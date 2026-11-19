// The libraries the videos draw from: illustrations and sound effects (the B-roll has its own sources).
// No "use client": the server checks with the same lists.

export type AssetKind = "illustration" | "sfx";

export type LibraryItem = {
  id: string;
  kind: AssetKind;
  name: string;
  /** Free words to find it again and for Claude to pick it: "tech", "flèche", "whoosh"… */
  tags: string[];
  /** Styles it belongs to, "<projectId>:<styleId>". Empty: free for every style. */
  styles: string[];
  /** File type, e.g. "image/svg+xml", "audio/mpeg". */
  type: string;
  ext: string;
  size: number;
  /** Who made it: a file added by hand, or one Claude made. */
  source: "upload" | "claude";
  createdAt: string;
};

export const ASSET_KINDS: AssetKind[] = ["illustration", "sfx"];
export const MAX_ASSET_BYTES: Record<AssetKind, number> = { illustration: 8_000_000, sfx: 8_000_000 };
export const MAX_ASSETS = 2000;
export const MAX_ASSET_NAME = 80;
export const MAX_TAGS = 12;
export const MAX_TAG = 30;

export const ASSET_ACCEPT: Record<AssetKind, string> = {
  illustration: "image/png,image/jpeg,image/webp,image/svg+xml,.svg",
  sfx: "audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a",
};

/** Usual categories of sound effects, offered as tags. */
export const SFX_TAGS = ["whoosh", "pop", "click", "thud", "swoosh", "ding", "glitch", "riser", "impact", "typing"];
export const ILLUSTRATION_TAGS = ["tech", "icône", "personnage", "flèche", "fond", "logo", "emoji", "schéma"];

/** "<projectId>:<styleId>", the key of a style in an item's `styles`. */
export const styleRef = (projectId: string, styleId: string) => `${projectId}:${styleId}`;

export const cleanTags = (raw: unknown): string[] => {
  const out: string[] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const tag = typeof t === "string" ? t.replace(/[\0-\x1f,]/g, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_TAG) : "";
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
};

/** A file name made into a readable title: "whoosh_fast-02.wav" → "whoosh fast 02". */
export const nameFromFile = (file: string) =>
  file
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ASSET_NAME) || "Sans nom";
