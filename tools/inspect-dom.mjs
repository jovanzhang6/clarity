/* 通过 CDP 读取Clarity渲染端的真实 DOM 状态（只读，不做任何交互） */
const port = process.argv[2] || '9222';

const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const page = list.find((t) => t.type === 'page' && /index\.html|Clarity/.test(t.title + t.url)) || list.find((t) => t.type === 'page');
if (!page) { console.log('no page target:', list.map((t) => t.title)); process.exit(1); }
console.log('target:', page.title, page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

const expr = `JSON.stringify({
  title: document.title,
  views: {
    setup: !document.getElementById('view-setup').hidden,
    recording: !document.getElementById('view-recording').hidden,
    save: !document.getElementById('view-save').hidden,
  },
  overlays: {
    picker: !document.getElementById('picker-modal').hidden,
    countdown: !document.getElementById('countdown').hidden,
    dialog: !document.getElementById('dialog-modal').hidden,
    lightbox: !document.getElementById('lightbox').hidden,
    countdownText: document.getElementById('countdown-num').textContent,
    dialogMsg: document.getElementById('dialog-msg').textContent,
  },
  livePreview: {
    hasStream: !!document.getElementById('preview-video').srcObject,
    videoHidden: document.getElementById('preview-video').hidden,
    aspectRatio: document.getElementById('source-preview').style.aspectRatio || '(默认16:9)',
  },
  hints: {
    system: document.getElementById('hint-system').textContent,
    mic: document.getElementById('hint-mic').textContent,
  },
  meta: document.getElementById('setup-meta').textContent,
})`;

ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
const result = await new Promise((res) => { ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); }; });
console.log(JSON.stringify(JSON.parse(result.result.result.value), null, 2));
ws.close();
process.exit(0);
