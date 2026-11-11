import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR, db, getMediaRow, listPosts } from "@/server/db";
import { postMediaIds } from "@/lib/formats";

/** Deletes a video or a photo that no post uses. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getMediaRow(id);
  if (!row) return NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  if (listPosts().some((p) => postMediaIds(p).includes(id))) return NextResponse.json({ error: "Ce média est utilisé par un post" }, { status: 409 });
  db().prepare("delete from media where id = ?").run(id);
  if (row.file) fs.rmSync(path.join(DATA_DIR, "media", path.basename(row.file)), { force: true });
  if (row.cover) fs.rmSync(path.join(DATA_DIR, "media", path.basename(row.cover)), { force: true });
  return NextResponse.json({ ok: true });
}
