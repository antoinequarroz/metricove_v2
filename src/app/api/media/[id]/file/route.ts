import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_DIR, getMediaRow } from "@/server/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const row = getMediaRow((await params).id);
  if (!row?.file) return new Response("Introuvable", { status: 404 });
  const file = path.join(DATA_DIR, "media", path.basename(row.file));
  if (!fs.existsSync(file)) return new Response("Introuvable", { status: 404 });
  const stat = fs.statSync(file);
  const type = file.endsWith(".mov") ? "video/quicktime" : file.endsWith(".png") ? "image/png" : file.match(/\.jpe?g$/) ? "image/jpeg" : "video/mp4";
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: { "Content-Type": type, "Content-Length": String(stat.size), "Cache-Control": "private, max-age=3600" },
  });
}
