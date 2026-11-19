import fs from "node:fs";
import { NextResponse } from "next/server";
import { isVideoJob } from "@/lib/montage";
import { cleanLook } from "@/lib/profiles";
import { addVersion, cleanEdl, cleanReel, dropUpload, EMPTY_EDL, getJob, moveInto, pageJob, previewPath, release, staleWrite, takeUpload, UploadError } from "@/server/montage";

/**
 * The worker sends a proposal: { edl, notes?, upload? (preview video) }, or for an animated reel { reel, notes?, upload }.
 * A video reel also sends `run` (worker ≥ 0.14.0, optional): the `run.startedAt` of its claim.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The body first, the job after: from here on everything is synchronous (SQLite, files), so a stop, a cancel or a
  // DELETE that arrived while the body was coming in is seen, and a deleted job is never saved back.
  const b = ((await req.json().catch(() => null)) ?? {}) as { edl?: unknown; reel?: unknown; notes?: string; upload?: string; run?: unknown };
  const job = getJob(id);
  if (!job) {
    dropUpload(b.upload);
    return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  }
  // A video from a run that is over (stopped, cancelled, or a new request queued after a stop): it would cancel the
  // request that follows and bring back a video nobody wants. Nothing is stored, its upload is dropped.
  const stale = staleWrite(job, b.run, isVideoJob(job) || !!(b.reel as { video?: unknown } | null | undefined)?.video);
  if (stale) {
    dropUpload(b.upload);
    return NextResponse.json({ error: stale }, { status: 409 });
  }
  // A version refused (unknown engine, code too long, bad EDL…): its video is dropped now, not kept 24 h in the uploads.
  // An older worker that falls back on /final sends its file again first (jobs.mjs).
  const refuse = (error: string) => {
    dropUpload(b.upload);
    return NextResponse.json({ error }, { status: 400 });
  };
  // An animated reel: the version is the plan the Mac rendered (texts, lengths, animations, Claude's code).
  let reel;
  if (job.kind === "motion") {
    if (!job.motion) return refuse("Reel sans demande");
    const look = cleanLook((b.reel as { look?: unknown } | undefined)?.look, job.motion.look);
    if (typeof look === "string") return refuse(look);
    const { logo: _logo, ...stored } = look;
    void _logo;
    reel = cleanReel(b.reel, stored);
    if (typeof reel === "string") return refuse(reel);
  }
  const edl = reel ? EMPTY_EDL : cleanEdl(b.edl, job.rushIds);
  if (typeof edl === "string") return refuse(edl);
  // Texts put by hand stay from one version to the next: a Mac older than 0.11.0 sends none back (no `texts` key).
  const from = job.versions.find((v) => v.n === job.base) ?? job.versions.at(-1);
  if (reel && !("texts" in ((b.reel as object) ?? {})) && from?.reel?.texts?.length) reel.texts = from.reel.texts;
  if (!reel && !("texts" in ((b.edl as object) ?? {})) && from?.edl.texts?.length) edl.texts = from.edl.texts;
  try {
    const v = addVersion(job, edl, "claude", typeof b.notes === "string" ? b.notes : undefined, reel);
    if (b.upload) {
      const up = takeUpload(b.upload);
      moveInto(up.file, previewPath(job.id, v.n));
      v.preview = fs.existsSync(previewPath(job.id, v.n));
    }
    job.feedback = undefined;
    if (reel) {
      job.marks = undefined;
      job.range = undefined;
      job.base = undefined;
      // A regeneration is done: the next request to Claude retouches this version.
      job.regen = undefined;
      // The first video gives the job the title Claude wrote for it (later ones keep the title, renamed by hand or not).
      if (reel.video?.title && !job.versions.some((x) => x.n !== v.n && x.reel?.video)) job.title = `Reel animé : ${reel.video.title}`.slice(0, 120);
    }
    // The answer goes to the Mac, which does not read it: like every answer, it carries no code (pageJob).
    return NextResponse.json({ job: pageJob(release(job, "review")), version: v.n }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
