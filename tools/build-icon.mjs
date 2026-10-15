/* 澄录 logo 生成器：纯 Node 绘制（取景框 + 录制红点），输出 PNG 与多尺寸 ICO，零依赖。
   设计基准 64×64：墨色圆角方块，白色四角取景框，中心红色录制点。 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets');
fs.mkdirSync(outDir, { recursive: true });

// ---------- PNG 编码 ----------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 图形绘制（有符号距离，3× 超采样抗锯齿） ----------
const INK = [24, 24, 27], WHITE = [255, 255, 255], RED = [220, 38, 38];
const SEGMENTS = [
  // 左上
  [21, 28, 21, 24], [21, 24, 24, 21], [24, 21, 28, 21],
  // 右上
  [43, 28, 43, 24], [43, 24, 40, 21], [40, 21, 36, 21],
  // 左下
  [21, 36, 21, 40], [21, 40, 24, 43], [24, 43, 28, 43],
  // 右下
  [43, 36, 43, 40], [43, 40, 40, 43], [40, 43, 36, 43],
];
const STROKE = 3.6, DOT_R = 7, DOT = [32, 32];

function inRoundedRect(x, y) {
  const half = 30, rad = 15, cx = 32, cy = 32;
  const qx = Math.abs(x - cx) - (half - rad);
  const qy = Math.abs(y - cy) - (half - rad);
  const outX = Math.max(qx, 0), outY = Math.max(qy, 0);
  const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(outX, outY);
  return d <= rad;
}
function segDist(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function renderIcon(S) {
  const ss = 3, W = S * ss;
  const buf = Buffer.alloc(S * S * 4);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px * ss + sx + 0.5) / ss * (64 / S);
          const y = (py * ss + sy + 0.5) / ss * (64 / S);
          let c = null;
          if (inRoundedRect(x, y)) c = INK;
          for (const seg of SEGMENTS) {
            if (segDist(x, y, seg) <= STROKE / 2) { c = WHITE; break; }
          }
          if (c !== WHITE && Math.hypot(x - DOT[0], y - DOT[1]) <= DOT_R) c = RED;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = ss * ss, i = (py * S + px) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return buf;
}

// ---------- ICO 打包（PNG 条目） ----------
function packIco(sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  for (const { size, buf } of sizes) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...sizes.map((s) => s.buf)]);
}

const sizes = [16, 32, 48, 256].map((S) => ({ size: S, buf: encodePNG(renderIcon(S), S, S) }));
fs.writeFileSync(path.join(outDir, 'icon.ico'), packIco(sizes));
fs.writeFileSync(path.join(outDir, 'icon-256.png'), sizes.find((s) => s.size === 256).buf);
fs.writeFileSync(path.join(outDir, 'icon-32.png'), sizes.find((s) => s.size === 32).buf);
console.log('assets written:', fs.readdirSync(outDir).join(', '));
