const fs = require('fs');
const path = require('path');

const PREFIX = '.clarity-rec-';

/**
 * 录制临时文件写入器：渲染端 MediaRecorder 的分片经 IPC 到主进程顺序落盘。
 * finish() 校验"收到的字节 == 磁盘上的字节"，不一致直接抛错，宁可报错也不静默丢帧。
 */
class TempWriter {
  constructor() {
    this.filePath = null;
    this.bytes = 0;
    this._stream = null;
    this._error = null;
  }

  async start(saveDir) {
    await fs.promises.mkdir(saveDir, { recursive: true });
    await fs.promises.access(saveDir, fs.constants.W_OK);
    this.filePath = path.join(saveDir, `${PREFIX}${Date.now()}.webm`);
    this._stream = fs.createWriteStream(this.filePath);
    return new Promise((resolve, reject) => {
      this._stream.once('open', () => resolve(this.filePath));
      this._stream.once('error', reject);
    });
  }

  append(buf) {
    if (!this._stream) throw new Error('录制写入器未启动');
    if (this._error) throw this._error;
    this.bytes += buf.length;
    return new Promise((resolve, reject) => {
      this._stream.write(buf, (err) => {
        if (err) { this._error = err; reject(err); } else resolve(this.bytes);
      });
    });
  }

  /** 关闭并校验磁盘大小，返回 { tempPath, bytes } */
  finish() {
    return new Promise((resolve, reject) => {
      if (!this._stream) return reject(new Error('录制写入器未启动'));
      this._stream.end(() => {
        this._stream = null;
        try {
          const onDisk = fs.statSync(this.filePath).size;
          if (onDisk !== this.bytes) {
            return reject(new Error(`落盘字节不一致：收到 ${this.bytes}，磁盘 ${onDisk}`));
          }
          resolve({ tempPath: this.filePath, bytes: this.bytes });
        } catch (e) {
          reject(e);
        }
      });
      this._stream.once('error', reject);
    });
  }

  /** 关闭并删除临时文件（用户丢弃/取消录制） */
  cancel() {
    return new Promise((resolve) => {
      const file = this.filePath;
      const done = () => {
        try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch { /* 删除失败不阻塞 */ }
        resolve({ deleted: !file || !fs.existsSync(file) });
      };
      if (this._stream) {
        this._stream.end(() => { this._stream = null; done(); });
        this._stream.once('error', done);
      } else done();
    });
  }
}

/** 启动时清理上次异常退出留下的孤儿临时文件（默认 24h 内的保留，防误删正在进行中的） */
async function cleanupOrphans(saveDir, maxAgeMs = 24 * 3600 * 1000) {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(saveDir)) {
      if (!name.startsWith(PREFIX)) continue;
      const full = path.join(saveDir, name);
      try {
        const st = fs.statSync(full);
        if (Date.now() - st.mtimeMs > maxAgeMs) { fs.unlinkSync(full); removed++; }
      } catch { /* 单个失败不影响其余 */ }
    }
  } catch { /* 目录不存在等，忽略 */ }
  return removed;
}

module.exports = { TempWriter, cleanupOrphans, PREFIX };
