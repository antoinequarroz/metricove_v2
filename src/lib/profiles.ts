// Style profile of a project: the look of its visuals and the voice Claude writes in.
// A project has a default style and may have others (a podcast, clips…): every carousel, photo post, text
// and video made with one style comes out the same.
// No "use client" here: the server validates profiles with the same lists.

export type LookTheme = "paper" | "night" | "accent" | "gradient" | "custom";

/** A flat background and the color of the text written on it, "#rrggbb" both. */
export type LookField = { bg: string; ink: string };

/** Everything that makes two visuals look alike (the format and the texts are not part of it). */
export type Look = {
  theme: LookTheme;
  /** Accent color, "#rrggbb". */
  accent: string;
  /** "grotesque": Bricolage Grotesque titles with Manrope texts. */
  font: "serif" | "sans" | "grotesque";
  /** Theme "custom": the fields of the brand (1 to 3). The visuals take them in turn. */
  fields: LookField[];
  /** Fine squared lines over a plain background. */
  grid: boolean;
  /** Page numbers in a small colored label. */
  pill: boolean;
  align: "left" | "center";
  valign: "top" | "middle" | "bottom";
  grain: boolean;
  numbers: boolean;
  /** Small signature at the bottom, e.g. "@livrematchfr". Empty for none. */
  handle: string;
  /** Small logo next to the signature: a "data:image/…" address. */
  logo?: string;
  /** How the edited videos of this style look (subtitles, opening hook, cards). Absent: the Mac's default look. */
  video?: VideoLook;
};

/**
 * The look of a style on video: what makes a creator's reels recognisable (font, case, outline or box behind the
 * subtitles, where they sit, the opening hook). Copied from reels by « Copier un créateur », or set by hand.
 */
export type VideoLook = {
  /** A Google Fonts family, e.g. "Montserrat" or "Bebas Neue". Empty: the font of the look. */
  font?: string;
  /** 400 to 900. */
  weight?: number;
  upper?: boolean;
  /** Color of the subtitle words (hex). */
  text?: string;
  /** Outline around the letters, in px at 1080 wide (0 = none), and its color. */
  stroke?: number;
  strokeColor?: string;
  /** A colored box behind the whole line, behind the spoken word only, or none. */
  box?: "none" | "line" | "word";
  boxColor?: string;
  /** Soft shadow under the letters. */
  shadow?: boolean;
  /** Opening hook: colored band (Metricove's), big plain text, or a white box. */
  hook?: "band" | "text" | "box";
  /** Subtitles: where, how they appear, how big, color of the key words. */
  position?: "auto" | "bottom" | "middle" | "top";
  anim?: "karaoke" | "pop" | "simple";
  size?: "s" | "m" | "l";
  highlight?: string;
  /** Background of the full-screen cards and the end card (hex). */
  card?: string;
};

export const VIDEO_FONT = /^[A-Za-z0-9 ]{2,40}$/;
export const VIDEO_HOOKS = [
  { value: "band", label: "Bandeau couleur" },
  { value: "text", label: "Gros texte" },
  { value: "box", label: "Cadre blanc" },
] as const;

export type PresetId = "antoine" | "livrematch" | "carnadzons";

export type StyleProfile = {
  /** "default" for the project's main style, else the id of another style of the project. */
  id: string;
  /** Name shown on the style's card, e.g. "Podcast". */
  name: string;
  /** Rules learned along the way, one per line: Claude follows them for everything made with this style. */
  notes: string;
  /** The starter style this profile comes from. */
  preset: PresetId;
  look: Look;
  /** How Claude writes for this project: tone, rules, things never to say. */
  tone: string;
  /** Folder of a skill on the Mac (holding a SKILL.md) that Claude reads before writing. Empty for none. */
  skill: string;
  /** The digital strategy of the project (audience, pillars, rhythm, goals): Claude plans and writes from it. Empty for none. */
  strategy: string;
  /** Name of the document the strategy was read from, when it came from one. */
  strategySource?: string;
  /** What Claude imitates and draws from: model posts, inspiration images, ideas. */
  refs: ProfileRefs;
  /** True once Antoine chose the look himself (it differs from the starter style): only then it dresses the videos. */
  lookSet?: boolean;
  /** False while the project still uses its starter style untouched. */
  saved: boolean;
};

export type ProfileRefs = {
  /** Posts of the project that worked: Claude imitates their structure and tone. */
  examples: { id: string; text: string }[];
  /** Post ideas waiting for their turn. */
  ideas: { id: string; text: string }[];
  /** Inspiration images (screenshots of carousels, visuals): Claude looks at them on the Mac. Files live on the server. */
  images: { id: string; name: string }[];
};

/** Id of the main style of every project (kept where the single profile always lived). */
export const DEFAULT_STYLE = "default";
/** Styles a project may have, the default one included. */
export const MAX_STYLES = 12;
export const MAX_STYLE_NAME = 40;
export const MAX_NOTES = 4000;
export const STYLE_ID = /^[a-z0-9]{6,16}$/;
/** The rules of a style, one per non-empty line (a leading "-" or "•" is dropped). */
export const noteLines = (notes: string) =>
  notes
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);

export const emptyRefs = (): ProfileRefs => ({ examples: [], ideas: [], images: [] });
export const MAX_EXAMPLES = 8;
export const MAX_EXAMPLE = 3000;
export const MAX_IDEAS = 50;
export const MAX_IDEA = 300;
export const MAX_REF_IMAGES = 6;
/** An inspiration image is shrunk by the browser before it is sent. */
export const MAX_REF_IMAGE_BYTES = 1_500_000;

const cleanList = (raw: unknown, max: number, length: number) => {
  const seen = new Set<string>();
  const out: { id: string; text: string }[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const text = typeof item?.text === "string" ? item.text.replace(/\r\n?/g, "\n").trim().slice(0, length) : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const id = typeof item?.id === "string" && /^[\w-]{1,40}$/.test(item.id) && !out.some((o) => o.id === item.id) ? item.id : crypto.randomUUID();
    out.push({ id, text });
    if (out.length >= max) break;
  }
  return out;
};

/** The model posts and the ideas a browser sent; the images are only changed by their own routes. */
export function cleanRefs(raw: unknown, base: ProfileRefs): ProfileRefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    examples: r.examples === undefined ? base.examples : cleanList(r.examples, MAX_EXAMPLES, MAX_EXAMPLE),
    ideas: r.ideas === undefined ? base.ideas : cleanList(r.ideas, MAX_IDEAS, MAX_IDEA),
    images: base.images,
  };
}

export const sameTexts = (a: { text: string }[], b: { text: string }[]) => a.length === b.length && a.every((x, i) => x.text === b[i].text);

export const LOOK_THEMES: LookTheme[] = ["paper", "night", "accent", "gradient", "custom"];
export const MAX_FIELDS = 3;
export const DEFAULT_FIELD: LookField = { bg: "#15161f", ink: "#f7f5ed" };
export const MAX_TONE = 3000;
export const MAX_SKILL = 300;
/** A logo is kept small (the browser shrinks it before sending). */
export const MAX_LOGO = 400_000;

export const PRESETS: { id: PresetId; label: string; hint: string; look: Look; tone: string }[] = [
  {
    id: "antoine",
    label: "AntoineQuarroz",
    hint: "Sombre, orange, texte net",
    look: { theme: "night", accent: "#ff5a1f", font: "sans", fields: [], grid: false, pill: false, align: "left", valign: "middle", grain: true, numbers: true, handle: "" },
    tone: `Antoine parle de développement et d'IA (outils, automatisation, retours d'expérience).
Ton direct, concret, à la première personne, sans jargon inutile.
Sur LinkedIn : une accroche forte en première ligne, des paragraphes courts, une question ou un appel à l'action à la fin.`,
  },
  {
    id: "livrematch",
    label: "LivreMatch",
    hint: "Bleu nuit, jaune et papier, corail, Bricolage Grotesque",
    // The design system of livrematch.fr: night, sun and paper fields, coral marks, squared lines.
    look: {
      theme: "custom",
      accent: "#ff6a5b",
      font: "grotesque",
      fields: [
        { bg: "#15161f", ink: "#f7f5ed" },
        { bg: "#f3f45b", ink: "#15161f" },
        { bg: "#f7f5ed", ink: "#15161f" },
      ],
      grid: true,
      pill: true,
      align: "left",
      valign: "middle",
      grain: false,
      numbers: true,
      handle: "",
    },
    tone: `LivreMatch : lecture et recommandations de livres (romantasy, fantasy).
Tutoiement, ton chaleureux et accrocheur.
Ni prix, ni note, ni Amazon. Aucun spoiler au-delà de la 4e de couverture.
Invitation au quiz sur livrematch.fr dans la description.`,
  },
  {
    id: "carnadzons",
    label: "Carnadzons",
    hint: "Couleur vive, texte net centré",
    look: { theme: "accent", accent: "#e11d48", font: "sans", fields: [], grid: false, pill: false, align: "center", valign: "middle", grain: true, numbers: true, handle: "" },
    tone: `Carnadzons : ton festif, chaleureux et convivial, à la première personne du pluriel (nous).
Phrases courtes, énergie, humour léger.
Ne jamais inventer une date, un lieu ou un programme : uniquement ce qui est donné.`,
  },
];

export const presetOf = (id: string | undefined) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** The starter style that fits a project, from its name. */
export function presetFor(projectName: string): PresetId {
  if (/livre ?match/i.test(projectName)) return "livrematch";
  if (/carna/i.test(projectName)) return "carnadzons";
  return "antoine";
}

export const starterProfile = (preset: PresetId, handle = ""): StyleProfile => {
  const p = presetOf(preset);
  return { id: DEFAULT_STYLE, name: "Principal", notes: "", preset: p.id, look: { ...p.look, handle }, tone: p.tone, skill: "", strategy: "", refs: emptyRefs(), saved: false };
};

const LOOK_KEYS = ["theme", "accent", "font", "grid", "pill", "align", "valign", "grain", "numbers", "handle", "logo"] as const;
const videoKey = (l: Look) => JSON.stringify(l.video ?? {});

/** Only the look, from an object that holds more (a deck). */
export function lookOf(from: Look): Look {
  return { theme: from.theme, accent: from.accent, font: from.font, fields: from.fields ?? [], grid: !!from.grid, pill: !!from.pill, align: from.align, valign: from.valign, grain: from.grain, numbers: from.numbers, handle: from.handle, ...(from.logo ? { logo: from.logo } : {}), ...(from.video ? { video: from.video } : {}) };
}

const fieldsKey = (l: Look) => (l.fields ?? []).map((f) => `${f.bg}/${f.ink}`.toLowerCase()).join(" ");

export const sameLook = (a: Look, b: Look) =>
  LOOK_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? "") || (k === "accent" && a.accent.toLowerCase() === b.accent.toLowerCase())) && fieldsKey(a) === fieldsKey(b) && videoKey(a) === videoKey(b);

// An SVG logo is only ever shown as an image (never put in the page as markup), where it cannot run a script.
const isLogo = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_LOGO && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(v);
const HEX = /^#[0-9a-f]{6}$/i;

function cleanFields(raw: unknown, base: LookField[]): LookField[] {
  if (!Array.isArray(raw)) return base;
  return raw
    .filter((f) => typeof f?.bg === "string" && HEX.test(f.bg) && typeof f?.ink === "string" && HEX.test(f.ink))
    .map((f) => ({ bg: f.bg.toLowerCase(), ink: f.ink.toLowerCase() }))
    .slice(0, MAX_FIELDS);
}

/** Keeps what makes sense in a look sent by a browser; the rest comes from `base`. */
export function cleanLook(raw: unknown, base: Look): Look | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, among: readonly T[], or: T) => (among.includes(v as T) ? (v as T) : or);
  if (r.logo !== undefined && r.logo !== null && r.logo !== "" && !isLogo(r.logo)) return "Logo illisible ou trop lourd";
  const logo = r.logo === undefined ? base.logo : isLogo(r.logo) ? r.logo : undefined;
  const theme = pick(r.theme, LOOK_THEMES, base.theme);
  const fields = cleanFields(r.fields, base.fields ?? []);
  return {
    theme,
    accent: typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent.toLowerCase() : base.accent,
    font: pick(r.font, ["serif", "sans", "grotesque"] as const, base.font),
    fields: theme === "custom" && !fields.length ? [DEFAULT_FIELD] : fields,
    grid: typeof r.grid === "boolean" ? r.grid : !!base.grid,
    pill: typeof r.pill === "boolean" ? r.pill : !!base.pill,
    align: pick(r.align, ["left", "center"] as const, base.align),
    valign: pick(r.valign, ["top", "middle", "bottom"] as const, base.valign),
    grain: typeof r.grain === "boolean" ? r.grain : base.grain,
    numbers: typeof r.numbers === "boolean" ? r.numbers : base.numbers,
    handle: typeof r.handle === "string" ? r.handle.replace(/\s+/g, " ").trim().slice(0, 40) : base.handle,
    ...(logo ? { logo } : {}),
    ...(() => {
      const video = r.video === undefined ? base.video : r.video === null ? undefined : cleanVideoLook(r.video);
      return video ? { video } : {};
    })(),
  };
}

/** A video look sent by a browser or by the Mac: what is not valid is dropped. `undefined` when nothing is left. */
export function cleanVideoLook(raw: unknown): VideoLook | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const hex = (v: unknown) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined);
  const among = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : undefined);
  const font = typeof r.font === "string" ? r.font.replace(/\s+/g, " ").trim() : "";
  const v: VideoLook = {
    ...(VIDEO_FONT.test(font) ? { font } : {}),
    ...(typeof r.weight === "number" && r.weight >= 100 && r.weight <= 900 ? { weight: Math.round(r.weight / 100) * 100 } : {}),
    ...(typeof r.upper === "boolean" ? { upper: r.upper } : {}),
    ...(hex(r.text) ? { text: hex(r.text) } : {}),
    ...(typeof r.stroke === "number" && r.stroke >= 0 && r.stroke <= 16 ? { stroke: Math.round(r.stroke) } : {}),
    ...(hex(r.strokeColor) ? { strokeColor: hex(r.strokeColor) } : {}),
    ...(among(r.box, ["none", "line", "word"] as const) ? { box: r.box as VideoLook["box"] } : {}),
    ...(hex(r.boxColor) ? { boxColor: hex(r.boxColor) } : {}),
    ...(typeof r.shadow === "boolean" ? { shadow: r.shadow } : {}),
    ...(among(r.hook, ["band", "text", "box"] as const) ? { hook: r.hook as VideoLook["hook"] } : {}),
    ...(among(r.position, ["auto", "bottom", "middle", "top"] as const) ? { position: r.position as VideoLook["position"] } : {}),
    ...(among(r.anim, ["karaoke", "pop", "simple"] as const) ? { anim: r.anim as VideoLook["anim"] } : {}),
    ...(among(r.size, ["s", "m", "l"] as const) ? { size: r.size as VideoLook["size"] } : {}),
    ...(hex(r.highlight) ? { highlight: hex(r.highlight) } : {}),
    ...(hex(r.card) ? { card: hex(r.card) } : {}),
  };
  return Object.keys(v).length ? v : undefined;
}
