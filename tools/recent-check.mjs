/* 最近录像双态验收：空目录空态 → 真实目录填充态（结束自动恢复） */
import fs from 'node:fs';
const port = process.argv[2] || '9222';
const emptyDir = 'D:\\Recordings-empty';
const realDir = 'D:\\Recordings';

fs.mkdirSync(emptyDir, { recursive: true });

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
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
  return r.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  // 空态
  await ev(`(async()=>{ window.api.setConfig({ saveDir: ${JSON.stringify(emptyDir)} }); state.config.saveDir = ${JSON.stringify(emptyDir)}; await loadRecent(); })()`);
  await sleep(300);
  console.log('空态:', await ev(`JSON.stringify({ hidden: document.getElementById('card-recent').hidden, text: document.getElementById('recent-list').textContent.trim() })`));

  // 填充态
  await ev(`(async()=>{ window.api.setConfig({ saveDir: ${JSON.stringify(realDir)} }); state.config.saveDir = ${JSON.stringify(realDir)}; await loadRecent(); })()`);
  await sleep(300);
  console.log('填充态:', await ev(`JSON.stringify({ rows: document.querySelectorAll('.recent-row').length, first: document.querySelector('.recent-name')?.textContent })`));
} finally {
  // 恢复真实目录配置
  await ev(`(async()=>{ window.api.setConfig({ saveDir: ${JSON.stringify(realDir)} }); state.config.saveDir = ${JSON.stringify(realDir)}; })()`);
}
process.exit(0);
