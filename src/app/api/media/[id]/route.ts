import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR, db, getMediaRow, listPosts } from "@/server/db";

/** Deletes a video that no post uses. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getMediaRow(id);
  if (!row) return NextResponse.json({ error: "Vidéo introuvable" }, { status: 404 });
  if (listPosts().some((p) => p.mediaId === id)) return NextResponse.json({ error: "Cette vidéo est utilisée par un post" }, { status: 409 });
  db().prepare("delete from media where id = ?").run(id);
  if (row.file) fs.rmSync(path.join(DATA_DIR, "media", path.basename(row.file)), { force: true });
  return NextResponse.json({ ok: true });
}
