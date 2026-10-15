# Clarity

<p align="center">
  <img src="assets/icon-256.png" width="96" alt="Clarity logo" />
</p>

<p align="center">
  <b>Minimal screen recording: toggle what you hear, record what you see.</b><br/>
  Windows desktop app · Electron + system ffmpeg · No subscription, no watermark, nothing leaves your machine
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · English
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Clarity in action" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/jovanzhang6/clarity/releases/latest"><strong>▶ HD demo video (MP4)</strong></a>
</p>

---


## Why Clarity

Screen recorders today are either heavy (OBS's learning curve), expensive (Screen Studio's subscription), or hide the switches that matter most (you find out 30 minutes in that nothing was recorded). Clarity does one thing: **make "recording it right" zero-effort** —

- Two independent audio toggles with **live level meters**, so you can verify audio *before* recording;
- A **live preview** of what will be captured — WYSIWYG;
- Resolution and save location configured **before** you hit record, so afterwards only a filename stands between you and the MP4.

## ✨ Features

| | |
|---|---|
| 🖥 **Screen / window capture** | Thumbnail picker that excludes itself; the preview is **live**, click to enlarge |
| 🔊 **Dual audio channels** | System audio (what the PC plays) and microphone (what you say) as independent toggles with 12-segment live meters |
| 🖥 **Non-intrusive while recording** | Minimize to taskbar, or collapse into an always-on-top mini bar; the recording view includes a live monitor |
| 🎚 **Controlled output** | Original / 1080p / 720p, choose your save folder (default `D:\Recordings`), MP4 via ffmpeg with a progress bar |
| ⏱ **Details** | 3-2-1 countdown (optional), pause/resume, sleep prevention, save prompt on accidental close |
| 🇨🇳 **Chinese-first UI** | Designed for Chinese users, works out of the box |


## 📦 Install

**Option 1: download the installer (recommended)**

Grab `Clarity-x.y.z-Setup.exe` from the [Releases](https://github.com/jovanzhang6/clarity/releases) page.

**Option 2: run from source**

```bash
git clone https://github.com/jovanzhang6/clarity.git
cd clarity
npm install
npm start
```

Requirements: Windows 10 19041+ / Windows 11, and [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) on your PATH (used for encoding).

## 🚀 30-second start

1. **Pick a source** — a screen or a window; the preview is live;
2. **Toggle audio** — system audio and/or microphone; if the meter moves, you're recording it;
3. **Hit record** — 3-second countdown, then record; stop and save when done.


## 🧪 Quality

Three test layers, all runnable locally:

```bash
npm test          # ① unit tests: encode args, byte integrity, cleanup, config persistence
npm run selftest  # ② E2E: records 5 real seconds → integrity check → transcode → ffprobe/frame checks
node tools/check-layout.mjs  # ③ UI layout assertion (start with --remote-debugging-port=9222)
```

Design decisions worth knowing:

- **Serial chunk writes**: MediaRecorder chunks are written to disk through a promise chain; stop waits for the chain to drain, and `finish()` hard-verifies "bytes received == bytes on disk" — fail loudly instead of dropping frames;
- **Never send a bare system-audio request**: known Electron issue ([#46369](https://github.com/electron/electron/issues/46369)) — system loopback must piggyback on a valid desktop video track, and source IDs are re-validated before every capture (stale IDs get the renderer killed by Chromium);
- **No native confirm/alert**: they block the renderer without focus on Windows; replaced with in-app dialogs.

Troubleshooting tools live in [`tools/`](./tools).

## 🏗 Packaging

```bash
npm run dist      # produces dist/Clarity-x.y.z-Setup.exe (NSIS)
```

## 🗺 Roadmap

- [ ] Region capture (screens/windows for now; cropping is per-clip in the editor flow)
- [ ] Microphone noise-suppression toggle
- [ ] i18n
- [ ] Auto-update channel

Issues and PRs welcome.

## 📄 License

[MIT](./LICENSE) — free for commercial use, no watermarks, no uploads.

## Acknowledgements

- [Electron](https://www.electronjs.org/) / [ffmpeg](https://ffmpeg.org/)
- Inspired by [Screen Studio](https://screen.studio/) and [Cap](https://cap.so/) — Clarity aims at the lightweight, controllable niche they don't cover.
