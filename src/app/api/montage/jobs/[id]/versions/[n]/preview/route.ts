import { NextResponse } from "next/server";
import { isVideoJob } from "@/lib/montage";
import { cleanBroll, cleanReel, dropUpload, getJob, moveInto, previewPath, release, staleWrite, takeUpload, UploadError } from "@/server/montage";
import { streamFile } from "@/server/stream";

type Ctx = { params: Promise<{ id: string; n: string }> };

/** Plays the preview of one version. */
export async function GET(req: Request, { params }: Ctx) {
  const { id, n } = await params;
  return streamFile(req, getJob(id) ? previewPath(id, Number(n)) : undefined, "private, no-store");
}

/**
 * The worker sends the preview of a version edited by hand: { upload, broll? } (B-roll shots it found), or for a reel
 * { upload, reel, notes? }. A video reel also sends `run` (worker ≥ 0.14.0, optional): the `run.startedAt` of its claim.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, n } = await params;
  // The body first, the job after: from here on everything is synchronous, so a stop, a cancel or a DELETE that arrived
  // while the body was coming in is seen, and a deleted job is never saved back.
  const b = ((await req.json().catch(() => null)) ?? {}) as { upload?: string; broll?: unknown; reel?: unknown; notes?: unknown; run?: unknown };
  const job = getJob(id);
  const v = job?.versions.find((x) => x.n === Number(n));
  if (!job || !v) {
    dropUpload(b.upload);
    return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  }
  // The preview of a run that is over (stopped, or a new edit made since: it may carry the same version number).
  const stale = staleWrite(job, b.run, isVideoJob(job));
  if (stale) {
    dropUpload(b.upload);
    return NextResponse.json({ error: stale }, { status: 409 });
  }
  if (!b.upload) return NextResponse.json({ error: "Champ « upload » manquant" }, { status: 400 });
  try {
    moveInto(takeUpload(b.upload).file, previewPath(id, v.n));
    v.preview = true;
    if (Array.isArray(b.broll)) v.edl.broll = cleanBroll(b.broll);
    // An animated reel: the plan as the Mac rendered it (lengths on screen, code it had to drop) and what it has to say.
    if (v.reel && b.reel) {
      const reel = cleanReel(b.reel, v.reel.look);
      // The Mac never changes the texts put by hand: an older one does not know them and would erase them.
      if (typeof reel !== "string") v.reel = { ...reel, ...(v.reel.texts?.length ? { texts: v.reel.texts } : {}) };
    }
    // What the Mac has to say: a reel's fallbacks, or the B-roll Claude placed on a passage.
    if (typeof b.notes === "string" && b.notes.trim()) v.notes = b.notes.trim().slice(0, 2000);
    job.brollAsk = undefined;
    return NextResponse.json({ job: release(job, "review") });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
