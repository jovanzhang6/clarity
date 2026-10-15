/* 单屏验收：读布局滚动指标 + 渲染器自合成整页帧 */
const port = process.argv[2] || '9222';
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

const expr = `JSON.stringify({
  docScroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  docClient: [document.documentElement.clientWidth, document.documentElement.clientHeight],
  setupScroll: [document.getElementById('view-setup').scrollWidth, document.getElementById('view-setup').scrollHeight],
  setupClient: [document.getElementById('view-setup').clientWidth, document.getElementById('view-setup').clientHeight],
})`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
const r1 = await new Promise((res) => { ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); }; });
const m = JSON.parse(r1.result.result.value);
const noDocScroll = m.docScroll[0] <= m.docClient[0] && m.docScroll[1] <= m.docClient[1];
const noSetupScroll = m.setupScroll[0] <= m.setupClient[0] && m.setupScroll[1] <= m.setupClient[1];
console.log(`文档滚动: ${m.docScroll} vs 视口 ${m.docClient} -> ${noDocScroll ? '不滚动' : '会滚动!'}`);
console.log(`准备视图: ${m.setupScroll} vs 视口 ${m.setupClient} -> ${noSetupScroll ? '不滚动' : '会滚动!'}`);
console.log(noDocScroll && noSetupScroll ? 'LAYOUT PASS：一屏装下' : 'LAYOUT FAIL');

ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } }));
const r2 = await new Promise((res) => { ws.onmessage = (ev) => { const d = JSON.parse(ev.data); if (d.id === 2) res(d); }; });
const { writeFileSync } = await import('node:fs');
writeFileSync('D:\\study\\clarity\\shot-layout.png', Buffer.from(r2.result.data, 'base64'));
console.log('saved shot-layout.png');
process.exit(0);
