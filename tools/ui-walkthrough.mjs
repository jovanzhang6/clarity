/* UI 全视图走查：脚本驱动 录制→保存→丢弃→迷你条，每个视图留截图 */
const port = process.argv[2] || '9222';
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const pages = list.filter((t) => t.type === 'page');
const main = pages.find((t) => /index\.html/.test(t.url));
const ws = new WebSocket(main.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const call = (method, params, target) => new Promise((res) => {
  const my = ++id;
  const msg = { id: my, method, params };
  if (target) msg.sessionId = target;
  ws.send(JSON.stringify(msg));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === my) res(d); };
});
const ev = (expr) => call('Runtime.evaluate', { expression: expr, returnByValue: true });
const shot = async (name) => {
  const s = await call('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`D:\\study\\clarity\\shots\\${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log('shot:', name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// attach to main page session
const attached = await call('Target.attachToTarget', { targetId: main.id, flatten: true });
const sessionId = attached.result.sessionId;

await ev(`document.getElementById('view-setup') && 'ok'`);
await shot('1-setup');

// 录制（带倒计时）
await ev(`startRecording()`);
await sleep(4200); // 3s 倒计时 + 启动
const recState = await ev(`JSON.stringify({view:!document.getElementById('view-recording').hidden, monitor: !!document.getElementById('rec-monitor').srcObject, t: document.getElementById('rec-timer').textContent})`);
console.log('录制视图:', JSON.parse(recState.result.result.value));
await sleep(2500);
await shot('2-recording');

// 停止 → 保存视图
await ev(`stopRecording()`);
await sleep(1500);
const saveState = await ev(`JSON.stringify({summary: document.getElementById('save-summary').textContent, name: document.getElementById('save-name').value})`);
console.log('保存视图:', JSON.parse(saveState.result.result.value));
await shot('3-save');

// 丢弃（应用内对话框 → 确定）
await ev(`discardRecording()`);
await sleep(400);
await shot('4-confirm-dialog');
await ev(`document.getElementById('dialog-ok').click()`);
await sleep(600);

// 迷你条（单独窗口，单独截图）
await ev(`window.api.miniShow()`);
await sleep(1200);
const mini = pages.find((t) => /mini\.html/.test(t.url));
if (mini) {
  const att2 = await call('Target.attachToTarget', { targetId: mini.id, flatten: true });
  const s2 = await call('Page.captureScreenshot', { format: 'png' }, att2.result.sessionId);
  const { writeFileSync } = await import('node:fs');
  writeFileSync('D:\\study\\clarity\\shots\\5-mini.png', Buffer.from(s2.result.data, 'base64'));
  console.log('shot: 5-mini');
}
await ev(`window.api.miniRestore()`);
await ev(`closeLightbox(); closePicker();`);
console.log('walkthrough done');
process.exit(0);
