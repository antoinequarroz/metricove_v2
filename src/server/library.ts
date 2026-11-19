import "server-only";
import fs from "node:fs";
import path from "node:path";
import { type AssetKind, ASSET_KINDS, cleanTags, type LibraryItem, MAX_ASSET_BYTES, MAX_ASSET_NAME, MAX_ASSETS, styleRef } from "@/lib/library";
import { DEFAULT_STYLE } from "@/lib/profiles";
import { DATA_DIR, getSetting, listProjects, setSetting } from "./db";
import { extraStyleIds } from "./profiles";

const KEY = "library";
const dir = () => path.join(DATA_DIR, "library");
const ID = /^[a-z0-9]{12}$/;

export const fileOf = (item: LibraryItem) => path.join(dir(), `${item.id}.${item.ext}`);

export function listLibrary(kind?: AssetKind): LibraryItem[] {
  const all = getSetting<LibraryItem[]>(KEY);
  return (Array.isArray(all) ? all : []).filter((i) => i && ID.test(i.id) && ASSET_KINDS.includes(i.kind) && (!kind || i.kind === kind));
}

const save = (items: LibraryItem[]) => setSetting(KEY, items);

/** What the bytes really are, whatever the browser says. SVG is only ever served as an image, under a strict policy. */
export function sniff(b: Buffer, kind: AssetKind): { type: string; ext: string } | undefined {
  const at = (i: number, s: string) => b.length >= i + s.length && b.toString("latin1", i, i + s.length) === s;
  if (kind === "illustration") {
    if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", ext: "png" };
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
    if (at(0, "RIFF") && at(8, "WEBP")) return { type: "image/webp", ext: "webp" };
    const head = b.toString("utf8", 0, Math.min(b.length, 2048)).replace(/^﻿/, "").trimStart();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { type: "image/svg+xml", ext: "svg" };
    return undefined;
  }
  if (at(0, "ID3") || (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { type: "audio/mpeg", ext: "mp3" };
  if (at(0, "RIFF") && at(8, "WAVE")) return { type: "audio/wav", ext: "wav" };
  if (at(0, "OggS")) return { type: "audio/ogg", ext: "ogg" };
  if (at(4, "ftyp")) return { type: "audio/mp4", ext: "m4a" };
  return undefined;
}

/** The style refs that still exist, from what a browser sent. */
function cleanStyles(raw: unknown): string[] {
  const valid = new Set(listProjects().flatMap((p) => [DEFAULT_STYLE, ...extraStyleIds(p.id)].map((s) => styleRef(p.id, s))));
  return [...new Set((Array.isArray(raw) ? raw : []).filter((s): s is string => typeof s === "string" && valid.has(s)))];
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/[\0-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_ASSET_NAME) : "");

export function addAsset(kind: AssetKind, bytes: Buffer, meta: { name?: unknown; tags?: unknown; styles?: unknown; source?: unknown }): LibraryItem | string {
  if (!bytes.length) return "Fichier vide";
  if (bytes.length > MAX_ASSET_BYTES[kind]) return `Fichier trop lourd (${Math.round(MAX_ASSET_BYTES[kind] / 1e6)} Mo au plus)`;
  const items = listLibrary();
  if (items.length >= MAX_ASSETS) return `${MAX_ASSETS} fichiers au plus dans les bibliothèques`;
  const what = sniff(bytes, kind);
  if (!what) return kind === "illustration" ? "Image illisible : PNG, JPEG, WebP ou SVG" : "Son illisible : MP3, WAV, OGG ou M4A";
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const item: LibraryItem = {
    id,
    kind,
    name: cleanName(meta.name) || (kind === "illustration" ? "Illustration" : kind === "music" ? "Musique" : "Bruitage"),
    tags: cleanTags(meta.tags),
    styles: cleanStyles(meta.styles),
    type: what.type,
    ext: what.ext,
    size: bytes.length,
    source: meta.source === "claude" || meta.source === "elevenlabs" || meta.source === "google" ? meta.source : "upload",
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(fileOf(item), bytes);
  save([item, ...items]);
  return item;
}

export function updateAsset(id: string, raw: unknown): LibraryItem | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = listLibrary();
  const at = items.findIndex((i) => i.id === id);
  if (at < 0) return "Fichier introuvable";
  if (r.name !== undefined && !cleanName(r.name)) return "Donne un nom";
  const item: LibraryItem = {
    ...items[at],
    ...(r.name !== undefined ? { name: cleanName(r.name) } : {}),
    ...(r.tags !== undefined ? { tags: cleanTags(r.tags) } : {}),
    ...(r.styles !== undefined ? { styles: cleanStyles(r.styles) } : {}),
  };
  items[at] = item;
  save(items);
  return item;
}

export function removeAsset(id: string) {
  const items = listLibrary();
  const item = items.find((i) => i.id === id);
  if (!item) return false;
  fs.rmSync(fileOf(item), { force: true });
  save(items.filter((i) => i.id !== id));
  return true;
}

export const findAsset = (id: string) => (ID.test(id) ? listLibrary().find((i) => i.id === id) : undefined);

/** A style removed (or a project): its items no longer point to it. */
export function forgetStyleInLibrary(projectId: string, styleId?: string) {
  const items = listLibrary();
  const gone = (s: string) => (styleId ? s === styleRef(projectId, styleId) : s.startsWith(`${projectId}:`));
  if (!items.some((i) => i.styles.some(gone))) return;
  save(items.map((i) => ({ ...i, styles: i.styles.filter((s) => !gone(s)) })));
}

/** Swapping the default style with another one: the items follow their style. */
export function swapStylesInLibrary(projectId: string, a: string, b: string) {
  const ra = styleRef(projectId, a);
  const rb = styleRef(projectId, b);
  save(listLibrary().map((i) => ({ ...i, styles: i.styles.map((s) => (s === ra ? rb : s === rb ? ra : s)) })));
}

export type JobAsset = { id: string; name: string; tags: string[]; url: string; type: string };
export type JobAssets = { illustrations: JobAsset[]; sfx: JobAsset[] };

/** What the Mac may use for a job: the items of its style, else the items that belong to no style. At most 60 of each. */
export function assetsFor(projectId: string, styleId?: string): JobAssets | undefined {
  const ref = styleRef(projectId, styleId && extraStyleIds(projectId).includes(styleId) ? styleId : DEFAULT_STYLE);
  const pick = (kind: AssetKind) => {
    const all = listLibrary(kind);
    const mine = all.filter((i) => i.styles.includes(ref));
    return (mine.length ? mine : all.filter((i) => !i.styles.length)).slice(0, 60).map((i) => ({ id: i.id, name: i.name, tags: i.tags, url: `/api/library/${i.id}/file`, type: i.type }));
  };
  const out = { illustrations: pick("illustration"), sfx: pick("sfx") };
  return out.illustrations.length || out.sfx.length ? out : undefined;
}
