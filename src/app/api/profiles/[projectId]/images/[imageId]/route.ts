import fs from "node:fs";
import { NextResponse } from "next/server";
import { listProjects } from "@/server/db";
import { refImageFile, removeRefImage } from "@/server/profiles";

type Ctx = { params: Promise<{ projectId: string; imageId: string }> };

/** One inspiration image of a project (the app shows it, the Mac downloads it for Claude). */
export async function GET(_req: Request, { params }: Ctx) {
  const { projectId, imageId } = await params;
  const project = listProjects().find((p) => p.id === projectId);
  const found = project ? refImageFile(project, imageId) : undefined;
  if (!found) return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(found.file)), {
    headers: { "Content-Type": found.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { projectId, imageId } = await params;
  const project = listProjects().find((p) => p.id === projectId);
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  return NextResponse.json({ profile: removeRefImage(project, imageId) });
}
