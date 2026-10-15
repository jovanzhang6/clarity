import fs from 'node:fs';
const p = 'renderer/styles.css';
let css = fs.readFileSync(p, 'utf8');

const start = css.indexOf('body.mini .btn {');
const endMarker = '/* ---------- 自检页';
const end = css.indexOf(endMarker);
if (start < 0 || end < 0) { console.error('markers not found', start, end); process.exit(1); }

const replacement = `body.mini .mini-icon {
  -webkit-app-region: no-drag;
  width: 27px; height: 24px;
  border: none; background: transparent;
  border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0;
  color: var(--ink);
}
body.mini .mini-icon:hover { background: var(--bg3); }
body.mini .mini-icon svg { width: 13px; height: 13px; }
body.mini .mini-icon.stop svg { width: 11px; height: 11px; }
/* 声音开关：开=墨色图标，关=淡色图标+红斜线（会议软件通用语汇），两态都是明确可点的按钮 */
body.mini .mini-icon.off { color: var(--faint); }
body.mini .mini-icon .ic-off { display: none; }
body.mini .mini-icon.off .ic-on { display: none; }
body.mini .mini-icon.off .ic-off { display: block; }

`;

css = css.slice(0, start) + replacement + css.slice(end);
fs.writeFileSync(p, css);
console.log('patched, mini block replaced');
