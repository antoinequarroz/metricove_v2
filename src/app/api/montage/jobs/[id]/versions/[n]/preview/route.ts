import { NextResponse } from "next/server";
import { cleanBroll, cleanReel, getJob, moveInto, previewPath, release, takeUpload, UploadError } from "@/server/montage";
import { streamFile } from "@/server/stream";

type Ctx = { params: Promise<{ id: string; n: string }> };

/** Plays the preview of one version. */
export async function GET(req: Request, { params }: Ctx) {
  const { id, n } = await params;
  return streamFile(req, getJob(id) ? previewPath(id, Number(n)) : undefined, "private, no-store");
}

/** The worker sends the preview of a version edited by hand: { upload, broll? } (B-roll shots it found), or for a reel { upload, reel, notes? }. */
export async function POST(req: Request, { params }: Ctx) {
  const { id, n } = await params;
  const job = getJob(id);
  const v = job?.versions.find((x) => x.n === Number(n));
  if (!job || !v) return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { upload?: string; broll?: unknown; reel?: unknown; notes?: unknown };
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
    if (v.reel && typeof b.notes === "string" && b.notes.trim()) v.notes = b.notes.trim().slice(0, 2000);
    return NextResponse.json({ job: release(job, "review") });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
