import fs from "node:fs";
import { NextResponse } from "next/server";
import { addVersion, cleanEdl, getJob, moveInto, previewPath, release, takeUpload, UploadError } from "@/server/montage";

/** The worker sends a proposal: { edl, notes?, upload? (preview video) }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { edl?: unknown; notes?: string; upload?: string };
  const edl = cleanEdl(b.edl, job.rushIds);
  if (typeof edl === "string") return NextResponse.json({ error: edl }, { status: 400 });
  try {
    const v = addVersion(job, edl, "claude", b.notes);
    if (b.upload) {
      const up = takeUpload(b.upload);
      moveInto(up.file, previewPath(job.id, v.n));
      v.preview = fs.existsSync(previewPath(job.id, v.n));
    }
    job.feedback = undefined;
    return NextResponse.json({ job: release(job, "review"), version: v.n }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
