import "server-only";
import fs from "node:fs";
import path from "node:path";
import { cleanLook, cleanRefs, emptyRefs, MAX_REF_IMAGE_BYTES, MAX_REF_IMAGES, MAX_SKILL, MAX_TONE, PRESETS, presetFor, type ProfileRefs, starterProfile, type StyleProfile } from "@/lib/profiles";
import type { Project } from "@/lib/types";
import { DATA_DIR, getSetting, listAccounts, listProjects, setSetting } from "./db";

const key = (projectId: string) => `profile:${projectId}`;

/** "@handle" of the project's Instagram account (else its first account): the default signature. */
function signature(project: Project) {
  const pool = listAccounts().filter((a) => project.accountIds.includes(a.id));
  const a = pool.find((x) => x.network === "instagram") ?? pool[0];
  return a ? `@${a.handle}`.slice(0, 40) : "";
}

/** The style profile of a project: the one saved, else the starter style that fits its name. */
export function profileOf(project: Project): StyleProfile {
  const saved = getSetting<Omit<StyleProfile, "saved">>(key(project.id));
  const starter = starterProfile(presetFor(project.name), signature(project));
  if (!saved) return starter;
  // A look saved before fields, grid and pill existed must not pick them up from the starter style.
  const look = cleanLook(saved.look, { ...starter.look, fields: [], grid: false, pill: false });
  return {
    preset: PRESETS.some((p) => p.id === saved.preset) ? saved.preset : starter.preset,
    look: typeof look === "string" ? starter.look : look,
    tone: typeof saved.tone === "string" ? saved.tone : starter.tone,
    skill: typeof saved.skill === "string" ? saved.skill : "",
    refs: storedRefs(saved.refs),
    saved: true,
  };
}

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

export function listProfiles(): Record<string, StyleProfile> {
  return Object.fromEntries(listProjects().map((p) => [p.id, profileOf(p)]));
}

/** Saves what the browser sent, on top of the current profile. Returns the profile, or why it was refused. */
export function saveProfile(project: Project, raw: unknown): StyleProfile | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const current = profileOf(project);
  const look = r.look === undefined ? current.look : cleanLook(r.look, current.look);
  if (typeof look === "string") return look;
  if (r.skill !== undefined && typeof r.skill !== "string") return "Dossier du skill invalide";
  const skill = typeof r.skill === "string" ? r.skill.trim() : current.skill;
  // The Mac only ever reads a SKILL.md there, but a path with odd characters is a typo anyway.
  if (skill.length > MAX_SKILL || /[\0\n\r]/.test(skill)) return "Dossier du skill invalide";
  const profile: StyleProfile = {
    preset: PRESETS.some((p) => p.id === r.preset) ? (r.preset as StyleProfile["preset"]) : current.preset,
    look,
    tone: typeof r.tone === "string" ? r.tone.trim().slice(0, MAX_TONE) : current.tone,
    skill,
    refs: r.refs === undefined ? current.refs : cleanRefs(r.refs, current.refs),
    saved: true,
  };
  return store(project.id, profile);
}

function store(projectId: string, profile: StyleProfile) {
  const { saved: _saved, ...stored } = profile;
  void _saved;
  setSetting(key(projectId), stored);
  return profile;
}

/* ---------- Inspiration images ---------- */

const IMAGE_ID = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const imageDir = (projectId: string) => path.join(DATA_DIR, "refs", projectId.replace(/[^\w-]/g, ""));

/** The kind of image the bytes really are, whatever the browser says. */
function imageKind(b: Buffer): "jpg" | "png" | "webp" | undefined {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return undefined;
}

export function addRefImage(project: Project, bytes: Buffer, name: string): StyleProfile | string {
  const current = profileOf(project);
  if (current.refs.images.length >= MAX_REF_IMAGES) return `${MAX_REF_IMAGES} images au plus : retires-en une d'abord`;
  if (bytes.length > MAX_REF_IMAGE_BYTES) return "Image trop lourde";
  const kind = imageKind(bytes);
  if (!kind) return "Image illisible : JPEG, PNG ou WebP";
  const id = `${crypto.randomUUID()}.${kind}`;
  fs.mkdirSync(imageDir(project.id), { recursive: true });
  fs.writeFileSync(path.join(imageDir(project.id), id), bytes);
  const clean = name.replace(/[\0-\x1f]/g, "").trim().slice(0, 80) || "Image";
  return store(project.id, { ...current, refs: { ...current.refs, images: [...current.refs.images, { id, name: clean }] }, saved: true });
}

/** The file of an inspiration image of this project, if it is one. */
export function refImageFile(project: Project, imageId: string): { file: string; type: string } | undefined {
  if (!IMAGE_ID.test(imageId) || !profileOf(project).refs.images.some((i) => i.id === imageId)) return undefined;
  const file = path.join(imageDir(project.id), imageId);
  if (!fs.existsSync(file)) return undefined;
  return { file, type: imageId.endsWith(".png") ? "image/png" : imageId.endsWith(".webp") ? "image/webp" : "image/jpeg" };
}

export function removeRefImage(project: Project, imageId: string): StyleProfile {
  const current = profileOf(project);
  if (IMAGE_ID.test(imageId)) fs.rmSync(path.join(imageDir(project.id), imageId), { force: true });
  if (!current.refs.images.some((i) => i.id === imageId)) return current;
  return store(project.id, { ...current, refs: { ...current.refs, images: current.refs.images.filter((i) => i.id !== imageId) } });
}

/** Back to the starter style. */
export function resetProfile(project: Project): StyleProfile {
  forgetProfile(project.id);
  return profileOf(project);
}

export function forgetProfile(projectId: string) {
  setSetting(key(projectId), null);
  fs.rmSync(imageDir(projectId), { recursive: true, force: true });
}

export type Voice = { tone?: string; skill?: string; examples?: string[]; images?: string[] };

/** What Claude needs to write in the project's voice. Sent to the Mac with each writing request. */
export function voiceOf(projectId: string | undefined): Voice | undefined {
  const project = projectId ? listProjects().find((p) => p.id === projectId) : undefined;
  if (!project) return undefined;
  const p = profileOf(project);
  const voice: Voice = {
    ...(p.tone.trim() ? { tone: p.tone.trim() } : {}),
    ...(p.skill ? { skill: p.skill } : {}),
    ...(p.refs.examples.length ? { examples: p.refs.examples.map((e) => e.text) } : {}),
    // Addresses the Mac downloads with its token.
    ...(p.refs.images.length ? { images: p.refs.images.map((i) => `/api/profiles/${project.id}/images/${i.id}`) } : {}),
  };
  return Object.keys(voice).length ? voice : undefined;
}
