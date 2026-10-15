/* 采集获取：三级回退 + 挂起超时 + 防渲染进程自杀。
   两条铁律（Electron 已知问题 46369/42765，错误码 263 = DESKTOP_CAPTURER_INVALID_OR_UNKNOWN_ID）：
   1) 不允许"裸系统音频"请求——系统回环必须伴随一个有效桌面视频轨；
   2) 任何 desktop 请求前必须重新枚举并校验源 ID 仍然存在——过期 ID 会直接杀渲染进程，try/catch 接不住。 */
(function () {
  const TIMEOUT_MS = 8000;

  function gUM(constraints) {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('采集请求挂起（' + TIMEOUT_MS / 1000 + 's 超时）'));
      }, TIMEOUT_MS);
      navigator.mediaDevices.getUserMedia(constraints).then(
        (stream) => {
          clearTimeout(timer);
          if (timedOut) stream.getTracks().forEach((t) => t.stop());
          else resolve(stream);
        },
        (err) => {
          clearTimeout(timer);
          if (!timedOut) reject(err);
        },
      );
    });
  }

  function withTimeout(promise, label) {
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(label + '挂起（' + TIMEOUT_MS / 1000 + 's 超时）'));
      }, TIMEOUT_MS);
      promise.then(
        (v) => { clearTimeout(timer); if (!timedOut) resolve(v); },
        (err) => { clearTimeout(timer); if (!timedOut) reject(err); },
      );
    });
  }

  const sysAudio = () => ({ mandatory: { chromeMediaSource: 'system' } });
  const desktopVideo = (sourceId) => ({
    mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: 30 },
  });

  async function listSources() {
    // getSources 在 WGC 卡死的机器上可能永久挂起，必须有超时护栏
    try {
      return await withTimeout(window.api.listSources(), '枚举画面源');
    } catch { return []; }
  }

  /* 在最新枚举里找到所选源；屏幕源找不到就退回主屏；都找不到返回 null */
  async function resolveSource(source) {
    const fresh = await listSources();
    if (source && source.id) {
      const same = fresh.find((s) => s.id === source.id);
      if (same) return same;
    }
    if (source && source.kind === 'screen') {
      return fresh.find((s) => s.kind === 'screen') || null;
    }
    if (source && source.kind === 'window') {
      const byName = fresh.find((s) => s.kind === 'window' && s.name === source.name);
      if (byName) return byName;
    }
    return null;
  }

  /* 系统回环通道：getDisplayMedia + setDisplayMediaRequestHandler（Electron loopback）。
     Chromium gUM 的 chromeMediaSource:'system' 回环在部分机器上只输出静音，loopback 才是真声。
     返回 { stream(视频+系统音轨), audioTrack }，失败返回 null。 */
  async function acquireLoopback(source) {
    try {
      const src = await resolveSource(source);
      if (!src) return null;
      window.api.selectDisplaySource(src.id);
      const s = await withTimeout(
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
        '系统声音通道（loopback）',
      );
      if (s.getAudioTracks().length === 0) {
        s.getTracks().forEach((t) => t.stop());
        return null;
      }
      return { stream: s, audioTrack: s.getAudioTracks()[0] };
    } catch {
      return null;
    }
  }

  /* 预览视频流：只带视频轨，常驻不中断（系统声音单独走 acquireSystemAudioOnly） */
  async function acquirePreview(source) {
    const src = await resolveSource(source);
    if (!src) throw new Error('找不到可用的画面源，请重新选择画面');
    return gUM({ video: desktopVideo(src.id) });
  }

  /* 仅系统声音：loopback 通道，拿到音轨后立即掐掉视频轨（不占用双路采集、不影响预览画面）。
     返回 MediaStream(仅音轨)，失败/无音轨返回 null。 */
  async function acquireSystemAudioOnly(source) {
    const loop = await acquireLoopback(source).catch(() => null);
    if (!loop || !loop.audioTrack) return null;
    const vt = loop.stream.getVideoTracks()[0];
    if (vt) vt.stop();
    return new MediaStream([loop.audioTrack]);
  }

  /**
   * 录制流。返回 { videoStream, systemAudioStream, attempts }，
   * systemAudioStream 为 null 表示系统音轨已合并在 videoStream 里。
   * 顺序：loopback 通道 → gUM 合并通道 → 重新枚举合并 → 纯视频兜底。
   */
  async function acquire(source, wantSystemAudio) {
    const attempts = [];
    const note = (label, ok, detail) => attempts.push({ label, ok, detail });

    const src = await resolveSource(source);
    if (!src) throw new Error('所选画面已失效（窗口可能已关闭），请重新选择画面');

    if (wantSystemAudio) {
      // 1) loopback 通道：getDisplayMedia + 主进程自动应答（真系统声，最稳）
      const loop = await acquireLoopback(src).catch(() => null);
      if (loop && loop.audioTrack) {
        note('loopback 通道', true, '视频+系统音轨');
        return { videoStream: loop.stream, systemAudioStream: null, attempts };
      }
      note('loopback 通道', false, '不可用');

      // 2) gUM 合并通道：全分辨率视频 + 系统回环
      try {
        const s = await gUM({ video: desktopVideo(src.id), audio: sysAudio() });
        if (s.getAudioTracks().length > 0) {
          note('gUM 合并通道', true, '视频+系统音轨');
          return { videoStream: s, systemAudioStream: null, attempts };
        }
        note('gUM 合并通道', false, '视频成功但没有音轨');
        s.getTracks().forEach((t) => t.stop());
      } catch (e) {
        note('gUM 合并通道', false, String(e.message || e));
      }

      // 给 WGC 一点喘息，连续秒开容易连续秒拒
      await new Promise((r) => setTimeout(r, 400));

      // 3) 重新枚举换新 ID 再试（源 ID 可能在这几秒内失效）
      try {
        const again = await resolveSource(source);
        if (again) {
          const s = await gUM({ video: desktopVideo(again.id), audio: sysAudio() });
          if (s.getAudioTracks().length > 0) {
            note('重新枚举后合并', true, '视频+系统音轨');
            return { videoStream: s, systemAudioStream: null, attempts };
          }
          note('重新枚举后合并', false, '视频成功但没有音轨');
          s.getTracks().forEach((t) => t.stop());
        } else {
          note('重新枚举后合并', false, '枚举不到画面源');
        }
      } catch (e) {
        note('重新枚举后合并', false, String(e.message || e));
      }

      // 4) 纯视频兜底（明确告知系统声音不可用——绝不发裸系统音频请求）
      const v = await gUM({ video: desktopVideo(src.id) });
      note('纯视频', true, '系统声音不可用，仅录制画面');
      return { videoStream: v, systemAudioStream: null, attempts, systemAudioFailed: true };
    }

    const v = await gUM({ video: desktopVideo(src.id) });
    note('纯视频', true, 'ok');
    return { videoStream: v, systemAudioStream: null, attempts };
  }

  window.clarityCapture = { acquire, acquirePreview, acquireSystemAudioOnly, listSourcesSafe: listSources };
})();
