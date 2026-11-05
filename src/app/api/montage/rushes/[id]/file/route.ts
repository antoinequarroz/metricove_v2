import { NextResponse } from "next/server";
import { getRushRow, releaseRushFile, rushFile } from "@/server/montage";
import { streamFile } from "@/server/stream";

type Ctx = { params: Promise<{ id: string }> };

/** A rush waiting on the server: the Mac downloads it, the page can play it. */
export async function GET(req: Request, { params }: Ctx) {
  const r = getRushRow((await params).id);
  return streamFile(req, r ? rushFile(r) : undefined, "private, no-store");
}

/** The Mac has the file: free the server. */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!releaseRushFile((await params).id)) return NextResponse.json({ error: "Rush introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
