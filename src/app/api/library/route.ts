import { NextResponse } from "next/server";
import { ASSET_KINDS, type AssetKind, MAX_ASSET_BYTES } from "@/lib/library";
import { addAsset, listLibrary } from "@/server/library";

export const dynamic = "force-dynamic";

/** The illustrations and sound effects (`?kind=illustration|sfx` for one library). */
export function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") as AssetKind | null;
  return NextResponse.json({ items: listLibrary(kind && ASSET_KINDS.includes(kind) ? kind : undefined) });
}

/**
 * Adds a file. The body is the file itself; `?kind=`, `name`, `tags` (comma separated), `styles` (comma separated
 * "<projectId>:<styleId>") and `source=claude` (from the Mac) go in the address.
 */
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") as AssetKind;
  if (!ASSET_KINDS.includes(kind)) return NextResponse.json({ error: "Bibliothèque inconnue" }, { status: 400 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_ASSET_BYTES[kind]) return NextResponse.json({ error: "Fichier trop lourd" }, { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  const split = (v: string | null) => (v ? v.split(",") : []);
  const item = addAsset(kind, bytes, { name: q.get("name"), tags: split(q.get("tags")), styles: split(q.get("styles")), source: q.get("source") });
  if (typeof item === "string") return NextResponse.json({ error: item }, { status: 400 });
  return NextResponse.json({ item }, { status: 201 });
}
