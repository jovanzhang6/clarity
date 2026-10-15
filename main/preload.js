const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  chooseDir: () => ipcRenderer.invoke('dir:choose'),

  // 画面源
  listSources: () => ipcRenderer.invoke('sources:list'),
  getRecentRecordings: (dir) => ipcRenderer.invoke('recordings:recent', dir),
  selectDisplaySource: (id) => ipcRenderer.send('display:select', id),
  playTestTone: (seconds) => ipcRenderer.invoke('test:tone', seconds),

  // 录制生命周期
  recStart: (saveDir) => ipcRenderer.invoke('recording:start', { saveDir }),
  recChunk: (buf) => ipcRenderer.invoke('recording:chunk', buf),
  recFinish: (durationMs) => ipcRenderer.invoke('recording:finish', { durationMs }),
  recCancel: () => ipcRenderer.invoke('recording:cancel'),
  tempDelete: (p) => ipcRenderer.invoke('temp:delete', p),

  // 保存
  encode: (opts) => ipcRenderer.invoke('encode:start', opts),
  probe: (p) => ipcRenderer.invoke('probe', p),
  onEncodeProgress: (cb) => ipcRenderer.on('encode:progress', (_e, pct) => cb(pct)),
  revealPath: (p) => ipcRenderer.invoke('shell:reveal', p),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),

  // 窗口与迷你条
  miniShow: () => ipcRenderer.invoke('mini:show'),
  miniRestore: () => ipcRenderer.invoke('mini:restore'),
  miniHide: () => ipcRenderer.invoke('mini:hide'),
  miniTick: (data) => ipcRenderer.send('mini:tick', data),
  miniControl: (action) => ipcRenderer.send('mini:control', action),
  onMiniControl: (cb) => ipcRenderer.on('mini:control', (_e, action) => cb(action)),
  onMiniTick: (cb) => ipcRenderer.on('mini:tick', (_e, data) => cb(data)),
  setRecordingFlag: (flag) => ipcRenderer.send('state:recording', flag),

  // 退出流程
  onForceSave: (cb) => ipcRenderer.on('app:save-and-quit', () => cb()),
  onForceDiscard: (cb) => ipcRenderer.on('app:discard-and-quit', () => cb()),
  quit: () => ipcRenderer.invoke('app:quit'),

  // 自检
  grabFrame: (mp4, png, atSec) => ipcRenderer.invoke('frame:grab', { mp4, png, atSec }),
  frameBrightness: (png) => ipcRenderer.invoke('frame:brightness', png),
  audioVolume: (p) => ipcRenderer.invoke('audio:volume', p),
  playTestTone: (seconds) => ipcRenderer.invoke('test:tone', seconds),
  selftestReport: (report) => ipcRenderer.invoke('selftest:report', report),
});
