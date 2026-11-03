import { NextResponse } from "next/server";
import { getPost, listAccounts, savePost } from "@/server/db";
import { tick } from "@/server/scheduler";
import type { Post } from "@/lib/types";

const STATUSES = ["draft", "scheduled"] as const;
const ORIGINS = ["manual", "claude-code", "hermes"] as const;

/** Creates or updates a post. Only drafts and scheduled posts can be written. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<Post> | null;
  if (!body) return NextResponse.json({ error: "JSON invalide" }, { status: 400 });

  const accounts = new Set(listAccounts().map((a) => a.id));
  const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((id) => accounts.has(id)) : [];
  const when = new Date(body.scheduledAt ?? "");
  const status = STATUSES.find((s) => s === body.status) ?? "draft";

  if (!accountIds.length) return NextResponse.json({ error: "Choisissez au moins un compte" }, { status: 400 });
  if (isNaN(when.getTime())) return NextResponse.json({ error: "Date invalide" }, { status: 400 });

  const existing = body.id ? getPost(body.id) : undefined;
  if (existing && (existing.status === "published" || existing.status === "publishing"))
    return NextResponse.json({ error: "Ce post est déjà publié" }, { status: 409 });

  const post: Post = {
    id: existing?.id ?? body.id ?? crypto.randomUUID(),
    accountIds,
    caption: String(body.caption ?? "").slice(0, 70_000),
    mediaId: body.mediaId || undefined,
    scheduledAt: when.toISOString(),
    status,
    origin: ORIGINS.find((o) => o === body.origin) ?? existing?.origin ?? "manual",
    youtube: body.youtube
      ? {
          title: String(body.youtube.title ?? "").slice(0, 100),
          format: body.youtube.format === "short" ? "short" : "video",
          privacy: (["public", "unlisted", "private"] as const).find((p) => p === body.youtube?.privacy) ?? "public",
        }
      : undefined,
  };
  savePost(post);
  // Publish right away if the date is already past.
  if (status === "scheduled" && when <= new Date()) void tick();
  return NextResponse.json(post);
}
