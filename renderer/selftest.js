/* Clarity 端到端自检：真实采集 5 秒 → 落盘 → ffmpeg 转码 → ffprobe/抽帧校验 */
const $ = (id) => document.getElementById(id);

const steps = [];
function addStep(name, ok, detail) {
  steps.push({ name, ok: !!ok, detail: String(detail == null ? '' : detail) });
  render();
}

function render() {
  const list = $('st-list');
  list.innerHTML = '';
  for (const s of steps) {
    const row = document.createElement('div');
    row.className = 'st';
    const mark = document.createElement('span');
    mark.className = 'st-mark ' + (s.ok ? 'ok' : 'fail');
    mark.textContent = s.ok ? '✓' : '✗';
    const name = document.createElement('span');
    name.className = 'st-name';
    name.textContent = s.name;
    const detail = document.createElement('span');
    detail.className = 'st-detail';
    detail.textContent = s.detail;
    row.appendChild(mark);
    row.appendChild(name);
    row.appendChild(detail);
    list.appendChild(row);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROJECT = 'D:\\study\\clarity';

(async () => {
  try {
    // 1. 画面源枚举 + 自身窗口排除
    const sources = await window.api.listSources();
    const screen = sources.find((s) => s.kind === 'screen');
    addStep('枚举画面源', sources.length > 0 && !!screen, `共 ${sources.length} 个源，主屏：${screen ? screen.name : '无'}`);
    const selfLeak = sources.some((s) => s.name && s.name.includes('Clarity'));
    addStep('排除自身窗口', !selfLeak, selfLeak ? '选择器里出现了自己的窗口' : '选择器中没有「Clarity」自己');

    // 2. 采集（与正式录制同构：预览视频流 + 纯音频 loopback 直连混音）
    const cfg = await window.api.getConfig();
    const { tempPath } = await window.api.recStart(cfg.saveDir);
    const previewStream = await window.clarityCapture.acquirePreview(screen);
    const vTrack = previewStream.getVideoTracks()[0];
    const vs = vTrack.getSettings();
    const sysStream = await window.clarityCapture.acquireSystemAudioOnly(screen);
    const sysTrack = sysStream ? sysStream.getAudioTracks()[0] : null;
    addStep(
      '采集音视频流',
      !!vTrack,
      `视频 ${Math.round(vTrack.getSettings().width || 0)}×${Math.round(vTrack.getSettings().height || 0)}，系统音轨：${sysTrack ? '有（纯音频 loopback）' : '无（环境不支持回环，按无声继续）'}`,
    );

    // 音频直连 MediaStreamSource（与正式录制一致），同时验证该通路有数据
    let hasAudio = false;
    let analyser = null;
    let audioOutTracks = [];
    if (sysTrack) {
      const ctx = new AudioContext();
      // 直连 MediaStreamSource（元素中转在本机回环轨上只会得到静音）
      const node = ctx.createMediaStreamSource(new MediaStream([sysTrack]));
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      node.connect(analyser);
      const dest = ctx.createMediaStreamDestination();
      analyser.connect(dest);
      audioOutTracks = dest.stream.getAudioTracks();
      hasAudio = true;
    }

    // 3. 录 5 秒
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t));
    const tracks = [vTrack, ...audioOutTracks];

    let sentBytes = 0;
    let writeChain = Promise.resolve();
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128000 });
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      sentBytes += e.data.size;
      writeChain = writeChain.then(async () => {
        await window.api.recChunk(await e.data.arrayBuffer());
      });
    };
    // 链上有失败也继续收尾：字节一致性由 recFinish 的落盘校验兜底
    const done = new Promise((r) => { rec.onstop = () => writeChain.then(() => r(), () => r()); });
    // 播放 7 秒 440Hz 测试音（覆盖录制全程），端到端验证系统声音真的有内容
    window.api.playTestTone(7);
    rec.start(1000);
    await sleep(5000);
    const durationMs = 5000 + (Date.now() % 100); // 与真实录制一样带一点自然误差
    rec.stop();
    await done;
    const fin = await window.api.recFinish(durationMs);
    const byteMatch = Math.abs(fin.bytes - sentBytes) < 8192;
    addStep('录制 5 秒并落盘', byteMatch, `收到 ${sentBytes} B，磁盘 ${fin.bytes} B`);

    // 音频图有数据吗：录一段 RMS 做参考（静音机房可能为 0，仅记录不断言）
    let rmsNote = 'n/a';
    if (analyser) {
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      rmsNote = 'RMS=' + Math.sqrt(sum / buf.length).toFixed(4);
    }

    // 4. 转码 720p
    const outPath = PROJECT + '\\selftest-output.mp4';
    const enc = await window.api.encode({
      tempPath: fin.tempPath,
      outPath,
      resolution: '720p',
      srcW: Math.round(vs.width || 0),
      srcH: Math.round(vs.height || 0),
      hasAudio,
      durationMs,
    });
    addStep('ffmpeg 转码 720p MP4', enc.ok, enc.ok ? `${(enc.sizeBytes / 1048576).toFixed(2)} MB` : enc.error);

    if (enc.ok) {
      // 5. ffprobe 校验
      const pj = await window.api.probe(enc.outPath);
      const v = pj.streams.find((s) => s.codec_type === 'video');
      const a = pj.streams.find((s) => s.codec_type === 'audio');
      const dur = Number(pj.format.duration);
      addStep('校验时长（4~7s）', dur >= 4 && dur <= 7, `${dur.toFixed(2)} s`);
      addStep('校验视频编码 H.264', v && v.codec_name === 'h264', v ? `${v.codec_name} ${v.width}x${v.height}` : '无视频轨');
      const shortSide = v ? Math.min(v.width, v.height) : 0;
      const expectScale = Math.min(vs.width || 0, vs.height || 0) > 720;
      addStep(
        '校验分辨率档位',
        expectScale ? shortSide > 0 && shortSide <= 722 : shortSide > 0,
        expectScale ? `源短边 ${Math.min(vs.width, vs.height)} → 短边 ${shortSide}（≤720）` : `源本身 ≤720p，短边 ${shortSide} 未放大`,
      );
      addStep('校验音轨 AAC', hasAudio ? !!a && a.codec_name === 'aac' : true, hasAudio ? (a ? `${a.codec_name} ${a.sample_rate}Hz（${rmsNote}）` : '音轨缺失') : '本次未启用音轨');

      // 5b. 系统声音内容非静音：录制全程有测试音，成品平均响度必须显著高于数字静音
      if (hasAudio) {
        const vol = await window.api.audioVolume(enc.outPath);
        addStep('系统声音内容非静音', vol != null && vol > -60, `成品平均响度 ${vol == null ? '解析失败' : vol.toFixed(1) + ' dB'}（-91 附近=静音）`);
      }

      // 6. 抽帧 + 非黑屏
      const png = PROJECT + '\\selftest-frame.png';
      await window.api.grabFrame(enc.outPath, png, 2);
      const yavg = await window.api.frameBrightness(png);
      addStep('抽帧且非黑屏', yavg != null && yavg > 2, `YAVG=${yavg == null ? '解析失败' : yavg.toFixed(1)}（0=纯黑）`);
    }

    // 7. 取消路径：临时文件必须被删干净
    await window.api.recStart(cfg.saveDir);
    await window.api.recChunk(new Uint8Array([1, 2, 3]).buffer);
    const c = await window.api.recCancel();
    addStep('取消清理临时文件', c.deleted === true, c.deleted ? '取消后 webm 已删除' : '取消后仍有残留');

    // 8. 临时文件删除白名单：路径拼改一律拒绝
    const g = await window.api.tempDelete('C:\\Windows\\System32\\evil.webm');
    addStep('删除接口白名单', g.deleted === false, g.deleted ? '危险：允许删除任意路径！' : '非 .clarity-rec-* 路径已拒绝');
  } catch (err) {
    addStep('异常中断', false, String((err && err.message) || err));
    await window.api.recCancel().catch(() => {});
  }

  const ok = steps.length > 0 && steps.every((s) => s.ok);
  $('st-status').textContent = ok ? '全部通过' : '存在失败';
  $('st-status').className = 'badge ' + (ok ? 'state-ok' : 'state-rec');
  await window.api.selftestReport({ ok, steps });
  // 不自动退出：窗口保持打开，供人工截图核对
})();
