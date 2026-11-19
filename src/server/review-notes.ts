import "server-only";
import fs from "node:fs";
import path from "node:path";
import { MAX_REVIEW_NOTES, type MontageMark, type NoteTargetKind, type ReviewNote } from "@/lib/montage";
import { DATA_DIR, getSetting, setSetting } from "./db";

// Review notes of a face-cam edit: kept apart from the job (setting `review:<job>`), so the Mac's writes on the job never
// meet the page's; the drawings are files next to the job's other files (gone with the job).

const KINDS: NoteTargetKind[] = ["caption", "text", "stage", "title", "broll", "face", "end"];
const key = (jobId: string) => `review:${jobId}`;
const dir = (jobId: string) => path.join(DATA_DIR, "montage", path.basename(jobId), "notes");
export const noteImagePath = (jobId: string, noteId: string) => path.join(dir(jobId), `${path.basename(noteId)}.jpg`);

export const listNotes = (jobId: string): ReviewNote[] => getSetting<ReviewNote[]>(key(jobId)) ?? [];
const save = (jobId: string, notes: ReviewNote[]) => setSetting(key(jobId), notes.length ? notes : undefined);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const unit = (v: unknown) => Math.round(Math.min(1, Math.max(0, num(v) ?? 0.5)) * 1000) / 1000;

function cleanTarget(raw: unknown): ReviewNote["target"] {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const kind = KINDS.find((k) => k === t.kind);
  const label = typeof t.label === "string" ? t.label.trim().slice(0, 120) : "";
  return kind && label ? { kind, label, x: unit(t.x), y: unit(t.y) } : undefined;
}

/** A new note. `image`: the frame with the drawing, as a JPEG/PNG data URL (≤ 550 kB). */
export function addNote(jobId: string, raw: Record<string, unknown>): ReviewNote | string {
  const notes = listNotes(jobId);
  if (notes.length >= MAX_REVIEW_NOTES) return `${MAX_REVIEW_NOTES} retours au plus : supprime ceux qui sont résolus`;
  const t = num(raw.t), version = num(raw.version);
  if (t === undefined || version === undefined) return "Moment ou version manquant";
  const note: ReviewNote = {
    id: crypto.randomUUID().slice(0, 12),
    version: Math.round(version),
    t: Math.round(Math.max(0, t) * 100) / 100,
    text: typeof raw.text === "string" ? raw.text.trim().slice(0, 1000) : "",
    status: "open",
    createdAt: Date.now(),
  };
  const target = cleanTarget(raw.target);
  if (target) note.target = target;
  const m = typeof raw.image === "string" ? raw.image.match(/^data:image\/(?:jpeg|png|webp);base64,(.+)$/) : null;
  if (m) {
    if (m[1].length > 750_000) return "Dessin trop lourd";
    fs.mkdirSync(dir(jobId), { recursive: true });
    fs.writeFileSync(noteImagePath(jobId, note.id), Buffer.from(m[1], "base64"));
    note.image = true;
  }
  save(jobId, [...notes, note]);
  return note;
}

/** Text, status or moment of a note. */
export function updateNote(jobId: string, noteId: string, raw: Record<string, unknown>): ReviewNote | undefined {
  const notes = listNotes(jobId);
  const n = notes.find((x) => x.id === noteId);
  if (!n) return undefined;
  if (typeof raw.text === "string") n.text = raw.text.trim().slice(0, 1000);
  if (raw.status === "open" || raw.status === "resolved") n.status = raw.status;
  if (num(raw.t) !== undefined) n.t = Math.round(Math.max(0, num(raw.t)!) * 100) / 100;
  save(jobId, notes);
  return n;
}

export function removeNote(jobId: string, noteId: string) {
  const notes = listNotes(jobId);
  if (!notes.some((x) => x.id === noteId)) return false;
  fs.rmSync(noteImagePath(jobId, noteId), { force: true });
  save(jobId, notes.filter((x) => x.id !== noteId));
  return true;
}

export const forgetNotes = (jobId: string) => setSetting(key(jobId), undefined);

/**
 * The open notes picked for a request, as the marks the Mac reads (drawing as a data URL; the element picked with
 * « Inspecter » is written in the text). Empty notes without a drawing are left out.
 */
export function notesAsMarks(jobId: string, ids: string[]): MontageMark[] {
  const out: MontageMark[] = [];
  for (const n of listNotes(jobId).filter((x) => ids.includes(x.id) && x.status === "open")) {
    const file = noteImagePath(jobId, n.id);
    const image = n.image && fs.existsSync(file) ? `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}` : undefined;
    const where = n.target ? `[${n.target.label}, à ${Math.round(n.target.x * 100)} % de la largeur et ${Math.round(n.target.y * 100)} % de la hauteur] ` : "";
    const text = `${where}${n.text}`.trim();
    if (!text && !image) continue;
    out.push({ id: n.id, version: n.version, t: n.t, text, image });
  }
  return out;
}

/** The notes sent with the request for version `n`. They stay open until Antoine marks them resolved. */
export function markSent(jobId: string, ids: string[], n: number) {
  const notes = listNotes(jobId);
  for (const x of notes) if (ids.includes(x.id)) x.sentIn = n;
  save(jobId, notes);
}
