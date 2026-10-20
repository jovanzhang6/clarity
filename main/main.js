const { app, BrowserWindow, ipcMain, dialog, shell, desktopCapturer, powerSaveBlocker, Menu, session, globalShortcut, Tray } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { computeTargetDims, encode, probe, grabFrame, frameBrightness, audioVolume } = require('./encoder');
const { TempWriter, cleanupOrphans, PREFIX } = require('./writer');
const { uniquePath } = require('./utils');

const isSelftest = process.argv.includes('--selftest');

let mainWin = null;
let miniWin = null;
let tray = null;
let writer = null;
let recordingFlag = false;
let forceQuitting = false;
let powerId = null;

// 托盘：常驻。左键 = 智能恢复（录制中呼出迷你条，否则显示主窗口）；右键 = 菜单
function createTray() {
  try {
    tray = new Tray(ICON);
    tray.setToolTip('Clarity');
    const rebuildMenu = () => Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { miniWin?.hide(); mainWin?.show(); mainWin?.focus(); } },
      ...(recordingFlag ? [{ label: '显示迷你条', click: () => { mainWin?.hide(); if (!miniWin) createMini(); miniWin.showInactive(); } }] : []),
      { type: 'separator' },
      { label: '退出 Clarity', click: () => { forceQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(rebuildMenu());
    tray.on('click', () => {
      if (recordingFlag) {
        mainWin?.hide();
        if (!miniWin) createMini();
        miniWin.showInactive();
      } else {
        miniWin?.hide();
        mainWin?.show();
        mainWin?.focus();
      }
    });
  } catch (err) {
    console.error('[clarity] tray create failed:', err.message);
    tray = null;
  }
}

app.setName('clarity');
Menu.setApplicationMenu(null);

// 从旧目录名迁移配置（项目曾用名 jianlu）
function migrateOldUserData() {
  try {
    const newDir = app.getPath('userData');
    const oldDir = path.join(path.dirname(newDir), 'jianlu');
    if (fs.existsSync(path.join(oldDir, 'config.json')) && !fs.existsSync(path.join(newDir, 'config.json'))) {
      fs.mkdirSync(newDir, { recursive: true });
      fs.copyFileSync(path.join(oldDir, 'config.json'), path.join(newDir, 'config.json'));
      console.log('[clarity] config migrated from', oldDir);
    }
  } catch { /* 迁移失败不阻塞启动 */ }
}

// 诊断开关：WGC 会话被系统卡住时，JIANLU_CAPTURE=gdi 绕过 Windows Graphics Capture 走旧管线
if (process.env.JIANLU_CAPTURE === 'gdi') {
  app.commandLine.appendSwitch('disable-features', 'WGCDesktopCapture,WGCWindowCapture');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { mainWin.show(); mainWin.focus(); }
  });
}

function stopPower() {
  if (powerId != null) { powerSaveBlocker.stop(powerId); powerId = null; }
}

const ICON = path.join(__dirname, '..', 'assets', 'icon.ico');

function createMain() {
  mainWin = new BrowserWindow({
    width: 1000,
    height: 704,
    minWidth: 880,
    minHeight: 600,
    title: 'Clarity',
    icon: ICON,
    backgroundColor: '#f6f6f7',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', isSelftest ? 'selftest.html' : 'index.html'));
  mainWin.on('page-title-updated', (e) => e.preventDefault());
  // 渲染端面包屑落到 stdout：录制/保存链路出问题可从日志逐步定位
  mainWin.webContents.on('console-message', (_e, _level, message) => {
    if (String(message).startsWith('[clarity]')) console.log(message);
  });
  mainWin.on('close', async (e) => {
    if (forceQuitting || !recordingFlag) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(mainWin, {
      type: 'question',
      title: '正在录制',
      message: '还有一段录制在进行',
      detail: '退出前要先处理这段录制。',
      buttons: ['保存并退出', '丢弃并退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) mainWin.webContents.send('app:save-and-quit');
    else if (response === 1) mainWin.webContents.send('app:discard-and-quit');
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function createMini() {
  miniWin = new BrowserWindow({
    width: 320,
    height: 50,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    icon: ICON,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  miniWin.setAlwaysOnTop(true, 'screen-saver');
  // 捕获排除：悬浮条只给操作者看，录制内容里完全不存在（Windows WDA_EXCLUDEFROMCAPTURE）
  miniWin.setContentProtection(true);
  miniWin.loadFile(path.join(__dirname, '..', 'renderer', 'mini.html'));
  miniWin.on('closed', () => { miniWin = null; });
}

function selfExcludeIds() {
  return [mainWin, miniWin].filter(Boolean).map((w) => w.getMediaSourceId());
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'audioCapture');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'audioCapture');

  // 系统声音走 Electron loopback 通道（Chromium gUM 的 chromeMediaSource:'system' 回环
  // 在部分机器上只输出静音，loopback 才是真声）。渲染端 getDisplayMedia 前先经
  // display:select 声明目标源，这里自动应答、不弹系统选择器。
  let displaySourceRequest = null; // { id, at }
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    (async () => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } });
      let hit = null;
      if (displaySourceRequest && Date.now() - displaySourceRequest.at < 8000) {
        hit = sources.find((s) => s.id === displaySourceRequest.id);
      }
      if (!hit) hit = sources.find((s) => s.kind === 'screen');
      if (hit) callback({ video: hit, audio: 'loopback' });
      else callback({});
    })().catch(() => callback({}));
  });

  ipcMain.on('display:select', (_e, id) => {
    displaySourceRequest = { id: String(id || ''), at: Date.now() };
  });
  // 迷你条最小化：隐藏悬浮条；Alt+Shift+C 全局呼出/隐藏（仅录制中生效）
  ipcMain.handle('mini:hide', () => { miniWin?.hide(); });
  globalShortcut.register('Alt+Shift+C', () => {
    if (!recordingFlag) return;
    if (miniWin && miniWin.isVisible()) miniWin.hide();
    else {
      mainWin?.hide();
      if (!miniWin) createMini();
      miniWin.showInactive();
    }
  });
  // 自检用：播放 4 秒测试音（系统回环是否有真实内容，靠它验证）
  ipcMain.handle('test:tone', (_e, seconds = 4) => {
    const proc = spawn('ffplay', ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${Number(seconds) || 4}`, '-volume', '30', '-autoexit', '-loglevel', 'quiet'], { windowsHide: true, stdio: 'ignore' });
    proc.on('error', () => {});
    return true;
  });

  migrateOldUserData();
  config.init(app.getPath('userData'));

  // 上次异常退出留下的孤儿临时文件，静默回收（保留 24h 内的，防止误删极少见的并发场景）
  const cfg = config.load();
  cleanupOrphans(cfg.saveDir).catch(() => {});

  createMain();
  createTray(); // 托盘兜底：迷你条最小化后可从这里恢复
  if (isSelftest) createMini(); // 自检也验证迷你条窗口能正常创建

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// ---------- 配置 ----------
ipcMain.handle('config:get', () => config.load());
ipcMain.handle('config:set', (_e, patch) => config.save(patch));
ipcMain.handle('dir:choose', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: '选择保存位置',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: config.load().saveDir,
  });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- 画面源 ----------
ipcMain.handle('sources:list', async () => {
  const selfIds = selfExcludeIds();
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });
  return sources
    .filter((s) => !selfIds.includes(s.id))
    .map((s) => ({
      id: s.id,
      kind: s.id.startsWith('screen') ? 'screen' : 'window',
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      icon: s.appIcon ? s.appIcon.toDataURL() : null,
    }));
});

// 最近录像：保存目录下按修改时间倒序的 mp4（排除录制临时文件）
ipcMain.handle('recordings:recent', (_e, dir) => {
  try {
    const files = fs
      .readdirSync(String(dir || ''))
      .filter((f) => f.toLowerCase().endsWith('.mp4') && !f.startsWith(PREFIX))
      .map((name) => {
        const full = path.join(String(dir), name);
        const st = fs.statSync(full);
        return { name, size: st.size, mtime: st.mtimeMs, path: full };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3);
    return { ok: true, items: files };
  } catch {
    return { ok: false, items: [] };
  }
});

// ---------- 录制 ----------
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

ipcMain.handle('recording:start', async (_e, { saveDir }) => {
  writer = new TempWriter();
  await writer.start(saveDir);
  if (powerId == null) powerId = powerSaveBlocker.start('prevent-display-sleep');
  return { tempPath: writer.filePath };
});

ipcMain.handle('recording:chunk', async (_e, buf) => {
  if (!writer) throw new Error('没有进行中的录制');
  await writer.append(toBuffer(buf));
  return writer.bytes;
});

ipcMain.handle('recording:finish', async () => {
  if (!writer) throw new Error('没有进行中的录制');
  const res = await writer.finish();
  writer = null;
  stopPower();
  return res;
});

ipcMain.handle('recording:cancel', async () => {
  if (!writer) return { deleted: true };
  const res = await writer.cancel();
  writer = null;
  stopPower();
  return res;
});

ipcMain.handle('temp:delete', (_e, p) => {
  const base = path.basename(String(p || ''));
  // 只允许删自己命名规则的临时文件，路径随意拼一律拒绝
  if (!base.startsWith(PREFIX)) return { deleted: false, reason: '非法路径' };
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { deleted: true };
  } catch (err) {
    return { deleted: false, reason: String(err.message || err) };
  }
});

// ---------- 保存 ----------
ipcMain.handle('encode:start', (_e, opts) => {
  const { tempPath, outPath, resolution, srcW, srcH, hasAudio, durationMs } = opts;
  const target = resolution === 'original' ? null : Number(resolution.replace('p', ''));
  const dims = computeTargetDims(srcW, srcH, target);
  const finalOut = uniquePath(outPath);
  return encode({
    tempPath,
    outPath: finalOut,
    scaleWidth: dims ? dims.width : null,
    scaleHeight: dims ? dims.height : null,
    hasAudio,
    durationMs,
    onProgress: (pct) => mainWin?.webContents.send('encode:progress', pct),
  })
    .then((r) => {
      fs.unlink(tempPath, () => {}); // 成功即清原始 webm
      return { ok: true, outPath: finalOut, sizeBytes: r.sizeBytes };
    })
    .catch((err) => ({ ok: false, error: String(err.message || err) })); // 失败保留 webm 供重试/丢弃
});

ipcMain.handle('probe', (_e, p) => probe(p));
ipcMain.handle('frame:grab', (_e, { mp4, png, atSec }) => grabFrame(mp4, png, atSec));
ipcMain.handle('frame:brightness', (_e, png) => frameBrightness(png));
ipcMain.handle('audio:volume', (_e, p) => audioVolume(p));

ipcMain.handle('shell:reveal', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));

// ---------- 窗口与迷你条 ----------
ipcMain.handle('mini:show', () => {
  mainWin?.hide();
  if (!miniWin) createMini();
  miniWin.showInactive();
});
ipcMain.handle('mini:restore', () => {
  miniWin?.hide();
  mainWin?.show();
  mainWin?.focus();
});
ipcMain.on('mini:tick', (_e, data) => miniWin?.webContents.send('mini:tick', data));
ipcMain.on('mini:control', (_e, action) => mainWin?.webContents.send('mini:control', action));
ipcMain.on('state:recording', (_e, flag) => { recordingFlag = !!flag; });
ipcMain.handle('app:quit', () => { forceQuitting = true; app.quit(); });

// ---------- 自检 ----------
ipcMain.handle('selftest:report', (_e, report) => {
  const outPath = path.join(process.cwd(), 'selftest-result.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('SELFTEST ' + (report.ok ? 'PASS' : 'FAIL') + ' -> ' + outPath);
  return true;
});
