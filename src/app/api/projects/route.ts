import { NextResponse } from "next/server";
import type { Project } from "@/lib/types";
import { listProjects, saveProject } from "@/server/db";
import { cleanProject } from "@/server/projects";

export function GET() {
  return NextResponse.json({ projects: listProjects() });
}

/** Creates a project: { name, accountIds?, hue? }. */
export async function POST(req: Request) {
  const project = cleanProject((await req.json().catch(() => ({}))) as Partial<Project>);
  if (typeof project === "string") return NextResponse.json({ error: project }, { status: 400 });
  saveProject(project);
  return NextResponse.json({ project });
}
