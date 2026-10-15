const fs = require('fs');
const path = require('path');

const p2 = (n) => String(n).padStart(2, '0');

/** 默认文件名（不含扩展名）：录制-20261009-170251 */
function makeRecordingName(d = new Date()) {
  return `录制-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

/** 路径去重：存在则追加 -2、-3… */
function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  for (let i = 2; ; i++) {
    const candidate = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

module.exports = { makeRecordingName, uniquePath };
