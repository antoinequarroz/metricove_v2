import { NextResponse } from "next/server";
import type { Project } from "@/lib/types";
import { deleteProject, listProjects, saveProject } from "@/server/db";
import { cleanProject } from "@/server/projects";

type Ctx = { params: Promise<{ id: string }> };

/** Renames a project or changes its accounts. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const current = listProjects().find((p) => p.id === id);
  if (!current) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  const project = cleanProject((await req.json().catch(() => ({}))) as Partial<Project>, current);
  if (typeof project === "string") return NextResponse.json({ error: project }, { status: 400 });
  saveProject(project);
  return NextResponse.json({ project });
}

/** Deletes a project. Its accounts and posts stay. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!listProjects().some((p) => p.id === id)) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
