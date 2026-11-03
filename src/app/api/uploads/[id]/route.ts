import { NextResponse } from "next/server";
import { appendUpload, getUpload, UploadError } from "@/server/montage";

type Ctx = { params: Promise<{ id: string }> };

/** Where an upload stands, to resume it. */
export async function GET(_req: Request, { params }: Ctx) {
  const u = getUpload((await params).id);
  if (!u) return NextResponse.json({ error: "Envoi introuvable" }, { status: 404 });
  return NextResponse.json({ received: u.received, size: u.size });
}

/** Adds one chunk (8 MB maximum) at ?offset=. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const offset = Number(new URL(req.url).searchParams.get("offset") ?? "0");
  try {
    const chunk = Buffer.from(await req.arrayBuffer());
    return NextResponse.json(appendUpload(id, offset, chunk));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
