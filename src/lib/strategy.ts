// Digital strategy of a project and brand guidelines (« charte graphique »), both read by Claude on the Mac.
// No "use client" here: the server checks what the Mac sends back with the same lists.

import type { Look, LookField } from "./profiles";

/** Length of the strategy kept in a profile (Claude gets it with every writing request). */
export const MAX_STRATEGY = 12_000;
/** Documents sent with one reading request (a strategy or a charte). */
export const MAX_SOURCES = 4;
/** One document: under the 10 MB limit of the server. */
export const MAX_SOURCE_BYTES = 9_000_000;
/** Text pasted in place of a document. */
export const MAX_SOURCE_TEXT = 30_000;

export type SourceType = "pdf" | "png" | "jpg" | "webp" | "txt" | "md" | "css" | "html";
export type SourceFile = { id: string; name: string; type: SourceType };

/** What the strategy reading gives back: a summary Claude can follow, ideas, and maybe a tone. */
export type StrategyResult = { strategy: string; ideas: string[]; tone?: string };

/** What the charte reading gives back: a look ready for the profile, and what it is based on. */
export type CharteResult = {
  look: Pick<Look, "theme" | "accent" | "font" | "fields" | "grid" | "align"> & { logo?: string };
  /** Brand colors found, with their name in the charte when it has one. */
  colors: { hex: string; name?: string }[];
  /** Font names found in the charte (the visuals use the closest of their three fonts). */
  fonts: string[];
  tone?: string;
  /** 2 to 4 sentences for Antoine: what was found, what was guessed. */
  notes: string;
};

/** kind "brand": documents, a website or a pasted text that Claude reads for a project. */
export type BrandRequest = {
  mode: "strategy" | "charte";
  project?: string;
  files: SourceFile[];
  url?: string;
  text?: string;
  result?: StrategyResult | CharteResult;
};

export type PlanFormat = "carrousel" | "photo" | "reel" | "facecam" | "texte";
export const PLAN_FORMATS: { value: PlanFormat; label: string }[] = [
  { value: "carrousel", label: "Carrousel" },
  { value: "photo", label: "Post photo" },
  { value: "reel", label: "Reel animé" },
  { value: "facecam", label: "Face caméra" },
  { value: "texte", label: "Texte seul" },
];

export type PlanItem = {
  id: string;
  /** "YYYY-MM-DD" and "HH:MM", local time of Antoine. */
  date: string;
  time: string;
  format: PlanFormat;
  /** The pillar (theme) of the strategy this post serves. */
  pillar: string;
  /** The idea in one line: what the Studio gets. */
  idea: string;
  /** Why this post, in the strategy's terms. */
  why: string;
  /** A first description, to be reworked. */
  caption: string;
  /** Networks this post is meant for (lowercase), among the project's. */
  networks: string[];
};

/** kind "plan": Claude proposes posts for a period from the strategy of the project. */
export type PlanRequest = {
  project?: string;
  /** First day of the period, "YYYY-MM-DD", and its length. */
  from: string;
  days: number;
  count: number;
  formats: PlanFormat[];
  networks: string[];
  accounts: { network: string; handle: string }[];
  /** What Antoine wants this time (a launch, an event); empty for none. */
  focus?: string;
  strategy: string;
  /** Posts already planned or published in and just before the period: Claude avoids the same subjects and days. */
  taken: { date: string; text: string }[];
  result?: { items: PlanItem[]; notes: string };
};

export const PLAN_DAYS = [7, 14, 30] as const;
export const MAX_PLAN_ITEMS = 15;
export const MAX_FOCUS = 500;

const HEX = /^#[0-9a-f]{6}$/i;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, n) : "");

/** A strategy reading sent by the Mac, checked. */
export function cleanStrategyResult(raw: unknown): StrategyResult | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strategy = str(r.strategy, MAX_STRATEGY);
  if (!strategy) return "Résumé de stratégie vide";
  const ideas = (Array.isArray(r.ideas) ? r.ideas : []).map((i) => str(i, 300).replace(/\s+/g, " ")).filter(Boolean).slice(0, 12);
  const tone = str(r.tone, 3000);
  return { strategy, ideas, ...(tone ? { tone } : {}) };
}

const FONTS = ["serif", "sans", "grotesque"] as const;
const THEMES = ["paper", "night", "accent", "gradient", "custom"] as const;
const isLogo = (v: unknown): v is string => typeof v === "string" && v.length <= 400_000 && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(v);

/** A charte reading sent by the Mac, checked. */
export function cleanCharteResult(raw: unknown): CharteResult | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const l = (r.look && typeof r.look === "object" ? r.look : {}) as Record<string, unknown>;
  const fields: LookField[] = (Array.isArray(l.fields) ? l.fields : [])
    .filter((f) => HEX.test(f?.bg) && HEX.test(f?.ink))
    .map((f) => ({ bg: String(f.bg).toLowerCase(), ink: String(f.ink).toLowerCase() }))
    .slice(0, 3);
  const accent = typeof l.accent === "string" && HEX.test(l.accent) ? l.accent.toLowerCase() : "";
  if (!accent && !fields.length) return "Aucune couleur trouvée dans la charte";
  const theme = THEMES.find((t) => t === l.theme) ?? (fields.length ? "custom" : "accent");
  const colors = (Array.isArray(r.colors) ? r.colors : [])
    .filter((c) => HEX.test(c?.hex))
    .map((c) => ({ hex: String(c.hex).toLowerCase(), ...(str(c.name, 40) ? { name: str(c.name, 40) } : {}) }))
    .slice(0, 12);
  return {
    look: {
      theme: theme === "custom" && !fields.length ? "accent" : theme,
      accent: accent || fields[0].bg,
      font: FONTS.find((f) => f === l.font) ?? "sans",
      fields: theme === "custom" ? fields : [],
      grid: l.grid === true,
      align: l.align === "center" ? "center" : "left",
      ...(isLogo(l.logo) ? { logo: l.logo } : {}),
    },
    colors,
    fonts: (Array.isArray(r.fonts) ? r.fonts : []).map((f) => str(f, 60)).filter(Boolean).slice(0, 6),
    ...(str(r.tone, 3000) ? { tone: str(r.tone, 3000) } : {}),
    notes: str(r.notes, 1200),
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The posts Claude proposed, checked against the request. */
export function cleanPlanResult(raw: unknown, req: PlanRequest): PlanRequest["result"] | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const first = new Date(`${req.from}T00:00:00Z`).getTime();
  const last = first + (req.days - 1) * 86_400_000;
  const items: PlanItem[] = [];
  for (const it of (Array.isArray(r.items) ? r.items : []) as Record<string, unknown>[]) {
    const idea = str(it?.idea, 300).replace(/\s+/g, " ");
    if (!idea) continue;
    let date = typeof it.date === "string" && DAY.test(it.date) ? it.date : req.from;
    const t = new Date(`${date}T00:00:00Z`).getTime();
    if (!(t >= first && t <= last)) date = req.from;
    const format = req.formats.find((f) => f === it.format) ?? req.formats[0] ?? "carrousel";
    const networks = (Array.isArray(it.networks) ? it.networks : []).map((n) => String(n).toLowerCase()).filter((n) => req.networks.includes(n));
    items.push({
      id: crypto.randomUUID(),
      date,
      time: typeof it.time === "string" && TIME.test(it.time) ? it.time : "12:00",
      format,
      pillar: str(it.pillar, 60),
      idea,
      why: str(it.why, 400),
      caption: str(it.caption, 3000),
      networks: networks.length ? [...new Set(networks)] : req.networks,
    });
    if (items.length >= MAX_PLAN_ITEMS) break;
  }
  if (!items.length) return "Claude n'a proposé aucun post";
  items.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  return { items, notes: str(r.notes, 1200) };
}
