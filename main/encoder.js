const { spawn } = require('child_process');
const fs = require('fs');

const even = (n) => {
  n = Math.max(2, Math.floor(n));
  return n % 2 === 0 ? n : n - 1;
};

/**
 * 计算转码目标尺寸：短边压到 targetShortSide，只缩不放，宽高取偶。
 * 返回 null 表示不需要缩放（仅做偶数对齐）。
 */
function computeTargetDims(srcW, srcH, targetShortSide) {
  if (!srcW || !srcH || !targetShortSide) return null;
  const short = Math.min(srcW, srcH);
  if (short <= targetShortSide) return null;
  const f = targetShortSide / short;
  return { width: even(Math.round(srcW * f)), height: even(Math.round(srcH * f)) };
}

/** 构造 ffmpeg 参数（纯函数，便于测试与排查） */
function buildEncodeArgs({ tempPath, outPath, scaleWidth, scaleHeight, hasAudio }) {
  const vf =
    scaleWidth && scaleHeight
      ? `scale=${scaleWidth}:${scaleHeight}`
      : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const args = [
    '-hide_banner', '-y',
    '-i', tempPath,
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
  ];
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
  else args.push('-an');
  args.push('-movflags', '+faststart', '-f', 'mp4', outPath, '-progress', 'pipe:1', '-nostats');
  return args;
}

/**
 * webm → mp4。onProgress(pct) 基于"已录时长"解析 ffmpeg -progress 输出。
 * 转码失败时保留临时 webm，由上层决定重试或丢弃。
 */
function encode({ tempPath, outPath, scaleWidth, scaleHeight, hasAudio, durationMs, onProgress }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(tempPath)) return reject(new Error('找不到录制的临时文件'));
    const args = buildEncodeArgs({ tempPath, outPath, scaleWidth, scaleHeight, hasAudio });
    const proc = spawn('ffmpeg', args, { windowsHide: true });
    let stderrTail = '';
    let lastPct = -1;
    proc.stdout.on('data', (d) => {
      const m = String(d).match(/out_time_us=(\d+)/);
      if (m && durationMs > 0 && onProgress) {
        const pct = Math.min(99, Math.round((Number(m[1]) / 1000 / durationMs) * 100));
        if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
      }
    });
    proc.stderr.on('data', (d) => { stderrTail = (stderrTail + String(d)).slice(-2000); });
    proc.on('error', (err) => reject(new Error('ffmpeg 启动失败：' + err.message)));
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        if (onProgress) onProgress(100);
        resolve({ sizeBytes: fs.statSync(outPath).size });
      } else {
        const lines = stderrTail.split('\n').filter((l) => l.trim()).slice(-3).join(' ');
        reject(new Error(`ffmpeg 转码失败（code ${code}）: ${lines}`));
      }
    });
  });
}

function runCapture(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', (e) => reject(new Error(`${bin} 启动失败：${e.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.split('\n').filter(Boolean).slice(-3).join(' ') || `${bin} 退出码 ${code}`));
      resolve(out);
    });
  });
}

/** 读取媒体信息 JSON（自检用） */
function probe(filePath) {
  return runCapture('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath])
    .then((out) => JSON.parse(out));
}

/** 抽一帧预览图 */
function grabFrame(mp4Path, pngPath, atSec = 2) {
  return runCapture('ffmpeg', ['-hide_banner', '-y', '-ss', String(atSec), '-i', mp4Path, '-frames:v', '1', pngPath])
    .then(() => pngPath);
}

/** 帧平均亮度（signalstats YAVG，0=纯黑），用于验证抽到的帧不是黑屏。输出在 stderr。 */
function frameBrightness(pngPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-i', pngPath, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const m = err.match(/YAVG=([\d.]+)/);
      resolve(m ? Number(m[1]) : null);
    });
  });
}

/** 平均响度（volumedetect mean_volume，dB；-91 附近=数字静音），自检用 */
function audioVolume(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const m = err.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
      resolve(m ? Number(m[1]) : null);
    });
  });
}

module.exports = { computeTargetDims, buildEncodeArgs, encode, probe, grabFrame, frameBrightness, audioVolume };
