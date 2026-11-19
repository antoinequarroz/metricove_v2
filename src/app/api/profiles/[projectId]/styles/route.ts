import { NextResponse } from "next/server";
import { listProjects } from "@/server/db";
import { createStyle } from "@/server/profiles";

type Ctx = { params: Promise<{ projectId: string }> };

/** A new style for the project: { name, from? } (copied from the style `from`, else from the default one). */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  const project = listProjects().find((p) => p.id === projectId);
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { name?: unknown; from?: unknown };
  const profile = createStyle(project, b.name, b.from);
  if (typeof profile === "string") return NextResponse.json({ error: profile }, { status: 400 });
  return NextResponse.json({ profile }, { status: 201 });
}
