import { NextResponse } from "next/server";
import { ingestVideo } from "@/server/media";
import { dropPreviews, getJob, release, takeUpload, UploadError } from "@/server/montage";

/** The worker sends the final video: { upload, title?, notes? }. It goes into the library. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { upload?: string; title?: string; notes?: unknown };
  if (!b.upload) return NextResponse.json({ error: "Champ « upload » manquant" }, { status: 400 });
  try {
    const up = takeUpload(b.upload);
    const { media } = ingestVideo(up.file, up.name.endsWith(".mp4") ? up.name : `${up.name}.mp4`, { title: b.title || job.title, source: "claude-code" });
    job.mediaId = media.id;
    if (typeof b.notes === "string" && b.notes.trim()) job.notes = b.notes.trim().slice(0, 1000);
    dropPreviews(job.id);
    job.versions.forEach((v) => (v.preview = false));
    return NextResponse.json({ job: release(job, "done"), media }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
