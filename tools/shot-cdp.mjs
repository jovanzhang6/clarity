/* 让渲染端自己合成一帧（Page.captureScreenshot），绕开桌面 DWM 通道 */
const port = process.argv[2] || '9222';
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
const msg = await new Promise((res) => { ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); }; });
if (msg.error) { console.log('error:', JSON.stringify(msg.error)); process.exit(1); }
const { writeFileSync } = await import('node:fs');
writeFileSync('D:\\study\\clarity\\shot-cdp.png', Buffer.from(msg.result.data, 'base64'));
console.log('saved D:\\study\\clarity\\shot-cdp.png');
process.exit(0);
