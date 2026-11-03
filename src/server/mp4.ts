import fs from "node:fs";

// Reads duration and frame size from an MP4/MOV file without ffmpeg.
// Walks the box tree: moov > mvhd (duration) and moov > trak > tkhd (width, height).

export type VideoInfo = { duration: number; width: number; height: number };

const CONTAINERS = new Set(["moov", "trak"]);

export function probeMp4(file: string): VideoInfo | null {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const info: VideoInfo = { duration: 0, width: 0, height: 0 };
    walk(fd, 0, size, info, 0);
    return info.duration > 0 ? info : null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function read(fd: number, pos: number, len: number) {
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, pos);
  return buf;
}

function walk(fd: number, start: number, end: number, info: VideoInfo, depth: number) {
  let pos = start;
  while (pos + 8 <= end && depth < 6) {
    const head = read(fd, pos, 16);
    let boxSize = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    let headerLen = 8;
    if (boxSize === 1) {
      boxSize = Number(head.readBigUInt64BE(8));
      headerLen = 16;
    } else if (boxSize === 0) {
      boxSize = end - pos;
    }
    if (boxSize < headerLen) return;

    if (CONTAINERS.has(type)) {
      walk(fd, pos + headerLen, pos + boxSize, info, depth + 1);
    } else if (type === "mvhd") {
      const b = read(fd, pos + headerLen, 32);
      const version = b[0];
      const timescale = version === 1 ? b.readUInt32BE(20) : b.readUInt32BE(12);
      const duration = version === 1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
      if (timescale) info.duration = duration / timescale;
    } else if (type === "tkhd") {
      const version = read(fd, pos + headerLen, 1)[0];
      // width and height are the last 8 bytes of tkhd, as 16.16 fixed point
      const at = pos + headerLen + (version === 1 ? 88 : 76);
      const b = read(fd, at, 8);
      let w = b.readUInt32BE(0) / 65536;
      let h = b.readUInt32BE(4) / 65536;
      // Phone videos are often stored landscape with a 90° rotation matrix.
      const m = read(fd, at - 36, 8);
      if (m.readInt32BE(0) === 0 && m.readInt32BE(4) !== 0) [w, h] = [h, w];
      // The audio track has 0x0: keep the video track.
      if (w > 0 && h > 0 && !info.width) {
        info.width = Math.round(w);
        info.height = Math.round(h);
      }
    }
    pos += boxSize;
  }
}

export function aspectOf(info: VideoInfo | null): "9:16" | "1:1" | "16:9" {
  if (!info?.width || !info.height) return "9:16";
  const r = info.width / info.height;
  return r < 0.85 ? "9:16" : r > 1.2 ? "16:9" : "1:1";
}
