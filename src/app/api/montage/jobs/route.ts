import { NextResponse } from "next/server";
import { type ClaudeEffort, cleanEffort, cleanModel, GEN_TRACK, libTrackId } from "@/lib/audio-ai";
import { ASSET_WORKER, MAX_STYLE_REFS, STYLE_WORKER, type StyleTask, MAX_ASSET_COUNT, MAX_ASSET_PROMPT, MAX_DIRECTION, MAX_SCENES, REEL_SOURCES, REEL_TARGETS, REEL_VIDEO, VIDEO_WORKER, AUDIO_WORKER, type MontageFormat, type MontageJob } from "@/lib/montage";
import { NETWORK_ORDER } from "@/lib/networks";
import type { Network } from "@/lib/types";
import { listAccounts, listMedia, listPosts, listProjects } from "@/server/db";
import { getRushRow, getStyle, listJobs, pageJob, saveJob, withAhead } from "@/server/montage";
import { cleanLook, starterProfile } from "@/lib/profiles";
import { captionsOf, profileOf, styleIdOf, voiceOf } from "@/server/profiles";
import { DEFAULT_STYLE } from "@/lib/profiles";
import { atLeast } from "@/lib/worker-version";
import { MAX_FOCUS, MAX_PLAN_ITEMS, MAX_SOURCE_TEXT, MAX_SOURCES, PLAN_DAYS, PLAN_FORMATS, type PlanFormat, type SourceFile } from "@/lib/strategy";
import { sourceFile } from "@/server/sources";
import { listNotes } from "@/server/review-notes";

export const dynamic = "force-dynamic";

/** The style of the project the job is made with: kept on the job only when it is not the default one. */
const styleOf = (projectId: string | undefined, raw: unknown) => {
  const id = projectId ? styleIdOf(projectId, raw) : DEFAULT_STYLE;
  return id === DEFAULT_STYLE ? undefined : id;
};

/** The jobs as the page sees them (scripts use it too): no code from Claude, a link in place of each drawing. */
export function GET() {
  const jobs = listJobs().map((j) => ({
    ...pageJob(j),
    ...(j.marks ? { marks: j.marks.map((m) => ({ ...m, image: m.image ? `/api/montage/jobs/${j.id}/marks/${m.id}` : undefined })) } : {}),
  }));
  return NextResponse.json({ jobs: withAhead(jobs), now: Date.now() });
}

type Body = {
  kind?: MontageJob["kind"];
  /** The Claude model of the job (montage, reel); left out, the one of Réglages. */
  model?: unknown;
  /** The thinking effort of the job (`claude --effort`); left out, the one of Réglages. */
  effort?: unknown;
  /** Video reel: the voice-over. */
  voice?: unknown;
  title?: string;
  projectId?: string;
  /** One of the project's other styles; left out = its default style. */
  styleId?: unknown;
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
  // kind "motion", mode "video" (worker 0.15.0)
  mode?: unknown;
  request?: unknown;
  source?: unknown;
  seconds?: unknown;
  track?: unknown;
  /** Engine 2 (worker 0.22.0): false = no sound effects; anything else = on. */
  sfx?: unknown;
  // kind "brand" (mode too)
  sources?: unknown;
  url?: unknown;
  text?: unknown;
  // kind "asset"
  assetKind?: unknown;
  // kind "style" (mode, from, name too)
  noteIds?: unknown;
  refs?: unknown;
  name?: unknown;
  prompt?: unknown;
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
  if (b.kind === "motion" && b.mode === "video") return videoJob(b);
  if (b.kind === "motion") return motionJob(b);
  if (b.kind === "brand") return brandJob(b);
  if (b.kind === "plan") return planJob(b);
  if (b.kind === "asset") return assetJob(b);
  if (b.kind === "style") return styleJob(b);
  const kind = b.kind === "script" ? "script" : "montage";
  const format: MontageFormat = ["9:16", "4:5", "1:1", "16:9"].includes(b.brief?.format as string) ? (b.brief!.format as MontageFormat) : "9:16";
  const rushIds = [...new Set(b.rushIds ?? [])].filter((id) => getRushRow(id));
  if (kind === "montage" && !rushIds.length) return NextResponse.json({ error: "Choisissez au moins un rush" }, { status: 400 });
  if (kind === "script" && !b.brief?.instructions?.trim()) return NextResponse.json({ error: "Décrivez l'idée de la vidéo" }, { status: 400 });
  const clip = (s: unknown, n: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, n) : undefined);
  const now = new Date().toISOString();
  const projectId = listProjects().some((p) => p.id === b.projectId) ? b.projectId : undefined;
  const styleId = styleOf(projectId, b.styleId);
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind,
    title: clip(b.title, 120) ?? (kind === "script" ? "Texte de prompteur" : "Nouveau montage"),
    projectId,
    ...(styleId ? { styleId } : {}),
    style: projectId && kind === "montage" ? captionsOf(projectId, styleId, getStyle(projectId)) : undefined,
    voice: kind === "script" ? voiceOf(projectId, styleId) : undefined,
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
    ...(cleanModel(b.model) ? { model: cleanModel(b.model) } : {}),
    ...(cleanEffort(b.effort) ? { effort: cleanEffort(b.effort) as ClaudeEffort } : {}),
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
    ...((id) => (id ? { styleId: id } : {}))(styleOf(project?.id, b.styleId)),
    voice: voiceOf(project?.id, styleOf(project?.id, b.styleId)),
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
    ...((id) => (id ? { styleId: id } : {}))(styleOf(project?.id, b.styleId)),
    voice: voiceOf(project?.id, styleOf(project?.id, b.styleId)),
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

/** The voice-over a page asks for: a known provider and a voice id or name. */
function voiceOfBody(raw: unknown): NonNullable<MontageJob["motion"]>["voice"] | undefined {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  if (!v || (v.provider !== "elevenlabs" && v.provider !== "google")) return undefined;
  const voiceId = typeof v.voiceId === "string" ? v.voiceId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(voiceId)) return undefined;
  const name = typeof v.name === "string" ? v.name.replace(/[\0-\x1f]/g, "").trim().slice(0, 100) : "";
  return { provider: v.provider, voiceId, ...(name ? { name } : {}) };
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
  const base = project ? profileOf(project, styleOf(project.id, b.styleId)).look : starterProfile("antoine").look;
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
    ...((id) => (id ? { styleId: id } : {}))(styleOf(project?.id, b.styleId)),
    status: "queued",
    action: "motion",
    brief: { format: "9:16" },
    motion: { scenes, look: stored, logo: b.logo !== false, music: b.music !== false, ...(direction ? { direction } : {}), ...(pace ? { pace } : {}), project: project?.name },
    ...(cleanModel(b.model) ? { model: cleanModel(b.model) } : {}),
    ...(cleanEffort(b.effort) ? { effort: cleanEffort(b.effort) as ClaudeEffort } : {}),
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

/**
 * Asks the Mac for a continuous video reel (worker 0.15.0): Claude writes the whole video from Antoine's request, in
 * the look and the voice of the project. Only a Mac at VIDEO_WORKER or newer can take it (`minWorker`); an older one
 * leaves it waiting, and the page says why.
 */
function videoJob(b: Body) {
  const request = typeof b.request === "string" ? b.request.replace(/\r\n?/g, "\n").trim().slice(0, REEL_VIDEO.request) : "";
  if (request.length < REEL_VIDEO.minRequest) return NextResponse.json({ error: `Écris ta demande (${REEL_VIDEO.minRequest} caractères au moins)` }, { status: 400 });
  const source = REEL_SOURCES.find((s) => s === b.source) ?? "idea";
  // Auto when left out (Claude picks between 15 and 60 s).
  const seconds = REEL_TARGETS.find((t) => t === Number(b.seconds));
  const pace = (["calm", "normal", "fast"] as const).find((p) => p === b.pace);
  const direction = typeof b.direction === "string" ? b.direction.replace(/\r\n?/g, "\n").trim().slice(0, MAX_DIRECTION) : "";
  // Only compared with the names of the Mac's music folder, never joined to a path.
  const track = typeof b.track === "string" ? b.track.trim().slice(0, 200) : "";
  const project = listProjects().find((p) => p.id === b.projectId);
  const base = project ? profileOf(project, styleOf(project.id, b.styleId)).look : starterProfile("antoine").look;
  const look = cleanLook(b.look, base);
  if (typeof look === "string") return NextResponse.json({ error: look }, { status: 400 });
  // The logo stays out of the job (the list of jobs is read every few seconds): the Mac gets it when it takes the job.
  const { logo: _logo, ...stored } = look;
  void _logo;
  const voice = voiceOfBody(b.voice);
  // What a Mac before AUDIO_WORKER cannot do (voice-over, library or composed music): only a newer one takes the job.
  const needsAudio = !!voice || track === GEN_TRACK || !!libTrackId(track);
  // Never under VIDEO_WORKER (the engine new videos are made with); the audio features may only raise it.
  const minWorker = needsAudio && !atLeast(VIDEO_WORKER, AUDIO_WORKER) ? AUDIO_WORKER : VIDEO_WORKER;
  const first = request.split("\n").find((l) => l.trim()) ?? request;
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "motion",
    // Runs of breaking spaces only: the non-breaking ones of French typography (« ? », « 3 h ») stay, as in line().
    title: `Reel animé : ${first.replace(/[^\S   ]+/g, " ").trim().slice(0, 60)}`,
    projectId: project?.id,
    ...((id) => (id ? { styleId: id } : {}))(styleOf(project?.id, b.styleId)),
    status: "queued",
    action: "motion",
    brief: { format: "9:16", ...(seconds ? { seconds } : {}) },
    motion: {
      mode: "video",
      scenes: [],
      request,
      source,
      ...(seconds ? { seconds } : {}),
      ...(pace ? { pace } : {}),
      ...(direction ? { direction } : {}),
      music: b.music !== false,
      ...(track ? { track } : {}),
      ...(voice ? { voice } : {}),
      ...(b.sfx === false ? { sfx: false } : {}),
      logo: b.logo !== false,
      look: stored,
      project: project?.name,
    },
    minWorker,
    ...(cleanModel(b.model) ? { model: cleanModel(b.model) } : {}),
    ...(cleanEffort(b.effort) ? { effort: cleanEffort(b.effort) as ClaudeEffort } : {}),
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

/** Asks the Mac for illustrations or sound effects for the libraries, in the colors of a style. */
function assetJob(b: Body) {
  const kind = b.assetKind === "sfx" ? "sfx" : b.assetKind === "illustration" ? "illustration" : undefined;
  if (!kind) return NextResponse.json({ error: "Bibliothèque inconnue" }, { status: 400 });
  const prompt = typeof b.prompt === "string" ? b.prompt.replace(/\r\n?/g, "\n").trim().slice(0, MAX_ASSET_PROMPT) : "";
  if (!prompt) return NextResponse.json({ error: kind === "sfx" ? "Décris le bruitage" : "Décris l'illustration" }, { status: 400 });
  const count = Math.min(MAX_ASSET_COUNT, Math.max(1, Math.round(Number(b.count) || 1)));
  const project = listProjects().find((p) => p.id === b.projectId);
  const styleId = project ? styleIdOf(project.id, b.styleId) : undefined;
  const style = project ? profileOf(project, styleId) : undefined;
  const look = style?.look;
  const palette = look ? [...new Set([look.accent, ...(look.theme === "custom" ? look.fields.flatMap((f) => [f.bg, f.ink]) : look.theme === "night" ? ["#111418", "#ffffff"] : look.theme === "paper" ? ["#f6f3ec", "#171614"] : [])].map((c) => c.toLowerCase()))] : undefined;
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "asset",
    title: `${kind === "sfx" ? "Bruitage" : "Illustration"} : ${prompt}`.slice(0, 120),
    projectId: project?.id,
    ...(styleId && styleId !== DEFAULT_STYLE ? { styleId } : {}),
    status: "queued",
    action: "asset",
    minWorker: ASSET_WORKER,
    brief: { format: "1:1" },
    asset: {
      kind,
      prompt,
      count,
      styles: project && styleId ? [`${project.id}:${styleId}`] : [],
      ...(palette?.length ? { palette } : {}),
      ...(style ? { style: `${project!.name} · ${style.name}` } : {}),
    },
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

/**
 * Asks the Mac about a style: rules drawn from the review notes Antoine resolved on a montage (mode "rules"), or a new
 * style copied from up to 3 reels (mode "copy": links read with yt-dlp on the Mac, or videos of the Médias library).
 */
function styleJob(b: Body) {
  const project = listProjects().find((p) => p.id === b.projectId);
  if (!project) return NextResponse.json({ error: "Choisis le projet" }, { status: 400 });
  const styleId = styleIdOf(project.id, b.styleId);
  const style = profileOf(project, styleId);
  const now = new Date().toISOString();
  let task: StyleTask;
  let title: string;
  if (b.mode === "rules") {
    const from = typeof b.from === "string" ? listJobs().find((j) => j.id === b.from && j.kind === "montage") : undefined;
    if (!from) return NextResponse.json({ error: "Montage introuvable" }, { status: 400 });
    const ids = Array.isArray(b.noteIds) ? (b.noteIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const notes = listNotes(from.id)
      .filter((n) => n.status === "resolved" && (!ids.length || ids.includes(n.id)) && (n.text.trim() || n.target))
      .slice(0, 30)
      .map((n) => `${n.target ? `[${n.target.label}] ` : ""}${n.text.trim() || "(sans texte)"}`.slice(0, 400));
    if (!notes.length) return NextResponse.json({ error: "Aucun retour résolu avec du texte" }, { status: 400 });
    task = { mode: "rules", styleId, from: from.id, notes, ...(style.notes.trim() ? { current: style.notes.slice(0, 4000) } : {}) };
    title = `Règles du style « ${style.name} »`;
  } else if (b.mode === "copy") {
    const media = listMedia();
    const refs = (Array.isArray(b.refs) ? (b.refs as Record<string, unknown>[]) : [])
      .flatMap((r): NonNullable<StyleTask["refs"]> => {
        if (typeof r?.mediaId === "string") {
          const m = media.find((x) => x.id === r.mediaId);
          return m ? [{ mediaId: m.id, title: m.title.slice(0, 120) }] : [];
        }
        const url = typeof r?.url === "string" ? r.url.trim() : "";
        return /^https:\/\/[^\s"'<>]{4,500}$/.test(url) ? [{ url }] : [];
      })
      .slice(0, MAX_STYLE_REFS);
    if (!refs.length) return NextResponse.json({ error: "Colle au moins un lien de reel, ou choisis une vidéo" }, { status: 400 });
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 40) : "Style copié";
    task = { mode: "copy", styleId, name, refs };
    title = `Copier un style : ${name}`;
  } else return NextResponse.json({ error: "Demande inconnue" }, { status: 400 });
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind: "style",
    title: title.slice(0, 120),
    projectId: project.id,
    ...(styleId !== DEFAULT_STYLE ? { styleId } : {}),
    status: "queued",
    action: "style",
    minWorker: STYLE_WORKER,
    brief: { format: "9:16" },
    styleTask: task,
    rushIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}

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
