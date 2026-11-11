import "server-only";
import { cleanLook, MAX_SKILL, MAX_TONE, PRESETS, presetFor, starterProfile, type StyleProfile } from "@/lib/profiles";
import type { Project } from "@/lib/types";
import { getSetting, listAccounts, listProjects, setSetting } from "./db";

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
  const look = cleanLook(saved.look, starter.look);
  return {
    preset: PRESETS.some((p) => p.id === saved.preset) ? saved.preset : starter.preset,
    look: typeof look === "string" ? starter.look : look,
    tone: typeof saved.tone === "string" ? saved.tone : starter.tone,
    skill: typeof saved.skill === "string" ? saved.skill : "",
    saved: true,
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
    saved: true,
  };
  const { saved: _saved, ...stored } = profile;
  void _saved;
  setSetting(key(project.id), stored);
  return profile;
}

/** Back to the starter style. */
export function resetProfile(project: Project): StyleProfile {
  setSetting(key(project.id), null);
  return profileOf(project);
}

export const forgetProfile = (projectId: string) => setSetting(key(projectId), null);

/** What Claude needs to write in the project's voice. Sent to the Mac with each writing request. */
export function voiceOf(projectId: string | undefined): { tone?: string; skill?: string } | undefined {
  const project = projectId ? listProjects().find((p) => p.id === projectId) : undefined;
  if (!project) return undefined;
  const p = profileOf(project);
  const voice = { ...(p.tone.trim() ? { tone: p.tone.trim() } : {}), ...(p.skill ? { skill: p.skill } : {}) };
  return voice.tone || voice.skill ? voice : undefined;
}
