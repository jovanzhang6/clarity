const $ = (id) => document.getElementById(id);

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

let paused = false;
window.api.onMiniTick(({ recState, elapsedMs, sysOn, micOn }) => {
  $('time').textContent = fmt(elapsedMs);
  $('dot').className = 'mini-dot ' + (recState === 'paused' ? 'paused' : 'rec');
  paused = recState === 'paused';
  $('b-pause').classList.toggle('paused', paused);
  // 图标状态：开=正常图标，关=图标变淡+红斜线（会议软件通用语汇）
  const setT = (id, on, onTitle, offTitle) => {
    const b = $(id);
    b.classList.toggle('on', on);
    b.classList.toggle('off', !on);
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? onTitle : offTitle;
  };
  setT('b-sys', sysOn, '系统声音：录制中，点击关闭', '系统声音：已关，点击开启');
  setT('b-mic', micOn, '麦克风：录制中，点击关闭', '麦克风：已关，点击开启');
  $('b-stop').disabled = false;
});

$('b-sys').addEventListener('click', () => window.api.miniControl('toggle-system'));
$('b-mic').addEventListener('click', () => window.api.miniControl('toggle-mic'));
$('b-pause').addEventListener('click', () => window.api.miniControl(paused ? 'resume' : 'pause'));
$('b-stop').addEventListener('click', () => window.api.miniControl('stop'));
$('b-min').addEventListener('click', () => window.api.miniHide());
$('b-expand').addEventListener('click', () => window.api.miniControl('expand'));
