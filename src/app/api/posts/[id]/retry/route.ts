import { NextResponse } from "next/server";
import { getPost, savePost } from "@/server/db";
import { tick } from "@/server/scheduler";

/** Puts a failed post back in the queue. Accounts that already succeeded are skipped. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const post = getPost((await params).id);
  if (!post) return NextResponse.json({ error: "Post introuvable" }, { status: 404 });
  if (post.status !== "failed") return NextResponse.json({ error: "Seuls les posts en échec peuvent être relancés" }, { status: 409 });
  const when = new Date(post.scheduledAt) < new Date() ? new Date() : new Date(post.scheduledAt);
  savePost({ ...post, status: "scheduled", scheduledAt: when.toISOString(), error: undefined });
  void tick();
  return NextResponse.json({ ok: true });
}
