/* 灯箱验收：脚本调 openLightbox() → 等高清帧 → 截渲染图 → 读文案 → 关闭 */
const port = process.argv[2] || '9222';
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const call = (method, params) => new Promise((res) => {
  const my = ++id;
  ws.send(JSON.stringify({ id: my, method, params }));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === my) res(d); };
});

await call('Runtime.evaluate', { expression: 'openLightbox()' });
await new Promise((r) => setTimeout(r, 2000)); // 等高清缩略图换上

const cap = await call('Runtime.evaluate', {
  expression: `JSON.stringify({ hidden: document.getElementById('lightbox').hidden,
    caption: document.getElementById('lightbox-caption').textContent,
    imgW: document.getElementById('lightbox-img').naturalWidth,
    imgH: document.getElementById('lightbox-img').naturalHeight })`,
  returnByValue: true,
});
console.log('灯箱状态:', cap.result.result.value);

const shot = await call('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('D:\\study\\clarity\\shot-lightbox.png', Buffer.from(shot.result.data, 'base64'));
console.log('saved shot-lightbox.png');

await call('Runtime.evaluate', { expression: 'closeLightbox()' });
process.exit(0);
