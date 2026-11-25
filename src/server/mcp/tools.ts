import "server-only";
import type { Account, Media, Post, PostStatus, Project } from "@/lib/types";
import { getPost, listAccounts, listMedia, listPosts, listProjects } from "../db";
import { getStats } from "../stats";

/**
 * The tools of the MCP server. Read only: an agent can look at the calendar, the accounts, the posts,
 * the library and the numbers, but never changes or publishes anything.
 */

type Args = Record<string, unknown>;
type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
export type Tool = { name: string; title: string; description: string; inputSchema: Schema; run: (args: Args) => unknown };

/** The agent's mistake: told back as a tool result so it can try again. */
export class ToolError extends Error {}

/** Days are cut in Antoine's time zone, not the server's. */
const TIME_ZONE = process.env.APP_TIMEZONE || "Europe/Zurich";
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const localTime = (iso: string) => new Intl.DateTimeFormat("fr-CH", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const STATUSES: PostStatus[] = ["draft", "scheduled", "publishing", "published", "failed"];
const NETWORKS = ["instagram", "facebook", "x", "linkedin", "youtube", "tiktok"];

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const int = (v: unknown, def: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Keeps a post when it falls between from and to, both inclusive. A bound "2026-11-25" is a whole
 * local day (a post at 23:30 in Zurich stays on its day); a full ISO date is an instant.
 */
function inRange(iso: string, fromRaw: unknown, toRaw: unknown): boolean {
  const day = dayOf(iso);
  const t = Date.parse(iso);
  const check = (raw: unknown, end: boolean) => {
    const s = str(raw);
    if (!s) return true;
    if (DAY.test(s)) return end ? day <= s : day >= s;
    const b = Date.parse(s);
    if (Number.isNaN(b)) throw new ToolError(`Date illisible : ${s}. Donne "AAAA-MM-JJ" ou une date ISO.`);
    return end ? t <= b : t >= b;
  };
  return check(fromRaw, false) && check(toRaw, true);
}

type Ctx = { accounts: Map<string, Account>; media: Map<string, Media>; projects: Project[] };
const ctx = (): Ctx => ({ accounts: new Map(listAccounts().map((a) => [a.id, a])), media: new Map(listMedia().map((m) => [m.id, m])), projects: listProjects() });

const accountLabel = (a: Account | undefined, id: string) => (a ? `${a.network} ${a.handle.startsWith("@") ? a.handle : `@${a.handle}`}` : `compte supprimé (${id})`);

/** Finds accounts by id, handle (with or without @), name or network. */
function matchAccounts(c: Ctx, query: string): Set<string> {
  const q = query.toLowerCase().replace(/^@/, "");
  const ids = [...c.accounts.values()].filter((a) => a.id === query || a.network === q || a.handle.toLowerCase().replace(/^@/, "") === q || a.name.toLowerCase() === q).map((a) => a.id);
  if (!ids.length) throw new ToolError(`Aucun compte ne correspond à « ${query} ». Utilise list_accounts pour voir les comptes.`);
  return new Set(ids);
}

function matchProject(c: Ctx, query: string): Project {
  const p = c.projects.find((x) => x.id === query || x.name.toLowerCase() === query.toLowerCase());
  if (!p) throw new ToolError(`Aucun projet « ${query} ». Projets : ${c.projects.map((x) => x.name).join(", ") || "aucun"}.`);
  return p;
}

function mediaSummary(m: Media | undefined, id: string) {
  if (!m) return { id, missing: true };
  return { id: m.id, title: m.title, kind: m.kind, aspect: m.aspect, duration: m.duration || undefined };
}

/** A post as an agent wants to read it: accounts and media by name, local day and time. */
function showPost(p: Post, c: Ctx, full = false) {
  const mediaIds = p.mediaIds ?? (p.mediaId ? [p.mediaId] : []);
  const failed = Object.entries(p.results ?? {}).filter(([, r]) => r.status === "failed");
  return {
    id: p.id,
    status: p.status,
    scheduledAt: p.scheduledAt,
    day: dayOf(p.scheduledAt),
    time: localTime(p.scheduledAt),
    accounts: p.accountIds.map((id) => accountLabel(c.accounts.get(id), id)),
    format: p.format ?? "feed",
    caption: full || p.caption.length <= 280 ? p.caption : `${p.caption.slice(0, 280)}…`,
    media: mediaIds.map((id) => mediaSummary(c.media.get(id), id)),
    origin: p.origin,
    ...(p.youtube ? { youtube: p.youtube } : {}),
    ...(p.error ? { error: p.error } : {}),
    ...(failed.length ? { failedOn: failed.map(([id, r]) => ({ account: accountLabel(c.accounts.get(id), id), error: r.error })) } : {}),
    ...(full && p.results ? { results: Object.fromEntries(Object.entries(p.results).map(([id, r]) => [accountLabel(c.accounts.get(id), id), r])) } : {}),
  };
}

/** Posts filtered by the common arguments of list_posts and get_calendar. */
function filterPosts(args: Args, c: Ctx): Post[] {
  const status = str(args.status);
  if (status && !STATUSES.includes(status as PostStatus)) throw new ToolError(`Statut inconnu : ${status}. Valeurs : ${STATUSES.join(", ")}.`);
  const account = str(args.account);
  const project = str(args.project);
  const search = str(args.search)?.toLowerCase();
  const accountIds = account ? matchAccounts(c, account) : undefined;
  const projectIds = project ? new Set(matchProject(c, project).accountIds) : undefined;
  return listPosts().filter(
    (p) =>
      (!status || p.status === status) &&
      (!accountIds || p.accountIds.some((id) => accountIds.has(id))) &&
      (!projectIds || p.accountIds.some((id) => projectIds.has(id))) &&
      (!search || p.caption.toLowerCase().includes(search)) &&
      inRange(p.scheduledAt, args.from, args.to),
  );
}

const filterProps = {
  from: { type: "string", description: 'Début, inclus : "AAAA-MM-JJ" (jour local) ou date ISO.' },
  to: { type: "string", description: 'Fin, incluse : "AAAA-MM-JJ" (jour local) ou date ISO.' },
  status: { type: "string", enum: STATUSES, description: "draft (brouillon), scheduled (programmé), publishing, published (publié), failed (échec)." },
  account: { type: "string", description: `Un compte : handle (@livrematch), nom, id, ou un réseau (${NETWORKS.join(", ")}).` },
  project: { type: "string", description: "Un projet (groupe de comptes), par nom ou id." },
  search: { type: "string", description: "Texte cherché dans la légende." },
};

const today = () => dayOf(new Date().toISOString());
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const TOOLS: Tool[] = [
  {
    name: "list_accounts",
    title: "Comptes",
    description: "Les comptes de réseaux sociaux branchés à Metricove (Instagram, TikTok, YouTube…), avec leurs abonnés et les projets dont ils font partie.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => {
      const c = ctx();
      return [...c.accounts.values()].map((a) => ({
        id: a.id,
        network: a.network,
        name: a.name,
        handle: a.handle,
        followers: a.followers,
        connected: a.connected,
        projects: c.projects.filter((p) => p.accountIds.includes(a.id)).map((p) => p.name),
      }));
    },
  },
  {
    name: "list_projects",
    title: "Projets",
    description: "Les projets : des groupes de comptes, par exemple une marque ou un site (LivreMatch…).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => {
      const c = ctx();
      return c.projects.map((p) => ({ id: p.id, name: p.name, accounts: p.accountIds.map((id) => accountLabel(c.accounts.get(id), id)) }));
    },
  },
  {
    name: "get_calendar",
    title: "Calendrier",
    description: `Le calendrier éditorial jour par jour (fuseau ${TIME_ZONE}). Sans dates : d'aujourd'hui à dans 14 jours. Chaque jour liste ses posts avec l'heure, les comptes, le statut et le début de la légende.`,
    inputSchema: { type: "object", properties: filterProps, additionalProperties: false },
    run: (args) => {
      const c = ctx();
      const from = str(args.from) ?? today();
      const to = str(args.to) ?? addDays(DAY.test(from) ? from : dayOf(from), 14);
      const posts = filterPosts({ ...args, from, to }, c);
      const days: Record<string, ReturnType<typeof showPost>[]> = {};
      for (const p of posts) (days[dayOf(p.scheduledAt)] ??= []).push(showPost(p, c));
      return { timeZone: TIME_ZONE, from, to, total: posts.length, days };
    },
  },
  {
    name: "list_posts",
    title: "Posts",
    description: "Cherche des posts (brouillons, programmés, publiés, en échec) par dates, statut, compte, projet ou texte. Les plus proches de la date d'abord, 50 par défaut.",
    inputSchema: {
      type: "object",
      properties: { ...filterProps, limit: { type: "number", description: "Nombre maximum de posts (50 par défaut, 200 au plus)." } },
      additionalProperties: false,
    },
    run: (args) => {
      const c = ctx();
      const posts = filterPosts(args, c);
      const limit = int(args.limit, 50, 200);
      return { total: posts.length, shown: Math.min(limit, posts.length), posts: posts.slice(0, limit).map((p) => showPost(p, c)) };
    },
  },
  {
    name: "get_post",
    title: "Un post",
    description: "Tout un post : légende entière, médias, options YouTube, et le résultat de la publication sur chaque compte.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "L'id du post (donné par list_posts ou get_calendar)." } }, required: ["id"], additionalProperties: false },
    run: (args) => {
      const id = str(args.id);
      const p = id && getPost(id);
      if (!p) throw new ToolError(`Aucun post avec l'id ${id ?? "(vide)"}.`);
      return showPost(p, ctx(), true);
    },
  },
  {
    name: "list_media",
    title: "Médiathèque",
    description: "Les vidéos et photos de la médiathèque, les plus récentes d'abord, avec les posts qui les utilisent.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Nombre maximum (50 par défaut, 200 au plus)." } }, additionalProperties: false },
    run: (args) => {
      const posts = listPosts();
      return listMedia()
        .slice(0, int(args.limit, 50, 200))
        .map((m) => ({ ...mediaSummary(m, m.id), source: m.source, createdAt: m.createdAt, usedBy: posts.filter((p) => (p.mediaIds ?? [p.mediaId]).includes(m.id)).map((p) => p.id) }));
    },
  },
  {
    name: "get_stats",
    title: "Statistiques",
    description: "Les chiffres lus sur les réseaux : abonnés, vues, portée et interactions par compte, et les posts publiés avec leurs vues, likes, commentaires, partages et enregistrements.",
    inputSchema: {
      type: "object",
      properties: { account: filterProps.account, limit: { type: "number", description: "Nombre maximum de posts (30 par défaut, 200 au plus), les plus récents d'abord." } },
      additionalProperties: false,
    },
    run: (args) => {
      const c = ctx();
      const account = str(args.account);
      const ids = account ? matchAccounts(c, account) : undefined;
      const s = getStats();
      const keep = (id: string) => !ids || ids.has(id);
      return {
        available: s.available,
        accounts: s.accounts.filter((a) => keep(a.accountId)).map(({ accountId, ...rest }) => ({ account: accountLabel(c.accounts.get(accountId), accountId), ...rest })),
        posts: s.posts
          .filter((p) => keep(p.accountId))
          .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
          .slice(0, int(args.limit, 30, 200))
          .map(({ accountId, ...rest }) => {
            delete rest.thumb; // A signed picture address: of no use to an agent.
            return { account: accountLabel(c.accounts.get(accountId), accountId), ...rest };
          }),
      };
    },
  },
];

export const toolByName = (name: unknown) => TOOLS.find((t) => t.name === name);
