import { NextResponse } from "next/server";
import { CAROUSEL_MAX, postProblems } from "@/lib/formats";
import { getMedia, getPost, listAccounts, savePost } from "@/server/db";
import { tick } from "@/server/scheduler";
import type { Network, Post, PostFormat } from "@/lib/types";

const STATUSES = ["draft", "scheduled"] as const;
const ORIGINS = ["manual", "claude-code", "hermes"] as const;

/** Creates or updates a post. Only drafts and scheduled posts can be written. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<Post> | null;
  if (!body) return NextResponse.json({ error: "JSON invalide" }, { status: 400 });

  const all = listAccounts();
  const accounts = new Set(all.map((a) => a.id));
  const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((id) => accounts.has(id)) : [];
  const when = new Date(body.scheduledAt ?? "");
  const status = STATUSES.find((s) => s === body.status) ?? "draft";

  if (!accountIds.length) return NextResponse.json({ error: "Choisissez au moins un compte" }, { status: 400 });
  if (isNaN(when.getTime())) return NextResponse.json({ error: "Date invalide" }, { status: 400 });

  const existing = body.id ? getPost(body.id) : undefined;
  if (existing && (existing.status === "published" || existing.status === "publishing"))
    return NextResponse.json({ error: "Ce post est déjà publié" }, { status: 409 });

  // Accounts that already got this video keep their result, so publishing again (after a
  // failure on another network) never sends a duplicate. A new video starts from scratch.
  // A carousel sends every media in order (mediaIds). One media alone is a plain post.
  const ids = Array.isArray(body.mediaIds) ? [...new Set(body.mediaIds.filter((x): x is string => typeof x === "string" && !!x))] : [];
  if (ids.length > CAROUSEL_MAX) return NextResponse.json({ error: `Un carrousel prend ${CAROUSEL_MAX} photos ou vidéos au plus` }, { status: 400 });
  const mediaId = ids[0] ?? (body.mediaId || undefined);
  // A script that updates a carousel naming only its first media (mediaId) keeps the carousel.
  const mediaIds = ids.length > 1 ? ids : body.mediaIds === undefined && existing?.mediaIds && existing.mediaId === mediaId ? existing.mediaIds : undefined;
  // A script that updates a post without naming the format keeps the one it had.
  const format: PostFormat | undefined = body.format === "story" ? "story" : body.format === "feed" ? undefined : existing?.format;

  // The same rules as the editor, so a script can't schedule a post the networks would refuse.
  if (status === "scheduled") {
    const items = (mediaIds ?? (mediaId ? [mediaId] : [])).map((id) => getMedia(id));
    if (items.some((m) => !m)) return NextResponse.json({ error: "Média introuvable" }, { status: 400 });
    const networks = [...new Set(all.filter((a) => accountIds.includes(a.id)).map((a) => a.network))] as Network[];
    const problems = postProblems({ format, items: items as NonNullable<(typeof items)[number]>[], networks });
    if (problems.length) return NextResponse.json({ error: problems[0] }, { status: 422 });
  }

  // A story and a feed post are two different publications: results don't carry over.
  const kept =
    existing?.results && existing.mediaId === mediaId && (existing.mediaIds ?? []).join() === (mediaIds ?? []).join() && existing.format === format
      ? Object.fromEntries(Object.entries(existing.results).filter(([id, r]) => r.status === "published" && accountIds.includes(id)))
      : {};

  const post: Post = {
    id: existing?.id ?? body.id ?? crypto.randomUUID(),
    results: Object.keys(kept).length ? kept : undefined,
    accountIds,
    caption: String(body.caption ?? "").slice(0, 70_000),
    mediaId,
    mediaIds,
    format,
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
