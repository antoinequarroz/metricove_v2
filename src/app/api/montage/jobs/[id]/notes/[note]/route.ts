import { NextResponse } from "next/server";
import { listNotes, removeNote, updateNote } from "@/server/review-notes";

type Ctx = { params: Promise<{ id: string; note: string }> };

/** { text?, status?: "open" | "resolved", t? } */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, note } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!updateNote(id, note, b ?? {})) return NextResponse.json({ error: "Retour introuvable" }, { status: 404 });
  return NextResponse.json({ notes: listNotes(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, note } = await params;
  if (!removeNote(id, note)) return NextResponse.json({ error: "Retour introuvable" }, { status: 404 });
  return NextResponse.json({ notes: listNotes(id) });
}
