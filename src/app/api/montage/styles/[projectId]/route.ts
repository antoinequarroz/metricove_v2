import { NextResponse } from "next/server";
import { listProjects } from "@/server/db";
import { cleanCaptions, getStyle, setStyle } from "@/server/montage";

type Ctx = { params: Promise<{ projectId: string }> };

/** Subtitle style of a project: new edits for this project start with it. */
export async function GET(_req: Request, { params }: Ctx) {
  return NextResponse.json({ style: getStyle((await params).projectId) ?? null });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!listProjects().some((p) => p.id === projectId)) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  const style = cleanCaptions(await req.json().catch(() => ({})));
  setStyle(projectId, style);
  return NextResponse.json({ style });
}
