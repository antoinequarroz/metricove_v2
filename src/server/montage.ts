import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_AUDIO, DEFAULT_CAPTIONS, type AudioSettings, type Broll, type CaptionStyle, type Edl, type EdlWord, type JobAction, type MontageFormat, type MontageJob, type MontageMark, type MontageVersion, type Rush } from "@/lib/montage";
import { DATA_DIR, db } from "./db";

/* ---------- Tables ---------- */

let ready = false;
function init() {
  if (ready) return db();
  const conn = db();
  conn.exec(`
    create table if not exists rushes (
      id text primary key,
      name text not null,
      origin text not null,
      size integer not null default 0,
      duration real,
      path text,
      thumb text,
      file text,
      created_at text not null
    );
    create table if not exists montage_jobs (
      id text primary key,
      data text not null,
      claimed_at integer,
      created_at text not null
    );
    create table if not exists uploads (
      id text primary key,
      name text not null,
      size integer not null,
      received integer not null default 0,
      created_at integer not null
    );
    create table if not exists kv (key text primary key, value text not null);
  `);
  ready = true;
  return conn;
}

export const dir = (...parts: string[]) => {
  const d = path.join(DATA_DIR, ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

/* ---------- Chunked uploads ---------- */

/** Bigger bodies are cut by the Next.js middleware, so files come in chunks. */
export const CHUNK_MAX = 8 * 1024 * 1024;
/** Keep this much disk free on the server, whatever happens. */
const DISK_RESERVE = 1024 * 1024 * 1024;

export function freeDisk() {
  try {
    const s = fs.statfsSync(DATA_DIR);
    return s.bavail * s.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

type UploadRow = { id: string; name: string; size: number; received: number; created_at: number };

const uploadPath = (id: string) => path.join(dir("uploads"), `${path.basename(id)}.part`);

export function createUpload(name: string, size: number) {
  cleanUploads();
  if (!Number.isFinite(size) || size <= 0) throw new UploadError("Taille de fichier invalide", 400);
  if (freeDisk() - size < DISK_RESERVE) throw new UploadError("Le serveur n'a plus assez de place pour ce fichier", 507);
  const id = crypto.randomUUID();
  init()
    .prepare("insert into uploads (id, name, size, received, created_at) values (?, ?, ?, 0, ?)")
    .run(id, path.basename(name).slice(0, 200), Math.round(size), Date.now());
  fs.writeFileSync(uploadPath(id), "");
  return { id };
}

export class UploadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function getUpload(id: string) {
  return init().prepare("select * from uploads where id = ?").get(id) as UploadRow | undefined;
}

export function appendUpload(id: string, offset: number, chunk: Buffer) {
  const u = getUpload(id);
  if (!u) throw new UploadError("Envoi introuvable", 404);
  if (offset !== u.received) throw new UploadError(`Morceau attendu à l'octet ${u.received}`, 409);
  if (chunk.length > CHUNK_MAX) throw new UploadError("Morceau trop gros (8 Mo maximum)", 413);
  if (u.received + chunk.length > u.size) throw new UploadError("Le fichier dépasse la taille annoncée", 400);
  fs.appendFileSync(uploadPath(id), chunk);
  const received = u.received + chunk.length;
  init().prepare("update uploads set received = ? where id = ?").run(received, id);
  return { received, complete: received === u.size };
}

/** Takes a finished upload: returns its temporary path and forgets it. */
export function takeUpload(id: string) {
  const u = getUpload(id);
  if (!u) throw new UploadError("Envoi introuvable", 404);
  if (u.received !== u.size) throw new UploadError("Envoi incomplet", 409);
  init().prepare("delete from uploads where id = ?").run(id);
  return { file: uploadPath(id), name: u.name, size: u.size };
}

/** Unfinished or unused uploads are deleted after 24 hours. */
function cleanUploads() {
  const old = init()
    .prepare("select id from uploads where created_at < ?")
    .all(Date.now() - 24 * 3600_000) as { id: string }[];
  for (const { id } of old) {
    fs.rmSync(uploadPath(id), { force: true });
    init().prepare("delete from uploads where id = ?").run(id);
  }
}

export function moveInto(from: string, to: string) {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

/* ---------- Rushes ---------- */

type RushRow = { id: string; name: string; origin: Rush["origin"]; size: number; duration: number | null; path: string | null; thumb: string | null; file: string | null; created_at: string };

const toRush = (r: RushRow): Rush => ({
  id: r.id,
  name: r.name,
  origin: r.origin,
  size: r.size,
  duration: r.duration ?? undefined,
  path: r.path ?? undefined,
  thumb: r.thumb ?? undefined,
  createdAt: r.created_at,
});

export function listRushes(): Rush[] {
  return (init().prepare("select * from rushes order by created_at desc").all() as RushRow[]).map(toRush);
}

export function getRushRow(id: string) {
  return init().prepare("select * from rushes where id = ?").get(id) as RushRow | undefined;
}

/** A video filmed in the Studio or sent from the phone. It waits on the server for the Mac. */
export function addUploadedRush(uploadId: string, name?: string, duration?: number) {
  const up = takeUpload(uploadId);
  const id = crypto.randomUUID();
  const ext = path.extname(up.name).toLowerCase() || ".webm";
  const file = `${id}${ext}`;
  moveInto(up.file, path.join(dir("rushes"), file));
  init()
    .prepare("insert into rushes (id, name, origin, size, duration, file, created_at) values (?, ?, 'upload', ?, ?, ?, ?)")
    .run(id, (name || up.name).slice(0, 200), up.size, Number.isFinite(duration) ? duration : null, file, new Date().toISOString());
  return toRush(getRushRow(id)!);
}

export const rushFile = (r: RushRow) => (r.file ? path.join(dir("rushes"), path.basename(r.file)) : undefined);

/** The Mac fetched the file: free the server. The rush stays listed until the Mac reports it in its folder. */
export function releaseRushFile(id: string) {
  const r = getRushRow(id);
  if (!r) return false;
  const f = rushFile(r);
  if (f) fs.rmSync(f, { force: true });
  init().prepare("update rushes set file = null where id = ?").run(id);
  return true;
}

type ScanItem = { path: string; name?: string; size?: number; duration?: number; mtime?: string; thumb?: string; from?: string };

/** The Mac reports the videos in its folder. Replaces the list of "mac" rushes, keeping ids stable by path. */
export function scanRushes(items: ScanItem[]) {
  const conn = init();
  const existing = conn.prepare("select * from rushes where origin = 'mac'").all() as RushRow[];
  const byPath = new Map(existing.map((r) => [r.path, r]));
  const seen = new Set<string>();
  const tx = conn.transaction(() => {
    for (const it of items) {
      if (!it.path || seen.has(it.path)) continue;
      seen.add(it.path);
      const thumb = typeof it.thumb === "string" && it.thumb.startsWith("data:image/") && it.thumb.length < 60_000 ? it.thumb : null;
      const fields = {
        name: (it.name || path.basename(it.path)).slice(0, 200),
        size: Math.round(it.size ?? 0),
        duration: Number.isFinite(it.duration) ? it.duration! : null,
        path: it.path,
        thumb,
      };
      const prev = byPath.get(it.path);
      const from = it.from ? getRushRow(it.from) : undefined;
      if (prev) {
        conn.prepare("update rushes set name=@name, size=@size, duration=@duration, thumb=coalesce(@thumb, thumb) where id=@id").run({ ...fields, id: prev.id });
      } else if (from) {
        // A Studio take now stored on the Mac: same id, so jobs keep pointing to it.
        const f = rushFile(from);
        if (f) fs.rmSync(f, { force: true });
        conn
          .prepare("update rushes set origin='mac', name=@name, size=@size, duration=coalesce(@duration, duration), path=@path, thumb=coalesce(@thumb, thumb), file=null where id=@id")
          .run({ ...fields, id: from.id });
      } else {
        conn
          .prepare("insert into rushes (id, name, origin, size, duration, path, thumb, created_at) values (@id, @name, 'mac', @size, @duration, @path, @thumb, @createdAt)")
          .run({ ...fields, id: crypto.randomUUID(), createdAt: it.mtime && !Number.isNaN(Date.parse(it.mtime)) ? new Date(it.mtime).toISOString() : new Date().toISOString() });
      }
    }
    // Files gone from the Mac folder.
    for (const r of existing) if (!seen.has(r.path ?? "")) conn.prepare("delete from rushes where id = ?").run(r.id);
  });
  tx();
  return listRushes().filter((r) => r.origin === "mac").length;
}

export function deleteRush(id: string) {
  const r = getRushRow(id);
  if (!r) return false;
  const f = rushFile(r);
  if (f) fs.rmSync(f, { force: true });
  init().prepare("delete from rushes where id = ?").run(id);
  return true;
}

/* ---------- Jobs ---------- */

type JobRow = { id: string; data: string; claimed_at: number | null; created_at: string };

export function listJobs(): MontageJob[] {
  return (init().prepare("select * from montage_jobs order by created_at desc").all() as JobRow[]).map((r) => JSON.parse(r.data));
}

export function getJob(id: string): MontageJob | undefined {
  const r = init().prepare("select * from montage_jobs where id = ?").get(id) as JobRow | undefined;
  return r ? JSON.parse(r.data) : undefined;
}

export function saveJob(job: MontageJob, claimed?: number | null) {
  job.updatedAt = new Date().toISOString();
  const conn = init();
  conn
    .prepare(
      `insert into montage_jobs (id, data, claimed_at, created_at) values (@id, @data, @claimed, @createdAt)
       on conflict(id) do update set data = excluded.data${claimed === undefined ? "" : ", claimed_at = excluded.claimed_at"}`,
    )
    .run({ id: job.id, data: JSON.stringify(job), claimed: claimed ?? null, createdAt: job.createdAt });
  return job;
}

export function deleteJob(id: string) {
  init().prepare("delete from montage_jobs where id = ?").run(id);
  fs.rmSync(path.join(DATA_DIR, "montage", path.basename(id)), { recursive: true, force: true });
}

/** Gives a job to the worker. A claim older than 15 minutes without news is given again (Mac asleep, crash). */
export function claimJob(): MontageJob | undefined {
  const conn = init();
  const stale = Date.now() - 15 * 60_000;
  const rows = conn.prepare("select * from montage_jobs where claimed_at is null or claimed_at < ? order by created_at").all(stale) as JobRow[];
  const row = rows.find((r) => (JSON.parse(r.data) as MontageJob).action);
  if (!row) return undefined;
  const job: MontageJob = JSON.parse(row.data);
  if (job.status !== "rendering") job.status = "working";
  job.step = job.step ?? "Pris en charge par le Mac";
  job.error = undefined;
  return saveJob(job, Date.now());
}

/** The worker reports progress: keeps the claim alive. */
export function touchJob(id: string) {
  init().prepare("update montage_jobs set claimed_at = ? where id = ? and claimed_at is not null").run(Date.now(), id);
}

/** The job waits for the worker again. */
export function queue(job: MontageJob, action: JobAction) {
  job.action = action;
  job.status = action === "final" ? "rendering" : "queued";
  job.step = undefined;
  job.progress = undefined;
  job.error = undefined;
  return saveJob(job, null);
}

/** The worker finished its part. */
export function release(job: MontageJob, status: MontageJob["status"]) {
  job.action = null;
  job.status = status;
  job.step = undefined;
  job.progress = undefined;
  return saveJob(job, null);
}

export const previewPath = (jobId: string, n: number) => path.join(dir("montage", path.basename(jobId)), `v${n}.mp4`);

export function addVersion(job: MontageJob, edl: Edl, by: MontageVersion["by"], notes?: string) {
  const v: MontageVersion = { n: (job.versions.at(-1)?.n ?? 0) + 1, edl, by, notes: notes?.slice(0, 2000), preview: false, createdAt: new Date().toISOString() };
  job.versions.push(v);
  return v;
}

/** Previews are only useful while reviewing. */
export function dropPreviews(jobId: string) {
  fs.rmSync(path.join(DATA_DIR, "montage", path.basename(jobId)), { recursive: true, force: true });
}

/* ---------- Worker presence ---------- */

export function workerSeen(info: { worker?: string; version?: string }) {
  init()
    .prepare("insert into kv (key, value) values ('worker', @v) on conflict(key) do update set value = excluded.value")
    .run({ v: JSON.stringify({ ...info, at: Date.now() }) });
}

export function workerStatus() {
  const r = init().prepare("select value from kv where key = 'worker'").get() as { value: string } | undefined;
  if (!r) return { online: false as const };
  const w = JSON.parse(r.value) as { worker?: string; version?: string; at: number };
  return { online: Date.now() - w.at < 30_000, lastSeen: new Date(w.at).toISOString(), name: w.worker, version: w.version };
}

/* ---------- Validation of what the worker or the page sends ---------- */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : undefined);

export function cleanEdl(raw: unknown, rushIds: string[]): Edl | string {
  if (!raw || typeof raw !== "object") return "EDL manquante";
  const e = raw as Record<string, unknown>;
  const format = ["9:16", "4:5", "1:1", "16:9"].includes(e.format as string) ? (e.format as Edl["format"]) : undefined;
  if (!format) return "Format inconnu";
  if (!Array.isArray(e.segments) || !e.segments.length) return "Aucun segment";
  const segments: Edl["segments"] = [];
  for (const [i, s] of (e.segments as Record<string, unknown>[]).entries()) {
    const inn = num(s.in);
    const out = num(s.out);
    const rush = str(s.rush, 100);
    if (inn === undefined || out === undefined || out <= inn || !rush) return `Segment ${i + 1} invalide`;
    if (rushIds.length && !rushIds.includes(rush)) return `Segment ${i + 1} : rush inconnu`;
    const words = Array.isArray(s.words)
      ? (s.words as Record<string, unknown>[])
          .flatMap((w): EdlWord[] => {
            const t0 = num(w.t0);
            const t1 = num(w.t1);
            const text = str(w.w, 80);
            if (t0 === undefined || t1 === undefined || text === undefined) return [];
            return [{ t0, t1, w: text, cut: w.cut === true || undefined, hl: w.hl === true || undefined, emoji: str(w.emoji, 16) || undefined }];
          })
      : undefined;
    segments.push({
      id: str(s.id, 60) || `s${i + 1}`,
      rush,
      in: inn,
      out,
      text: str(s.text, 2000) ?? "",
      kept: s.kept !== false,
      reason: str(s.reason, 120),
      words,
    });
  }
  const t = e.title as Record<string, unknown> | null | undefined;
  const end = e.endCard as Record<string, unknown> | null | undefined;
  return {
    format,
    segments,
    title: t && str(t.text, 200) ? { text: str(t.text, 200)!, until: num(t.until) ?? 3 } : null,
    endCard: end && str(end.text, 200) ? { text: str(end.text, 200)! } : null,
    zooms: Array.isArray(e.zooms)
      ? (e.zooms as Record<string, unknown>[])
          .map((z) => ({ at: num(z.at)!, dur: num(z.dur)!, scale: num(z.scale)! }))
          .filter((z) => z.at !== undefined && z.dur !== undefined && z.scale !== undefined)
      : [],
    crop: e.crop === "center" ? "center" : "face",
    hooks: Array.isArray(e.hooks) ? (e.hooks as unknown[]).map((h) => str(h, 200)).filter((h): h is string => !!h?.trim()).slice(0, 5) : undefined,
    captions: e.captions === undefined ? undefined : cleanCaptions(e.captions),
    audio: e.audio === undefined ? undefined : cleanAudio(e.audio),
    broll: Array.isArray(e.broll) ? cleanBroll(e.broll) : undefined,
    brollAuto: e.brollAuto === undefined ? undefined : e.brollAuto === true,
    exports: Array.isArray(e.exports) ? [...new Set((e.exports as unknown[]).filter((f): f is MontageFormat => FORMATS.includes(f as string)))].filter((f) => f !== format) : undefined,
  };
}

const FORMATS = ["9:16", "4:5", "1:1", "16:9"];

function cleanBroll(raw: unknown[]): Broll[] {
  const out: Broll[] = [];
  for (const b of (raw as Record<string, unknown>[]).slice(0, 30)) {
    const at = num(b.at);
    const dur = num(b.dur);
    const query = str(b.query, 120)?.trim();
    if (at === undefined || dur === undefined || dur <= 0 || !query) continue;
    const thumb = typeof b.thumb === "string" && b.thumb.startsWith("data:image/") && b.thumb.length < 60_000 ? b.thumb : undefined;
    out.push({
      at: Math.max(0, at),
      dur: Math.min(30, dur),
      query,
      source: b.source === "mine" || b.source === "pexels" ? b.source : undefined,
      ref: str(b.ref, 300) || undefined,
      thumb,
      mode: b.mode === "pip" ? "pip" : "full",
    });
  }
  return out.sort((a, b) => a.at - b.at);
}
const HEX = /^#[0-9a-f]{6}$/i;

export function cleanCaptions(raw: unknown): CaptionStyle {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CAPTIONS;
  return {
    on: c.on !== false,
    position: (["auto", "top", "middle", "bottom"] as const).find((p) => p === c.position) ?? d.position,
    look: (["karaoke", "pop", "simple"] as const).find((p) => p === c.look) ?? d.look,
    size: (["s", "m", "l"] as const).find((p) => p === c.size) ?? d.size,
    highlight: typeof c.highlight === "string" && HEX.test(c.highlight) ? c.highlight : undefined,
    emoji: c.emoji === undefined ? d.emoji : c.emoji === true,
  };
}

export function cleanAudio(raw: unknown): AudioSettings {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const m = (a.music && typeof a.music === "object" ? a.music : {}) as Record<string, unknown>;
  const d = DEFAULT_AUDIO;
  return {
    denoise: a.denoise === undefined ? d.denoise : a.denoise === true,
    silences: (["keep", "tight", "cut"] as const).find((p) => p === a.silences) ?? d.silences,
    music: {
      on: m.on === true,
      track: str(m.track, 200)?.trim() || undefined,
      volume: Math.min(1, Math.max(0, num(m.volume) ?? d.music.volume)),
      duck: m.duck !== false,
    },
  };
}

/** Drawings sent to Claude: at most 8, each image ≤ 400 KB. */
export function cleanMarks(raw: unknown): MontageMark[] | string {
  if (!Array.isArray(raw)) return [];
  const marks: MontageMark[] = [];
  for (const [i, m] of (raw as Record<string, unknown>[]).slice(0, 8).entries()) {
    const t = num(m.t);
    const version = num(m.version);
    const text = str(m.text, 1000)?.trim() ?? "";
    const image = typeof m.image === "string" && m.image.startsWith("data:image/") ? m.image : undefined;
    if (image && image.length > 550_000) return `Dessin ${i + 1} trop lourd`;
    if (t === undefined || version === undefined || (!text && !image)) continue;
    marks.push({ id: str(m.id, 60) || `m${i + 1}`, version, t: Math.max(0, t), text, image });
  }
  return marks;
}

/* ---------- Subtitle style per project ---------- */

export function getStyle(projectId: string): CaptionStyle | undefined {
  const r = init().prepare("select value from kv where key = ?").get(`style:${projectId}`) as { value: string } | undefined;
  return r ? cleanCaptions(JSON.parse(r.value)) : undefined;
}

export function setStyle(projectId: string, style: CaptionStyle) {
  init()
    .prepare("insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value")
    .run(`style:${projectId}`, JSON.stringify(style));
}
