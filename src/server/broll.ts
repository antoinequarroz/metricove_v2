import { getSetting, setSetting } from "@/server/db";

/** Pexels key set in Réglages, else PEXELS_KEY in the server .env. Never sent to the page. */
export const pexelsKey = () => getSetting<string>("pexelsKey") || process.env.PEXELS_KEY || "";
export const setPexelsKey = (key: string) => setSetting("pexelsKey", key || null);

export type PexelsHit = {
  id: string;
  /** Still picture (images.pexels.com). */
  image: string;
  dur: number;
  w: number;
  h: number;
  /** Small file to play in the page on hover. */
  preview?: string;
  /** File the Mac downloads: the smallest one at 720p or more. */
  url: string;
  author?: string;
};

type PexelsFile = { link?: string; file_type?: string; width?: number; height?: number };
type PexelsVideo = { id: number; image?: string; duration?: number; width?: number; height?: number; user?: { name?: string }; video_files?: PexelsFile[] };

const ORIENT: Record<string, string> = { "9:16": "portrait", "4:5": "portrait", "1:1": "square", "16:9": "landscape" };
const okLink = (l?: string): l is string => !!l && /^https:\/\/videos\.pexels\.com\//.test(l);

export class PexelsError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Searches Pexels videos for the B-roll picker. */
export async function searchPexels(query: string, format: string, page = 1): Promise<{ hits: PexelsHit[]; more: boolean }> {
  const key = pexelsKey();
  if (!key) throw new PexelsError("Pas de clé Pexels : ajoute-la dans Réglages.", 409);
  const q = new URLSearchParams({ query, orientation: ORIENT[format] ?? "portrait", size: "medium", per_page: "15", page: String(page), locale: "fr-FR" });
  const r = await fetch(`https://api.pexels.com/videos/search?${q}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r) throw new PexelsError("Pexels ne répond pas", 502);
  if (r.status === 401 || r.status === 403) throw new PexelsError("Clé Pexels refusée : vérifie-la dans Réglages.", 409);
  if (r.status === 429) throw new PexelsError("Trop de recherches Pexels pour l'instant : réessaie dans une minute.", 429);
  if (!r.ok) throw new PexelsError(`Pexels → ${r.status}`, 502);
  const j = (await r.json()) as { videos?: PexelsVideo[]; next_page?: string };
  const hits: PexelsHit[] = [];
  for (const v of j.videos ?? []) {
    const files = (v.video_files ?? []).filter((f) => okLink(f.link) && /mp4/i.test(f.file_type ?? "mp4") && f.width && f.height);
    const big = files.filter((f) => Math.min(f.width!, f.height!) >= 720).sort((a, b) => a.width! * a.height! - b.width! * b.height!)[0] ?? [...files].sort((a, b) => b.width! * b.height! - a.width! * a.height!)[0];
    const small = [...files].sort((a, b) => a.width! * a.height! - b.width! * b.height!)[0];
    if (!big || !v.image?.startsWith("https://")) continue;
    hits.push({ id: String(v.id), image: v.image, dur: v.duration ?? 0, w: v.width ?? 0, h: v.height ?? 0, preview: small?.link, url: big.link!, author: v.user?.name });
  }
  return { hits, more: !!j.next_page };
}
