"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REEL_TARGETS, VIDEO_WORKER, type JobPhase, type MontageJob, type MontageVersion } from "@/lib/montage";
import { atLeast } from "@/lib/worker-version";
import type { WorkerStatus } from "./use-montage";

/* ---------- Following one job ---------- */

type Followed = {
  id: string | null;
  job?: MontageJob;
  worker?: WorkerStatus;
  /** Server clock minus this browser's clock (ms), measured on the last answer. */
  skew: number;
  /** The job no longer exists (deleted here or in another tab). */
  gone: boolean;
  /** The last read failed (the site did not answer, or answered an error): what is shown is the last good read. */
  error: string;
  /** When the last good read came back (this browser's clock, ms). */
  at?: number;
};

const LIVE = new Set(["queued", "working", "rendering"]);
/** A job the Mac still has to do something with. */
export const isLive = (j?: MontageJob) => !!j && (j.action !== null || LIVE.has(j.status));

/**
 * One job read from GET /api/montage/jobs/:id: every 2 s while the Mac has it (and the tab is visible), every 15 s
 * otherwise. The answer brings the Mac's presence and the server's clock, so remaining times do not trust this one.
 */
export function useReelJob(id: string | null) {
  const [state, setState] = useState<Followed>({ id, skew: 0, gone: false, error: "" });
  const live = useRef(state);
  live.current = state;
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`/api/montage/jobs/${encodeURIComponent(id)}`, { signal: ctrl.signal, cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 404) return setState((s) => (s.id === id ? { ...s, job: undefined, gone: true, error: "", at: Date.now() } : s));
      const data = (await res.json().catch(() => null)) as { job?: MontageJob; worker?: WorkerStatus; now?: number } | MontageJob | null;
      if (!res.ok || !data) throw new Error(`Erreur ${res.status}`);
      // An older server answers the job alone.
      const job = "job" in data && data.job ? data.job : (data as MontageJob);
      const extra = "job" in data ? data : {};
      setState((s) =>
        s.id === id
          ? {
              id,
              job,
              worker: (extra as { worker?: WorkerStatus }).worker ?? s.worker,
              skew: typeof (extra as { now?: number }).now === "number" ? (extra as { now: number }).now - Date.now() : s.skew,
              gone: false,
              error: "",
              at: Date.now(),
            }
          : s,
      );
    } catch (e) {
      if (ctrl.signal.aborted && inflight.current !== ctrl) return;
      setState((s) => (s.id === id ? { ...s, error: ctrl.signal.aborted ? "Le site ne répond pas" : (e as Error).message } : s));
    } finally {
      clearTimeout(timer);
      if (inflight.current === ctrl) inflight.current = null;
    }
  }, [id]);

  // A new job to follow starts from nothing.
  useEffect(() => {
    setState({ id, skew: live.current.skew, gone: false, error: "" });
  }, [id]);

  const active = useRef(false);
  active.current = isLive(state.job);
  const kick = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!id) return;
    // One loop only: one timer at a time, and no new read while one is on its way (its end sets the next timer).
    let stop = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };
    const tick = async () => {
      if (stop || reading) return;
      reading = true;
      try {
        await refresh();
      } finally {
        reading = false;
      }
      if (!stop) schedule(active.current && document.visibilityState === "visible" ? 2000 : 15_000);
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") schedule(0);
    };
    kick.current = () => schedule(2000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearTimeout(timer);
      kick.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      inflight.current?.abort();
    };
  }, [id, refresh]);
  // The job comes alive (a new generation, a retry): the next read comes in 2 s, not at the end of a slow wait.
  const nowLive = isLive(state.job);
  useEffect(() => {
    if (nowLive) kick.current?.();
  }, [nowLive]);

  const mine = state.id === id;
  return { job: mine ? state.job : undefined, worker: mine ? state.worker : undefined, skew: state.skew, gone: mine && state.gone, error: mine ? state.error : "", at: mine ? state.at : undefined, refresh };
}

/**
 * Server clock minus this browser's clock (ms), for a screen that does not follow the job with useReelJob: read from
 * GET /api/montage/jobs/:id while `on`, then once a minute.
 */
export function useServerSkew(id: string | null, on: boolean) {
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    if (!id || !on) return;
    let stop = false;
    let ctrl: AbortController | undefined;
    const read = async () => {
      ctrl?.abort();
      const mine = new AbortController();
      ctrl = mine;
      const timer = setTimeout(() => mine.abort(), 10_000);
      try {
        const sent = Date.now();
        const res = await fetch(`/api/montage/jobs/${encodeURIComponent(id)}`, { cache: "no-store", signal: mine.signal });
        const data = (await res.json().catch(() => null)) as { now?: unknown } | null;
        // The answer was written about halfway between the question and the answer.
        if (!stop && typeof data?.now === "number") setSkew(data.now - (sent + Date.now()) / 2);
      } catch {
        // No answer: the last skew stays.
      } finally {
        clearTimeout(timer);
      }
    };
    read();
    const every = setInterval(read, 60_000);
    return () => {
      stop = true;
      clearInterval(every);
      ctrl?.abort();
    };
  }, [id, on]);
  return skew;
}

/** The server's time (ms), redrawn once a second while `on`: countdowns and elapsed times move without new answers. */
export function useServerClock(skew: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    setNow(Date.now() + skew);
    if (!on) return;
    const t = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(t);
  }, [skew, on]);
  return now;
}

/* ---------- What the Studio shows ---------- */

/**
 * What was last asked of a video that already has one: a new video from the request (`regen`), a retouch by Claude
 * (`retouch`), or edits by hand rendered without Claude (`edit`).
 */
export type ReelAsk = "regen" | "retouch" | "edit";

export type ReelView =
  | { kind: "idle" }
  | { kind: "queued"; job: MontageJob }
  | { kind: "running"; job: MontageJob; silent: boolean }
  /** `failed`: the last request failed, the last good video stays; `ask`: what that request was, when it is known. */
  | { kind: "ready"; job: MontageJob; version: MontageVersion; failed?: string; ask?: ReelAsk }
  | { kind: "library"; job: MontageJob; mediaId: string }
  | { kind: "failed"; job: MontageJob };

/** The versions of a job that are video reels. */
export const videoVersions = (job: MontageJob) => job.versions.filter((v) => !!v.reel?.video);

/**
 * `ask`: what this browser saw asked last (askOf). The job itself only says it for a retouch with words: the server
 * keeps that text after a failure, and clears it for a regeneration or edits by hand.
 */
export function reelView(job: MontageJob | undefined, worker: WorkerStatus | undefined, ask?: ReelAsk): ReelView {
  if (!job || job.status === "cancelled") return { kind: "idle" };
  if (job.action !== null) {
    if (job.status === "queued") return { kind: "queued", job };
    return { kind: "running", job, silent: !!worker?.silent && worker.busy?.id === job.id };
  }
  if (job.status === "done" && job.mediaId) return { kind: "library", job, mediaId: job.mediaId };
  const version = videoVersions(job).findLast((v) => v.preview);
  if (version) return { kind: "ready", job, version, ...(job.error ? { failed: job.error, ask: job.feedback ? "retouch" : ask } : {}) };
  return { kind: "failed", job };
}

/** What a job the Mac has in hand was asked to do, read from the job; undefined for a first video. */
export function askOfJob(job: MontageJob): ReelAsk | undefined {
  if (job.action === null) return undefined;
  if (job.regen) return "regen";
  if (job.action === "preview") return "edit";
  if (job.action === "motion" && videoVersions(job).some((v) => v.preview)) return "retouch";
  return undefined;
}

const ASK_KEY = "metricove-reel-asks-v1";
function readAsks(): Record<string, ReelAsk> {
  try {
    const raw = JSON.parse(localStorage.getItem(ASK_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}
/** When this tab last asked something of a video: a list read just before the request must not forget it. */
const askedAt = new Map<string, number>();
/** Keeps in this browser what was last asked of a video (the 30 latest videos), for when that request fails. */
export function rememberAsk(id: string, ask: ReelAsk) {
  askedAt.set(id, Date.now());
  try {
    const all = readAsks();
    if (all[id] === ask) return;
    delete all[id];
    const next = Object.fromEntries([...Object.entries(all), [id, ask]].slice(-30));
    localStorage.setItem(ASK_KEY, JSON.stringify(next));
  } catch {}
}
/** The request went well: nothing to remember any more. */
export function forgetAsk(id: string) {
  if (Date.now() - (askedAt.get(id) ?? 0) < 15_000) return;
  try {
    const all = readAsks();
    if (!(id in all)) return;
    delete all[id];
    localStorage.setItem(ASK_KEY, JSON.stringify(all));
  } catch {}
}
/** What this browser saw asked last of the video, if it saw anything. */
export function askOf(id: string | undefined): ReelAsk | undefined {
  if (!id) return undefined;
  const a = readAsks()[id];
  return a === "regen" || a === "retouch" || a === "edit" ? a : undefined;
}

/* ---------- The Mac ---------- */

/** `silent`: the Mac holds a job but has sent no news for a while (asleep?), whatever the server still calls online. */
export type MacKind = "never" | "old" | "silent" | "offline" | "busy" | "mine" | "ready";
/** `quiet`: minutes since the Mac was last heard of (silent only); `mine`: a silent Mac holds the job followed here. */
export type MacState = { kind: MacKind; version?: string; seen?: string; busyTitle?: string; quiet?: number; mine?: boolean };

/** "à 14:02" today, "le 17.11" another day. */
export function seenText(iso?: string, now = Date.now()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date(now);
  const same = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  const two = (n: number) => String(n).padStart(2, "0");
  return same ? `à ${two(d.getHours())}:${two(d.getMinutes())}` : `le ${two(d.getDate())}.${two(d.getMonth() + 1)}`;
}

/** Whole minutes since the Mac was last heard of (1 at least), as the rail and the pill both say it. */
export function quietMinutes(worker: WorkerStatus | undefined, now = Date.now()) {
  const seen = worker?.lastSeen ? Date.parse(worker.lastSeen) : NaN;
  return Number.isFinite(seen) ? Math.max(1, Math.round((now - seen) / 60_000)) : 1;
}

/** What the Mac can do for a video right now. `mine`: it works on the job followed here. */
export function macState(worker: WorkerStatus | undefined, followed?: string | null, now = Date.now()): MacState {
  if (!worker?.lastSeen) return { kind: "never" };
  const base = { version: worker.version, seen: seenText(worker.lastSeen, now) };
  // A Mac without a known version never gets a video (the server's claim needs VIDEO_WORKER or newer).
  if (!atLeast(worker.version, VIDEO_WORKER)) return { kind: "old", ...base };
  // Busy and quiet for a while: the server still says online for a moment (up to 90 s), the rail already says silent.
  if (worker.busy && worker.silent) return { kind: "silent", ...base, quiet: quietMinutes(worker, now), mine: worker.busy.id === followed };
  if (!worker.online) return { kind: "offline", ...base };
  if (worker.busy) return worker.busy.id === followed ? { kind: "mine", ...base } : { kind: "busy", ...base, busyTitle: worker.busy.title.replace(/^Reel animé : /, "") };
  return { kind: "ready", ...base };
}

/* ---------- Times ---------- */

/** "encore environ 2 min 30": the remaining time, rounded the calm way (never a number that ticks every second). */
export function etaText(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "un peu plus long que prévu";
  if (seconds < 15) return "presque fini";
  if (seconds < 60) return "encore moins d'une minute";
  if (seconds < 90) return "encore environ 1 min";
  const half = Math.round(seconds / 30) * 30;
  const m = Math.floor(half / 60);
  return `encore environ ${m} min${half % 60 ? " 30" : ""}`;
}

/** "1 min 20", "45 s": an elapsed time. */
export function durationText(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${String(r).padStart(2, "0")}` : `${m} min`;
}

/** Seconds a whole video should take on this Mac, from what it learned (or the defaults of the design). */
export function videoEstimate(worker: WorkerStatus | undefined, target?: number) {
  const seconds = REEL_TARGETS.find((t) => t === target) ?? 30;
  const frameMs = worker?.speed?.frameMs ?? 150;
  const write = worker?.speed?.writeS ?? 110;
  // write + check (with the storyboard) + review + render + music and upload.
  return write + 40 + 60 + (seconds * 30 * frameMs) / 1000 + 13;
}

/**
 * Seconds a new preview of edits made by hand should take on this Mac (no Claude): check, render of `seconds` of
 * video at 30 images a second, music and upload, from what the Mac learned (or the defaults of the design).
 */
export function previewEstimate(worker: WorkerStatus | undefined, seconds: number) {
  const frameMs = worker?.speed?.frameMs ?? 150;
  return 40 + (Math.max(0, seconds) * 30 * frameMs) / 1000 + 13;
}

/** "environ 5 min": a duration announced before anything runs. */
export function aboutText(seconds: number) {
  if (seconds < 90) return "environ 1 min";
  return `environ ${Math.round(seconds / 60)} min`;
}

/* ---------- Phases ---------- */

/** The lines of the phase track: finish and upload make one line (they last seconds). */
export const PHASE_LINES: { key: string; phases: JobPhase[]; label: string; title: string }[] = [
  { key: "write", phases: ["write"], label: "Claude écrit la vidéo", title: "Claude écrit la vidéo" },
  { key: "check", phases: ["check"], label: "Vérification dans Chrome", title: "Vérification dans Chrome" },
  { key: "review", phases: ["review"], label: "Claude relit les images", title: "Claude relit les images" },
  { key: "render", phases: ["render"], label: "Rendu", title: "Rendu de la vidéo" },
  { key: "finish", phases: ["finish", "upload"], label: "Musique et envoi", title: "Musique et envoi" },
];

/**
 * The bar between two reports of the Mac: it goes on at the pace the Mac announced (what is left over the time it
 * said is left), at most 3 points ahead of its last report and never past 99 %. The caller keeps it from going back.
 */
export function liveProgress(job: MontageJob, now: number) {
  const p = Math.min(1, Math.max(0, job.progress ?? 0));
  const run = job.run;
  const at = run?.beatAt ? Date.parse(run.beatAt) : NaN;
  const eta = run?.etaAt ? Date.parse(run.etaAt) : NaN;
  if (!run?.phase || !Number.isFinite(at) || !Number.isFinite(eta) || eta <= at) return p;
  const rate = (1 - p) / ((eta - at) / 1000);
  const lead = Math.min(0.03, rate * Math.max(0, (now - at) / 1000));
  return Math.min(0.99, Math.max(p, p + lead));
}

/** The beats Claude wrote, with their rendered length: known after the write phase. */
export const runBeats = (job: MontageJob) => job.run?.beats ?? [];

/** Where the render is in the video (seconds), from the frames the Mac reported. */
export function renderHead(job: MontageJob) {
  const beats = runBeats(job);
  const f = job.run?.frames;
  if (!f || !f[1] || !beats.length) return undefined;
  const total = beats.at(-1)!.end;
  return Math.min(total, (f[0] / f[1]) * total);
}
