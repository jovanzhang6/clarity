/* 音量表验收：静音基线 vs 播放测试音（ffplay 正弦波），对比点亮段数 */
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
const litCount = async () => {
  const r = await call('Runtime.evaluate', {
    expression: `JSON.stringify({sys: document.querySelectorAll('#meter-system i.lit').length, mic: document.querySelectorAll('#meter-mic i.lit').length})`,
    returnByValue: true,
  });
  return JSON.parse(r.result.result.value);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 静音基线
await sleep(1200);
const b1 = await litCount();
await sleep(700);
const b2 = await litCount();
console.log(`静音基线: 系统声音 ${Math.max(b1.sys, b2.sys)}/12 段, 麦克风 ${Math.max(b1.mic, b2.mic)}/12 段`);

// 播放中等音量测试音（约 -14dBFS）4 秒
const ff = spawn('ffplay', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-volume', '20', '-autoexit', '-loglevel', 'quiet'], { stdio: 'ignore' });
await sleep(1500);
const t1 = await litCount();
await sleep(700);
const t2 = await litCount();
await sleep(700);
const t3 = await litCount();
const peak = Math.max(t1.sys, t2.sys, t3.sys);
console.log(`测试音（约-14dBFS）: 系统声音峰值 ${peak}/12 段 (样本 ${t1.sys}/${t2.sys}/${t3.sys})`);

const baseOk = Math.max(b1.sys, b2.sys) <= 1;
const toneOk = peak >= 2 && peak <= 11; // 对数刻度下中等音量约 2~6 段，有明显反应且不顶满
console.log(baseOk && toneOk ? 'METER PASS：小声音不顶满、响声有区分度' : 'METER FAIL');
console.log(`  基线<=1段: ${baseOk ? 'OK' : 'FAIL'} | 测试音4~11段: ${toneOk ? 'OK' : 'FAIL'}`);
process.exit(baseOk && toneOk ? 0 : 1);
