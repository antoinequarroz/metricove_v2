import "server-only";
import fs from "node:fs";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/**
 * fs stream → web stream that stops cleanly when the client hangs up. Readable.toWeb throws
 * "Controller is already closed" (an uncaught exception) when a video player or a network aborts a Range request.
 */
function webStream(file: string, opts?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const node = fs.createReadStream(file, opts);
  const chunks = node[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(new Uint8Array(value as Buffer));
      } catch (e) {
        node.destroy();
        try {
          controller.error(e);
        } catch {
          // Already closed by the client.
        }
      }
    },
    cancel() {
      node.destroy();
    },
  });
}

/** Streams a file, with Range support (Safari and iOS need it to play video). */
export function streamFile(req: Request, file: string | undefined, cache = "private, max-age=3600") {
  if (!file || !fs.existsSync(file)) return new Response("Introuvable", { status: 404 });
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": cache,
  };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(webStream(file, { start, end }), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(webStream(file), { headers: { ...headers, "Content-Length": String(size) } });
}
