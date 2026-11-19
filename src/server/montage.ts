import "server-only";
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_SFX, DEFAULT_AUDIO, DEFAULT_CAPTIONS, MAX_SFX, MAX_STAGES, STAGE_ANIMS, STAGE_KINDS, type Sfx, type Stage, JOB_PHASES, MAX_TEXTS, MUSIC_FADE, REEL_ACTORS, REEL_BRIDGES, REEL_CAMERAS, REEL_LAYOUTS, REEL_SHAPES, REEL_SOURCES, REEL_TARGETS, REEL_VIDEO, REEL_ZONES, VIDEO_BEAT_ID, VIDEO_BOARD, VIDEO_ENGINE, VIDEO_LIMITS, VIDEO_MOMENT_ID, VIDEO_WORKER, isVideoJob, type AudioSettings, type FreeText, type MusicCue, type Broll, type CaptionStyle, type Edl, type EdlWord, type JobAction, type JobPhase, type JobRun, type MontageFormat, type MontageJob, type MontageMark, type MontageVersion, type ReelBeat, type ReelCode, type ReelFx, type ReelMoment, type ReelPlan, type ReelScene, type ReelVideo, type Rush, type WorkerSpeed } from "@/lib/montage";
import { atLeast } from "@/lib/worker-version";
import type { Look } from "@/lib/profiles";
import { DATA_DIR, db } from "./db";
import { removeSources } from "./sources";

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

/** Forgets an upload nobody will take (a video refused because its run is over): frees the disk now, not in 24 hours. */
export function dropUpload(id: unknown) {
  if (typeof id !== "string" || !getUpload(id)) return;
  init().prepare("delete from uploads where id = ?").run(id);
  fs.rmSync(uploadPath(id), { force: true });
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
  // The documents a reading request was made of go with it.
  const job = getJob(id);
  if (job?.brand && job.projectId) removeSources(job.projectId, job.brand.files.map((f) => f.id));
  init().prepare("delete from montage_jobs where id = ?").run(id);
  fs.rmSync(path.join(DATA_DIR, "montage", path.basename(id)), { recursive: true, force: true });
}

/** A claim without news for this long is given again (Mac asleep, crash). */
const CLAIM_STALE = 15 * 60_000;
/** Same for a video job held by a worker ≥ 0.15.0: it reports every 15 s, and workDir/worker.lock keeps it alone on its Mac. */
const CLAIM_STALE_FAST = 90_000;

/**
 * Does the worker that holds this job report every 15 s? Only a video job run by a worker ≥ 0.15.0 does (its own
 * progress heartbeat); every other path of that same worker (script, caption, post, cover, face-cam edit, reels of
 * scenes) and every older worker still report once a minute.
 */
const fastBeat = (job: MontageJob) => isVideoJob(job) && atLeast(job.run?.by, VIDEO_WORKER);

/**
 * Gives the oldest waiting job to the worker of version `version`, skipping the jobs it is too old for (`minWorker`;
 * a missing version counts as "0.0.0", so it gets no such job). A claim without news for 15 minutes is given again,
 * or for 90 s for a video job held by a worker ≥ 0.15.0 (fastBeat): a Mac that crashed in the middle of a video takes
 * it back as soon as it returns. `run` starts again: the worker that held the job sees `run.startedAt` change and stops.
 */
export function claimJob(version?: string): MontageJob | undefined {
  const conn = init();
  const now = Date.now();
  const rows = conn.prepare("select * from montage_jobs where claimed_at is null or claimed_at < ? order by created_at").all(now - CLAIM_STALE_FAST) as JobRow[];
  for (const row of rows) {
    const job: MontageJob = JSON.parse(row.data);
    if (!job.action) continue;
    // Claimed between 90 s and 15 min ago: only given again when it reports every 15 s (it would have reported).
    if (row.claimed_at !== null && row.claimed_at >= now - CLAIM_STALE && !fastBeat(job)) continue;
    // A video job also needs today's VIDEO_WORKER: one asked before a version bump keeps an older minWorker.
    if (!atLeast(version, job.minWorker) || (isVideoJob(job) && !atLeast(version, VIDEO_WORKER))) continue;
    // A video job starts its run from nothing: what an earlier run left (taken back, or a late report) means nothing here.
    if (job.minWorker) job.step = job.progress = undefined;
    if (job.status !== "rendering") job.status = "working";
    job.step = job.step ?? "Pris en charge par le Mac";
    job.error = undefined;
    const at = new Date(now).toISOString();
    job.run = { startedAt: at, ...(version ? { by: version.slice(0, 20) } : {}), beatAt: at };
    return saveJob(job, now);
  }
  return undefined;
}

/**
 * A write from the worker that belongs to a run that is over: answered 409, nothing is stored. `run` is the
 * `run.startedAt` the worker got with its claim and sends back with each write (worker ≥ 0.15.0, optional): another
 * value means the page stopped that run, or another claim took the job (`queue()` and `release()` clear `run`, a claim
 * sets a new one). Without it (older workers, or a worker that does not send it yet), only a video job (`video`) is
 * checked, by its state: it takes worker writes only while it is claimed, never with no action (stopped, cancelled,
 * finished) nor while it waits in the queue (a new request made after a stop, that nobody has claimed yet). Other jobs
 * keep their old behaviour. Returns the French reason, or undefined when the write is the current run's.
 * A refused write still says the Mac is there: its presence is refreshed (its `busy` job is left as it is, and
 * workerStatus no longer counts it once it is not the Mac's), so that a request queued after a stop never reads « Mac
 * éteint » while the Mac drops the old run. A worker 0.15.0 takes the 409 as the order to stop.
 */
export function staleWrite(job: MontageJob, run: unknown, video = isVideoJob(job)): string | undefined {
  let why: string | undefined;
  if (typeof run === "string" && run) why = run === job.run?.startedAt ? undefined : "Ce passage du Mac est terminé (arrêté, repris ou remplacé) : rien n'est enregistré";
  else if (video && (!job.action || job.status === "queued")) why = "Ce reel n'est plus en cours sur le Mac : rien n'est enregistré";
  if (why) workerSeen({});
  return why;
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
  job.run = undefined;
  return saveJob(job, null);
}

/** The worker finished its part. */
export function release(job: MontageJob, status: MontageJob["status"]) {
  job.action = null;
  job.status = status;
  job.step = undefined;
  job.progress = undefined;
  job.run = undefined;
  return saveJob(job, null);
}

const intIn = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const secIn = (v: unknown, hi = 3600) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= hi ? Math.round(v * 1000) / 1000 : undefined);
const isPhase = (v: unknown): v is JobPhase => JOB_PHASES.includes(v as JobPhase);

/** The markers of a run as the worker reports them: at most 12, with their times in the video. */
function cleanRunBeats(raw: unknown): JobRun["beats"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<JobRun["beats"]> = [];
  for (const b of (raw as Record<string, unknown>[]).slice(0, REEL_VIDEO.beats[1])) {
    const start = secIn(b?.start, 61);
    const end = secIn(b?.end, 61);
    if (typeof b?.id !== "string" || !VIDEO_BEAT_ID.test(b.id) || start === undefined || end === undefined || !(start < end)) continue;
    out.push({ id: b.id, title: line(b.title, VIDEO_LIMITS.beat.title), start, end });
  }
  return out.length ? out : undefined;
}

/**
 * What the worker reports while it works (PATCH { step, progress, phase?, phases?, eta?, frames?, beats?, done? }),
 * on the `run` of the job. Fields out of bounds are ignored; an older worker sends none of them and only refreshes
 * `beatAt`. Times are the server's: `phaseAt` when the phase changes, `etaAt` = now + eta seconds.
 */
export function reportRun(job: MontageJob, b: Record<string, unknown>) {
  const now = new Date();
  const at = now.toISOString();
  // A job taken before the server knew `run` (or by a worker that sends none) gets one at its first report.
  const run: JobRun = job.run ?? { startedAt: at, beatAt: at };
  if (isPhase(b.phase) && b.phase !== run.phase) {
    run.phase = b.phase;
    run.phaseAt = at;
  }
  if (Array.isArray(b.phases)) {
    const phases = [...new Set((b.phases as unknown[]).filter(isPhase))].slice(0, JOB_PHASES.length);
    if (phases.length) run.phases = phases;
  }
  const eta = secIn(b.eta);
  if (eta !== undefined) run.etaAt = new Date(now.getTime() + eta * 1000).toISOString();
  if (Array.isArray(b.frames) && b.frames.length === 2) {
    const n = intIn(b.frames[1], 0, 20_000);
    const i = n === undefined ? undefined : intIn(b.frames[0], 0, n);
    if (i !== undefined && n !== undefined) run.frames = [i, n];
  }
  const beats = cleanRunBeats(b.beats);
  if (beats) run.beats = beats;
  if (Array.isArray(b.done)) {
    const done = (b.done as Record<string, unknown>[])
      .slice(0, JOB_PHASES.length)
      .flatMap((d) => (isPhase(d?.phase) && secIn(d.s) !== undefined ? [{ phase: d.phase, s: secIn(d.s)! }] : []));
    if (done.length) run.done = done;
  }
  run.beatAt = at;
  job.run = run;
}

/* ---------- Storyboard of a video job (worker 0.15.0) ---------- */

export const boardPath = (jobId: string) => path.join(dir("montage", path.basename(jobId)), "board.jpg");

/** Where the board of a job would be, without creating its folder (GET). */
export const boardFile = (jobId: string) => path.join(DATA_DIR, "montage", path.basename(jobId), "board.jpg");

/**
 * The storyboard the Mac took before rendering: a JPEG sprite, one tile per beat at the instant it is settled.
 * `image` = "data:image/jpeg;base64,…" (VIDEO_BOARD.chars at most, VIDEO_BOARD.bytes decoded), `frames` = [{ id, t }]
 * (VIDEO_BOARD.frames at most). Stored as a file (the job only keeps its version number). Returns an error in French.
 */
export function saveBoard(job: MontageJob, image: unknown, frames: unknown): string | undefined {
  const prefix = "data:image/jpeg;base64,";
  if (typeof image !== "string" || !image.startsWith(prefix)) return "Planche attendue en data:image/jpeg;base64";
  if (image.length > VIDEO_BOARD.chars) return `Planche trop lourde (${Math.round(VIDEO_BOARD.bytes / 1024)} Ko au plus)`;
  const bytes = Buffer.from(image.slice(prefix.length), "base64");
  if (bytes.length > VIDEO_BOARD.bytes) return `Planche trop lourde (${Math.round(VIDEO_BOARD.bytes / 1024)} Ko au plus)`;
  // A JPEG starts with FF D8 FF and ends with FF D9.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return "La planche n'est pas une image JPEG";
  if (!Array.isArray(frames) || !frames.length || frames.length > VIDEO_BOARD.frames) return `Tuiles de la planche : 1 à ${VIDEO_BOARD.frames}`;
  const tiles: NonNullable<JobRun["board"]>["frames"] = [];
  for (const f of frames as Record<string, unknown>[]) {
    const t = secIn(f?.t, 61);
    if (typeof f?.id !== "string" || !VIDEO_BEAT_ID.test(f.id) || t === undefined) return "Tuile de la planche invalide";
    tiles.push({ id: f.id, t });
  }
  const file = boardPath(job.id);
  fs.writeFileSync(`${file}.part`, bytes);
  fs.renameSync(`${file}.part`, file);
  const at = new Date().toISOString();
  job.run = { ...(job.run ?? { startedAt: at, beatAt: at }), beatAt: at, board: { v: Date.now(), n: tiles.length, frames: tiles } };
  return undefined;
}

/** For each job waiting for the Mac: how many jobs with an action were made before it (they go first). */
export function withAhead<T extends MontageJob>(jobs: T[]): T[] {
  const active = jobs.filter((j) => j.action).map((j) => j.createdAt);
  return jobs.map((j) => (j.action && j.status === "queued" ? { ...j, ahead: active.filter((c) => c < j.createdAt).length } : j));
}

export const previewPath = (jobId: string, n: number) => path.join(dir("montage", path.basename(jobId)), `v${n}.mp4`);

export function addVersion(job: MontageJob, edl: Edl, by: MontageVersion["by"], notes?: string, reel?: ReelPlan) {
  const v: MontageVersion = { n: (job.versions.at(-1)?.n ?? 0) + 1, edl, ...(reel ? { reel } : {}), by, notes: notes?.slice(0, 2000), preview: false, createdAt: new Date().toISOString() };
  job.versions.push(v);
  return v;
}

/** Previews are only useful while reviewing. */
export function dropPreviews(jobId: string) {
  fs.rmSync(path.join(DATA_DIR, "montage", path.basename(jobId)), { recursive: true, force: true });
}

/* ---------- Worker presence ---------- */

/** The presence record of the Mac (kv 'worker'). `busy`: the job it reported on last (cleared by its next claim). */
type WorkerRecord = { worker?: string; version?: string; tracks?: string[]; speed?: WorkerSpeed; busy?: string; at: number };

function readWorker(): WorkerRecord | undefined {
  const r = init().prepare("select value from kv where key = 'worker'").get() as { value: string } | undefined;
  if (!r) return undefined;
  try {
    return JSON.parse(r.value) as WorkerRecord;
  } catch {
    return undefined;
  }
}

function writeWorker(w: WorkerRecord) {
  init()
    .prepare("insert into kv (key, value) values ('worker', @v) on conflict(key) do update set value = excluded.value")
    .run({ v: JSON.stringify(w) });
}

/**
 * The Mac says it is there. What it does not send (version, music `tracks`, `speed`) keeps its last value: the rush
 * scan sends no version, and must not make the version gate blink. `idle` (a claim: the Mac only asks for work
 * between two jobs) clears `busy`.
 */
export function workerSeen(info: { worker?: string; version?: string; tracks?: string[]; speed?: WorkerSpeed }, { idle = false }: { idle?: boolean } = {}) {
  const before = readWorker();
  const worker = info.worker ?? before?.worker;
  const version = info.version ?? before?.version;
  const tracks = info.tracks ?? before?.tracks;
  const speed = info.speed ?? before?.speed;
  const busy = idle ? undefined : before?.busy;
  writeWorker({ worker, version, ...(tracks ? { tracks } : {}), ...(speed ? { speed } : {}), ...(busy ? { busy } : {}), at: Date.now() });
}

/** The Mac reported on a job (PATCH, board): it is there and busy with it. The rest of its record is kept. */
export function touchWorker(jobId: string) {
  const before = readWorker();
  writeWorker({ ...before, busy: jobId, at: Date.now() });
}

/** The speed a claim reports ({ frameMs, writeS }), within sane bounds; undefined when nothing usable. */
export function cleanSpeed(raw: unknown): WorkerSpeed | undefined {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const frameMs = num(s.frameMs);
  const writeS = num(s.writeS);
  const out: WorkerSpeed = {
    ...(frameMs !== undefined && frameMs >= 1 && frameMs <= 10_000 ? { frameMs: Math.round(frameMs) } : {}),
    ...(writeS !== undefined && writeS >= 1 && writeS <= 3600 ? { writeS: Math.round(writeS) } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** One shot of the Mac B-roll folder, as the page lists it. */
export type MacBroll = { name: string; thumb?: string; dur?: number };

/** The files of the Mac B-roll folder (worker 0.13.0), kept apart from the presence record that is read every few seconds. */
export function saveMacBroll(list: MacBroll[]) {
  init()
    .prepare("insert into kv (key, value) values ('worker-broll', @v) on conflict(key) do update set value = excluded.value")
    .run({ v: JSON.stringify({ list, at: Date.now() }) });
}

export function macBroll(): { list: MacBroll[]; at?: string } {
  const r = init().prepare("select value from kv where key = 'worker-broll'").get() as { value: string } | undefined;
  if (!r) return { list: [] };
  const v = JSON.parse(r.value) as { list: MacBroll[]; at: number };
  return { list: v.list, at: new Date(v.at).toISOString() };
}

/** Presence windows: seen recently, or busy and reporting (a busy Mac sends no claim; it reports every 15 s on a video job of a 0.15.0 worker, every 60 s otherwise). */
const SEEN_MS = 30_000;
const BUSY_MS = 90_000;
const SILENT_MS = 45_000;
const SILENT_OLD_MS = 120_000;

export type WorkerState = {
  online: boolean;
  lastSeen?: string;
  name?: string;
  version?: string;
  tracks?: string[];
  /** The job the Mac works on right now. */
  busy?: { id: string; title: string };
  /** Busy, but no news for a while (asleep? crashed?): its job will be taken back. */
  silent?: boolean;
  speed?: WorkerSpeed;
};

export function workerStatus(): WorkerState {
  const w = readWorker();
  if (!w) return { online: false };
  const age = Date.now() - w.at;
  // `busy` only counts while the Mac holds that job: finished, stopped or deleted, the Mac is free; back in the queue
  // (a new request after a stop, nobody has claimed it yet), it is not the Mac's either.
  const job = w.busy ? getJob(w.busy) : undefined;
  const busy = job && job.action && job.status !== "queued" ? { id: job.id, title: job.title } : undefined;
  return {
    online: age < SEEN_MS || (!!busy && age < BUSY_MS),
    lastSeen: new Date(w.at).toISOString(),
    name: w.worker,
    version: w.version,
    tracks: w.tracks,
    ...(busy && job ? { busy, silent: age >= (fastBeat(job) ? SILENT_MS : SILENT_OLD_MS) } : {}),
    ...(w.speed ? { speed: w.speed } : {}),
  };
}

/* ---------- Validation of what the worker or the page sends ---------- */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : undefined);
/**
 * One line of text: no line breaks, no runs of breaking spaces (the engine lays out words, never raw markup). The
 * non-breaking spaces of French typography (U+00A0, narrow U+202F, figure U+2007: « Chapitre 3 », « 3 h », « 12 % »)
 * are kept: JavaScript's \s matches them too.
 */
const line = (v: unknown, max: number) => (str(v, max * 2) ?? "").replace(/[^\S\u00a0\u202f\u2007]+/g, " ").trim().slice(0, max);

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
            return [{ t0, t1, w: text, cut: w.cut === true || undefined, hl: w.hl === true || undefined, emoji: str(w.emoji, 16) || undefined, brk: w.brk === true || undefined, glue: w.glue === true || undefined }];
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
      ...((sp) => (sp !== undefined && sp >= 0.5 && sp <= 2 && sp !== 1 ? { speed: Math.round(sp * 100) / 100 } : {}))(num(s.speed)),
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
          .map((z) => ({ at: num(z.at)!, dur: num(z.dur)!, scale: num(z.scale)!, ...(z.hold === true ? { hold: true } : {}) }))
          .filter((z) => z.at !== undefined && z.dur !== undefined && z.scale !== undefined)
      : [],
    crop: e.crop === "center" ? "center" : "face",
    hooks: Array.isArray(e.hooks) ? (e.hooks as unknown[]).map((h) => str(h, 200)).filter((h): h is string => !!h?.trim()).slice(0, 5) : undefined,
    captions: e.captions === undefined ? undefined : cleanCaptions(e.captions),
    audio: e.audio === undefined ? undefined : cleanAudio(e.audio),
    broll: Array.isArray(e.broll) ? cleanBroll(e.broll) : undefined,
    brollAuto: e.brollAuto === undefined ? undefined : e.brollAuto === true,
    ...(Array.isArray(e.stages) && e.stages.length ? { stages: cleanStages(e.stages) } : {}),
    ...(Array.isArray(e.sfx) && e.sfx.length ? { sfx: cleanSfx(e.sfx) } : {}),
    ...(e.stageAuto === false ? { stageAuto: false } : {}),
    ...(Array.isArray(e.texts) && e.texts.length ? { texts: cleanTexts(e.texts) } : {}),
    exports: Array.isArray(e.exports) ? [...new Set((e.exports as unknown[]).filter((f): f is MontageFormat => FORMATS.includes(f as string)))].filter((f) => f !== format) : undefined,
  };
}

const FORMATS = ["9:16", "4:5", "1:1", "16:9"];

/** Key moments: at most 12, bounded (two at the same time: the Mac keeps the first). */
export function cleanStages(raw: unknown[]): Stage[] {
  const out: Stage[] = [];
  for (const x of (raw as Record<string, unknown>[]).slice(0, MAX_STAGES * 2)) {
    const at = num(x?.at), dur = num(x?.dur);
    const title = str(x?.title, 80)?.trim();
    const kind = STAGE_KINDS.find((k) => k === x?.kind);
    if (at === undefined || dur === undefined || !title || !kind) continue;
    const s: Stage = { at: Math.round(Math.max(0, at) * 100) / 100, dur: Math.round(Math.min(15, Math.max(0.8, dur)) * 100) / 100, kind, title };
    const body = str(x.body, 140)?.trim();
    if (body) s.body = body;
    const ill = str(x.illustration, 60);
    if (ill && /^[\w-]+$/.test(ill)) s.illustration = ill;
    const anim = STAGE_ANIMS.find((a) => a === x.anim);
    if (anim) s.anim = anim;
    out.push(s);
    if (out.length >= MAX_STAGES) break;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Sound effects: a library id or a sound the Mac makes (`builtin:whoosh`). */
export function cleanSfx(raw: unknown[]): Sfx[] {
  const out: Sfx[] = [];
  for (const x of (raw as Record<string, unknown>[]).slice(0, MAX_SFX * 2)) {
    const at = num(x?.at);
    const sound = str(x?.sound, 60);
    if (at === undefined || !sound || !(/^[\w-]+$/.test(sound) || BUILTIN_SFX.some((b) => sound === `builtin:${b}`))) continue;
    const v = num(x.volume);
    out.push({ at: Math.round(Math.max(0, at) * 100) / 100, sound, name: str(x.name, 80)?.trim() || sound.replace(/^builtin:/, ""), ...(v !== undefined ? { volume: Math.round(Math.min(1.5, Math.max(0.05, v)) * 100) / 100 } : {}) });
    if (out.length >= MAX_SFX) break;
  }
  return out.sort((a, b) => a.at - b.at);
}

export function cleanBroll(raw: unknown[]): Broll[] {
  const out: Broll[] = [];
  for (const b of (raw as Record<string, unknown>[]).slice(0, 30)) {
    const at = num(b.at);
    const dur = num(b.dur);
    const query = str(b.query, 120)?.trim();
    if (at === undefined || dur === undefined || dur <= 0 || !query) continue;
    // A small picture made by the Mac, or the one shown in the picker (Pexels still, cover of a library video).
    const thumb =
      typeof b.thumb === "string" && ((b.thumb.startsWith("data:image/") && b.thumb.length < 60_000) || /^https:\/\/images\.pexels\.com\/[^\s"'<>]{1,500}$/.test(b.thumb) || /^\/api\/media\/[\w-]{1,80}\/cover$/.test(b.thumb))
        ? b.thumb
        : undefined;
    out.push({
      at: Math.max(0, at),
      dur: Math.min(30, dur),
      query,
      source: b.source === "mine" || b.source === "pexels" || b.source === "library" ? b.source : undefined,
      ref: str(b.ref, 300) || undefined,
      thumb,
      mode: b.mode === "pip" ? "pip" : "full",
      ...(b.source === "pexels" && typeof b.url === "string" && /^https:\/\/videos\.pexels\.com\/[^\s"'<>]{1,400}$/.test(b.url) ? { url: b.url } : {}),
      ...(num(b.from)! > 0 ? { from: Math.min(3600, Math.round(num(b.from)! * 100) / 100) } : {}),
      ...(num(b.sound)! > 0 ? { sound: Math.min(1, Math.round(num(b.sound)! * 100) / 100) } : {}),
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

/** Where the music starts and its fades, kept only when set. */
/** Texts put on the video by hand: at most 12, bounded. */
export function cleanTexts(raw: unknown): FreeText[] {
  const out: FreeText[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []) {
    if (out.length >= MAX_TEXTS) break;
    const text = (str(t?.text, 200) ?? "").replace(/\r/g, "").trim();
    const start = Math.max(0, num(t?.start) ?? 0);
    const end = Math.min(num(t?.end) ?? start + 3, start + 600);
    if (!text || !(end - start >= 0.3)) continue;
    let id = (str(t?.id, 40) ?? "").replace(/[^\w-]/g, "");
    if (!id || seen.has(id)) id = `t-${crypto.randomUUID().slice(0, 8)}`;
    seen.add(id);
    const unit = (v: unknown) => Math.min(1, Math.max(0, num(v) ?? 0.5));
    out.push({
      id,
      text,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      x: Math.round(unit(t?.x) * 1000) / 1000,
      y: Math.round(unit(t?.y) * 1000) / 1000,
      size: (["s", "m", "l", "xl"] as const).find((z) => z === t?.size) ?? "m",
      style: t?.style === "band" ? "band" : "plain",
    });
  }
  return out;
}

export function cleanCue(raw: unknown): MusicCue {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (v: unknown, max: number) => (num(v) !== undefined && num(v)! >= 0 ? Math.round(Math.min(max, num(v)!) * 10) / 10 : undefined);
  const [start, fadeIn, fadeOut] = [pick(m.start, MUSIC_FADE.maxStart), pick(m.fadeIn, MUSIC_FADE.maxIn), pick(m.fadeOut, MUSIC_FADE.maxOut)];
  return { ...(start ? { start } : {}), ...(fadeIn !== undefined ? { fadeIn } : {}), ...(fadeOut !== undefined ? { fadeOut } : {}) };
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
      ...cleanCue(m),
    },
  };
}

/** Drawings sent to Claude: at most 8, each image ≤ 400 KB. */
export function cleanMarks(raw: unknown): MontageMark[] | string {
  if (!Array.isArray(raw)) return [];
  const marks: MontageMark[] = [];
  for (const [i, m] of (raw as Record<string, unknown>[]).slice(0, 40).entries()) {
    if (marks.length >= 8) break;
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

/* ---------- Animated reel: the plan of a version ---------- */

/** A reel version has no edit list. */
export const EMPTY_EDL: Edl = { format: "9:16", segments: [] };

const FX = {
  enter: ["rise", "type", "punch", "slide", "blur"],
  transition: ["auto", "up", "circle", "side", "cut"],
  decor: ["ring", "dots", "bars", "none"],
} as const;

function cleanFx(raw: unknown): ReelFx | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, among: readonly T[]) => (among.includes(v as T) ? (v as T) : among[0]);
  return { enter: pick(r.enter, FX.enter), transition: pick(r.transition, FX.transition), decor: pick(r.decor, FX.decor), accent: (str(r.accent, 60) ?? "").replace(/\s+/g, " ").trim(), count: r.count === true };
}

/** Code written by Claude on the Mac. The Mac checks it again before every render; here only its size is bounded. */
function cleanCode(raw: unknown): ReelCode | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.html !== "string" || typeof r.js !== "string" || r.html.length > 20_000 || r.js.length > 15_000) return undefined;
  const css = typeof r.css === "string" ? r.css : "";
  if (css.length > 12_000) return undefined;
  const at = num(r.at);
  return { html: r.html, css, js: r.js, ...(at !== undefined && Number.isInteger(at) && at >= 0 && at < 20 ? { at } : {}) };
}

const PACES = ["calm", "normal", "fast"] as const;

/* ---------- Continuous video reel (worker 0.15.0): the `video` of a plan ---------- */

const pick = <T extends string>(v: unknown, among: readonly T[], fallback: T): T => (among.includes(v as T) ? (v as T) : fallback);
/** Free text that may keep its line breaks (request, direction, caption). */
const para = (v: unknown, max: number) => (str(v, max * 2) ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);

/** The texts and choices of a beat, bounded (shared by the Mac and the page). Undefined when it has no text at all. */
function beatFields(x: Record<string, unknown>, fallback?: ReelBeat): Omit<ReelBeat, "id" | "start" | "end" | "say"> | undefined {
  const L = VIDEO_LIMITS.beat;
  const text = line(x.text, L.text) || (fallback?.text ?? "");
  const title = line(x.title, L.title) || fallback?.title || text.slice(0, L.title);
  if (!text) return undefined;
  const sub = line(x.sub, L.sub);
  const items = Array.isArray(x.items) ? (x.items as unknown[]).map((i) => line(i, L.item)).filter(Boolean).slice(0, L.items) : [];
  const emphasis = line(x.emphasis, L.emphasis);
  const seconds = num(x.seconds) ?? fallback?.seconds ?? 3;
  const [lo, hi] = REEL_VIDEO.seconds;
  return {
    title,
    text,
    ...(sub ? { sub } : {}),
    ...(items.length ? { items } : {}),
    ...(emphasis ? { emphasis } : {}),
    ...(x.count === true ? { count: true } : {}),
    layout: pick(x.layout, REEL_LAYOUTS, fallback?.layout ?? "stack"),
    bridge: pick(x.bridge, REEL_BRIDGES, fallback?.bridge ?? "morph"),
    actor: pick(x.actor, REEL_ACTORS, fallback?.actor ?? "rest"),
    camera: pick(x.camera, REEL_CAMERAS, fallback?.camera ?? "drift"),
    seconds: Math.min(hi, Math.max(lo, seconds)),
    ...(x.fixed === true ? { fixed: true } : {}),
    ...(x.cut === true ? { cut: true } : {}),
  };
}

/** The reserved fields (METRI-18, METRI-27/28): not read in v1, kept bounded so that a newer Mac can round-trip them. */
function reservedVideo(v: Record<string, unknown>): Pick<ReelVideo, "captions" | "voiceOver" | "motionStyle"> {
  const c = v.captions as Record<string, unknown> | undefined;
  const o = v.voiceOver as Record<string, unknown> | undefined;
  const style = line(v.motionStyle, 1000);
  return {
    ...(c && typeof c === "object" ? { captions: { on: c.on === true, ...(["karaoke", "pop", "simple"].includes(c.look as string) ? { look: c.look as "karaoke" | "pop" | "simple" } : {}) } } : {}),
    ...(o && typeof o === "object" && o.provider === "elevenlabs" && line(o.voiceId, 100) ? { voiceOver: { provider: "elevenlabs" as const, voiceId: line(o.voiceId, 100) } } : {}),
    ...(style ? { motionStyle: style } : {}),
  };
}

/** Code of a moment from the Mac: strings within the bounds of VIDEO_LIMITS. The Mac checks it again before every render. */
function videoCode(raw: unknown): ReelCode | "trop long" | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const [html, css, js] = [r.html, r.css ?? "", r.js].map((x) => (typeof x === "string" ? x : undefined));
  if (html === undefined || css === undefined || js === undefined) return undefined;
  const M = VIDEO_LIMITS.moment;
  if (html.length > M.html || css.length > M.css || js.length > M.js) return "trop long";
  return { html, css, js };
}

/**
 * The `video` of a plan. From the Mac (`base` left out): the whole score, code of the moments included (bounded only:
 * the Mac is the safety boundary). From the page (`base` = the video of the version it starts from): the page edits
 * texts, choices, lengths, cuts and the order of the beats the base has; everything else (request, seed, moments and
 * their code…) comes from the base, and a moment survives only when the page still marks it `custom`.
 */
export function cleanVideo(raw: unknown, base?: ReelVideo): ReelVideo | string {
  if (!raw || typeof raw !== "object") return "Plan vidéo manquant";
  const v = raw as Record<string, unknown>;
  const fromMac = !base;
  if (fromMac && v.engine !== VIDEO_ENGINE) return "Moteur vidéo inconnu : mets le site à jour";

  // Beats.
  const beats: ReelBeat[] = [];
  const seen = new Set<string>();
  for (const [i, x] of (Array.isArray(v.beats) ? (v.beats as Record<string, unknown>[]) : []).entries()) {
    if (!x || typeof x !== "object" || beats.length >= REEL_VIDEO.beats[1]) continue;
    if (base) {
      // The page: only the beats of the base, each at most once; what it does not say well stays as in the base.
      const old = base.beats.find((b) => b.id === x.id);
      if (!old || seen.has(old.id)) continue;
      const f = beatFields(x, old);
      if (!f) continue;
      seen.add(old.id);
      beats.push({ id: old.id, ...f, ...(old.say ? { say: old.say } : {}) });
      continue;
    }
    const f = beatFields(x);
    if (!f) continue;
    // Ids are stable across versions: a bad or repeated one gets a new unique id (moments that pointed to it are dropped).
    let id = typeof x.id === "string" && VIDEO_BEAT_ID.test(x.id) && !seen.has(x.id) ? x.id : `b${i + 1}`;
    for (let k = 2; seen.has(id); k++) id = `b${i + 1}-${k}`;
    seen.add(id);
    const start = num(x.start);
    const end = num(x.end);
    const say = line(x.say, 300);
    beats.push({
      id,
      ...f,
      ...(say ? { say } : {}),
      ...(start !== undefined && end !== undefined && start >= 0 && start < end && end <= 61 ? { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 } : {}),
    });
  }
  if (beats.filter((b) => !b.cut).length < REEL_VIDEO.keep) return "Garde au moins deux temps forts";

  // Moments.
  const ids = new Set(beats.map((b) => b.id));
  const moments: ReelMoment[] = [];
  let total = 0;
  for (const x of Array.isArray(v.moments) ? (v.moments as Record<string, unknown>[]) : []) {
    if (!x || typeof x !== "object" || moments.length >= REEL_VIDEO.moments) continue;
    if (moments.some((m) => m.id === x.id)) continue;
    if (base) {
      // The page never brings code nor moves a moment: kept from the base, while the page still marks it `custom`.
      const old = base.moments.find((m) => m.id === x.id);
      if (!old || x.custom !== true || !ids.has(old.from) || !ids.has(old.to)) continue;
      moments.push({ id: old.id, brief: old.brief, from: old.from, to: old.to, zone: old.zone, ...(old.code ? { code: old.code } : {}) });
      continue;
    }
    if (typeof x.id !== "string" || !VIDEO_MOMENT_ID.test(x.id)) continue;
    const from = typeof x.from === "string" ? x.from : "";
    const to = typeof x.to === "string" ? x.to : "";
    if (!ids.has(from) || !ids.has(to)) continue;
    const code = videoCode(x.code);
    if (code === "trop long") return "Code des animations trop long";
    total += code ? code.html.length + code.css.length + code.js.length : 0;
    if (total > VIDEO_LIMITS.code) return "Code des animations trop long";
    moments.push({ id: x.id, brief: line(x.brief, VIDEO_LIMITS.moment.brief), from, to, zone: pick(x.zone, REEL_ZONES, "above"), ...(code ? { code } : {}) });
  }

  if (base) {
    // Everything the page cannot change.
    const { beats: _b, moments: _m, ...head } = base;
    void _b;
    void _m;
    return { ...head, beats, moments };
  }
  const target = REEL_TARGETS.find((t) => t === v.target);
  const direction = para(v.direction, 1000);
  const caption = para(v.caption, VIDEO_LIMITS.caption);
  const seed = num(v.seed);
  const tools = (v.tools && typeof v.tools === "object" ? v.tools : {}) as Record<string, unknown>;
  const worker = line(tools.worker, VIDEO_LIMITS.tools);
  const hyperframes = line(tools.hyperframes, VIDEO_LIMITS.tools);
  return {
    engine: VIDEO_ENGINE,
    request: para(v.request, REEL_VIDEO.request),
    source: pick(v.source, REEL_SOURCES, "idea"),
    ...(target ? { target } : {}),
    ...(direction ? { direction } : {}),
    title: line(v.title, VIDEO_LIMITS.title),
    shape: pick(v.shape, REEL_SHAPES, "orb"),
    beats,
    moments,
    ...(caption ? { caption } : {}),
    seed: seed !== undefined && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : 0,
    ...(worker || hyperframes ? { tools: { ...(worker ? { worker } : {}), ...(hyperframes ? { hyperframes } : {}) } } : {}),
    ...reservedVideo(v),
  };
}

/**
 * The plan of a reel version. From the Mac (`base` left out): taken as it is, code included.
 * From the page: the code never travels through the browser, so each scene takes the code of the scene with the same id
 * in `base` when the page still marks it `custom`. A whole custom scene whose text changed loses its code (the text is in it).
 * A video plan (`video`, worker 0.15.0) has no scenes: its `video` goes through cleanVideo. From the page, only a base
 * with a video makes a video plan (a page can never turn a reel of scenes into a video, nor bring code).
 */
export function cleanReel(raw: unknown, look: Look, base?: ReelPlan): ReelPlan | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (base ? !!base.video : r.video !== undefined) {
    const video = cleanVideo(r.video, base?.video);
    if (typeof video === "string") return video;
    return { ...planFields(r, look, base), scenes: [], video };
  }
  const seen = new Set<string>();
  const scenes: ReelScene[] = [];
  for (const x of (Array.isArray(r.scenes) ? (r.scenes as Record<string, unknown>[]) : []).slice(0, 16)) {
    const title = (str(x?.title, 120) ?? "").replace(/\r/g, "").trim();
    const body = (str(x?.body, 240) ?? "").replace(/\r/g, "").trim();
    if (!title && !body) continue;
    let id = (str(x?.id, 40) ?? "").replace(/[^\w-]/g, "");
    if (!id || seen.has(id)) id = `s-${crypto.randomUUID().slice(0, 8)}`;
    seen.add(id);
    const seconds = num(x?.seconds);
    const dur = num(x?.dur);
    const anim = (str(x?.anim, 300) ?? "").replace(/\s+/g, " ").trim();
    const fx = cleanFx(x?.fx);
    const old = base?.scenes.find((s) => s.id === id);
    const art = base ? (x?.custom === "art" && old?.art && old.title === title && old.body === body ? old.art : undefined) : cleanCode(x?.art);
    const layer = art ? undefined : base ? (x?.custom === "layer" ? old?.layer : undefined) : cleanCode(x?.layer);
    scenes.push({
      id,
      title,
      body,
      ...(anim ? { anim } : {}),
      ...(seconds !== undefined && seconds >= 1.5 ? { seconds: Math.round(Math.min(15, seconds) * 10) / 10 } : {}),
      ...(x?.cut === true ? { cut: true } : {}),
      ...(fx ? { fx } : {}),
      ...(art ? { art } : {}),
      ...(layer ? { layer } : {}),
      ...(!base && dur !== undefined && dur > 0 && dur < 60 ? { dur } : {}),
    });
  }
  if (!scenes.some((s) => !s.cut)) return "Garde au moins une scène";
  if (scenes.filter((s) => !s.cut).length > 8) return "8 scènes au plus";
  return { scenes, ...planFields(r, look, base) };
}

/** What a plan of scenes and a video plan share: look, logo, music, hand-placed texts, rhythm, rendered length. */
function planFields(r: Record<string, unknown>, look: Look, base?: ReelPlan): Omit<ReelPlan, "scenes" | "video"> {
  const volume = num(r.volume);
  const duration = num(r.duration);
  // Only compared with the names of the Mac's folder, never joined to a path: kept as it is.
  const track = str(r.track, 200)?.trim();
  const cue = cleanCue(r.cue);
  return {
    look,
    logo: r.logo !== false,
    music: r.music !== false,
    volume: volume === undefined ? (base?.volume ?? 0.7) : Math.min(1, Math.max(0, volume)),
    ...(track ? { track } : {}),
    ...(Object.keys(cue).length ? { cue } : {}),
    ...(Array.isArray(r.texts) && r.texts.length ? { texts: cleanTexts(r.texts) } : {}),
    pace: PACES.find((p) => p === r.pace) ?? base?.pace ?? "normal",
    ...(base?.direction ? { direction: base.direction } : str(r.direction, 1000)?.trim() ? { direction: str(r.direction, 1000)!.trim() } : {}),
    ...(!base && duration !== undefined && duration > 0 ? { duration } : {}),
  };
}

/** The plan as the page gets it: the code stays on the server, the page only learns that there is some. */
export function pageReel(plan: ReelPlan): ReelPlan {
  return {
    ...plan,
    scenes: plan.scenes.map(({ art, layer, ...s }) => ({ ...s, ...(art ? { custom: "art" as const } : layer ? { custom: "layer" as const } : {}) })),
    // A video: the moments without their code, `custom` says whether there is some.
    ...(plan.video ? { video: { ...plan.video, moments: (plan.video.moments ?? []).map(({ code, ...m }) => ({ ...m, custom: !!code })) } } : {}),
  };
}

/**
 * A job as the page gets it. For a reel: no code from Claude in the plans, and a link in place of each drawing.
 * The Mac gets the whole job when it takes it (worker/claim).
 */
export function pageJob(job: MontageJob): MontageJob {
  if (job.kind !== "motion") return job;
  return {
    ...job,
    ...(job.marks ? { marks: job.marks.map((m) => ({ ...m, image: m.image ? `/api/montage/jobs/${job.id}/marks/${m.id}` : undefined })) } : {}),
    versions: job.versions.map((v) => (v.reel ? { ...v, reel: pageReel(v.reel) } : v)),
  };
}

/** A reel whose last request failed goes back to its last good version: the versions edited by hand that never got a video are dropped. */
export function restoreReel(job: MontageJob) {
  while (job.versions.length > 1 && job.versions.at(-1)!.by === "edit" && !job.versions.at(-1)!.preview) job.versions.pop();
  job.marks = undefined;
  job.range = undefined;
  job.base = undefined;
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
