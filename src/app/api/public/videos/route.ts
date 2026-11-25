import { NextResponse } from "next/server";
import { listMedia, listPosts, listProjects } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * The videos a brand has already published, for its own website (livrematch.fr/vu-en-video).
 * Public on purpose, without a key: it only lists what is already public on the networks.
 * Only the projects named in PUBLIC_VIDEO_PROJECTS (comma separated, "LivreMatch" by default)
 * are open; drafts, scheduled and failed posts never leave Metricove, and neither do the accounts.
 */
const TIME_ZONE = process.env.APP_TIMEZONE || "Europe/Zurich";
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const LINK = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s)»"]+/gi;

const openProjects = () =>
  (process.env.PUBLIC_VIDEO_PROJECTS ?? "LivreMatch")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function GET(req: Request) {
  const name = (new URL(req.url).searchParams.get("project") ?? "").trim().toLowerCase();
  const project = openProjects().includes(name) ? listProjects().find((p) => p.name.toLowerCase() === name) : undefined;
  if (!project) return NextResponse.json({ error: "Projet introuvable" }, { status: 404 });

  const accounts = new Set(project.accountIds);
  const media = new Map(listMedia().map((m) => [m.id, m]));
  const videos = listPosts()
    .filter((p) => p.status === "published" && p.accountIds.length > 0 && p.accountIds.every((id) => accounts.has(id)))
    .flatMap((p) => {
      const m = media.get(p.mediaId ?? p.mediaIds?.[0] ?? "");
      if (!m || m.kind !== "video") return [];
      return [{ day: dayOf(p.scheduledAt), title: m.title, links: [...new Set(p.caption.match(LINK) ?? [])].slice(0, 10) }];
    })
    .sort((a, b) => b.day.localeCompare(a.day));

  return NextResponse.json({ project: project.name, videos }, { headers: { "cache-control": "public, max-age=300" } });
}
