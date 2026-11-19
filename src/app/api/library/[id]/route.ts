import { NextResponse } from "next/server";
import { removeAsset, updateAsset } from "@/server/library";

type Ctx = { params: Promise<{ id: string }> };

/** Renames an item, changes its tags or the styles it belongs to. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const item = updateAsset(id, await req.json().catch(() => ({})));
  if (typeof item === "string") return NextResponse.json({ error: item }, { status: item === "Fichier introuvable" ? 404 : 400 });
  return NextResponse.json({ item });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!removeAsset(id)) return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
