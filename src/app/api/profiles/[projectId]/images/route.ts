import { NextResponse } from "next/server";
import { MAX_REF_IMAGE_BYTES } from "@/lib/profiles";
import { listProjects } from "@/server/db";
import { addRefImage } from "@/server/profiles";

type Ctx = { params: Promise<{ projectId: string }> };

/** Adds an inspiration image to a project. The body is the image itself (JPEG, PNG or WebP). */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  const project = listProjects().find((p) => p.id === projectId);
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REF_IMAGE_BYTES) return NextResponse.json({ error: "Image trop lourde" }, { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  const name = decodeURIComponent(new URL(req.url).searchParams.get("name") ?? "");
  const profile = addRefImage(project, bytes, name);
  if (typeof profile === "string") return NextResponse.json({ error: profile }, { status: 400 });
  return NextResponse.json({ profile }, { status: 201 });
}
