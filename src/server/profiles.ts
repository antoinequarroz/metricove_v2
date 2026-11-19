import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CAPTIONS, type CaptionStyle } from "@/lib/montage";
import { cleanLook, cleanRefs, DEFAULT_STYLE, emptyRefs, MAX_NOTES, MAX_REF_IMAGE_BYTES, MAX_REF_IMAGES, MAX_SKILL, MAX_STYLE_NAME, MAX_STYLES, MAX_TONE, noteLines, PRESETS, presetFor, type ProfileRefs, sameLook, STYLE_ID, starterProfile, type StyleProfile, type VideoLook } from "@/lib/profiles";
import { cleanMedia, type StyleMedia } from "@/lib/audio-ai";
import { MAX_STRATEGY } from "@/lib/strategy";
import type { Project } from "@/lib/types";
import { DATA_DIR, getSetting, listAccounts, listProjects, setSetting } from "./db";

const key = (projectId: string, styleId = DEFAULT_STYLE) => (styleId === DEFAULT_STYLE ? `profile:${projectId}` : `profile:${projectId}:${styleId}`);
/** The other styles of a project (the default one is not listed), in the order they were made. */
const indexKey = (projectId: string) => `styles:${projectId}`;

type Stored = Omit<StyleProfile, "saved" | "id">;

/** "@handle" of the project's Instagram account (else its first account): the default signature. */
function signature(project: Project) {
  const pool = listAccounts().filter((a) => project.accountIds.includes(a.id));
  const a = pool.find((x) => x.network === "instagram") ?? pool[0];
  return a ? `@${a.handle}`.slice(0, 40) : "";
}

/** Ids of the project's other styles that still exist. */
export function extraStyleIds(projectId: string): string[] {
  const ids = getSetting<string[]>(indexKey(projectId));
  return (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && STYLE_ID.test(id) && id !== DEFAULT_STYLE);
}

/** Is this one of the project's styles? An unknown or missing id means the default style. */
export const styleIdOf = (projectId: string, styleId: unknown) => (typeof styleId === "string" && extraStyleIds(projectId).includes(styleId) ? styleId : DEFAULT_STYLE);

/**
 * A style of a project: the one saved, else the starter style that fits its name.
 * Without a style id (or with an unknown one), the project's default style.
 */
export function profileOf(project: Project, styleId?: string): StyleProfile {
  const id = styleIdOf(project.id, styleId);
  const saved = getSetting<Stored>(key(project.id, id));
  const starter = { ...starterProfile(presetFor(project.name), signature(project)), id };
  // The strategy belongs to the project: every style writes from the same one.
  const project_ = id === DEFAULT_STYLE ? saved : getSetting<Stored>(key(project.id));
  const strategy = typeof project_?.strategy === "string" ? project_.strategy : "";
  const strategySource = typeof project_?.strategySource === "string" && project_.strategySource ? { strategySource: project_.strategySource } : {};
  if (!saved) return { ...starter, strategy, ...strategySource };
  // A look saved before fields, grid and pill existed must not pick them up from the starter style.
  const look = cleanLook(saved.look, { ...starter.look, fields: [], grid: false, pill: false });
  const kept = typeof look === "string" ? starter.look : look;
  return {
    id,
    name: cleanName(saved.name) || (id === DEFAULT_STYLE ? "Principal" : "Style"),
    notes: typeof saved.notes === "string" ? saved.notes : "",
    preset: PRESETS.some((p) => p.id === saved.preset) ? saved.preset : starter.preset,
    look: kept,
    // A profile stored before this mark existed: its look counts as chosen when it is not the starter one.
    lookSet: typeof saved.lookSet === "boolean" ? saved.lookSet : !sameLook(kept, starter.look),
    tone: typeof saved.tone === "string" ? saved.tone : starter.tone,
    skill: typeof saved.skill === "string" ? saved.skill : "",
    strategy,
    ...strategySource,
    refs: storedRefs(saved.refs),
    ...(cleanMedia(saved.media) ? { media: cleanMedia(saved.media) } : {}),
    saved: true,
  };
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/[\0-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_STYLE_NAME) : "");
const cleanNotes = (v: string) => v.replace(/\r\n?/g, "\n").replace(/[\0-\x08\x0b-\x1f]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_NOTES);

function storedRefs(raw: unknown): ProfileRefs {
  const refs = cleanRefs(raw, emptyRefs());
  const images = (raw as ProfileRefs | undefined)?.images;
  return {
    ...refs,
    images: (Array.isArray(images) ? images : [])
      .filter((i) => typeof i?.id === "string" && IMAGE_ID.test(i.id))
      .map((i) => ({ id: i.id, name: String(i.name ?? "").slice(0, 80) }))
      .slice(0, MAX_REF_IMAGES),
  };
}

/** The default style of every project (what the Studio starts from). */
export function listProfiles(): Record<string, StyleProfile> {
  return Object.fromEntries(listProjects().map((p) => [p.id, profileOf(p)]));
}

/** Every style of every project, the default one first. */
export function listStyles(): Record<string, StyleProfile[]> {
  return Object.fromEntries(listProjects().map((p) => [p.id, [profileOf(p), ...extraStyleIds(p.id).map((id) => profileOf(p, id))]]));
}

/** Saves what the browser sent, on top of the current style. Returns the style, or why it was refused. */
export function saveProfile(project: Project, raw: unknown, styleId?: string): StyleProfile | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const current = profileOf(project, styleId);
  const look = r.look === undefined ? current.look : cleanLook(r.look, current.look);
  if (typeof look === "string") return look;
  if (r.skill !== undefined && typeof r.skill !== "string") return "Dossier du skill invalide";
  const skill = typeof r.skill === "string" ? r.skill.trim() : current.skill;
  // The Mac only ever reads a SKILL.md there, but a path with odd characters is a typo anyway.
  if (skill.length > MAX_SKILL || /[\0\n\r]/.test(skill)) return "Dossier du skill invalide";
  if (r.name !== undefined && !cleanName(r.name)) return "Donne un nom au style";
  const profile: StyleProfile = {
    id: current.id,
    name: r.name === undefined ? current.name : cleanName(r.name),
    notes: typeof r.notes === "string" ? cleanNotes(r.notes) : current.notes,
    preset: PRESETS.some((p) => p.id === r.preset) ? (r.preset as StyleProfile["preset"]) : current.preset,
    look,
    tone: typeof r.tone === "string" ? r.tone.trim().slice(0, MAX_TONE) : current.tone,
    skill,
    strategy: typeof r.strategy === "string" ? r.strategy.replace(/\r\n?/g, "\n").trim().slice(0, MAX_STRATEGY) : current.strategy,
    ...(() => {
      // The name of the document goes with the text: a strategy typed by hand has none.
      const source = r.strategySource === undefined ? current.strategySource : typeof r.strategySource === "string" ? r.strategySource.replace(/[\0-\x1f]/g, "").trim().slice(0, 120) : "";
      return source ? { strategySource: source } : {};
    })(),
    refs: r.refs === undefined ? current.refs : cleanRefs(r.refs, current.refs),
    // `media: null` goes back to Réglages; left out, it stays as it is.
    ...((m) => (m ? { media: m } : {}))(r.media === undefined ? current.media : cleanMedia(r.media)),
    // Saving the tone or a skill alone does not make the starter look a choice.
    lookSet: !!current.lookSet || !sameLook(look, current.look),
    saved: true,
  };
  // The strategy is the project's: set from another style, it goes to the default one.
  if (current.id !== DEFAULT_STYLE && (r.strategy !== undefined || r.strategySource !== undefined)) {
    const main = profileOf(project);
    store(project.id, { ...main, strategy: profile.strategy, ...(profile.strategySource ? { strategySource: profile.strategySource } : {}) });
  }
  return store(project.id, profile);
}

function store(projectId: string, profile: StyleProfile) {
  const { saved: _saved, id, ...rest } = profile;
  void _saved;
  // Only the default style keeps the strategy: the others read it from there.
  const stored: Stored = id === DEFAULT_STYLE ? rest : (({ strategy: _s, strategySource: _src, ...x }) => (void _s, void _src, { ...x, strategy: "" }))(rest);
  setSetting(key(projectId, id), stored);
  return profile;
}

/** A new style for the project, copied from one of its styles (the default one when `from` is unknown). */
export function createStyle(project: Project, name: unknown, from?: unknown): StyleProfile | string {
  const clean = cleanName(name);
  if (!clean) return "Donne un nom au style";
  const ids = extraStyleIds(project.id);
  if (ids.length + 1 >= MAX_STYLES) return `${MAX_STYLES} styles au plus par projet`;
  const base = profileOf(project, typeof from === "string" ? from : undefined);
  let id = "";
  do id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  while (ids.includes(id));
  // Copied without the inspiration images: their files belong to the style they were added to.
  const style: StyleProfile = { ...base, id, name: clean, refs: { ...base.refs, images: [] }, saved: true };
  setSetting(indexKey(project.id), [...ids, id]);
  return store(project.id, style);
}

/** Removes one of the project's other styles (the default one is reset instead). */
export function deleteStyle(project: Project, styleId: string) {
  const ids = extraStyleIds(project.id);
  if (!ids.includes(styleId)) return;
  setSetting(indexKey(project.id), ids.filter((x) => x !== styleId));
  setSetting(key(project.id, styleId), null);
  fs.rmSync(imageDir(project.id, styleId), { recursive: true, force: true });
}

/** This style becomes the project's default one, and the old default one takes its place among the others. */
export function makeDefault(project: Project, styleId: string): StyleProfile | string {
  const ids = extraStyleIds(project.id);
  if (!ids.includes(styleId)) return "Style introuvable";
  const main = profileOf(project);
  const other = profileOf(project, styleId);
  // Swap the inspiration images: the default ones live at the root of the project's folder.
  const root = imageDir(project.id);
  const sub = imageDir(project.id, styleId);
  const tmp = path.join(root, `.swap-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const move = (from: string, to: string, files: string[]) => {
    fs.mkdirSync(to, { recursive: true });
    for (const f of files) if (fs.existsSync(path.join(from, f))) fs.renameSync(path.join(from, f), path.join(to, f));
  };
  move(root, tmp, main.refs.images.map((i) => i.id));
  move(sub, root, other.refs.images.map((i) => i.id));
  move(tmp, sub, main.refs.images.map((i) => i.id));
  fs.rmSync(tmp, { recursive: true, force: true });
  store(project.id, { ...other, id: DEFAULT_STYLE, strategy: main.strategy, ...(main.strategySource ? { strategySource: main.strategySource } : {}) });
  store(project.id, { ...main, id: styleId });
  return profileOf(project);
}

/* ---------- Inspiration images ---------- */

const IMAGE_ID = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const imageDir = (projectId: string, styleId = DEFAULT_STYLE) => {
  const root = path.join(DATA_DIR, "refs", projectId.replace(/[^\w-]/g, ""));
  return styleId === DEFAULT_STYLE ? root : path.join(root, styleId.replace(/[^a-z0-9]/g, ""));
};

/** The kind of image the bytes really are, whatever the browser says. */
function imageKind(b: Buffer): "jpg" | "png" | "webp" | undefined {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return undefined;
}

export function addRefImage(project: Project, bytes: Buffer, name: string, styleId?: string): StyleProfile | string {
  const current = profileOf(project, styleId);
  if (current.refs.images.length >= MAX_REF_IMAGES) return `${MAX_REF_IMAGES} images au plus : retires-en une d'abord`;
  if (bytes.length > MAX_REF_IMAGE_BYTES) return "Image trop lourde";
  const kind = imageKind(bytes);
  if (!kind) return "Image illisible : JPEG, PNG ou WebP";
  const id = `${crypto.randomUUID()}.${kind}`;
  const dir = imageDir(project.id, current.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), bytes);
  const clean = name.replace(/[\0-\x1f]/g, "").trim().slice(0, 80) || "Image";
  return store(project.id, { ...current, refs: { ...current.refs, images: [...current.refs.images, { id, name: clean }] }, saved: true });
}

/** The file of an inspiration image of this project (any of its styles), if it is one. */
export function refImageFile(project: Project, imageId: string): { file: string; type: string } | undefined {
  if (!IMAGE_ID.test(imageId)) return undefined;
  const owner = [DEFAULT_STYLE, ...extraStyleIds(project.id)].find((sid) => profileOf(project, sid).refs.images.some((i) => i.id === imageId));
  if (!owner) return undefined;
  const file = path.join(imageDir(project.id, owner), imageId);
  if (!fs.existsSync(file)) return undefined;
  return { file, type: imageId.endsWith(".png") ? "image/png" : imageId.endsWith(".webp") ? "image/webp" : "image/jpeg" };
}

export function removeRefImage(project: Project, imageId: string, styleId?: string): StyleProfile {
  const current = profileOf(project, styleId);
  if (!current.refs.images.some((i) => i.id === imageId)) return current;
  if (IMAGE_ID.test(imageId)) fs.rmSync(path.join(imageDir(project.id, current.id), imageId), { force: true });
  return store(project.id, { ...current, refs: { ...current.refs, images: current.refs.images.filter((i) => i.id !== imageId) } });
}

/** The default style back to the starter style (its other styles stay). */
export function resetProfile(project: Project): StyleProfile {
  const current = profileOf(project);
  setSetting(key(project.id), null);
  const dir = imageDir(project.id);
  for (const i of current.refs.images) fs.rmSync(path.join(dir, i.id), { force: true });
  // The strategy is the project's, not the style's: it stays.
  if (current.strategy) store(project.id, { ...profileOf(project), strategy: current.strategy, ...(current.strategySource ? { strategySource: current.strategySource } : {}), saved: true });
  return profileOf(project);
}

/** A project removed: all of its styles go. */
export function forgetProfile(projectId: string) {
  for (const id of extraStyleIds(projectId)) setSetting(key(projectId, id), null);
  setSetting(indexKey(projectId), null);
  setSetting(key(projectId), null);
  fs.rmSync(imageDir(projectId), { recursive: true, force: true });
}

/** Colors and font of the Mac's video overlays (subtitles, opening hook, end card) and generic covers. */
export type VideoTheme = { accent: string; ink: string; dark?: string; text?: string; font?: string; googleFont?: string; fontStretch?: string; design?: VideoDesign };
/** How the Mac draws subtitles, hook and cards (worker 0.21.0; older workers ignore it). */
export type VideoDesign = Pick<VideoLook, "weight" | "upper" | "stroke" | "strokeColor" | "box" | "boxColor" | "shadow" | "hook">;

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The look of the project, as the Mac's video theme. Only for a look Antoine chose (`lookSet`): a starter
 * style he never touched must not replace the theme set on the Mac, even once the tone or a skill is saved.
 */
export function themeOf(projectId: string | undefined, styleId?: string): VideoTheme | undefined {
  const project = projectId ? listProjects().find((p) => p.id === projectId) : undefined;
  if (!project) return undefined;
  const p = profileOf(project, styleId);
  if (!p.saved || !p.lookSet) return undefined;
  const { look } = p;
  // The end card and the subtitles need a dark field with light text: the darkest field of the brand.
  const field = look.theme === "custom" ? [...look.fields].sort((a, b) => luminance(a.bg) - luminance(b.bg))[0] : undefined;
  const dark = field && luminance(field.bg) < 0.25 ? field.bg : look.theme === "night" ? "#111418" : undefined;
  const text = field && dark && luminance(field.ink) > 0.6 ? field.ink : undefined;
  return {
    accent: look.accent,
    // Text written on the accent color (the opening hook).
    ink: luminance(look.accent) > 0.45 ? (dark ?? "#141414") : (text ?? "#ffffff"),
    ...(dark ? { dark } : {}),
    ...(text ? { text } : {}),
    ...(look.font === "grotesque"
      ? { font: "Bricolage Grotesque", googleFont: "Bricolage Grotesque:opsz,wdth,wght@12..96,75..100,200..800", fontStretch: "90%" }
      : {}),
    ...videoParts(look.video),
  };
}

/** The video look of a style, as theme keys: its font (from Google Fonts), colors and drawing of the subtitles. */
function videoParts(v: VideoLook | undefined): Partial<VideoTheme> {
  if (!v) return {};
  const design: VideoDesign = {};
  for (const k of ["weight", "upper", "stroke", "strokeColor", "box", "boxColor", "shadow", "hook"] as const) if (v[k] !== undefined) (design as Record<string, unknown>)[k] = v[k];
  return {
    // A static weight is asked first; the Mac falls back on the family alone when Google has no such weight.
    ...(v.font ? { font: v.font, googleFont: `${v.font}:wght@${v.weight ?? 800}`, fontStretch: "100%" } : {}),
    ...(v.text ? { text: v.text } : {}),
    ...(v.card ? { dark: v.card } : {}),
    ...(Object.keys(design).length ? { design } : {}),
  };
}

/** The subtitle settings a style's video look sets (place, animation, size, key word color), over the project's. */
export function captionsOf(projectId: string | undefined, styleId: string | undefined, base: CaptionStyle | undefined): CaptionStyle | undefined {
  const project = projectId ? listProjects().find((p) => p.id === projectId) : undefined;
  const v = project ? profileOf(project, styleId).look.video : undefined;
  if (!v || !(v.position || v.anim || v.size || v.highlight)) return base;
  return { ...DEFAULT_CAPTIONS, ...base, ...(v.position ? { position: v.position } : {}), ...(v.anim ? { look: v.anim } : {}), ...(v.size ? { size: v.size } : {}), ...(v.highlight ? { highlight: v.highlight } : {}) };
}

export type Voice = { tone?: string; skill?: string; examples?: string[]; images?: string[]; strategy?: string };

/** What Claude needs to write in the project's voice. Sent to the Mac with each writing request. */
export function voiceOf(projectId: string | undefined, styleId?: string): Voice | undefined {
  const project = projectId ? listProjects().find((p) => p.id === projectId) : undefined;
  if (!project) return undefined;
  const p = profileOf(project, styleId);
  // The style's notes travel inside the tone: every Mac program already gives the tone to Claude.
  const rules = noteLines(p.notes);
  const tone = [p.tone.trim(), rules.length ? `Notes du style « ${p.name} » (règles à suivre) :\n${rules.map((l) => `- ${l}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  const voice: Voice = {
    ...(tone ? { tone } : {}),
    ...(p.skill ? { skill: p.skill } : {}),
    // Old Mac programs ignore it; from worker 0.14.0 it guides posts, descriptions and scripts.
    ...(p.strategy.trim() ? { strategy: p.strategy.trim() } : {}),
    ...(p.refs.examples.length ? { examples: p.refs.examples.map((e) => e.text) } : {}),
    // Addresses the Mac downloads with its token.
    ...(p.refs.images.length ? { images: p.refs.images.map((i) => `/api/profiles/${project.id}/images/${i.id}`) } : {}),
  };
  return Object.keys(voice).length ? voice : undefined;
}

/** What a style chooses for its videos (voice, music, Claude), or undefined: the claim puts it under Réglages. */
export function mediaOf(projectId: string | undefined, styleId?: string): StyleMedia | undefined {
  const project = projectId ? listProjects().find((p) => p.id === projectId) : undefined;
  return project ? profileOf(project, styleId).media : undefined;
}
