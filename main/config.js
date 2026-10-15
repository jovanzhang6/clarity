const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  saveDir: 'D:\\Recordings',
  resolution: '720p', // original | 1080p | 720p
  systemAudio: true,
  mic: false,
  micDeviceId: null,
  autoMini: true,
  countdown: 3, // 0 = 关闭倒计时
  openFolderAfterSave: false,
  lastSave: null, // { path, name }
};

let dir = null;

function init(userDataDir) {
  dir = userDataDir;
}

function file() {
  return path.join(dir, 'config.json');
}

function load() {
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(patch) {
  const next = { ...load(), ...patch };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { init, load, save, DEFAULTS };
