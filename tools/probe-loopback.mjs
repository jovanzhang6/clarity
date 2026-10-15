/* 实验：禁用 WgcAudioCapture 后，loopback 通道是否出真声 */
import { spawn } from 'node:child_process';
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
const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result.result.value;
};

console.log('启动 loopback+分析器:', await ev(`(async()=>{
  const sources = await window.api.listSources();
  const s0 = sources.find(x=>x.kind==='screen');
  window.api.selectDisplaySource(s0.id);
  const s = await navigator.mediaDevices.getDisplayMedia({video:true, audio:true});
  const at = s.getAudioTracks()[0];
  if (!at) { s.getTracks().forEach(t=>t.stop()); return '无音轨'; }
  const ctx = new AudioContext();
  const v = document.createElement('video');
  v.style.cssText='position:fixed;left:-9999px;width:2px;height:2px;';
  v.srcObject = new MediaStream([at]);
  document.body.appendChild(v);
  await v.play().catch(e=>{});
  const node = ctx.createMediaElementSource(v);
  const an = ctx.createAnalyser(); an.fftSize=512; node.connect(an);
  window.__probe = {an, ctx, s, v};
  return '音轨就绪';
})()`));

const ff = spawn('ffplay', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-volume', '30', '-autoexit', '-loglevel', 'quiet'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1600));
console.log('测试音期间:', await ev(`(window.__probe ? (()=>{const an=window.__probe.an;const b=new Uint8Array(an.fftSize);an.getByteTimeDomainData(b);let s=0;for(let j=0;j<b.length;j++){const v=(b[j]-128)/128;s+=v*v;}return '峰值RMS='+Math.sqrt(s/b.length).toFixed(4);})() : 'no probe')`));
await ev(`window.__probe && (window.__probe.s.getTracks().forEach(t=>t.stop()), window.__probe.ctx.close(), window.__probe.v.remove())`);
process.exit(0);
