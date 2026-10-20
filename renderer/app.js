/* Clarity 渲染端：状态机 + 音频图 + 录制 + 保存 */
const $ = (id) => document.getElementById(id);

const state = {
  view: 'setup',
  config: null,
  sources: [],
  source: null,
  pickerTab: 'screen',

  sysOn: false,
  sysAnalyser: null,
  sysGain: null,
  sysSourceNode: null,

  previewStream: null, // 实时预览（视频 + 可选系统回环），选择源后常驻

  micOn: false,
  micStream: null,
  micAnalyser: null,
  micGain: null,
  micSourceNode: null,
  micDeviceId: null,

  audioCtx: null,
  mixedDest: null,

  recState: 'idle', // idle | countdown | recording | paused
  recorder: null,
  recDurationMs: 0,
  recBytes: 0,
  recTempPath: null,
  recSrcW: 0,
  recSrcH: 0,
  recHasAudio: false,
  _t0: 0,
  _pausedAt: 0,
  _pauseTotal: 0,
  _timerId: null,

  saved: null, // { outPath, sizeBytes }
};

const METER_SEGS = 12;

// ---------- 小工具 ----------
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const fmtBytes = (b) => {
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 应用内对话框：原生 confirm/alert 会无焦点阻塞渲染进程，一律禁用
function uiConfirm(msg, okText = '确定', cancelText = '取消') {
  return new Promise((resolve) => {
    $('dialog-msg').textContent = msg;
    $('dialog-ok').textContent = okText;
    $('dialog-ok').classList.add('primary');
    $('dialog-cancel').hidden = !cancelText;
    $('dialog-cancel').textContent = cancelText || '取消';
    $('dialog-modal').hidden = false;
    const done = (v) => {
      $('dialog-modal').hidden = true;
      $('dialog-ok').onclick = null;
      $('dialog-cancel').onclick = null;
      resolve(v);
    };
    $('dialog-ok').onclick = () => done(true);
    $('dialog-cancel').onclick = () => done(false);
  });
}
const uiAlert = (msg) => uiConfirm(msg, '知道了', null);

// 关键路径面包屑：主进程会把 renderer console 落到 stdout，出问题能从日志定位
const log = (...args) => console.log('[clarity]', ...args);

function show(view) {
  state.view = view;
  $('view-setup').hidden = view !== 'setup';
  $('view-recording').hidden = view !== 'recording';
  $('view-save').hidden = view !== 'save';
}

function setMeta() {
  const src = state.source ? (state.source.kind === 'screen' ? '屏幕' : '窗口') + '：' + state.source.name : '尚未选择画面';
  const aud = state.sysOn && state.micOn ? '系统声音+麦克风' : state.sysOn ? '仅系统声音' : state.micOn ? '仅麦克风' : '无声';
  $('setup-meta').textContent = state.source ? `${src} · 声音：${aud}` : src;
  $('btn-record').disabled = !state.source;
}

// ---------- 音量表 ----------
function buildMeters() {
  for (const id of ['meter-system', 'meter-mic']) {
    $(id).innerHTML = '<i></i>'.repeat(METER_SEGS);
  }
}

function meterLoop() {
  drawMeter('meter-system', state.sysAnalyser);
  drawMeter('meter-mic', state.micAnalyser);
  requestAnimationFrame(meterLoop);
}

// 音量条刻度：dBFS 对数映射（-40dB 底 / 0dB 顶格），环境底噪（约-45dB）不会点亮
const METER_FLOOR_DB = 40;
const METER_GATE = 0.06; // 噪声门：低于刻度 6% 一律全灰
const meterLevels = {}; // 各表上次电平，用于起音快/回落慢的平滑

function drawMeter(elId, analyser) {
  const segs = $(elId).children;
  let lit = 0;
  let hot = false;
  if (analyser) {
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    let level = 1 + db / METER_FLOOR_DB; // -40dB→0，0dB→1
    level = Math.max(0, Math.min(1, level));
    // 起音瞬时跟随，回落缓慢衰减，条形不闪烁
    const prev = meterLevels[elId] || 0;
    level = Math.max(level, prev * 0.86);
    // 噪声门：安静环境保持全灰
    if (level < METER_GATE) level = 0;
    meterLevels[elId] = level;
    lit = Math.round(level * METER_SEGS);
    hot = level > 0.85;
  }
  for (let i = 0; i < METER_SEGS; i++) {
    segs[i].className = i < lit ? (hot && i >= METER_SEGS - 3 ? 'hot' : 'lit') : '';
  }
}

// ---------- 音频图 ----------
function ensureAudioCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new AudioContext();
    state.mixedDest = state.audioCtx.createMediaStreamDestination();
  }
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  return state.audioCtx;
}

async function attachBranch(which, stream) {
  const ctx = ensureAudioCtx();
  // 统一用 MediaStreamSource 直连——实测本机回环轨走"元素中转"只会得到静音
  const node = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.55;
  const gain = ctx.createGain();
  gain.gain.value = 1;
  node.connect(analyser);
  analyser.connect(gain);
  gain.connect(state.mixedDest);
  if (which === 'system') { state.sysAnalyser = analyser; state.sysGain = gain; state.sysSourceNode = node; }
  else { state.micAnalyser = analyser; state.micGain = gain; state.micSourceNode = node; }
}

function detachBranch(which) {
  const key = which === 'system' ? 'sys' : 'mic';
  const analyser = state[`${key}Analyser`];
  const node = state[`${key}SourceNode`];
  const gain = state[`${key}Gain`];
  try { node && node.disconnect(); } catch {}
  try { analyser && analyser.disconnect(); } catch {}
  try { gain && gain.disconnect(); } catch {}
  state[`${key}Analyser`] = null;
  state[`${key}SourceNode`] = null;
}

// ---------- 实时预览（纯视频，常驻不中断） ----------
async function startPreview() {
  stopPreviewStream();
  if (!state.source) return;
  try {
    const s = await window.clarityCapture.acquirePreview(state.source);
    state.previewStream = s;
    const vid = $('preview-video');
    vid.srcObject = s;
    await vid.play().catch(() => {});
    vid.hidden = false;
    $('source-empty').hidden = true;
    const vt = s.getVideoTracks()[0];
    if (vt) {
      const st = vt.getSettings();
      const ratio = (st.width || 0) / (st.height || 0);
      if (ratio > 0) {
        $('source-preview').style.aspectRatio = String(Math.min(2.4, Math.max(1.2, ratio)));
      }
    }
  } catch (err) {
    $('hint-system').textContent = state.sysOn ? '实时预览不可用（' + shortErr(err) + '）' : '';
    $('hint-system').className = 'audio-hint error';
  }
}

function stopPreviewStream() {
  if (state.previewStream) {
    state.previewStream.getTracks().forEach((t) => t.stop());
    state.previewStream = null;
  }
  const vid = $('preview-video');
  if (vid) { vid.srcObject = null; vid.hidden = true; }
}

// ---------- 系统声音（独立于预览视频流，切换开关不闪预览） ----------
let sysAudioLoading = false;
async function startSystemAudio() {
  if (state.sysAudioLoading) return;
  state.sysAudioLoading = true;
  try {
    const stream = await window.clarityCapture.acquireSystemAudioOnly(state.source);
    if (!stream) {
      $('hint-system').textContent = '系统声音不可用（录制时仍会尝试）';
      $('hint-system').className = 'audio-hint error';
    } else {
      state.sysAudioStream = stream;
      await attachBranch('system', stream);
      $('hint-system').textContent = '已就绪';
      $('hint-system').className = 'audio-hint live';
    }
  } catch (err) {
    $('hint-system').textContent = '系统声音不可用（' + shortErr(err) + '）';
    $('hint-system').className = 'audio-hint error';
  }
  state.sysAudioLoading = false;
}

function stopSystemAudio() {
  detachBranch('system');
  if (state.sysAudioStream) {
    state.sysAudioStream.getTracks().forEach((t) => t.stop());
    state.sysAudioStream = null;
  }
}

// ---------- 系统声音开关 ----------
function enableSystem() {
  state.sysOn = true;
  window.api.setConfig({ systemAudio: true });
  syncToggleUI();
  $('hint-system').textContent = '正在获取系统声音…';
  $('hint-system').className = 'audio-hint';
  startSystemAudio();
}

function disableSystem() {
  state.sysOn = false;
  window.api.setConfig({ systemAudio: false });
  stopSystemAudio();
  $('hint-system').textContent = '';
  $('hint-system').className = 'audio-hint';
  syncToggleUI();
}

// ---------- 麦克风开关 ----------
async function enableMic() {
  $('hint-mic').textContent = '正在获取麦克风…';
  $('hint-mic').className = 'audio-hint';
  try {
    const constraint = state.micDeviceId ? { deviceId: { exact: state.micDeviceId } } : true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
    state.micStream = stream;
    await attachBranch('mic', stream);
    state.micOn = true;
    window.api.setConfig({ mic: true, micDeviceId: state.micDeviceId });
    $('hint-mic').textContent = '已就绪';
    $('hint-mic').className = 'audio-hint live';
    await refreshMicDevices();
  } catch (err) {
    state.micOn = false;
    $('hint-mic').textContent = '麦克风获取失败（' + shortErr(err) + '），去 Windows 设置 > 隐私 > 麦克风 允许桌面应用';
    $('hint-mic').className = 'audio-hint error';
  }
  syncToggleUI();
}

function disableMic() {
  if (state.micStream) state.micStream.getTracks().forEach((t) => t.stop());
  state.micStream = null;
  detachBranch('mic');
  state.micOn = false;
  window.api.setConfig({ mic: false });
  $('hint-mic').textContent = '';
  $('hint-mic').className = 'audio-hint';
  syncToggleUI();
}

function shortErr(err) {
  const s = String(err && err.message || err);
  if (/Permission|denied/i.test(s)) return '权限被拒绝';
  if (/NotFound|no.*device/i.test(s)) return '没有找到设备';
  if (/sys/i.test(s)) return '该设备不支持回环捕获';
  return s.slice(0, 60);
}

async function refreshMicDevices() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const mics = devs.filter((d) => d.kind === 'audioinput');
    const sel = $('mic-device');
    sel.innerHTML = '';
    for (const d of mics) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || '麦克风 ' + (sel.length + 1);
      sel.appendChild(opt);
    }
    if (state.micDeviceId) sel.value = state.micDeviceId;
    sel.hidden = !state.micOn || mics.length <= 1;
  } catch { /* 忽略 */ }
}

function syncToggleUI() {
  $('toggle-system').checked = state.sysOn;
  $('toggle-mic').checked = state.micOn;
  $('mic-device').hidden = !state.micOn;
  setMeta();
}

// ---------- 画面源 ----------
async function refreshSources() {
  // listSources 内部有 6s 超时护栏：挂起时返回空列表，绝不吊死界面
  state.sources = await window.clarityCapture.listSourcesSafe();
  state.sourcesAt = Date.now();
}

function renderPicker() {
  const grid = $('picker-grid');
  grid.innerHTML = '';
  const list = state.sources.filter((s) => s.kind === state.pickerTab);
  $('picker-empty').hidden = list.length > 0;
  $('picker-empty').textContent = '没有可选的窗口——先开几个窗口再点「刷新」';
  for (const s of list) {
    const item = document.createElement('button');
    const isActive = state.source && s.id === state.source.id;
    item.className = 'picker-item' + (isActive ? ' active' : '');
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = s.thumbnail;
    const name = document.createElement('div');
    name.className = 'p-name';
    if (s.icon) {
      const icon = document.createElement('img');
      icon.className = 'icon';
      icon.src = s.icon;
      name.appendChild(icon);
    }
    const span = document.createElement('span');
    span.textContent = s.name || '(无标题窗口)';
    span.title = s.name;
    name.appendChild(span);
    item.appendChild(img);
    item.appendChild(name);
    item.addEventListener('click', () => {
      selectSource(s);
      closePicker();
    });
    grid.appendChild(item);
  }
}

function selectSource(s) {
  state.source = s;
  $('source-kind').textContent = s.kind === 'screen' ? '屏幕' : '窗口';
  $('source-name').textContent = s.name;
  setMeta();
  startPreview(); // 实时预览跟随所选源重启
}

// ---------- 预览放大灯箱（同一预览流，点击即看大图） ----------
function openLightbox() {
  if (!state.previewStream) return;
  const v = $('lightbox-video');
  v.srcObject = state.previewStream;
  v.play().catch(() => {});
  $('lightbox-caption').textContent = '实时预览 · ' + (state.source.kind === 'screen' ? '屏幕' : '窗口') + '：' + state.source.name;
  $('lightbox').hidden = false;
}
function closeLightbox() { $('lightbox').hidden = true; }

async function openPicker(force) {
  $('picker-modal').hidden = false; // 先弹窗，加载放在窗口里，避免点击后无响应
  const cacheAge = Date.now() - (state.sourcesAt || 0);
  if (force || !state.sources.length || cacheAge > 10000) {
    $('picker-grid').innerHTML = '';
    $('picker-empty').hidden = false;
    $('picker-empty').textContent = '正在获取画面源…';
    await refreshSources();
  }
  renderPicker();
}
function closePicker() { $('picker-modal').hidden = true; }

// ---------- 录制 ----------
function pickVBR(h) {
  if (h >= 2160) return 20_000_000;
  if (h >= 1440) return 12_000_000;
  if (h >= 1080) return 8_000_000;
  return 5_000_000;
}

function elapsedMs() {
  if (state.recState === 'paused') return state._pauseTotal + (state._pausedAt - state._t0);
  return state._pauseTotal + (Date.now() - state._t0);
}

async function countdown() {
  const seconds = Number(state.config.countdown ?? 3);
  if (!seconds) return; // 0 = 关闭倒计时
  const overlay = $('countdown');
  overlay.hidden = false;
  let cancelled = false;
  $('btn-countdown-cancel').onclick = () => { cancelled = true; };
  for (let n = seconds; n >= 1; n--) {
    $('countdown-num').textContent = String(n);
    await sleep(1000);
    if (cancelled) break;
  }
  overlay.hidden = true;
  if (cancelled) throw new Error('已取消');
}

async function startRecording() {
  if (!state.source || state.recState !== 'idle') return;
  log('record: begin, source =', state.source.kind, state.source.id);
  try {
    await countdown();
    log('record: countdown done');
  } catch {
    log('record: countdown cancelled');
    return; // 用户取消
  }

  $('btn-record').disabled = true;
  closePicker();

  // 倒计时一结束立即离场：迷你条已捕获排除，先出现不会录入画面。
  // 采集初始化（1-3s）在离场之后进行，迷你条先显示“启动中”呼吸态。
  if ($('toggle-autohide').checked) {
    window.api.miniShow();
    window.api.miniTick({ recState: 'starting', elapsedMs: 0, sysOn: state.sysOn, micOn: state.micOn });
  } else {
    show('recording');
    $('rec-badge').textContent = '启动中…';
    $('rec-badge').className = 'badge state-paused';
  }

  try {
    stopPreviewStream(); // 释放预览采集，录制换全分辨率通道
    stopSystemAudio(); // 系统声音表与录制各自重新采集
    const cfg = state.config;
    const { tempPath } = await window.api.recStart(cfg.saveDir);
    state.recTempPath = tempPath;
    log('record: temp file opened =', tempPath);

    // 纯视频轨：系统声音与麦克风都走混音图（可在录制中实时开关）
    const vs = await window.clarityCapture.acquirePreview(state.source);
    const videoTrack = vs.getVideoTracks()[0];
    state._recStreams = [vs];

    // 系统声音：独立纯音频 loopback（与预览互不干扰，支持录制中动态补采）
    if (state.sysOn) {
      const sysStream = await window.clarityCapture.acquireSystemAudioOnly(state.source).catch(() => null);
      if (sysStream) {
        state.sysAudioStream = sysStream;
        await attachBranch('system', sysStream);
        log('record: system audio branch wired (audio-only loopback)');
      } else {
        log('record: system audio unavailable, asking user');
        const goOn = await uiConfirm(
          '系统声音捕获失败（设备可能不支持回环，或被其他程序占用）。要继续只录画面（无声）吗？',
          '继续录无声',
          '取消录制',
        );
        if (!goOn) throw new Error('已取消：系统声音不可用');
      }
    }

    // 混音轨常驻进录制流：系统声音/麦克风可在录制中实时开关（关=写入数字静音）
    state.recHasAudio = true;
    const tracks = [videoTrack, ...state.mixedDest.stream.getAudioTracks()];

    const st = videoTrack.getSettings();
    state.recSrcW = Math.round(st.width || 0);
    state.recSrcH = Math.round(st.height || 0);

    const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t));
    state.recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: mime,
      videoBitsPerSecond: pickVBR(state.recSrcH),
      audioBitsPerSecond: 128000,
    });
    // 分片写入串行成链，stop() 后等链排干再关文件，保证"收到的字节 == 磁盘字节"
    state._writeChain = Promise.resolve();
    state.recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      state.recBytes += e.data.size;
      state._writeChain = state._writeChain.then(async () => {
        await window.api.recChunk(await e.data.arrayBuffer());
      }).catch((err) => {
        failRecording('写入磁盘失败，录制已中止：' + String(err.message || err));
      });
    };

    state.recState = 'recording';
    state._t0 = Date.now();
    state._pauseTotal = 0;
    state.recBytes = 0;
    state.recorder.start(1000);
    window.api.setRecordingFlag(true);
    log('record: recorder started, video', state.recSrcW + 'x' + state.recSrcH, 'audio =', state.recHasAudio);

    // 徽章从“启动中”转正
    $('rec-badge').textContent = '录制中';
    $('rec-badge').className = 'badge state-rec';

    // 录制视图里放一路实时监视器，所见即所录
    const monitor = $('rec-monitor');
    if (monitor) { monitor.srcObject = new MediaStream([videoTrack]); monitor.play().catch(() => {}); }

    updateRecUI();
    state._timerId = setInterval(updateRecUI, 250);

    if ($('toggle-autohide').checked) window.api.miniShow(); // 已在离场时显示过，这里保底
  } catch (err) {
    // 采集阶段失败：清理干净回到准备态
    log('record: FAILED -', String(err.message || err));
    try { state.recorder && state.recorder.state !== 'inactive' && state.recorder.stop(); } catch {}
    for (const s of state._recStreams || []) s.getTracks().forEach((t) => t.stop());
    state._recStreams = [];
    await window.api.recCancel().catch(() => {});
    state.recTempPath = null;
    window.api.setRecordingFlag(false);
    $('btn-record').disabled = !state.source;
    stopSystemAudio(); // 释放录制期回环（错误路径下可能已采集）
    show('setup'); // 之前已提前切到录制视图，失败必须回到准备态
    setMeta();
    startPreview(); // 回准备态，恢复实时预览
    if (state.sysOn) startSystemAudio();
    await uiAlert(err.message || String(err));
  }
}

function failRecording(msg) {
  // 磁盘写入失败等致命错误：尽力止损，回准备态
  log('record: fatal -', msg);
  try { state.recorder && state.recorder.state !== 'inactive' && state.recorder.stop(); } catch {}
  clearInterval(state._timerId);
  for (const s of state._recStreams || []) s.getTracks().forEach((t) => t.stop());
  state._recStreams = [];
  window.api.recCancel().catch(() => {});
  window.api.setRecordingFlag(false);
  state.recState = 'idle';
  state.recTempPath = null;
  window.api.miniRestore(); // 可能正收在迷你条，先把主窗口亮出来再报错
  show('setup');
  $('btn-record').disabled = !state.source;
  stopSystemAudio(); // 释放录制期回环
  startPreview();
  if (state.sysOn) startSystemAudio();
  uiAlert(msg);
}

function updateRecUI() {
  const ms = elapsedMs();
  $('rec-timer').textContent = fmtClock(ms);
  $('rec-size').textContent = '已录约 ' + fmtBytes(state.recBytes);
  if (state.recState === 'recording' || state.recState === 'paused') {
    window.api.miniTick({
      recState: state.recState,
      elapsedMs: ms,
      sysOn: state.sysOn,
      micOn: state.micOn,
    });
  }
}

// ---------- 录制中实时开关（迷你条） ----------
// 门控语义：关=从当前时刻起写入数字静音，开=恢复采集；都不打断录制
async function toggleSystemGate() {
  if (state.recState !== 'recording' && state.recState !== 'paused') return;
  if (state.sysOn) {
    state.sysOn = false;
    window.api.setConfig({ systemAudio: false });
    detachBranch('system'); // 增益断开，混音轨写入静音
    stopSystemAudio(); // 释放回环采集
    log('record: system audio gated OFF');
  } else {
    state.sysOn = true;
    window.api.setConfig({ systemAudio: true });
    const stream = await window.clarityCapture.acquireSystemAudioOnly(state.source).catch(() => null);
    if (stream) {
      state.sysAudioStream = stream;
      await attachBranch('system', stream);
      log('record: system audio gated ON');
    } else {
      state.sysOn = false;
      window.api.setConfig({ systemAudio: false });
      log('record: system audio re-acquire FAILED');
    }
  }
  syncToggleUI();
  updateRecUI();
}

async function toggleMicGate() {
  if (state.recState !== 'recording' && state.recState !== 'paused') return;
  if (state.micOn) {
    state.micOn = false;
    window.api.setConfig({ mic: false });
    detachBranch('mic'); // 增益断开，混音轨写入静音
    if (state.micStream) {
      state.micStream.getTracks().forEach((t) => t.stop());
      state.micStream = null;
    }
    log('record: mic gated OFF');
  } else {
    try {
      const constraint = state.micDeviceId ? { deviceId: { exact: state.micDeviceId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
      state.micStream = stream;
      await attachBranch('mic', stream);
      state.micOn = true;
      window.api.setConfig({ mic: true });
      log('record: mic gated ON');
    } catch (err) {
      log('record: mic enable FAILED -', String(err.message || err));
    }
  }
  syncToggleUI();
  updateRecUI();
}

function pauseResume() {
  if (state.recState === 'recording') {
    state.recorder.pause();
    state._pausedAt = Date.now();
    state.recState = 'paused';
    $('btn-pause').textContent = '继续';
    $('rec-badge').textContent = '已暂停';
    $('rec-badge').className = 'badge state-paused';
  } else if (state.recState === 'paused') {
    state.recorder.resume();
    state._pauseTotal += Date.now() - state._pausedAt;
    state.recState = 'recording';
    $('btn-pause').textContent = '暂停';
    $('rec-badge').textContent = '录制中';
    $('rec-badge').className = 'badge state-rec';
  }
  updateRecUI();
}

async function stopRecording() {
  if (state.recState !== 'recording' && state.recState !== 'paused') return;
  log('record: stopping at', state.recDurationMs, 'ms');
  clearInterval(state._timerId);
  if (state.recState === 'paused') state._pauseTotal += Date.now() - state._pausedAt;
  state.recDurationMs = state._pauseTotal + (Date.now() - state._t0);

  const rec = state.recorder;
  await new Promise((resolve) => {
    rec.onstop = () => state._writeChain.then(resolve); // 等最后一个分片真正落盘
    try { rec.stop(); } catch { resolve(); }
  });
  state.recorder = null;

  const fin = await window.api.recFinish(state.recDurationMs);
  state.recTempPath = fin.tempPath;
  state.recBytes = fin.bytes;
  window.api.setRecordingFlag(false);
  state.recState = 'idle';
  log('record: finished, bytes =', fin.bytes);

  // 停掉录制用的全部采集流（视频流 + 可能独立存在的系统声音流）
  for (const s of state._recStreams || []) s.getTracks().forEach((t) => t.stop());
  state._recStreams = [];
  detachBranch('system');
  const monitor = $('rec-monitor');
  if (monitor) monitor.srcObject = null;
  startPreview(); // 恢复实时预览
  if (state.sysOn) startSystemAudio();

  enterSaveView();
}

// ---------- 保存 ----------
function audioDesc() {
  return state.sysOn && state.micOn ? '系统声音 + 麦克风' : state.sysOn ? '仅系统声音' : state.micOn ? '仅麦克风' : '无声';
}

function enterSaveView() {
  const facts = [
    '时长 ' + fmtClock(state.recDurationMs),
    '原始 ' + (state.recSrcW && state.recSrcH ? `${state.recSrcW}×${state.recSrcH}` : '未知'),
    '素材 ' + fmtBytes(state.recBytes),
    '声音 ' + audioDesc(),
  ];
  $('save-facts').textContent = '';
  for (const f of facts) {
    const s = document.createElement('span');
    s.textContent = f;
    $('save-facts').appendChild(s);
  }
  const resolution = getSeg('seg-res') || state.config.resolution || '720p';
  const resLabel = { original: '原始分辨率', '1080p': '1080p', '720p': '720p' }[resolution] || resolution;
  $('save-summary').textContent = `将按 ${resLabel} 保存到 ${state.config.saveDir}`;
  $('save-name').value = defaultName();
  $('save-progress').hidden = true;
  $('save-done').hidden = true;
  $('save-error').hidden = true;
  $('btn-save').disabled = false;
  $('btn-save-home').disabled = false;
  $('btn-discard').disabled = false;
  show('save');
}

function defaultName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `录制-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function setSeg(segId, value) {
  for (const b of $(segId).querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.v === value);
  }
}
function getSeg(segId) {
  return $(segId).querySelector('.active')?.dataset.v;
}

async function saveMp4(autoBackHome = false) {
  const name = $('save-name').value.trim().replace(/[\\/:*?"<>|]/g, '-');
  if (!name) { $('save-error').textContent = '文件名不能为空'; $('save-error').hidden = false; return; }
  const resolution = getSeg('seg-res') || '720p';
  const saveDir = $('save-dir').textContent;
  window.api.setConfig({ resolution, saveDir });
  state.config.resolution = resolution;
  state.config.saveDir = saveDir;
  log('save: begin, resolution =', resolution, ', dir =', saveDir, ', autoBackHome =', autoBackHome);

  $('btn-save').disabled = true;
  $('btn-save-home').disabled = true;
  $('btn-discard').disabled = true;
  $('save-error').hidden = true;
  $('save-progress').hidden = false;
  $('save-bar').style.width = '0%';
  $('save-pct').textContent = '转码中 0%';

  const res = await window.api.encode({
    tempPath: state.recTempPath,
    outPath: saveDir + '\\' + name + '.mp4',
    resolution,
    srcW: state.recSrcW,
    srcH: state.recSrcH,
    hasAudio: state.recHasAudio,
    durationMs: state.recDurationMs,
  });

  if (!res.ok) {
    log('save: FAILED -', res.error);
    $('save-progress').hidden = true;
    $('save-error').textContent = res.error + '（原始录制已保留，可重试或丢弃）';
    $('save-error').hidden = false;
    $('btn-save').disabled = false;
    $('btn-save-home').disabled = false;
    $('btn-discard').disabled = false;
    return;
  }

  state.saved = res;
  log('save: done =', res.outPath);
  $('save-progress').hidden = true;
  $('done-msg').textContent = '已保存：' + res.outPath + '（' + fmtBytes(res.sizeBytes) + '）';
  $('save-done').hidden = false;

  // 记住最近一次保存，准备页提供直达入口
  state.config.lastSave = { path: res.outPath, name: name + '.mp4' };
  window.api.setConfig({ lastSave: state.config.lastSave });
  updateLastSaveRow();
  if ($('toggle-openfolder').checked) window.api.revealPath(res.outPath);
  loadRecent();

  if (autoBackHome) {
    await sleep(1400); // 让“已保存”状态可见
    resetToSetup();
  }
}

// ---------- 最近录像（保存目录下最新 3 段） ----------
async function loadRecent() {
  const res = await window.api.getRecentRecordings(state.config.saveDir).catch(() => null);
  const items = (res && res.items) || [];
  const list = $('recent-list');
  const card = $('card-recent');
  card.hidden = false;
  if (!items.length) {
    // 空态：说人话 + 给出路（规范要求），卡保留占位
    list.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = '还没有录像——点右下角「开始录制」，录完的文件会出现在这里';
    list.appendChild(empty);
    return;
  }
  list.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = it.name;
    name.title = it.path;
    const size = document.createElement('span');
    size.className = 'recent-size';
    size.textContent = fmtBytes(it.size);
    const open = document.createElement('button');
    open.className = 'btn small';
    open.textContent = '打开';
    open.addEventListener('click', () => window.api.revealPath(it.path));
    row.append(name, size, open);
    list.appendChild(row);
  }
}

async function discardRecording() {
  const ok = await uiConfirm('确定丢弃这段录制？原始素材会立刻删除，无法恢复。', '丢弃', '留着');
  if (!ok) return;
  if (state.recTempPath) await window.api.tempDelete(state.recTempPath).catch(() => {});
  state.recTempPath = null;
  log('save: discarded');
  resetToSetup();
}

function updateLastSaveRow() {
  const last = state.config.lastSave;
  $('row-last').hidden = !last;
  if (last) {
    $('last-name').textContent = last.name;
    $('last-name').title = last.path;
  }
}

async function copySavedPath() {
  if (!state.saved) return;
  try {
    await navigator.clipboard.writeText(state.saved.outPath);
    const btn = $('btn-copy-path');
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制路径'; }, 2000);
  } catch { /* 剪贴板失败静默 */ }
}

function resetToSetup() {
  state.saved = null;
  show('setup');
  setMeta();
  refreshSources().then(() => {
    if (state.source) {
      // 刷新缩略图并恢复实时预览
      selectSource(state.sources.find((s) => s.id === state.source.id) || state.source);
    } else {
      startPreview();
    }
    if (state.sysOn) startSystemAudio();
  });
}

// ---------- 迷你条控制 ----------
window.api.onMiniControl((action) => {
  if (action === 'pause') pauseResume();
  else if (action === 'resume') pauseResume();
  else if (action === 'toggle-system') toggleSystemGate();
  else if (action === 'toggle-mic') toggleMicGate();
  else if (action === 'stop') {
    stopRecording()
      .then(() => window.api.miniRestore()) // 从迷你条停止后，主窗口要亮出保存页
      .catch((e) => uiAlert(String(e.message || e)));
  } else if (action === 'expand') window.api.miniRestore();
});

// ---------- 强制退出流程（主窗口关闭拦截） ----------
window.api.onForceSave(async () => {
  // 保存并退出：按当前配置直接落盘
  if (state.recState === 'recording' || state.recState === 'paused') {
    await stopRecording();
  }
  if (state.recTempPath) {
    const res = await window.api.encode({
      tempPath: state.recTempPath,
      outPath: state.config.saveDir + '\\' + defaultName() + '.mp4',
      resolution: state.config.resolution || '720p',
      srcW: state.recSrcW,
      srcH: state.recSrcH,
      hasAudio: state.recHasAudio,
      durationMs: state.recDurationMs,
    });
    if (res.ok) { window.api.quit(); return; }
    // 转码失败：把窗口亮出来，交给保存页处理
    window.api.miniRestore();
    enterSaveView();
    $('save-error').textContent = res.error;
    $('save-error').hidden = false;
  } else {
    window.api.quit();
  }
});

window.api.onForceDiscard(async () => {
  if (state.recState === 'recording' || state.recState === 'paused') {
    clearInterval(state._timerId);
    try { state.recorder && state.recorder.stop(); } catch {}
    for (const s of state._recStreams || []) s.getTracks().forEach((t) => t.stop());
    state._recStreams = [];
    await window.api.recCancel().catch(() => {});
    window.api.setRecordingFlag(false);
    state.recState = 'idle';
    state.recTempPath = null;
  }
  window.api.quit();
});

// ---------- 事件绑定 ----------
function bind() {
  $('btn-pick').addEventListener('click', openPicker);
  $('source-preview').addEventListener('click', openLightbox);
  $('lightbox').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeLightbox(); closePicker(); }
  });
  $('btn-close-picker').addEventListener('click', closePicker);
  $('picker-modal').addEventListener('click', (e) => { if (e.target === $('picker-modal')) closePicker(); });
  $('btn-refresh').addEventListener('click', async () => {
    $('picker-grid').innerHTML = '';
    $('picker-empty').hidden = false;
    $('picker-empty').textContent = '正在获取画面源…';
    await refreshSources();
    renderPicker();
  });
  for (const b of $('picker-tabs').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      state.pickerTab = b.dataset.v;
      setSeg('picker-tabs', state.pickerTab);
      renderPicker();
    });
  }
  setSeg('picker-tabs', state.pickerTab); // 初始高亮默认 tab（屏幕）

  $('toggle-system').addEventListener('change', (e) => (e.target.checked ? enableSystem() : disableSystem()));
  $('toggle-mic').addEventListener('change', (e) => (e.target.checked ? enableMic() : disableMic()));
  $('mic-device').addEventListener('change', async (e) => {
    state.micDeviceId = e.target.value || null;
    if (state.micOn) { disableMic(); await enableMic(); }
  });

  $('toggle-autohide').addEventListener('change', (e) => window.api.setConfig({ autoMini: e.target.checked }));
  for (const b of $('seg-countdown').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      setSeg('seg-countdown', b.dataset.v);
      state.config.countdown = Number(b.dataset.v);
      window.api.setConfig({ countdown: state.config.countdown });
    });
  }
  $('toggle-openfolder').addEventListener('change', (e) => window.api.setConfig({ openFolderAfterSave: e.target.checked }));
  $('btn-last-open').addEventListener('click', () => state.config.lastSave && window.api.revealPath(state.config.lastSave.path));

  $('btn-record').addEventListener('click', startRecording);
  $('btn-pause').addEventListener('click', pauseResume);
  $('btn-stop').addEventListener('click', () => stopRecording().catch((e) => uiAlert(String(e.message || e))));
  $('btn-minibar').addEventListener('click', () => window.api.miniShow());

  for (const b of $('seg-res').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      setSeg('seg-res', b.dataset.v);
      window.api.setConfig({ resolution: b.dataset.v });
      state.config.resolution = b.dataset.v;
    });
  }
  $('btn-browse').addEventListener('click', async () => {
    const dir = await window.api.chooseDir();
    if (dir) {
      $('save-dir').textContent = dir;
      $('save-dir').title = dir;
      window.api.setConfig({ saveDir: dir });
      state.config.saveDir = dir;
    }
  });
  $('btn-open-dir').addEventListener('click', () => window.api.openPath($('save-dir').textContent));
  $('btn-save').addEventListener('click', () => saveMp4(false));
  $('btn-save-home').addEventListener('click', () => saveMp4(true));
  $('btn-discard').addEventListener('click', discardRecording);
  $('btn-copy-path').addEventListener('click', copySavedPath);
  $('btn-reveal').addEventListener('click', () => state.saved && window.api.revealPath(state.saved.outPath));
  $('btn-again').addEventListener('click', resetToSetup);
}

// ---------- 启动 ----------
window.addEventListener('DOMContentLoaded', async () => {
  buildMeters();
  requestAnimationFrame(meterLoop);
  bind();
  window.api.onEncodeProgress((pct) => {
    $('save-bar').style.width = pct + '%';
    $('save-pct').textContent = '转码中 ' + pct + '%';
  });

  state.config = await window.api.getConfig();
  $('toggle-autohide').checked = state.config.autoMini !== false;
  setSeg('seg-countdown', String(state.config.countdown ?? 3));
  $('toggle-openfolder').checked = !!state.config.openFolderAfterSave;
  updateLastSaveRow();
  setSeg('seg-res', state.config.resolution || '720p');
  $('save-dir').textContent = state.config.saveDir;
  $('save-dir').title = state.config.saveDir;
  loadRecent();

  // 先落状态位，再选源——startPreview 依赖 sysOn 决定是否带系统音轨
  state.sysOn = !!state.config.systemAudio;
  syncToggleUI();

  await refreshSources();
  const primary = state.sources.find((s) => s.kind === 'screen');
  if (primary) selectSource(primary);
  if (state.sysOn) startSystemAudio();

  if (state.config.mic) {
    await refreshMicDevices();
    await enableMic();
  }
  await refreshMicDevices();
  syncToggleUI();
});
