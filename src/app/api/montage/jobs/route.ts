import { NextResponse } from "next/server";
import type { MontageFormat, MontageJob } from "@/lib/montage";
import { NETWORK_ORDER } from "@/lib/networks";
import type { Network } from "@/lib/types";
import { listAccounts, listMedia, listPosts, listProjects } from "@/server/db";
import { getRushRow, getStyle, listJobs, saveJob } from "@/server/montage";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

type Body = {
  kind?: MontageJob["kind"];
  title?: string;
  projectId?: string;
  brief?: Partial<MontageJob["brief"]>;
  rushIds?: string[];
  script?: string;
  // kind "caption"
  accountIds?: string[];
  draft?: string;
  mediaId?: string;
  // kind "post"
  idea?: string;
  slides?: number;
};

/**
 * Asks the Mac for an edit (kind "montage", with rushes), a teleprompter script (kind "script")
 * a post description (kind "caption"), a feed cover (kind "cover") or a whole post (kind "post").
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  if (b.kind === "caption") return captionJob(b);
  if (b.kind === "cover") return coverJob(b);
  if (b.kind === "post") return postJob(b);
  const kind = b.kind === "script" ? "script" : "montage";
  const format: MontageFormat = ["9:16", "4:5", "1:1", "16:9"].includes(b.brief?.format as string) ? (b.brief!.format as MontageFormat) : "9:16";
  const rushIds = [...new Set(b.rushIds ?? [])].filter((id) => getRushRow(id));
  if (kind === "montage" && !rushIds.length) return NextResponse.json({ error: "Choisissez au moins un rush" }, { status: 400 });
  if (kind === "script" && !b.brief?.instructions?.trim()) return NextResponse.json({ error: "Décrivez l'idée de la vidéo" }, { status: 400 });
  const clip = (s: unknown, n: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, n) : undefined);
  const now = new Date().toISOString();
  const projectId = listProjects().some((p) => p.id === b.projectId) ? b.projectId : undefined;
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind,
    title: clip(b.title, 120) ?? (kind === "script" ? "Texte de prompteur" : "Nouveau montage"),
    projectId,
    style: projectId && kind === "montage" ? getStyle(projectId) : undefined,
    status: "queued",
    action: kind === "script" ? "script" : "propose",
    brief: {
      format,
      seconds: Number.isFinite(b.brief?.seconds) && b.brief!.seconds! > 0 ? Math.round(b.brief!.seconds!) : undefined,
      instructions: clip(b.brief?.instructions, 2000),
      hook: clip(b.brief?.hook, 300),
      cta: clip(b.brief?.cta, 300),
    },
    script: clip(b.script, 10_000),
    rushIds,
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

function captionJob(b: Body) {
  const ids = new Set(b.accountIds ?? []);
  const accounts = listAccounts().filter((a) => ids.has(a.id));
  if (!accounts.length) return NextResponse.json({ error: "Choisissez d'abord les comptes" }, { status: 400 });
  const networks = NETWORK_ORDER.filter((n: Network) => accounts.some((a) => a.network === n));
  const media = b.mediaId ? listMedia().find((m) => m.id === b.mediaId) : undefined;
  const project = listProjects().find((p) => p.id === b.projectId) ?? listProjects().find((p) => accounts.every((a) => p.accountIds.includes(a.id)));
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "caption",
    title: media ? `Description : ${media.title}`.slice(0, 120) : "Description de post",
    projectId: project?.id,
    status: "queued",
    action: "caption",
    brief: { format: media?.aspect ?? "9:16" },
    caption: {
      networks,
      accounts: accounts.map((a) => ({ network: a.network, handle: a.handle })),
      project: project?.name,
      draft: typeof b.draft === "string" && b.draft.trim() ? b.draft.trim().slice(0, 5000) : undefined,
      mediaId: media?.id,
      youtube: networks.includes("youtube"),
    },
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

/** Asks the Mac for a feed cover in the project's style. */
function coverJob(b: Body) {
  const media = listMedia().find((m) => m.id === b.mediaId);
  if (!media) return NextResponse.json({ error: "Vidéo introuvable" }, { status: 404 });
  // The project of the posts that use this video, else the one asked for.
  const projects = listProjects();
  const ids = new Set(b.accountIds ?? listPosts().filter((p) => p.mediaId === media.id).flatMap((p) => p.accountIds));
  const project =
    projects.find((p) => p.id === b.projectId) ?? (ids.size ? projects.find((p) => [...ids].every((id) => p.accountIds.includes(id))) : undefined);
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "cover",
    title: `Couverture : ${media.title}`.slice(0, 120),
    projectId: project?.id,
    status: "queued",
    action: "cover",
    brief: { format: media.aspect },
    cover: {
      mediaId: media.id,
      project: project?.name,
      instructions: typeof b.draft === "string" && b.draft.trim() ? b.draft.trim().slice(0, 2000) : undefined,
    },
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

/** Asks the Mac for a whole post from an idea: the text of each slide and the description. */
function postJob(b: Body) {
  const idea = typeof b.idea === "string" ? b.idea.trim().slice(0, 3000) : "";
  if (!idea) return NextResponse.json({ error: "Décrivez l'idée du post" }, { status: 400 });
  const slides = Math.min(10, Math.max(1, Math.round(Number.isFinite(b.slides) ? (b.slides as number) : 5)));
  const projects = listProjects();
  const project = projects.find((p) => p.id === b.projectId);
  // The accounts given, else those of the project: Claude adapts the tone and the length to them.
  const ids = new Set(Array.isArray(b.accountIds) && b.accountIds.length ? b.accountIds : (project?.accountIds ?? []));
  const accounts = listAccounts().filter((a) => ids.has(a.id));
  const networks = NETWORK_ORDER.filter((n: Network) => accounts.some((a) => a.network === n));
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "post",
    title: `Post : ${idea}`.slice(0, 120),
    projectId: project?.id,
    status: "queued",
    action: "post",
    brief: { format: "4:5" },
    post: { idea, slides, networks, accounts: accounts.map((a) => ({ network: a.network, handle: a.handle })), project: project?.name },
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}
