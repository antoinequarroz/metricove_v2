import fs from "node:fs";

// Reads the format and the size of a JPEG or PNG without any image library.

export type ImageInfo = { type: "jpeg" | "png"; width: number; height: number };

export const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);

/** Reads only the start of the file: the size sits in the first kilobytes (after EXIF and thumbnails at worst). */
export function probeImage(file: string): ImageInfo | null {
  let buf: Buffer;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const len = Math.min(fs.fstatSync(fd).size, 1024 * 1024);
      buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  return probeImageBytes(buf);
}

export function probeImageBytes(buf: Buffer): ImageInfo | null {
  if (buf.length >= 24 && buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width && height ? { type: "png", width, height } : null;
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let turned = false;
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1];
    // Padding and markers without a length.
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2) return null;
    // Phone photos are often stored sideways, with the rotation in EXIF.
    if (marker === 0xe1) turned = exifTurned(buf.subarray(pos + 4, pos + 2 + len)) ?? turned;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      const height = buf.readUInt16BE(pos + 5);
      const width = buf.readUInt16BE(pos + 7);
      if (!width || !height) return null;
      return turned ? { type: "jpeg", width: height, height: width } : { type: "jpeg", width, height };
    }
    pos += 2 + len;
  }
  return null;
}

/** True when the EXIF orientation swaps width and height (values 5 to 8). */
function exifTurned(app1: Buffer): boolean | undefined {
  if (app1.length < 14 || app1.toString("latin1", 0, 4) !== "Exif") return undefined;
  const tiff = app1.subarray(6);
  const le = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) return u16(entry + 8) >= 5 && u16(entry + 8) <= 8;
    }
  } catch {
    // Truncated EXIF: no rotation known.
  }
  return undefined;
}
