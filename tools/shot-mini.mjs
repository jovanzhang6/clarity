/* 抓迷你条窗口截图 */
const port = process.argv[2] || '9222';
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
console.log('targets:', list.filter((t) => t.type === 'page').map((t) => t.url.split('/').pop()).join(', '));
const mini = list.find((t) => t.type === 'page' && /mini\.html/.test(t.url));
if (!mini) { console.log('mini target 不在列表'); process.exit(0); }
const ws = new WebSocket(mini.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const s = await new Promise((res) => {
  ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); };
});
const { writeFileSync } = await import('node:fs');
writeFileSync('D:\\study\\clarity\\shots\\5-mini.png', Buffer.from(s.result.data, 'base64'));
console.log('saved shots/5-mini.png');
process.exit(0);
