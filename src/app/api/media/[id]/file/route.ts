import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_DIR, getMediaRow } from "@/server/db";

const TYPES: Record<string, string> = { ".mov": "video/quicktime", ".m4v": "video/mp4", ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** Streams a video, with Range support (Safari and iOS need it to play video). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const row = getMediaRow((await params).id);
  if (!row?.file) return new Response("Introuvable", { status: 404 });
  const file = path.join(DATA_DIR, "media", path.basename(row.file));
  if (!fs.existsSync(file)) return new Response("Introuvable", { status: 404 });
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
