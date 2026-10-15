import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

// ---------- 设计语言（与 Clarity 应用一致） ----------
const C = {
  bg: '#f6f6f7',
  card: '#ffffff',
  ink: '#18181b',
  muted: '#52525b',
  faint: '#a1a1aa',
  border: '#e4e4e7',
  border2: '#d4d4d8',
  bg3: '#f4f4f5',
  ok: '#16a34a',
  red: '#dc2626',
  amber: '#f59e0b',
  dark: '#1e1e1e',
};
const FONT = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_INOUT = Easing.bezier(0.65, 0, 0.35, 1);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------- 通用元素 ----------

// 背景点阵：给纯色底一点质感
const DotGrid: React.FC = () => {
  const dots: React.ReactNode[] = [];
  for (let x = 20; x < 1280; x += 34) {
    for (let y = 20; y < 720; y += 34) {
      dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill={C.border} opacity={0.55} />);
    }
  }
  return (
    <svg width={1280} height={720} style={{ position: 'absolute', inset: 0 }}>
      {dots}
    </svg>
  );
};

// Logo：取景框四角 + 录制红点（progress 0..1 控制绘制）
const Logo: React.FC<{ size?: number; progress: number; dotScale?: number }> = ({
  size = 240,
  progress = 1,
  dotScale = 1,
}) => {
  const arm = (d: string) => (
    <path
      d={d}
      fill="none"
      stroke="#ffffff"
      strokeWidth={3.6}
      strokeLinecap="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - clamp01(progress)}
    />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 240 240">
      <rect x={4} y={4} width={232} height={232} rx={52} fill={C.ink} />
      <g transform="scale(3.75)">
        {arm('M21 28v-6a2.5 2.5 0 0 1 2.5-2.5H29')}
        {arm('M43 28v-6a2.5 2.5 0 0 0-2.5-2.5H35')}
        {arm('M21 36v6a2.5 2.5 0 0 0 2.5 2.5H29')}
        {arm('M43 36v6a2.5 2.5 0 0 1-2.5 2.5H35')}
      </g>
      <circle cx={120} cy={120} r={26 * dotScale} fill={C.red} />
    </svg>
  );
};

// 音量表：12 段，随帧律动（active=false 全灰）
const Meter: React.FC<{ x: number; y: number; w: number; h?: number; frame: number; active: boolean; seed: number }> = ({
  x,
  y,
  w,
  h = 8,
  frame,
  active,
  seed,
}) => {
  const n = 12;
  const gap = 3;
  const segW = (w - gap * (n - 1)) / n;
  const segs = [];
  for (let i = 0; i < n; i++) {
    let lit = false;
    let hot = false;
    if (active) {
      // 底噪 + 语音式起伏的合成电平
      const wave = 0.32 + 0.1 * Math.sin(frame * 0.14 + seed * 3 + i * 0.42);
      const burst = Math.max(0, Math.sin(frame * 0.21 + seed * 7 + i * 0.18)) * 0.3;
      const level = clamp01(wave + burst - 0.05);
      lit = i / n < level;
      hot = lit && i >= n - 3 && level > 0.82;
    }
    segs.push(
      <rect
        key={i}
        x={x + i * (segW + gap)}
        y={y}
        width={segW}
        height={h}
        rx={2}
        fill={hot ? C.amber : lit ? C.ok : C.bg3}
      />,
    );
  }
  return <g>{segs}</g>;
};

// 迷你版 Clarity 窗口（矢量重绘的应用界面）
const MiniClarity: React.FC<{ frame: number; sysOn: boolean; micOn: boolean }> = ({ frame, sysOn, micOn }) => {
  // 预览区里的"抽象桌面"：随帧移动的元素，暗示这是直播画面
  const drift = (frame * 0.6) % 80;
  return (
    <div
      style={{
        width: 640,
        height: 'auto',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: FONT,
        boxShadow: '0 18px 50px rgba(24,24,27,0.14)',
      }}
    >
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
        <svg width={18} height={18} viewBox="0 0 240 240">
          <rect x={4} y={4} width={232} height={232} rx={52} fill={C.ink} />
          <circle cx={120} cy={120} r={30} fill={C.red} />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Clarity</span>
      </div>
      {/* 双栏主体 */}
      <div style={{ display: 'flex', gap: 12, padding: '0 14px' }}>
        {/* 左：画面预览（抽象桌面动画） */}
        <div
          style={{
            flex: 1.4,
            aspectRatio: '16/9',
            background: C.dark,
            borderRadius: 8,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div style={{ position: 'absolute', left: 16, top: 14, width: 110, height: 200, background: '#252526', borderRadius: 6 }}>
            {[46, 78, 60, 90, 52, 74, 64].map((w, i) => (
              <div
                key={i}
                style={{
                  margin: '10px 10px 0',
                  height: 5,
                  width: w,
                  borderRadius: 2,
                  background: i % 3 === 0 ? '#3aa0c9' : i % 3 === 1 ? '#8a8a8a' : '#4a9e6b',
                  opacity: 0.9,
                }}
              />
            ))}
          </div>
          <div style={{ position: 'absolute', left: 140 + drift * 0.35, top: 24, width: 240, height: 150, background: '#1b1b1b', borderRadius: 8 }}>
            {[].map.call([0], () => null)}
            {[64, 96, 72, 110, 84].map((w, i) => (
              <div key={i} style={{ margin: '12px 12px 0', marginLeft: 12 + (i % 2) * 16, height: 6, width: w, borderRadius: 3, background: '#3c8fbd', opacity: 0.85 }} />
            ))}
            <div style={{ position: 'absolute', right: 14, bottom: 12, width: 64, height: 40, background: '#2d2d2d', borderRadius: 5 }} />
          </div>
          <div style={{ position: 'absolute', right: 18, top: 18, width: 96, height: 64, background: '#2b2b2b', borderRadius: 6 }} />
          {/* 状态条 */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 22, background: 'rgba(244,244,245,0.92)', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px' }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: C.red, display: 'inline-block' }} />
            <span style={{ fontSize: 10, color: '#3f3f46' }}>REC</span>
            <span style={{ flex: 1 }} />
            {[14, 20, 16, 22, 18, 14].map((w, i) => (
              <span key={i} style={{ width: w, height: 6, borderRadius: 2, background: C.border2, display: 'inline-block' }} />
            ))}
          </div>
        </div>
        {/* 右：双声音卡 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { title: '系统声音', sub: '电脑里播的声音', on: sysOn, seed: 1 },
            { title: '麦克风', sub: '你自己说的话', on: micOn, seed: 4 },
          ].map((a) => (
            <div key={a.title} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{a.title}</span>
                {/* 开关 */}
                <div style={{ width: 30, height: 17, borderRadius: 99, background: a.on ? C.ok : C.border2, position: 'relative' }}>
                  <div
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 99,
                      background: '#fff',
                      position: 'absolute',
                      top: 2,
                      left: a.on ? 15 : 2,
                      transition: 'none',
                    }}
                  />
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{a.sub}</div>
              <svg width="100%" height={8} viewBox={`0 0 200 8`} preserveAspectRatio="none">
                <Meter x={0} y={0} w={200} frame={frame} active={a.on} seed={a.seed} />
              </svg>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.faint }}>开哪个就录哪个的声音；全关则录制无声视频</div>
        </div>
      </div>
      {/* 底部录制条 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 0' }}>
        <span style={{ fontSize: 11, color: C.faint }}>屏幕：整个屏幕 · 声音：仅系统声音</span>
        <div style={{ background: C.ink, color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 8, padding: '7px 18px' }}>
          ● 开始录制
        </div>
      </div>
    </div>
  );
};

// ---------- 场景 ----------

// S1 Logo 揭幕
const SceneLogo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const draw = spring({ frame, fps, config: { damping: 14, stiffness: 60 }, durationInFrames: 55 });
  const dotPop = spring({ frame: frame - 30, fps, config: { damping: 9, stiffness: 130, mass: 0.7 } });
  const wordIn = spring({ frame: frame - 44, fps, config: { damping: 16, stiffness: 90 } });
  const tagIn = spring({ frame: frame - 62, fps, config: { damping: 16, stiffness: 90 } });
  const wordSpacing = interpolate(wordIn, [0, 1], [0.42, 0.06]);
  const dotPulse = 1 + 0.05 * Math.sin(frame * 0.18);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <div style={{ opacity: wordIn, transform: `translateY(${(1 - wordIn) * 14}px)`, marginBottom: 26, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Logo size={132} progress={draw} dotScale={Math.max(0.001, dotPop * dotPulse)} />
        <span
          style={{
            fontSize: 78,
            fontWeight: 700,
            color: C.ink,
            letterSpacing: `${wordSpacing}em`,
            fontFamily: FONT,
            lineHeight: 1,
          }}
        >
          Clarity
        </span>
      </div>
      <div
        style={{
          opacity: tagIn,
          transform: `translateY(${(1 - tagIn) * 12}px)`,
          fontSize: 24,
          color: C.muted,
          letterSpacing: '0.35em',
          fontFamily: FONT,
        }}
      >
        极简录屏 · 所见即所录
      </div>
    </AbsoluteFill>
  );
};

// 通用字幕（kicker + 主句，从下方滑入）
const Caption: React.FC<{ kicker: string; main: string; localFrame: number }> = ({ kicker, main, localFrame }) => {
  const inP = spring({ frame: localFrame, fps: 30, config: { damping: 16, stiffness: 90 } });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 88, textAlign: 'center', fontFamily: FONT }}>
      <div style={{ fontSize: 15, color: C.faint, letterSpacing: '0.3em', marginBottom: 12, opacity: inP }}>{kicker}</div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 700,
          color: C.ink,
          opacity: inP,
          transform: `translateY(${(1 - inP) * 26}px)`,
        }}
      >
        {main}
      </div>
    </div>
  );
};

// 场景通用淡入淡出
const SceneFade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, dur - 12, dur], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

// S2 双声音通道
const SceneAudio: React.FC = () => {
  const frame = useCurrentFrame();
  const cardIn = spring({ frame: frame - 6, fps: 30, config: { damping: 15, stiffness: 80 } });
  const toggleOnSpring = spring({ frame: frame - 55, fps: 30, config: { damping: 10, stiffness: 140, mass: 0.6 } });
  const micOnSpring = spring({ frame: frame - 95, fps: 30, config: { damping: 10, stiffness: 140, mass: 0.6 } });
  const micOn = micOnSpring > 0.5;
  const knobSys = interpolate(toggleOnSpring, [0, 1], [2, 15]);
  const knobMic = interpolate(micOnSpring, [0, 1], [2, 15]);
  const audioCard = {
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: '18px 22px',
    background: C.card,
    width: 470,
    boxShadow: '0 10px 34px rgba(24,24,27,0.07)',
  };
  return (
    <SceneFade dur={225}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: `scale(${interpolate(cardIn, [0, 1], [0.94, 1])})`, opacity: cardIn }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 系统声音卡 */}
            <div style={{ ...audioCard, transform: `translateY(${(1 - cardIn) * 24}px)` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
                    系统声音 <span style={{ fontWeight: 400, color: C.faint, fontSize: 17 }}>电脑里播的声音</span>
                  </div>
                  <div style={{ fontSize: 17, color: C.muted, marginTop: 5, fontFamily: FONT }}>视频、会议、音乐、提示音</div>
                </div>
                <div style={{ width: 58, height: 32, borderRadius: 99, background: toggleOnSpring > 0.5 ? C.ok : C.border2, position: 'relative' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 99, background: '#fff', position: 'absolute', top: 3, left: knobSys * 1.75, boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
                </div>
              </div>
              <svg width={426} height={14} viewBox="0 0 426 12" style={{ marginTop: 14 }}>
                <Meter x={0} y={0} w={426} h={12} frame={frame + 55} active={toggleOnSpring > 0.5} seed={1} />
              </svg>
            </div>
            {/* 麦克风卡 */}
            <div style={{ ...audioCard, transform: `translateY(${(1 - cardIn) * 24}px)` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: C.ink, fontFamily: FONT }}>
                    麦克风 <span style={{ fontWeight: 400, color: C.faint, fontSize: 17 }}>你自己说的话</span>
                  </div>
                  <div style={{ fontSize: 17, color: C.muted, marginTop: 5, fontFamily: FONT }}>人声、解说、在线对话</div>
                </div>
                <div style={{ width: 58, height: 32, borderRadius: 99, background: micOnSpring > 0.5 ? C.ok : C.border2, position: 'relative' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 99, background: '#fff', position: 'absolute', top: 3, left: knobMic * 1.75, boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
                </div>
              </div>
              <svg width={426} height={14} viewBox="0 0 426 12" style={{ marginTop: 14 }}>
                <Meter x={0} y={0} w={426} h={12} frame={frame + 95} active={micOn} seed={4} />
              </svg>
            </div>
          </div>
        </div>
      </AbsoluteFill>
      <Caption kicker="DUAL AUDIO CHANNELS" main="双声音通道 · 独立开关" localFrame={frame} />
    </SceneFade>
  );
};

// S3 实时预览（镜头推拉 + 光标）
const ScenePreview: React.FC = () => {
  const frame = useCurrentFrame(); // 0..225
  const winIn = spring({ frame: frame - 4, fps: 30, config: { damping: 15, stiffness: 70 } });

  // 镜头：全览 → 推近左侧代码区 → 拉回 → 推近右侧状态区
  const zoom = interpolate(
    frame,
    [20, 70, 110, 160, 225],
    [1, 1, 1.26, 1.26, 1],
    { easing: EASE_INOUT, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const camX = interpolate(frame, [20, 70, 110, 160, 225], [0, 0, -95, -95, 0], {
    easing: EASE_INOUT,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const camY = interpolate(frame, [20, 70, 110, 160, 225], [0, 0, -40, -40, 0], {
    easing: EASE_INOUT,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // 光标：两条贝塞尔路径 + 两次点击涟漪
  const cursorX = interpolate(frame, [30, 90, 130, 190, 225], [120, 480, 480, 180, 180], {
    easing: EASE_INOUT,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cursorY = interpolate(frame, [30, 90, 130, 190, 225], [90, 230, 230, 60, 60], {
    easing: EASE_INOUT,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const click1 = clamp01((frame - 92) / 22); // 涟漪 1
  const click2 = clamp01((frame - 192) / 22); // 涟漪 2

  return (
    <SceneFade dur={225}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <div
          style={{
            width: 640,
            height: 412,
            transform: `scale(${interpolate(winIn, [0, 1], [0.92, 1])})`,
            opacity: winIn,
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `scale(${zoom}) translate(${camX}px, ${camY}px)`,
              transformOrigin: '50% 50%',
            }}
          >
            <MiniClarity frame={frame + 345} sysOn micOn={false} />
            {/* 点击涟漪（在窗口内容坐标系里） */}
            {[{ f: click1, x: 480, y: 230 }, { f: click2, x: 180, y: 60 }].map(({ f, x, y }, i) =>
              f > 0 && f < 1 ? (
                <svg
                  key={i}
                  width={640}
                  height={412}
                  style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
                >
                  <circle cx={x} cy={y} r={8 + f * 30} fill="none" stroke={C.red} strokeWidth={3} opacity={1 - f} />
                  <circle cx={x} cy={y} r={6} fill={C.red} opacity={1 - f * 0.6} />
                </svg>
              ) : null,
            )}
            {/* 红点光标 */}
            <div
              style={{
                position: 'absolute',
                left: cursorX - 7,
                top: cursorY - 7,
                width: 14,
                height: 14,
                borderRadius: 99,
                background: C.red,
                boxShadow: '0 0 0 3px rgba(255,255,255,0.85)',
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
      <Caption kicker="LIVE PREVIEW · AUTO FOCUS" main="实时预览 · 所见即所录" localFrame={frame} />
    </SceneFade>
  );
};

// S4 保存工作流
const SceneSave: React.FC = () => {
  const frame = useCurrentFrame(); // 0..210
  const cardIn = spring({ frame: frame - 4, fps: 30, config: { damping: 15, stiffness: 80 } });
  const segIn = spring({ frame: frame - 30, fps: 30, config: { damping: 12, stiffness: 120 } });
  const typed = Math.round(clamp01((frame - 40) / 45) * 'D:\\Recordings\\录制-20261010.mp4'.length);
  const pathText = 'D:\\Recordings\\录制-20261010.mp4'.slice(0, typed);
  const prog = interpolate(frame, [95, 150], [0, 100], { easing: EASE_INOUT, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const done = frame > 155;
  const checkDraw = spring({ frame: frame - 158, fps: 30, config: { damping: 12, stiffness: 120 } });

  return (
    <SceneFade dur={210}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: 700,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: '26px 30px',
            fontFamily: FONT,
            transform: `scale(${interpolate(cardIn, [0, 1], [0.94, 1])})`,
            opacity: cardIn,
            boxShadow: '0 18px 50px rgba(24,24,27,0.10)',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 18 }}>保存</div>
          {/* 分辨率 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: C.muted, width: 52 }}>分辨率</span>
            <div style={{ display: 'flex', background: C.bg3, borderRadius: 8, padding: 3 }}>
              {['原始', '1080p', '720p'].map((r) => {
                const active = r === '720p';
                const pop = active ? segIn : 1;
                return (
                  <div
                    key={r}
                    style={{
                      padding: '6px 20px',
                      borderRadius: 6,
                      fontSize: 14,
                      fontFamily: FONT,
                      background: active ? C.card : 'transparent',
                      border: active ? `1px solid ${C.border2}` : '1px solid transparent',
                      fontWeight: active ? 700 : 400,
                      color: active ? C.ink : C.muted,
                      transform: `scale(${interpolate(pop, [0, 1], [0.9, 1])})`,
                    }}
                  >
                    {r}
                  </div>
                );
              })}
            </div>
          </div>
          {/* 位置（打字机） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: C.muted, width: 52 }}>位置</span>
            <code style={{ flex: 1, background: C.bg3, borderRadius: 8, padding: '9px 12px', fontSize: 14, color: C.ink, fontFamily: 'Consolas, monospace' }}>
              {pathText}
              {typed < 'D:\\Recordings\\录制-20261010.mp4'.length && frame > 40 && frame % 24 < 12 ? '|' : ''}
            </code>
          </div>
          {/* 进度 */}
          <div style={{ marginTop: 20 }}>
            <div style={{ height: 7, background: C.bg3, borderRadius: 99 }}>
              <div style={{ height: '100%', width: `${prog}%`, background: C.ink, borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
              {done ? '' : `转码中 ${Math.round(prog)}%`}
            </div>
          </div>
          {/* 完成态 */}
          {done && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <svg width={22} height={22} viewBox="0 0 22 22">
                <circle cx={11} cy={11} r={10} fill={C.ok} opacity={0.15} />
                <circle cx={11} cy={11} r={10} fill="none" stroke={C.ok} strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01(checkDraw)} />
                <path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke={C.ok} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01(checkDraw * 1.4 - 0.4)} />
              </svg>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.ok }}>已保存 D:\Recordings\录制-20261010.mp4</span>
            </div>
          )}
        </div>
      </AbsoluteFill>
      <Caption kicker="SAVE YOUR WAY" main="720p · 保存位置自选" localFrame={frame} />
    </SceneFade>
  );
};

// S5 结尾卡
const SceneEnd: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logoIn = spring({ frame, fps, config: { damping: 13, stiffness: 80 } });
  const lineIn = spring({ frame: frame - 24, fps, config: { damping: 15, stiffness: 90 } });
  const urlIn = spring({ frame: frame - 42, fps, config: { damping: 15, stiffness: 90 } });
  const pulse = 1 + 0.06 * Math.sin(frame * 0.2);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: C.ink }}>
      <div style={{ opacity: logoIn, transform: `scale(${interpolate(logoIn, [0, 1], [0.7, 1])})`, marginBottom: 30 }}>
        <Logo size={150} progress={1} dotScale={pulse} />
      </div>
      <div
        style={{
          fontSize: 64,
          fontWeight: 700,
          color: '#fff',
          fontFamily: FONT,
          letterSpacing: '0.04em',
          opacity: lineIn,
          transform: `translateY(${(1 - lineIn) * 16}px)`,
          marginBottom: 18,
        }}
      >
        Clarity
      </div>
      <div
        style={{
          fontSize: 24,
          color: '#a1a1aa',
          fontFamily: FONT,
          letterSpacing: '0.2em',
          opacity: urlIn,
          transform: `translateY(${(1 - urlIn) * 12}px)`,
        }}
      >
        免费 · 无水印 · MIT 开源
      </div>
      <div
        style={{
          marginTop: 26,
          fontSize: 17,
          color: '#71717a',
          fontFamily: 'Consolas, monospace',
          opacity: urlIn,
        }}
      >
        github.com/jovanzhang6/clarity
      </div>
    </AbsoluteFill>
  );
};

// ---------- 主合成 ----------
export const ClarityPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT }}>
      <DotGrid />
      {/* S1 Logo 揭幕 */}
      <Sequence from={0} durationInFrames={125}>
        <SceneLogo />
      </Sequence>
      {/* S2 双声音通道 */}
      <Sequence from={120} durationInFrames={225}>
        <SceneAudio />
      </Sequence>
      {/* S3 实时预览 */}
      <Sequence from={340} durationInFrames={230}>
        <ScenePreview />
      </Sequence>
      {/* S4 保存工作流 */}
      <Sequence from={565} durationInFrames={215}>
        <SceneSave />
      </Sequence>
      {/* S5 结尾卡 */}
      <Sequence from={775} durationInFrames={125}>
        <SceneEnd />
      </Sequence>
    </AbsoluteFill>
  );
};
