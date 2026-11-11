import crypto from "node:crypto";
import { mediaSecret } from "./password";

// Instagram, Facebook and Co. download the videos themselves, from a public URL.
// The URL is signed and expires, so the rest of the app stays private.

export function mediaSignature(id: string, exp: number, key = mediaSecret()) {
  return crypto.createHmac("sha256", key).update(`media:${id}:${exp}`).digest("hex");
}

/** Public URL of a video, valid for `hours`. */
export function signedMediaUrl(id: string, hours = 24) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const base = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/media/${id}/file?exp=${exp}&sig=${mediaSignature(id, exp)}`;
}

/** Public URL of a video's cover image, valid for `hours`. */
export function signedCoverUrl(id: string, hours = 24) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const base = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/media/${id}/cover?exp=${exp}&sig=${mediaSignature(`${id}:cover`, exp)}`;
}
