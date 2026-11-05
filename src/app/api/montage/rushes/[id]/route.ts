import { NextResponse } from "next/server";
import { deleteRush, listJobs } from "@/server/montage";

/** Forgets a rush (a file on the Mac stays on the Mac). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const used = listJobs().filter((j) => j.rushIds.includes(id) && !["done", "cancelled", "failed"].includes(j.status)).length;
  if (used) return NextResponse.json({ error: "Ce rush sert à un montage en cours" }, { status: 409 });
  if (!deleteRush(id)) return NextResponse.json({ error: "Rush introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
