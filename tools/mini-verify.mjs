/* 迷你条验收 v2：驱动录制 → 轮询等待迷你条 → 图标状态/tooltips/截图 → 停止 → 丢弃恢复 */
import fs from 'node:fs';
const port = process.argv[2] || '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const call = (method, params) => new Promise((res) => {
  const my = ++id;
  ws.send(JSON.stringify({ id: my, method, params }));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === my) res(d); };
});
const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.result.value;
};

// 开始录制
await ev(`startRecording()`);
console.log('record: started (countdown 3s)');

// 轮询迷你条 target（最多 15s）
let mini = null;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  const l = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  mini = l.find((t) => t.type === 'page' && /mini\.html/.test(t.url));
  if (mini) break;
}
if (!mini) { console.log('FAIL: 迷你条窗口未出现'); process.exit(1); }
console.log('mini target found');

// 连接迷你条页面，读状态 + 截图
const ws2 = new WebSocket(mini.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws2.onopen = res; ws2.onerror = rej; });
const call2 = (method, params) => new Promise((res) => {
  const my = ++id;
  ws2.send(JSON.stringify({ id: my, method, params }));
  ws2.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === my) res(d); };
});
await sleep(800);
const st = await call2('Runtime.evaluate', {
  expression: `JSON.stringify({
    sysClass: document.getElementById('b-sys').className,
    micClass: document.getElementById('b-mic').className,
    sysTitle: document.getElementById('b-sys').title,
    time: document.getElementById('time').textContent,
  })`,
  returnByValue: true,
});
console.log('迷你条状态:', st.result.result.value);
const s = await call2('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:\\study\\clarity\\shots\\mini-icons2.png', Buffer.from(s.result.data, 'base64'));
console.log('shot: shots/mini-icons2.png');
ws2.close();

// 停止（回保存页）→ 丢弃恢复
await ev(`stopRecording()`);
await sleep(1800);
await ev(`(async()=>{ const ok = await uiConfirm('测试收尾：丢弃这段录制？', '丢弃', '留着'); if (ok) { if (state.recTempPath) await window.api.tempDelete(state.recTempPath).catch(()=>{}); state.recTempPath=null; resetToSetup(); } })()`);
await sleep(600);
console.log('done');
process.exit(0);
