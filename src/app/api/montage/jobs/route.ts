import { NextResponse } from "next/server";
import { MAX_DIRECTION, MAX_SCENES, type MontageFormat, type MontageJob } from "@/lib/montage";
import { NETWORK_ORDER } from "@/lib/networks";
import type { Network } from "@/lib/types";
import { listAccounts, listMedia, listPosts, listProjects } from "@/server/db";
import { getRushRow, getStyle, listJobs, saveJob } from "@/server/montage";
import { cleanLook, starterProfile } from "@/lib/profiles";
import { profileOf, voiceOf } from "@/server/profiles";
import { MAX_FOCUS, MAX_PLAN_ITEMS, MAX_SOURCE_TEXT, MAX_SOURCES, PLAN_DAYS, PLAN_FORMATS, type PlanFormat, type SourceFile } from "@/lib/strategy";
import { sourceFile } from "@/server/sources";

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
  reel?: boolean;
  // kind "motion"
  scenes?: unknown;
  look?: unknown;
  logo?: boolean;
  music?: boolean;
  direction?: unknown;
  pace?: unknown;
  // kind "brand"
  mode?: unknown;
  sources?: unknown;
  url?: unknown;
  text?: unknown;
  // kind "plan"
  from?: unknown;
  days?: unknown;
  count?: unknown;
  formats?: unknown;
  focus?: unknown;
};

/**
 * Asks the Mac for an edit (kind "montage", with rushes), a teleprompter script (kind "script")
 * a post description (kind "caption"), a feed cover (kind "cover"), a whole post (kind "post")
 * or an animated reel (kind "motion").
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  if (b.kind === "caption") return captionJob(b);
  if (b.kind === "cover") return coverJob(b);
  if (b.kind === "post") return postJob(b);
  if (b.kind === "motion") return motionJob(b);
  if (b.kind === "brand") return brandJob(b);
  if (b.kind === "plan") return planJob(b);
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
    voice: kind === "script" ? voiceOf(projectId) : undefined,
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
    voice: voiceOf(project?.id),
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
    voice: voiceOf(project?.id),
    status: "queued",
    action: "post",
    brief: { format: "4:5" },
    post: { idea, slides, networks, accounts: accounts.map((a) => ({ network: a.network, handle: a.handle })), project: project?.name, ...(b.reel === true ? { reel: true } : {}) },
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

/** Asks the Mac for an animated reel: text scenes in the look of the project, no rush. */
function motionJob(b: Body) {
  const scenes = (Array.isArray(b.scenes) ? (b.scenes as Record<string, unknown>[]) : [])
    .map((s) => {
      const anim = typeof s?.anim === "string" ? s.anim.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      return { title: typeof s?.title === "string" ? s.title.trim().slice(0, 120) : "", body: typeof s?.body === "string" ? s.body.trim().slice(0, 240) : "", ...(anim ? { anim } : {}) };
    })
    .filter((s) => s.title || s.body)
    .slice(0, MAX_SCENES);
  if (!scenes.length) return NextResponse.json({ error: "Écris au moins une scène" }, { status: 400 });
  const project = listProjects().find((p) => p.id === b.projectId);
  // The look the page shows, checked; what it does not say comes from the project's profile.
  const base = project ? profileOf(project).look : starterProfile("antoine").look;
  const look = cleanLook(b.look, base);
  if (typeof look === "string") return NextResponse.json({ error: look }, { status: 400 });
  // The logo stays out of the job (the list of jobs is read every few seconds): the Mac gets it when it takes the job.
  const { logo: _logo, ...stored } = look;
  void _logo;
  const direction = typeof b.direction === "string" ? b.direction.replace(/\r\n?/g, "\n").trim().slice(0, MAX_DIRECTION) : "";
  const pace = (["calm", "normal", "fast"] as const).find((p) => p === b.pace);
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "motion",
    title: `Reel animé : ${scenes[0].title || scenes[0].body}`.replace(/\s+/g, " ").slice(0, 120),
    projectId: project?.id,
    status: "queued",
    action: "motion",
    brief: { format: "9:16" },
    motion: { scenes, look: stored, logo: b.logo !== false, music: b.music !== false, ...(direction ? { direction } : {}), ...(pace ? { pace } : {}), project: project?.name },
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

/** Asks the Mac to read a digital strategy or a charte (documents, a website, a pasted text) for a project. */
function brandJob(b: Body) {
  const project = listProjects().find((p) => p.id === b.projectId);
  if (!project) return NextResponse.json({ error: "Choisis le projet" }, { status: 400 });
  const mode = b.mode === "charte" ? "charte" : "strategy";
  const files: SourceFile[] = [];
  for (const s of (Array.isArray(b.sources) ? b.sources : []) as Record<string, unknown>[]) {
    const id = typeof s?.id === "string" ? s.id : "";
    if (!sourceFile(project.id, id) || files.some((f) => f.id === id)) continue;
    files.push({ id, name: typeof s.name === "string" ? s.name.replace(/[\0-\x1f]/g, "").slice(0, 120) || "Document" : "Document", type: id.split(".").pop() as SourceFile["type"] });
    if (files.length >= MAX_SOURCES) break;
  }
  let url: string | undefined;
  if (typeof b.url === "string" && b.url.trim()) {
    const raw = b.url.trim();
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      if (u.username || u.password) throw new Error();
      url = u.toString().slice(0, 500);
    } catch {
      return NextResponse.json({ error: "Adresse du site illisible" }, { status: 400 });
    }
  }
  const text = typeof b.text === "string" ? b.text.replace(/\r\n?/g, "\n").trim().slice(0, MAX_SOURCE_TEXT) : "";
  if (!files.length && !url && !text) return NextResponse.json({ error: mode === "charte" ? "Ajoute la charte : un PDF, des images ou l'adresse du site" : "Ajoute la stratégie : un document ou un texte" }, { status: 400 });
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "brand",
    title: `${mode === "charte" ? "Charte" : "Stratégie"} : ${project.name}`.slice(0, 120),
    projectId: project.id,
    // The charte reading keeps the tone in mind (it may propose one); the strategy reading writes from scratch.
    voice: mode === "charte" ? undefined : (({ tone }) => (tone ? { tone } : undefined))(voiceOf(project.id) ?? {}),
    status: "queued",
    action: "brand",
    brief: { format: "4:5" },
    brand: { mode, project: project.name, files, ...(url ? { url } : {}), ...(text ? { text } : {}) },
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

const TZ = process.env.TZ || "Europe/Zurich";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });

/** Asks the Mac for posts to plan over a period, from the digital strategy of the project. */
function planJob(b: Body) {
  const project = listProjects().find((p) => p.id === b.projectId);
  if (!project) return NextResponse.json({ error: "Choisis le projet" }, { status: 400 });
  const profile = profileOf(project);
  if (!profile.strategy.trim()) return NextResponse.json({ error: "Ajoute d'abord la stratégie digitale du projet" }, { status: 400 });
  const today = dayOf(new Date().toISOString());
  const from = typeof b.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.from) && b.from >= today ? b.from : today;
  const days = PLAN_DAYS.find((d) => d === Number(b.days)) ?? 7;
  const count = Math.min(MAX_PLAN_ITEMS, Math.max(1, Math.round(Number(b.count) || 5)));
  const formats = PLAN_FORMATS.map((f) => f.value).filter((f) => Array.isArray(b.formats) && (b.formats as unknown[]).includes(f)) as PlanFormat[];
  const accounts = listAccounts().filter((a) => project.accountIds.includes(a.id));
  const networks = NETWORK_ORDER.filter((n: Network) => accounts.some((a) => a.network === n));
  // What is already planned in the period, and the two weeks before it: Claude avoids repeating them.
  const start = new Date(`${from}T00:00:00Z`).getTime() - 14 * 86_400_000;
  const end = new Date(`${from}T00:00:00Z`).getTime() + (days + 1) * 86_400_000;
  const taken = listPosts()
    .filter((p) => p.status !== "failed" && p.accountIds.some((id) => project.accountIds.includes(id)))
    .filter((p) => {
      const t = new Date(p.scheduledAt).getTime();
      return t >= start && t < end;
    })
    .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))
    .slice(-40)
    .map((p) => ({ date: dayOf(p.scheduledAt), text: p.caption.replace(/\s+/g, " ").trim().slice(0, 160) || "(sans texte)" }));
  const focus = typeof b.focus === "string" ? b.focus.replace(/\s+/g, " ").trim().slice(0, MAX_FOCUS) : "";
  const voice = voiceOf(project.id);
  if (voice) delete voice.strategy;
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "plan",
    title: `Plan de contenu : ${project.name}`.slice(0, 120),
    projectId: project.id,
    voice,
    status: "queued",
    action: "plan",
    brief: { format: "4:5" },
    plan: {
      project: project.name,
      from,
      days,
      count,
      formats: formats.length ? formats : ["carrousel", "photo", "reel"],
      networks,
      accounts: accounts.map((a) => ({ network: a.network, handle: a.handle })),
      ...(focus ? { focus } : {}),
      strategy: profile.strategy.trim(),
      taken,
    },
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}
