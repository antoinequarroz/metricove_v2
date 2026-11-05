import { NextResponse } from "next/server";
import { cleanEdl, deleteJob, getJob, addVersion, queue, release, saveJob, touchJob } from "@/server/montage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  return NextResponse.json({ job });
}

type Body = {
  // From the page
  revise?: string;
  edl?: unknown;
  approve?: number;
  cancel?: boolean;
  title?: string;
  // From the worker
  step?: string;
  progress?: number;
  status?: "failed" | "done";
  error?: string;
  script?: string;
  caption?: string;
  youtubeTitle?: string;
};

export async function PATCH(req: Request, { params }: Ctx) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const busy = job.action !== null;

  // ---- Page ----
  if (b.cancel) {
    job.action = null;
    return NextResponse.json({ job: release(job, "cancelled") });
  }
  if (typeof b.title === "string" && b.title.trim()) {
    job.title = b.title.trim().slice(0, 120);
    saveJob(job);
  }
  if (typeof b.revise === "string") {
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce montage" }, { status: 409 });
    job.feedback = b.revise.trim().slice(0, 2000) || undefined;
    return NextResponse.json({ job: queue(job, "propose") });
  }
  if (b.edl !== undefined) {
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce montage" }, { status: 409 });
    const edl = cleanEdl(b.edl, job.rushIds);
    if (typeof edl === "string") return NextResponse.json({ error: edl }, { status: 400 });
    addVersion(job, edl, "edit");
    return NextResponse.json({ job: queue(job, "preview") });
  }
  if (b.approve !== undefined) {
    if (busy) return NextResponse.json({ error: "Le Mac travaille déjà sur ce montage" }, { status: 409 });
    if (!job.versions.some((v) => v.n === b.approve)) return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
    job.approved = b.approve;
    return NextResponse.json({ job: queue(job, "final") });
  }

  // ---- Worker ----
  if (b.status === "failed") {
    job.error = (b.error ?? "Erreur inconnue sur le Mac").slice(0, 2000);
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
  if (b.step !== undefined || b.progress !== undefined) {
    if (typeof b.step === "string") job.step = b.step.slice(0, 200);
    if (typeof b.progress === "number" && Number.isFinite(b.progress)) job.progress = Math.min(1, Math.max(0, b.progress));
    saveJob(job);
    touchJob(job.id);
  }
  return NextResponse.json({ job });
}

/** Deletes a job and its previews. The final video stays in the library. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getJob(id)) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  deleteJob(id);
  return NextResponse.json({ ok: true });
}
