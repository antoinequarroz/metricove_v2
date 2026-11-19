"use client";

/**
 * Cover of a reel: one picture of the video, taken in the browser (the video comes from this site, so the canvas can
 * read it), then sent to the library item.
 */

/** Waits for one event of the video, or fails on its error event or after `ms`. */
function waitFor(video: HTMLVideoElement, event: string, ms: number, what: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`${what} : la vidéo ne répond pas`)), ms);
    const ok = () => done();
    const ko = () => done(new Error(`${what} : vidéo illisible`));
    function done(error?: Error) {
      clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener("error", ko);
      if (error) reject(error);
      else resolve();
    }
    video.addEventListener(event, ok, { once: true });
    video.addEventListener("error", ko, { once: true });
  });
}

/**
 * The picture of the video at `t` seconds, as a JPEG. A video element on screen is never touched (its address is
 * read again in a hidden one), so the playback the user watches does not jump.
 */
export async function captureFrame(source: HTMLVideoElement | string, t: number, { timeoutMs = 15_000, quality = 0.9 } = {}): Promise<Blob> {
  const src = typeof source === "string" ? source : source.currentSrc || source.src;
  if (!src) throw new Error("Pas de vidéo pour la couverture");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  try {
    if (video.readyState < 1) await waitFor(video, "loadedmetadata", timeoutMs, "Couverture");
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : t;
    video.currentTime = Math.min(Math.max(0, Number.isFinite(t) ? t : 0), end);
    await waitFor(video, "seeked", timeoutMs, "Couverture");
    if (video.readyState < 2) await waitFor(video, "loadeddata", timeoutMs, "Couverture");
    if (!video.videoWidth || !video.videoHeight) throw new Error("Couverture : image vide");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couverture : dessin impossible dans ce navigateur");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couverture : image impossible à créer"))), "image/jpeg", quality));
  } finally {
    // Frees the connection and the decoder right away.
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * Makes `blob` the cover of the library item. False when the server refused it or did not answer within `timeoutMs`
 * (the video stays without cover).
 */
export async function putCover(mediaId: string, blob: Blob, { timeoutMs = 20_000 } = {}): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}/cover`, { method: "PUT", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob, signal: ctrl.signal }).catch(() => null);
    return !!res?.ok;
  } finally {
    clearTimeout(timer);
  }
}
