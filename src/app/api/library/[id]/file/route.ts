import fs from "node:fs";
import { NextResponse } from "next/server";
import { fileOf, findAsset } from "@/server/library";

type Ctx = { params: Promise<{ id: string }> };

/** The file of an illustration or a sound effect (the app shows or plays it, the Mac downloads it). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const item = findAsset(id);
  const file = item ? fileOf(item) : "";
  if (!item || !fs.existsSync(file)) return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      "Content-Type": item.type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // An SVG opened on its own must not run anything.
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
