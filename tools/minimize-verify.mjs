/* 最小化闭环验收：录制中 → 最小化隐藏 → 恢复显示 → 停止保存 → 丢弃 */
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

// 用 PowerShell 枚举可见的 Clarity 迷你条窗口（通过 CDP 让主进程报告更直接：跳过，改用文件枚举脚本输出由外层检查）
// 这里直接走 API 闭环：
await ev(`startRecording()`);
await sleep(5500);
console.log('录制中:', await ev(`JSON.stringify({ recState: state.recState, miniVisible: !!(window.__miniHidden === undefined ? null : !window.__miniHidden) })`));

// 最小化（隐藏迷你条）
await ev(`window.api.miniHide()`);
await sleep(500);
console.log('最小化后: miniHide 已调用');

// 恢复（模拟 Alt+Shift+C 的显示逻辑）
await ev(`window.api.miniShow()`);
await sleep(500);
console.log('恢复后: miniShow 已调用');

// 停止 → 保存页
await ev(`stopRecording()`);
await sleep(1800);
console.log('停止后视图:', await ev(`JSON.stringify({ save: !document.getElementById('view-save').hidden, setup: !document.getElementById('view-setup').hidden })`));

// 丢弃恢复
await ev(`(async()=>{ const ok = await uiConfirm('测试收尾：丢弃这段录制？', '丢弃', '留着'); if (ok) { if (state.recTempPath) await window.api.tempDelete(state.recTempPath).catch(()=>{}); state.recTempPath=null; resetToSetup(); } })()`);
await sleep(600);
console.log('丢弃完成');
process.exit(0);
