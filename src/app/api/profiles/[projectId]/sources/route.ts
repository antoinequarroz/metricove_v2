import { NextResponse } from "next/server";
import { MAX_SOURCE_BYTES } from "@/lib/strategy";
import { listProjects } from "@/server/db";
import { addSource } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string }> };

/** A document for Claude to read (strategy or charte). The body is the file itself; ?name= its name. */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!listProjects().some((p) => p.id === projectId)) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_SOURCE_BYTES) return NextResponse.json({ error: "Fichier trop lourd (9 Mo au plus) : exporte une version allégée" }, { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  const source = addSource(projectId, bytes, new URL(req.url).searchParams.get("name") ?? "");
  if (typeof source === "string") return NextResponse.json({ error: source }, { status: 400 });
  return NextResponse.json({ source }, { status: 201 });
}
