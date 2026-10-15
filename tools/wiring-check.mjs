/* 系统回环接线对照实验：MediaStreamSource vs 元素中转 vs MediaRecorder */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 建一路 loopback（getDisplayMedia 自动应答）
const setup = await ev(`(async()=>{
  const sources = await window.api.listSources();
  const s0 = sources.find(x=>x.kind==='screen');
  window.api.selectDisplaySource(s0.id);
  const s = await navigator.mediaDevices.getDisplayMedia({video:true, audio:true});
  const at = s.getAudioTracks()[0];
  if (!at) { s.getTracks().forEach(t=>t.stop()); return 'no-track'; }
  window.__lb = { stream: s, track: at };
  return 'ok';
})()`);
console.log('loopback:', setup);
if (setup !== 'ok') process.exit(1);

// 放 10 秒测试音，期间依次测三种接法
spawn('ffplay', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-volume', '30', '-autoexit', '-loglevel', 'quiet'], { stdio: 'ignore' });
await sleep(1200);

console.log('A. MediaStreamSource 直连:', await ev(`(async()=>{
  const ctx = new AudioContext();
  const node = ctx.createMediaStreamSource(new MediaStream([window.__lb.track]));
  const an = ctx.createAnalyser(); an.fftSize=512; node.connect(an);
  const b = new Uint8Array(an.fftSize); let peak = 0;
  for (let k=0;k<12;k++){ an.getByteTimeDomainData(b); let s=0; for(let j=0;j<b.length;j++){const v=(b[j]-128)/128;s+=v*v;} peak=Math.max(peak, Math.sqrt(s/b.length)); await new Promise(r=>setTimeout(r,100)); }
  node.disconnect(); ctx.close();
  return '峰值RMS='+peak.toFixed(4);
})()`));

console.log('B. 元素中转:', await ev(`(async()=>{
  const ctx = new AudioContext();
  const v = document.createElement('video');
  v.style.cssText='position:fixed;left:-9999px;width:2px;height:2px;';
  v.srcObject = new MediaStream([window.__lb.track]);
  document.body.appendChild(v);
  await v.play().catch(e=>{});
  const node = ctx.createMediaElementSource(v);
  const an = ctx.createAnalyser(); an.fftSize=512; node.connect(an);
  const b = new Uint8Array(an.fftSize); let peak = 0;
  for (let k=0;k<12;k++){ an.getByteTimeDomainData(b); let s=0; for(let j=0;j<b.length;j++){const v=(b[j]-128)/128;s+=v*v;} peak=Math.max(peak, Math.sqrt(s/b.length)); await new Promise(r=>setTimeout(r,100)); }
  node.disconnect(); ctx.close(); v.remove();
  return '峰值RMS='+peak.toFixed(4);
})()`));

console.log('C. MediaRecorder 2 秒:', await ev(`(async()=>{
  const rec = new MediaRecorder(new MediaStream([window.__lb.track]), { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start(500);
  await new Promise(r=>setTimeout(r,2000));
  rec.stop(); await done;
  const blob = new Blob(chunks, {type:'audio/webm'});
  window.__lbBlob = blob;
  return 'size=' + blob.size;
})()`));

// C 的响度用 ffmpeg 分析（blob 落地由主进程做不了，走 dataURL 太大——直接在页面里解码 RMS）
console.log('C2. 解码 RMS:', await ev(`(async()=>{
  const buf = await window.__lbBlob.arrayBuffer();
  const ctx = new AudioContext();
  const audio = await ctx.decodeAudioData(buf.slice(0));
  const ch = audio.getChannelData(0);
  let s = 0; for (let j=0;j<ch.length;j++) s += ch[j]*ch[j];
  const rms = Math.sqrt(s/ch.length);
  ctx.close();
  return '时长='+audio.duration.toFixed(2)+'s 峰值RMS='+rms.toFixed(4);
})()`));

window.__lb.stream.getTracks().forEach(t=>t.stop());
process.exit(0);
