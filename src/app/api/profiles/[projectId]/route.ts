import { NextResponse } from "next/server";
import { listProjects } from "@/server/db";
import { resetProfile, saveProfile } from "@/server/profiles";

type Ctx = { params: Promise<{ projectId: string }> };

const find = async (ctx: Ctx) => {
  const { projectId } = await ctx.params;
  return listProjects().find((p) => p.id === projectId);
};

/** Changes the style profile of a project: its look, its tone, its skill. Only the fields sent change. */
export async function PUT(req: Request, ctx: Ctx) {
  const project = await find(ctx);
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  const profile = saveProfile(project, await req.json().catch(() => ({})));
  if (typeof profile === "string") return NextResponse.json({ error: profile }, { status: 400 });
  return NextResponse.json({ profile });
}

/** Back to the starter style of the project. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const project = await find(ctx);
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  return NextResponse.json({ profile: resetProfile(project) });
}
