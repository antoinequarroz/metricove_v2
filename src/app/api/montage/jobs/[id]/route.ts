import { NextResponse } from "next/server";
import { isVideoJob, MAX_ASSET_COUNT, MAX_RULES, MAX_SENT_NOTES, REEL_TARGETS, REEL_VIDEO } from "@/lib/montage";
import { findAsset } from "@/server/library";
import { listProjects } from "@/server/db";
import { createStyle, saveProfile } from "@/server/profiles";
import { markSent, notesAsMarks } from "@/server/review-notes";
import { ingestVideo } from "@/server/media";
import { cleanEdl, cleanMarks, cleanReel, deleteJob, dropPreviews, EMPTY_EDL, getJob, addVersion, pageJob, previewPath, queue, release, reportRun, restoreReel, saveJob, staleWrite, touchJob, touchWorker, workerStatus } from "@/server/montage";
import fs from "node:fs";
import { cleanCharteResult, cleanPlanResult, cleanStrategyResult } from "@/lib/strategy";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  // The Mac only asks whether the job still exists (and whether it is still its own: `run`, `action`): nobody needs
  // Claude's code or the drawings from here. The Studio follows one job with it: the Mac's presence and the server's
  // clock come along.
  return NextResponse.json({ job: pageJob(job), worker: workerStatus(), now: Date.now() });
}

type Body = {
  // From the page
  revise?: string;
  marks?: unknown;
  /** Face-cam edit: ids of the review notes sent with the request (kept on the server, see review-notes.ts). */
  notes?: unknown;
  edl?: unknown;
  /** Face-cam edit: Claude proposes B-roll for this passage only, { range: [from, to], note? } (sent with the edl on screen). */
  brollAsk?: { range?: unknown; note?: unknown };
  /** Animated reel: the passage (seconds) a request is about, the version a request or an edit starts from, the edited plan. */
  range?: unknown;
  from?: unknown;
  reel?: unknown;
  approve?: number;
  cancel?: boolean;
  /** Animated reel: take back a request the Mac has not started. */
  withdraw?: boolean;
  /** Video reel: a new video from the request (version n+1), optionally with a new request or length. */
  regenerate?: boolean;
  request?: unknown;
  seconds?: unknown;
  /** Video reel: stop the generation running on the Mac, back to the last good version. */
  stop?: boolean;
  title?: string;
  // From the worker
  step?: string;
  progress?: number;
  /** Video reel (worker 0.15.0): where the Mac is. */
  phase?: unknown;
  phases?: unknown;
  eta?: unknown;
  frames?: unknown;
  beats?: unknown;
  done?: unknown;
  /** Worker ≥ 0.15.0 (optional): the `run.startedAt` of its claim. A write from a run that is over gets 409 (staleWrite). */
  run?: unknown;
  status?: "failed" | "done";
  error?: string;
  script?: string;
  caption?: string;
  youtubeTitle?: string;
  post?: { caption?: unknown; slides?: unknown };
  brand?: unknown;
  plan?: unknown;
  asset?: { result?: unknown };
  /** kind "style": { rules } or, for a copy, { summary, notes, accent? }. */
  style?: { rules?: unknown; summary?: unknown; notes?: unknown; accent?: unknown };
};

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  // The body first, the job after: from here on everything is synchronous (SQLite, files), so a stop, a cancel or a
  // DELETE that arrived while the body was coming in is seen, and a deleted job is never saved back by a late write.
  const raw: unknown = await req.json().catch(() => null);
  const b = (raw && typeof raw === "object" ? raw : {}) as Body;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  const busy = job.action !== null;

  // ---- Page ----
  if (b.cancel) {
    job.action = null;
    // A regeneration asked for and then cancelled is over: a later request to Claude retouches the last version.
    job.regen = undefined;
    return NextResponse.json({ job: pageJob(release(job, "cancelled")) });
  }
  if (b.withdraw) {
    // The Mac is off or busy and the request waits: take it back, the reel returns to its last version with a video.
    if (job.kind !== "motion" || !job.versions.some((v) => v.reel && v.preview)) return NextResponse.json({ error: "Rien à reprendre sur ce montage" }, { status: 400 });
    if (!busy) return NextResponse.json({ job: pageJob(job) });
    if (job.status !== "queued") return NextResponse.json({ error: "Le Mac a déjà commencé : attends la fin" }, { status: 409 });
    restoreReel(job);
    job.feedback = undefined;
    job.regen = undefined;
    return NextResponse.json({ job: pageJob(release(job, "review")) });
  }
  if (b.stop === true) {
    // A generation (regeneration, retouch, edit) on a video reel that already has videos: the Mac sees the action gone,
    // stops within seconds and sends nothing. A first generation has nothing to go back to: it is cancelled (DELETE).
    // Only a video job: the worker of a reel of scenes only stops when the job is deleted, it keeps withdraw and cancel.
    // The Mac may have finished between the click (after a confirm) and this request: nothing to stop, the video is there.
    if (isVideoJob(job) && !busy) return NextResponse.json({ job: pageJob(job) });
    if (!isVideoJob(job) || !job.versions.some((v) => v.reel && v.preview)) return NextResponse.json({ error: "Rien à rétablir : annule plutôt" }, { status: 400 });
    restoreReel(job);
    job.regen = undefined;
    return NextResponse.json({ job: pageJob(release(job, "review")) });
  }
  if (b.regenerate === true) {
    // A whole new video from the request (Claude is asked for a clearly different idea); the versions stay.
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce reel" }, { status: 409 });
    if (!isVideoJob(job) || !job.motion) return NextResponse.json({ error: "Seulement pour un reel vidéo" }, { status: 400 });
    if (b.request !== undefined) {
      const request = typeof b.request === "string" ? b.request.replace(/\r\n?/g, "\n").trim().slice(0, REEL_VIDEO.request) : "";
      if (request.length < REEL_VIDEO.minRequest) return NextResponse.json({ error: `Écris ta demande (${REEL_VIDEO.minRequest} caractères au moins)` }, { status: 400 });
      job.motion.request = request;
    }
    if (b.seconds !== undefined) {
      // A length among REEL_TARGETS, anything else (null, 0, "auto") = Auto.
      const seconds = REEL_TARGETS.find((t) => t === Number(b.seconds));
      job.motion.seconds = seconds;
      job.brief = { ...job.brief, seconds };
    }
    job.regen = true;
    job.feedback = job.marks = job.range = job.base = undefined;
    return NextResponse.json({ job: pageJob(queue(job, "motion")) });
  }
  if (typeof b.title === "string" && b.title.trim()) {
    job.title = b.title.trim().slice(0, 120);
    saveJob(job);
  }
  if (typeof b.revise === "string") {
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce montage" }, { status: 409 });
    const noteIds = Array.isArray(b.notes) ? (b.notes as unknown[]).filter((x): x is string => typeof x === "string").slice(0, MAX_SENT_NOTES) : [];
    const marks = job.kind === "montage" && noteIds.length ? notesAsMarks(job.id, noteIds) : cleanMarks(b.marks);
    if (typeof marks === "string") return NextResponse.json({ error: marks }, { status: 400 });
    job.feedback = b.revise.trim().slice(0, 2000) || undefined;
    job.marks = marks.length ? marks : undefined;
    if (job.kind === "motion") {
      // A reel: Claude changes the passage picked on the timeline, starting from the version on screen.
      const base = job.versions.find((v) => v.n === b.from && v.reel) ?? job.versions.findLast((v) => v.reel);
      if (base && !job.feedback && !job.marks) return NextResponse.json({ error: "Écris ta demande ou dessine une note" }, { status: 400 });
      const [a, z] = Array.isArray(b.range) ? (b.range as unknown[]).map(Number) : [];
      job.range = Number.isFinite(a) && Number.isFinite(z) && z - a >= 0.1 && a >= 0 ? [Math.round(a * 100) / 100, Math.round(z * 100) / 100] : undefined;
      job.base = base?.n;
      // A retouch is never a regeneration (a regeneration left over from a withdraw or a failure must not come back).
      job.regen = undefined;
      return NextResponse.json({ job: pageJob(queue(job, "motion")) });
    }
    // A note left empty is not a request: Claude would start again from nothing.
    if (job.versions.length && !job.feedback && !job.marks && typeof b.revise === "string" && ((Array.isArray(b.marks) && b.marks.length) || noteIds.length)) return NextResponse.json({ error: "Écris ta demande ou une note" }, { status: 400 });
    const queued = queue(job, "propose");
    // The notes sent stay open: they say which version they were sent for, Antoine marks them resolved when it is right.
    if (job.marks?.length && noteIds.length) markSent(job.id, job.marks.map((m) => m.id), (job.versions.at(-1)?.n ?? 0) + 1);
    return NextResponse.json({ job: queued });
  }
  if (b.brollAsk !== undefined) {
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce montage" }, { status: 409 });
    if (job.kind !== "montage") return NextResponse.json({ error: "Seulement pour une vidéo face caméra" }, { status: 400 });
    const [a, z] = Array.isArray(b.brollAsk?.range) ? (b.brollAsk?.range as unknown[]).map(Number) : [];
    if (!Number.isFinite(a) || !Number.isFinite(z) || a < 0 || z - a < 0.8 || z - a > 120) return NextResponse.json({ error: "Choisis un passage de 1 s à 2 min" }, { status: 400 });
    // The edit on screen becomes the version Claude adds B-roll to (unsaved changes included).
    const edl = b.edl !== undefined ? cleanEdl(b.edl, job.rushIds) : job.versions.at(-1)?.edl;
    if (typeof edl === "string") return NextResponse.json({ error: edl }, { status: 400 });
    if (!edl) return NextResponse.json({ error: "Pas encore de montage" }, { status: 400 });
    addVersion(job, structuredClone(edl), "edit");
    const note = typeof b.brollAsk?.note === "string" ? b.brollAsk?.note.trim().slice(0, 500) : "";
    job.brollAsk = { range: [Math.round(a * 100) / 100, Math.round(z * 100) / 100], ...(note ? { note } : {}) };
    return NextResponse.json({ job: queue(job, "broll") });
  }
  if (b.edl !== undefined) {
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce montage" }, { status: 409 });
    const edl = cleanEdl(b.edl, job.rushIds);
    if (typeof edl === "string") return NextResponse.json({ error: edl }, { status: 400 });
    addVersion(job, edl, "edit");
    return NextResponse.json({ job: queue(job, "preview") });
  }
  if (b.reel !== undefined) {
    // A reel edited by hand (texts, lengths, scenes cut or moved, music): the Mac renders it as it is, without Claude.
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce reel" }, { status: 409 });
    const base = job.versions.find((v) => v.n === b.from && v.reel) ?? job.versions.findLast((v) => v.reel);
    if (job.kind !== "motion" || !base?.reel) return NextResponse.json({ error: "Ce montage n'est pas un reel animé" }, { status: 400 });
    const reel = cleanReel(b.reel, base.reel.look, base.reel);
    if (typeof reel === "string") return NextResponse.json({ error: reel }, { status: 400 });
    addVersion(job, EMPTY_EDL, "edit", undefined, reel);
    // An earlier request to Claude is over: it must not come back with a later retry.
    job.feedback = job.marks = job.range = job.base = undefined;
    return NextResponse.json({ job: pageJob(queue(job, "preview")) });
  }
  if (b.approve !== undefined) {
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce montage" }, { status: 409 });
    if (!job.versions.some((v) => v.n === b.approve)) return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
    if (job.kind === "motion") {
      // A reel is rendered in full quality each time: the version on screen is the final video, it goes to the library now.
      const file = previewPath(job.id, b.approve);
      if (!fs.existsSync(file)) return NextResponse.json({ error: "Cette version n'a pas encore de vidéo" }, { status: 409 });
      const { media } = ingestVideo(file, "reel.mp4", { title: job.title, source: "claude-code" });
      job.approved = b.approve;
      job.mediaId = media.id;
      dropPreviews(job.id);
      job.versions.forEach((v) => (v.preview = false));
      job.error = job.feedback = job.marks = job.range = job.base = undefined;
      return NextResponse.json({ job: pageJob(release(job, "done")), media });
    }
    job.approved = b.approve;
    return NextResponse.json({ job: queue(job, "final") });
  }

  // ---- Worker ----
  const fromWorker = b.status !== undefined || b.step !== undefined || b.progress !== undefined || b.phase !== undefined;
  // The tail of a run that is over (stopped, cancelled, taken back, or a new request queued after a stop): stored
  // nowhere, so that it neither cancels the next request nor brings an old run back on screen.
  const stale = fromWorker ? staleWrite(job, b.run) : undefined;
  if (stale) return NextResponse.json({ error: stale }, { status: 409 });
  if (b.status === "failed") {
    job.error = (b.error ?? "Erreur inconnue sur le Mac").slice(0, 2000);
    // A regeneration that failed is over: the next request to Claude retouches the last good version again.
    job.regen = undefined;
    if (job.kind === "motion" && job.versions.some((v) => v.reel && v.preview)) {
      // A retouch that failed must not lock a reel that already has good versions: it stays open, with the error
      // on show and the text of the request kept so that it can be reworded.
      restoreReel(job);
      return NextResponse.json({ job: pageJob(release(job, "review")) });
    }
    return NextResponse.json({ job: pageJob(release(job, "failed")) });
  }
  if (b.status === "done" && job.kind === "script") {
    job.script = (b.script ?? "").slice(0, 10_000);
    return NextResponse.json({ job: pageJob(release(job, "done")) });
  }
  if (b.status === "done" && job.kind === "cover") {
    // The image itself was sent to /api/media/:id/cover just before.
    return NextResponse.json({ job: pageJob(release(job, "done")) });
  }
  if (b.status === "done" && job.kind === "caption" && job.caption) {
    const text = (b.caption ?? "").trim().slice(0, 5000);
    if (!text) return NextResponse.json({ error: "Description vide" }, { status: 400 });
    job.caption.result = { caption: text, youtubeTitle: b.youtubeTitle?.trim().slice(0, 100) || undefined };
    return NextResponse.json({ job: pageJob(release(job, "done")) });
  }
  if (b.status === "done" && job.kind === "post" && job.post) {
    const caption = typeof b.post?.caption === "string" ? b.post.caption.trim().slice(0, 5000) : "";
    const slides = (Array.isArray(b.post?.slides) ? (b.post.slides as Record<string, unknown>[]) : [])
      .slice(0, 10)
      .map((s) => ({ title: typeof s?.title === "string" ? s.title.trim().slice(0, 200) : "", body: typeof s?.body === "string" ? s.body.trim().slice(0, 600) : "" }))
      .filter((s) => s.title || s.body);
    if (!slides.length) return NextResponse.json({ error: "Post vide" }, { status: 400 });
    job.post.result = { caption, slides };
    return NextResponse.json({ job: pageJob(release(job, "done")) });
  }
  if (b.status === "done" && job.kind === "brand" && job.brand) {
    const result = job.brand.mode === "charte" ? cleanCharteResult(b.brand) : cleanStrategyResult(b.brand);
    if (typeof result === "string") return NextResponse.json({ error: result }, { status: 400 });
    job.brand.result = result;
    return NextResponse.json({ job: pageJob(release(job, "done")) });
  }
  if (b.status === "done" && job.kind === "asset" && job.asset) {
    // The files were sent to /api/library just before; only the ids of items that exist are kept.
    const ids = (Array.isArray(b.asset?.result) ? b.asset.result : []).filter((id): id is string => typeof id === "string" && !!findAsset(id)).slice(0, MAX_ASSET_COUNT * 2);
    if (!ids.length) return NextResponse.json({ error: "Rien n'a été ajouté à la bibliothèque" }, { status: 400 });
    job.asset.result = ids;
    return NextResponse.json({ job: pageJob(release(job, "done")) });
  }
  if (b.status === "done" && job.kind === "style" && job.styleTask) {
    const t = job.styleTask;
    const line = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").replace(/^[-•*]\s*/, "").trim().slice(0, n) : "");
    if (t.mode === "rules") {
      const rules = [...new Set((Array.isArray(b.style?.rules) ? b.style.rules : []).map((x) => line(x, 240)).filter(Boolean))].slice(0, MAX_RULES);
      if (!rules.length) return NextResponse.json({ error: "Aucune règle proposée" }, { status: 400 });
      t.result = { rules };
      return NextResponse.json({ job: pageJob(release(job, "done")) });
    }
    // A copy: the new style is made now, from the style it starts from, with Claude's notes (and accent color).
    const project = listProjects().find((p) => p.id === job.projectId);
    if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 400 });
    const notes = typeof b.style?.notes === "string" ? b.style.notes.replace(/\r\n?/g, "\n").trim().slice(0, 4000) : "";
    if (!notes) return NextResponse.json({ error: "Claude n'a pas écrit de notes" }, { status: 400 });
    const made = createStyle(project, t.name || "Style copié", t.styleId);
    if (typeof made === "string") return NextResponse.json({ error: made }, { status: 400 });
    const accent = typeof b.style?.accent === "string" && /^#[0-9a-f]{6}$/i.test(b.style.accent) ? b.style.accent.toLowerCase() : undefined;
    const saved = saveProfile(project, { notes, ...(accent ? { look: { ...made.look, accent } } : {}) }, made.id);
    if (typeof saved === "string") saveProfile(project, { notes }, made.id);
    t.result = { styleId: made.id, notes, summary: line(b.style?.summary, 1200) || undefined, ...(accent ? { accent } : {}) };
    return NextResponse.json({ job: pageJob(release(job, "done")) });
  }
  if (b.status === "done" && job.kind === "plan" && job.plan) {
    const result = cleanPlanResult(b.plan, job.plan);
    if (typeof result === "string") return NextResponse.json({ error: result }, { status: 400 });
    job.plan.result = result;
    return NextResponse.json({ job: pageJob(release(job, "done")) });
  }
  if (b.step !== undefined || b.progress !== undefined || b.phase !== undefined) {
    // Only while the job is the Mac's: a report on a job nobody holds (finished, cancelled, or waiting in the queue
    // again) is the tail of a run that is over. Ignored (an older worker does not read the answer): no step on show,
    // no `run` brought back, and the Mac is not marked busy with a job it does not hold.
    if (!job.action || job.status === "queued") return NextResponse.json({ job: pageJob(job) });
    if (typeof b.step === "string") job.step = b.step.slice(0, 200);
    if (typeof b.progress === "number" && Number.isFinite(b.progress)) job.progress = Math.min(1, Math.max(0, b.progress));
    // The live state of the run (phase, eta, frames, markers…).
    reportRun(job, b as Record<string, unknown>);
    saveJob(job);
    touchJob(job.id);
    // A busy Mac sends no claim: its reports say it is there (any worker version).
    touchWorker(job.id);
  }
  return NextResponse.json({ job: pageJob(job) });
}

/** Deletes a job and its previews. The final video stays in the library. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getJob(id)) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  deleteJob(id);
  return NextResponse.json({ ok: true });
}
