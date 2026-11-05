import { NextResponse } from "next/server";
import { CHUNK_MAX, createUpload, UploadError } from "@/server/montage";

/** Starts a chunked upload: { name, size } → { id, chunk }. Then PUT /api/uploads/:id?offset=… */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; size?: number };
  try {
    return NextResponse.json({ ...createUpload(body.name ?? "video", Number(body.size)), chunk: CHUNK_MAX }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
