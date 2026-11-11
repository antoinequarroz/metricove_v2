import fs from "node:fs";
import { NextResponse } from "next/server";
import { cleanLook } from "@/lib/profiles";
import { addVersion, cleanEdl, cleanReel, EMPTY_EDL, getJob, moveInto, previewPath, release, takeUpload, UploadError } from "@/server/montage";

/** The worker sends a proposal: { edl, notes?, upload? (preview video) }, or for an animated reel { reel, notes?, upload }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { edl?: unknown; reel?: unknown; notes?: string; upload?: string };
  // An animated reel: the version is the plan the Mac rendered (texts, lengths, animations, Claude's code).
  let reel;
  if (job.kind === "motion") {
    if (!job.motion) return NextResponse.json({ error: "Reel sans demande" }, { status: 400 });
    const look = cleanLook((b.reel as { look?: unknown } | undefined)?.look, job.motion.look);
    if (typeof look === "string") return NextResponse.json({ error: look }, { status: 400 });
    const { logo: _logo, ...stored } = look;
    void _logo;
    reel = cleanReel(b.reel, stored);
    if (typeof reel === "string") return NextResponse.json({ error: reel }, { status: 400 });
  }
  const edl = reel ? EMPTY_EDL : cleanEdl(b.edl, job.rushIds);
  if (typeof edl === "string") return NextResponse.json({ error: edl }, { status: 400 });
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
    }
    return NextResponse.json({ job: release(job, "review"), version: v.n }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
