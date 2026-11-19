import fs from "node:fs";
import { noteImagePath } from "@/server/review-notes";

type Ctx = { params: Promise<{ id: string; note: string }> };

/** The frame with the drawing of a review note. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, note } = await params;
  const file = noteImagePath(id, note);
  if (!fs.existsSync(file)) return new Response("Introuvable", { status: 404 });
  const buf = fs.readFileSync(file);
  const type = buf[0] === 0x89 ? "image/png" : buf[0] === 0x52 ? "image/webp" : "image/jpeg";
  return new Response(buf, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
