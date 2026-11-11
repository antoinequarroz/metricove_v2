// Style profile of a project: the look of its visuals and the voice Claude writes in.
// One profile per project, so every carousel, photo post and text of the project comes out the same.
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
};

export type PresetId = "antoine" | "livrematch" | "carnadzons";

export type StyleProfile = {
  /** The starter style this profile comes from. */
  preset: PresetId;
  look: Look;
  /** How Claude writes for this project: tone, rules, things never to say. */
  tone: string;
  /** Folder of a skill on the Mac (holding a SKILL.md) that Claude reads before writing. Empty for none. */
  skill: string;
  /** What Claude imitates and draws from: model posts, inspiration images, ideas. */
  refs: ProfileRefs;
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
  return { preset: p.id, look: { ...p.look, handle }, tone: p.tone, skill: "", refs: emptyRefs(), saved: false };
};

const LOOK_KEYS = ["theme", "accent", "font", "grid", "pill", "align", "valign", "grain", "numbers", "handle", "logo"] as const;

/** Only the look, from an object that holds more (a deck). */
export function lookOf(from: Look): Look {
  return { theme: from.theme, accent: from.accent, font: from.font, fields: from.fields ?? [], grid: !!from.grid, pill: !!from.pill, align: from.align, valign: from.valign, grain: from.grain, numbers: from.numbers, handle: from.handle, ...(from.logo ? { logo: from.logo } : {}) };
}

const fieldsKey = (l: Look) => (l.fields ?? []).map((f) => `${f.bg}/${f.ink}`.toLowerCase()).join(" ");

export const sameLook = (a: Look, b: Look) =>
  LOOK_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? "") || (k === "accent" && a.accent.toLowerCase() === b.accent.toLowerCase())) && fieldsKey(a) === fieldsKey(b);

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
  };
}
