import { NextResponse } from "next/server";
import { ingestVideo } from "@/server/media";
import { cleanEdl, cleanMarks, cleanReel, deleteJob, dropPreviews, EMPTY_EDL, getJob, addVersion, pageJob, previewPath, queue, release, restoreReel, saveJob, touchJob } from "@/server/montage";
import fs from "node:fs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  // The Mac only asks whether the job still exists: nobody needs Claude's code or the drawings from here.
  return NextResponse.json({ job: pageJob(job) });
}

type Body = {
  // From the page
  revise?: string;
  marks?: unknown;
  edl?: unknown;
  /** Animated reel: the passage (seconds) a request is about, the version a request or an edit starts from, the edited plan. */
  range?: unknown;
  from?: unknown;
  reel?: unknown;
  approve?: number;
  cancel?: boolean;
  /** Animated reel: take back a request the Mac has not started. */
  withdraw?: boolean;
  title?: string;
  // From the worker
  step?: string;
  progress?: number;
  status?: "failed" | "done";
  error?: string;
  script?: string;
  caption?: string;
  youtubeTitle?: string;
  post?: { caption?: unknown; slides?: unknown };
};

export async function PATCH(req: Request, { params }: Ctx) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const busy = job.action !== null;

  // ---- Page ----
  if (b.cancel) {
    job.action = null;
    return NextResponse.json({ job: pageJob(release(job, "cancelled")) });
  }
  if (b.withdraw) {
    // The Mac is off or busy and the request waits: take it back, the reel returns to its last version with a video.
    if (job.kind !== "motion" || !job.versions.some((v) => v.reel && v.preview)) return NextResponse.json({ error: "Rien à reprendre sur ce montage" }, { status: 400 });
    if (!busy) return NextResponse.json({ job: pageJob(job) });
    if (job.status !== "queued") return NextResponse.json({ error: "Le Mac a déjà commencé : attends la fin" }, { status: 409 });
    restoreReel(job);
    job.feedback = undefined;
    return NextResponse.json({ job: pageJob(release(job, "review")) });
  }
  if (typeof b.title === "string" && b.title.trim()) {
    job.title = b.title.trim().slice(0, 120);
    saveJob(job);
  }
  if (typeof b.revise === "string") {
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce montage" }, { status: 409 });
    const marks = cleanMarks(b.marks);
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
      return NextResponse.json({ job: pageJob(queue(job, "motion")) });
    }
    return NextResponse.json({ job: queue(job, "propose") });
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
  if (b.status === "failed") {
    job.error = (b.error ?? "Erreur inconnue sur le Mac").slice(0, 2000);
    if (job.kind === "motion" && job.versions.some((v) => v.reel && v.preview)) {
      // A retouch that failed must not lock a reel that already has good versions: it stays open, with the error
      // on show and the text of the request kept so that it can be reworded.
      restoreReel(job);
      return NextResponse.json({ job: release(job, "review") });
    }
    return NextResponse.json({ job: release(job, "failed") });
  }
  if (b.status === "done" && job.kind === "script") {
    job.script = (b.script ?? "").slice(0, 10_000);
    return NextResponse.json({ job: release(job, "done") });
  }
  if (b.status === "done" && job.kind === "cover") {
    // The image itself was sent to /api/media/:id/cover just before.
    return NextResponse.json({ job: release(job, "done") });
  }
  if (b.status === "done" && job.kind === "caption" && job.caption) {
    const text = (b.caption ?? "").trim().slice(0, 5000);
    if (!text) return NextResponse.json({ error: "Description vide" }, { status: 400 });
    job.caption.result = { caption: text, youtubeTitle: b.youtubeTitle?.trim().slice(0, 100) || undefined };
    return NextResponse.json({ job: release(job, "done") });
  }
  if (b.status === "done" && job.kind === "post" && job.post) {
    const caption = typeof b.post?.caption === "string" ? b.post.caption.trim().slice(0, 5000) : "";
    const slides = (Array.isArray(b.post?.slides) ? (b.post.slides as Record<string, unknown>[]) : [])
      .slice(0, 10)
      .map((s) => ({ title: typeof s?.title === "string" ? s.title.trim().slice(0, 200) : "", body: typeof s?.body === "string" ? s.body.trim().slice(0, 600) : "" }))
      .filter((s) => s.title || s.body);
    if (!slides.length) return NextResponse.json({ error: "Post vide" }, { status: 400 });
    job.post.result = { caption, slides };
    return NextResponse.json({ job: release(job, "done") });
  }
  if (b.step !== undefined || b.progress !== undefined) {
    if (typeof b.step === "string") job.step = b.step.slice(0, 200);
    if (typeof b.progress === "number" && Number.isFinite(b.progress)) job.progress = Math.min(1, Math.max(0, b.progress));
    saveJob(job);
    touchJob(job.id);
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
