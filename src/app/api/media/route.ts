import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/server/db";
import { ingestVideo, VIDEO_EXT, type VideoMeta } from "@/server/media";
import { takeUpload, UploadError } from "@/server/montage";

export const dynamic = "force-dynamic";

/**
 * Upload a video. Over 10 MB, send it in chunks to /api/uploads first, then post JSON { upload, title?, post? }.
 * Small files can still come as multipart: field "file", plus optional "title" and "post"
 * (JSON with caption, accounts, scheduledAt, youtube). Used by the Videos page,
 * Claude Code and Hermes.
 */
export async function POST(req: Request) {
  // Big files: sent first in chunks to /api/uploads, then { upload, title?, post?, source? } here.
  if (req.headers.get("content-type")?.includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as VideoMeta & { upload?: string; post?: VideoMeta };
    if (!b.upload) return NextResponse.json({ error: "Champ « upload » manquant" }, { status: 400 });
    try {
      const up = takeUpload(b.upload);
      if (!VIDEO_EXT.has(path.extname(up.name).toLowerCase())) {
        fs.rmSync(up.file, { force: true });
        return NextResponse.json({ error: "Formats acceptés : mp4, mov, m4v" }, { status: 415 });
      }
      const source = b.source === "upload" || b.source === "hermes" || b.source === "claude-code" ? b.source : undefined;
      return NextResponse.json(ingestVideo(up.file, up.name, { ...b.post, title: b.title ?? b.post?.title, source }), { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
    }
  }
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
