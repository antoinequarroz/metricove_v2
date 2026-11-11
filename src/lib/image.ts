"use client";

// Photos are prepared in the browser before they are sent: Instagram only takes JPEG,
// phones often store photos sideways (EXIF), and PNG or WebP exports can be huge.

export const IMAGE_FILE = /\.(jpe?g|png|webp|heic|heif)$/i;
export const VIDEO_FILE = /\.(mp4|mov|m4v)$/i;
/** For <input type="file" accept>. */
export const MEDIA_ACCEPT = "video/mp4,video/quicktime,.mp4,.mov,.m4v,image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";

/** Longest side kept, in pixels. Instagram shows 1080 wide: this leaves room for sharpness. */
const MAX_SIDE = 2160;
/** Instagram's limit for a photo. */
const MAX_BYTES = 8 * 1024 * 1024;

export const isImageFile = (file: File) => file.type.startsWith("image/") || IMAGE_FILE.test(file.name);

type Drawable = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(blob: Blob): Promise<Drawable> {
  // createImageBitmap applies the EXIF rotation, so the photo comes out upright.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Unknown format for this browser: the <img> path below gives the final answer.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("unreadable"));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Photo illisible par ce navigateur. Exportez-la en JPEG ou en PNG (les photos HEIC d'iPhone s'ouvrent dans Safari).");
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion de la photo impossible"))), "image/jpeg", quality));
}

/**
 * Draws a region of the photo into a JPEG no bigger than Instagram accepts.
 * `crop` is the region in the photo's own pixels. The whole photo by default.
 */
async function render(d: Drawable, crop = { x: 0, y: 0, width: d.width, height: d.height }): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(crop.width, crop.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Conversion de la photo impossible");
  // JPEG has no transparency: a transparent PNG gets a white background, not a black one.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(d.source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.92, 0.85, 0.75, 0.6]) {
    const blob = await toJpeg(canvas, quality);
    if (blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("Photo trop lourde, même compressée");
}

const jpegName = (name: string, suffix = "") => `${name.replace(/\.[^.]+$/, "") || "photo"}${suffix}.jpg`;

/** Turns any photo the browser can read into an upright JPEG ready for Instagram and Facebook. */
export async function prepareImage(file: File): Promise<File> {
  const d = await decode(file);
  try {
    if (!d.width || !d.height) throw new Error("Photo vide");
    return new File([await render(d)], jpegName(file.name), { type: "image/jpeg" });
  } finally {
    d.close();
  }
}

/**
 * Cuts the middle of a photo to the given ratio (width / height), keeping as much as possible.
 * Used to make a photo fit Instagram's feed (between 4:5 and 1.91:1).
 */
export async function cropImageToRatio(url: string, ratio: number, name: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Photo introuvable");
  const d = await decode(await res.blob());
  try {
    const current = d.width / d.height;
    const width = current > ratio ? Math.round(d.height * ratio) : d.width;
    const height = current > ratio ? d.height : Math.round(d.width / ratio);
    const crop = { x: Math.round((d.width - width) / 2), y: Math.round((d.height - height) / 2), width, height };
    return new File([await render(d, crop)], jpegName(name), { type: "image/jpeg" });
  } finally {
    d.close();
  }
}
