import { NextResponse } from "next/server";
import { deletePost, getPost, savePost } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

/** Moves a post to another day, keeping its time. */
export async function PATCH(req: Request, { params }: Ctx) {
  const post = getPost((await params).id);
  if (!post) return NextResponse.json({ error: "Post introuvable" }, { status: 404 });
  if (post.status === "published" || post.status === "publishing") return NextResponse.json({ error: "Ce post est déjà publié" }, { status: 409 });
  const { scheduledAt } = (await req.json().catch(() => ({}))) as { scheduledAt?: string };
  const when = new Date(scheduledAt ?? "");
  if (isNaN(when.getTime())) return NextResponse.json({ error: "Date invalide" }, { status: 400 });
  const next = { ...post, scheduledAt: when.toISOString() };
  savePost(next);
  return NextResponse.json(next);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const post = getPost((await params).id);
  if (post?.status === "publishing") return NextResponse.json({ error: "Publication en cours" }, { status: 409 });
  deletePost((await params).id);
  return NextResponse.json({ ok: true });
}
