import { NextResponse } from "next/server";
import { DEFAULT_STYLE } from "@/lib/profiles";
import { listProjects } from "@/server/db";
import { forgetStyleInLibrary } from "@/server/library";
import { deleteStyle, extraStyleIds, profileOf, resetProfile, saveProfile } from "@/server/profiles";

type Ctx = { params: Promise<{ projectId: string }> };

const find = async (ctx: Ctx) => {
  const { projectId } = await ctx.params;
  return listProjects().find((p) => p.id === projectId);
};
/** `?style=<id>`: one of the project's other styles. Left out: the default style. */
const styleParam = (req: Request) => new URL(req.url).searchParams.get("style") || DEFAULT_STYLE;

/** Changes a style of a project: its name, notes, look, tone, skill. Only the fields sent change. */
export async function PUT(req: Request, ctx: Ctx) {
  const project = await find(ctx);
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  const style = styleParam(req);
  if (style !== DEFAULT_STYLE && !extraStyleIds(project.id).includes(style)) return NextResponse.json({ error: "Style introuvable" }, { status: 404 });
  const profile = saveProfile(project, await req.json().catch(() => ({})), style);
  if (typeof profile === "string") return NextResponse.json({ error: profile }, { status: 400 });
  return NextResponse.json({ profile });
}

/** The default style goes back to the starter style; another style is removed. */
export async function DELETE(req: Request, ctx: Ctx) {
  const project = await find(ctx);
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  const style = styleParam(req);
  if (style === DEFAULT_STYLE) return NextResponse.json({ profile: resetProfile(project) });
  deleteStyle(project, style);
  forgetStyleInLibrary(project.id, style);
  return NextResponse.json({ profile: profileOf(project) });
}
