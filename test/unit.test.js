const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { computeTargetDims, buildEncodeArgs } = require('../main/encoder');
const { makeRecordingName, uniquePath } = require('../main/utils');
const { TempWriter, cleanupOrphans, PREFIX } = require('../main/writer');
const config = require('../main/config');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-test-'));

// ---------- computeTargetDims ----------
test('computeTargetDims: 1080p 源压到 720p', () => {
  assert.deepEqual(computeTargetDims(1920, 1080, 720), { width: 1280, height: 720 });
});

test('computeTargetDims: 2K 源压到 720p', () => {
  assert.deepEqual(computeTargetDims(2560, 1440, 720), { width: 1280, height: 720 });
});

test('computeTargetDims: 竖屏按短边压', () => {
  assert.deepEqual(computeTargetDims(1440, 2560, 720), { width: 720, height: 1280 });
});

test('computeTargetDims: 4K 压到 1080p', () => {
  assert.deepEqual(computeTargetDims(3840, 2160, 1080), { width: 1920, height: 1080 });
});

test('computeTargetDims: 不放大（源已小于目标）', () => {
  assert.equal(computeTargetDims(1280, 720, 720), null);
  assert.equal(computeTargetDims(960, 540, 720), null);
});

test('computeTargetDims: 目标为空表示原始分辨率', () => {
  assert.equal(computeTargetDims(1920, 1080, null), null);
});

test('computeTargetDims: 结果永远是偶数尺寸（yuv420p 要求）', () => {
  for (const [w, h, t] of [[1359, 759, 720], [1919, 1079, 1080], [2221, 1233, 720]]) {
    const r = computeTargetDims(w, h, t);
    if (r) {
      assert.equal(r.width % 2, 0, `w=${r.width}`);
      assert.equal(r.height % 2, 0, `h=${r.height}`);
    }
  }
});

test('computeTargetDims: 非法入参返回 null', () => {
  assert.equal(computeTargetDims(0, 1080, 720), null);
  assert.equal(computeTargetDims(1920, 0, 720), null);
});

// ---------- buildEncodeArgs ----------
test('buildEncodeArgs: 有音轨时带 aac 编码', () => {
  const args = buildEncodeArgs({ tempPath: 'a.webm', outPath: 'b.mp4', scaleWidth: 1280, scaleHeight: 720, hasAudio: true });
  assert.ok(args.includes('-c:a') && args.includes('aac'));
  assert.ok(!args.includes('-an'));
  assert.ok(args.includes('scale=1280:720'));
});

test('buildEncodeArgs: 无音轨时 -an 且只做偶数对齐', () => {
  const args = buildEncodeArgs({ tempPath: 'a.webm', outPath: 'b.mp4', scaleWidth: null, scaleHeight: null, hasAudio: false });
  assert.ok(args.includes('-an'));
  assert.ok(!args.includes('-c:a'));
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
});

test('buildEncodeArgs: 快速启动标志存在（播放器秒开）', () => {
  const args = buildEncodeArgs({ tempPath: 'a.webm', outPath: 'b.mp4', hasAudio: true });
  assert.ok(args.includes('+faststart'));
});

// ---------- makeRecordingName ----------
test('makeRecordingName: 格式为 录制-YYYYMMDD-HHmmss', () => {
  const d = new Date(2026, 9, 9, 17, 2, 51);
  assert.equal(makeRecordingName(d), '录制-20261009-170251');
});

test('makeRecordingName: 单数位补零', () => {
  const d = new Date(2026, 0, 3, 8, 5, 9);
  assert.equal(makeRecordingName(d), '录制-20260103-080509');
});

// ---------- uniquePath ----------
test('uniquePath: 不存在直接返回', () => {
  const dir = tmp();
  assert.equal(uniquePath(path.join(dir, 'x.mp4')), path.join(dir, 'x.mp4'));
});

test('uniquePath: 冲突追加 -2、-3', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'x.mp4'), 'a');
  fs.writeFileSync(path.join(dir, 'x-2.mp4'), 'a');
  assert.equal(uniquePath(path.join(dir, 'x.mp4')), path.join(dir, 'x-3.mp4'));
});

// ---------- TempWriter ----------
test('TempWriter: 落盘字节与写入字节一致', async () => {
  const dir = tmp();
  const w = new TempWriter();
  await w.start(dir);
  await w.append(Buffer.from('hello'));
  await w.append(Buffer.from(' world'));
  const res = await w.finish();
  assert.equal(res.bytes, 11);
  assert.equal(fs.statSync(res.tempPath).size, 11);
  assert.equal(fs.readFileSync(res.tempPath, 'utf8'), 'hello world');
});

test('TempWriter: 磁盘内容被篡改时 finish 报错而非静默', async () => {
  const dir = tmp();
  const w = new TempWriter();
  await w.start(dir);
  await w.append(Buffer.alloc(10, 7));
  fs.truncateSync(w.filePath, 3); // 模拟磁盘丢失数据
  await assert.rejects(() => w.finish(), /不一致/);
});

test('TempWriter: cancel 删除临时文件', async () => {
  const dir = tmp();
  const w = new TempWriter();
  await w.start(dir);
  await w.append(Buffer.from('abc'));
  const res = await w.cancel();
  assert.equal(res.deleted, true);
  assert.equal(fs.existsSync(w.filePath), false);
});

test('TempWriter: start 到不可写目录要抛错', { skip: process.platform !== 'win32' }, async () => {
  const w = new TempWriter();
  await assert.rejects(() => w.start('Z:\\不存在的盘\\录屏'));
});

// ---------- cleanupOrphans ----------
test('cleanupOrphans: 只清超龄孤儿，保留新文件', async () => {
  const dir = tmp();
  const oldFile = path.join(dir, PREFIX + '1000.webm');
  const newFile = path.join(dir, PREFIX + '2000.webm');
  const otherFile = path.join(dir, 'user-video.mp4');
  fs.writeFileSync(oldFile, 'x');
  fs.writeFileSync(newFile, 'x');
  fs.writeFileSync(otherFile, 'x');
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);

  const removed = await cleanupOrphans(dir);
  assert.equal(removed, 1);
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.existsSync(newFile), true);
  assert.equal(fs.existsSync(otherFile), true);
});

test('cleanupOrphans: 目录不存在不抛错', async () => {
  const removed = await cleanupOrphans('Z:\\不存在\\录屏');
  assert.equal(removed, 0);
});

// ---------- config ----------
test('config: 默认值 + 合并保存 + 持久化', () => {
  const dir = tmp();
  config.init(dir);
  const first = config.load();
  assert.equal(first.saveDir, 'D:\\Recordings');
  assert.equal(first.resolution, '720p');
  assert.equal(first.systemAudio, true);
  assert.equal(first.mic, false);
  assert.equal(first.countdown, 3);
  assert.equal(first.openFolderAfterSave, false);
  assert.equal(first.lastSave, null);

  config.save({ resolution: '1080p', saveDir: 'E:\\Rec', countdown: 5, lastSave: { path: 'X:\\a.mp4', name: 'a.mp4' } });
  config.init(dir); // 模拟重启后重新加载
  const second = config.load();
  assert.equal(second.resolution, '1080p');
  assert.equal(second.saveDir, 'E:\\Rec');
  assert.equal(second.countdown, 5);
  assert.deepEqual(second.lastSave, { path: 'X:\\a.mp4', name: 'a.mp4' });
  assert.equal(second.systemAudio, true, '未改动的字段保持默认');
});

test('config: 坏文件回退默认值', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), '{oops');
  config.init(dir);
  const c = config.load();
  assert.equal(c.resolution, '720p');
});
