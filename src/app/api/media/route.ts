import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/server/db";
import { ingestVideo, VIDEO_EXT, type VideoMeta } from "@/server/media";

export const dynamic = "force-dynamic";

/**
 * Upload a video (multipart): field "file", plus optional "title" and "post"
 * (JSON with caption, accounts, scheduledAt, youtube). Used by the Videos page,
 * Claude Code and Hermes.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Envoyez un formulaire multipart avec le champ « file »" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Champ « file » manquant" }, { status: 400 });
  const ext = path.extname(file.name).toLowerCase();
  if (!VIDEO_EXT.has(ext)) return NextResponse.json({ error: "Formats acceptés : mp4, mov, m4v" }, { status: 415 });

  let meta: VideoMeta = {};
  const rawPost = form.get("post");
  if (typeof rawPost === "string" && rawPost.trim()) {
    try {
      meta = JSON.parse(rawPost);
    } catch {
      return NextResponse.json({ error: "Le champ « post » n'est pas du JSON valide" }, { status: 400 });
    }
  }
  const title = form.get("title");
  if (typeof title === "string" && title.trim()) meta.title = title.trim();
  const source = form.get("source");
  if (source === "upload" || source === "hermes" || source === "claude-code") meta.source = source;

  const tmpDir = path.join(DATA_DIR, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${crypto.randomUUID()}${ext}`);
  await fs.promises.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    return NextResponse.json(ingestVideo(tmp, file.name, meta), { status: 201 });
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
