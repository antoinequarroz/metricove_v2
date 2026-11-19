import { NextResponse } from "next/server";
import { listProjects } from "@/server/db";
import { DEFAULT_STYLE } from "@/lib/profiles";
import { swapStylesInLibrary } from "@/server/library";
import { makeDefault } from "@/server/profiles";

type Ctx = { params: Promise<{ projectId: string; styleId: string }> };

/** This style becomes the project's default one. */
export async function POST(_req: Request, { params }: Ctx) {
  const { projectId, styleId } = await params;
  const project = listProjects().find((p) => p.id === projectId);
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  const profile = makeDefault(project, styleId);
  if (typeof profile === "string") return NextResponse.json({ error: profile }, { status: 404 });
  swapStylesInLibrary(project.id, DEFAULT_STYLE, styleId);
  return NextResponse.json({ profile });
}
