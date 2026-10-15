/* 宣传素材录制 v2：Page.startScreencast 推流截帧 → docs/demo.gif + release demo.mp4 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '9222';
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const outDir = path.join(root, 'demo-frames');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
if (!page) { console.log('main page not found'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const call = (method, params) => new Promise((res) => {
  const my = ++id;
  pending.set(my, res);
  ws.send(JSON.stringify({ id: my, method, params }));
});
const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const r = pending.get(d.id); pending.delete(d.id); r(d); return; }
  if (d.method === 'Page.screencastFrame') {
    events.push({ data: d.params.data, ts: Date.now() });
    call('Page.screencastFrameAck', { sessionId: d.params.sessionId });
  }
};
const ev = (expr) => call('Runtime.evaluate', { expression: expr, returnByValue: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await call('Page.enable');
await call('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

// ---------- 驱动演示旅程 ----------
console.log('demo: 准备页（实时预览）');
await sleep(2200);

console.log('demo: 打开选择器（加载→填充）');
await ev(`openPicker(true)`);
await sleep(2200);

console.log('demo: 选中“整个屏幕”');
await ev(`[...document.querySelectorAll('.picker-item')][0]?.click()`);
await sleep(1200);

console.log('demo: 麦克风开关演示');
await ev(`document.getElementById('toggle-mic').click()`);
await sleep(1500);
await ev(`document.getElementById('toggle-mic').click()`);
await sleep(800);

console.log('demo: 倒计时 + 录制（测试音让音量表跳舞）');
spawn('ffplay', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=9', '-volume', '25', '-autoexit', '-loglevel', 'quiet'], { stdio: 'ignore' });
await ev(`startRecording()`);
await sleep(7500);

console.log('demo: 停止并保存');
await ev(`stopRecording()`);
await sleep(2000);

console.log('demo: 保存为 MP4（转码进度）');
await ev(`document.getElementById('btn-save').click()`);
await sleep(4500);

console.log('demo: 完成 → 回到准备页');
await ev(`document.getElementById('btn-again').click()`);
await sleep(2000);

await call('Page.stopScreencast');
console.log('screencast frames:', events.length);
if (events.length === 0) process.exit(1);

// 落盘帧（png 直接写）
events.forEach((e, i) => {
  fs.writeFileSync(path.join(outDir, `frame-${String(i).padStart(4, '0')}.png`), Buffer.from(e.data, 'base64'));
});
fs.writeFileSync(path.join(outDir, 'timestamps.json'), JSON.stringify({ count: events.length, spanMs: events[events.length - 1].ts - events[0].ts }));
process.exit(0);
