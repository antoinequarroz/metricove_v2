import { NextResponse } from "next/server";
import { getJob, moveInto, previewPath, release, takeUpload, UploadError } from "@/server/montage";
import { streamFile } from "@/server/stream";

type Ctx = { params: Promise<{ id: string; n: string }> };

/** Plays the preview of one version. */
export async function GET(req: Request, { params }: Ctx) {
  const { id, n } = await params;
  return streamFile(req, getJob(id) ? previewPath(id, Number(n)) : undefined, "private, no-store");
}

/** The worker sends the preview of a version edited by hand: { upload }. */
export async function POST(req: Request, { params }: Ctx) {
  const { id, n } = await params;
  const job = getJob(id);
  const v = job?.versions.find((x) => x.n === Number(n));
  if (!job || !v) return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { upload?: string };
  if (!b.upload) return NextResponse.json({ error: "Champ « upload » manquant" }, { status: 400 });
  try {
    moveInto(takeUpload(b.upload).file, previewPath(id, v.n));
    v.preview = true;
    return NextResponse.json({ job: release(job, "review") });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
