import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR, getMediaRow, setMediaCover } from "@/server/db";
import { streamFile } from "@/server/stream";

type Ctx = { params: Promise<{ id: string }> };

const dir = () => path.join(DATA_DIR, "media");
const MAX = 8 * 1024 * 1024; // Instagram takes covers up to 8 MB.

/** The cover image (also reachable by Instagram through a signed link). */
export async function GET(req: Request, { params }: Ctx) {
  const row = getMediaRow((await params).id);
  return streamFile(req, row?.cover ? path.join(dir(), path.basename(row.cover)) : undefined, "private, max-age=31536000, immutable");
}

/** Sets the cover: the raw JPEG or PNG as the body (the Mac worker and the page both use this). */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const row = getMediaRow(id);
  if (!row) return NextResponse.json({ error: "Vidéo introuvable" }, { status: 404 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "Image vide" }, { status: 400 });
  if (bytes.length > MAX) return NextResponse.json({ error: "Image trop lourde (8 Mo au plus)" }, { status: 413 });
  // Check the real format, not the header the client claims.
  const ext = bytes[0] === 0xff && bytes[1] === 0xd8 ? ".jpg" : bytes.subarray(0, 4).toString("hex") === "89504e47" ? ".png" : null;
  if (!ext) return NextResponse.json({ error: "Formats acceptés : JPEG ou PNG" }, { status: 415 });
  const name = `${id}-cover-${Date.now().toString(36)}${ext}`;
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), name), bytes);
  if (row.cover) fs.rmSync(path.join(dir(), path.basename(row.cover)), { force: true });
  setMediaCover(id, name);
  return NextResponse.json({ cover: `/api/media/${id}/cover?v=${encodeURIComponent(name)}` });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const row = getMediaRow(id);
  if (!row) return NextResponse.json({ error: "Vidéo introuvable" }, { status: 404 });
  if (row.cover) fs.rmSync(path.join(dir(), path.basename(row.cover)), { force: true });
  setMediaCover(id, null);
  return NextResponse.json({ ok: true });
}
