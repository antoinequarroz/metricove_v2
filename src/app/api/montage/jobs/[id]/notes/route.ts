import { NextResponse } from "next/server";
import { getJob } from "@/server/montage";
import { addNote, listNotes } from "@/server/review-notes";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The review notes of an edit (all versions). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getJob(id)) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  return NextResponse.json({ notes: listNotes(id) });
}

/** A new note: { version, t, text?, image? (data URL), target? }. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  if (job.kind !== "montage") return NextResponse.json({ error: "Seulement pour une vidéo face caméra" }, { status: 400 });
  const note = addNote(id, b ?? {});
  if (typeof note === "string") return NextResponse.json({ error: note }, { status: 400 });
  return NextResponse.json({ note, notes: listNotes(id) });
}
