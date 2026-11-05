import crypto from "node:crypto";

// Instagram, Facebook and Co. download the videos themselves, from a public URL.
// The URL is signed and expires, so the rest of the app stays private.

const secret = () => process.env.MEDIA_URL_SECRET || process.env.API_TOKEN || process.env.APP_PASSWORD || "";

export function mediaSignature(id: string, exp: number, key = secret()) {
  return crypto.createHmac("sha256", key).update(`media:${id}:${exp}`).digest("hex");
}

/** Public URL of a video, valid for `hours`. */
export function signedMediaUrl(id: string, hours = 24) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const base = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/media/${id}/file?exp=${exp}&sig=${mediaSignature(id, exp)}`;
}
