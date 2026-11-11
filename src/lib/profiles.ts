// Style profile of a project: the look of its visuals and the voice Claude writes in.
// One profile per project, so every carousel, photo post and text of the project comes out the same.
// No "use client" here: the server validates profiles with the same lists.

export type LookTheme = "paper" | "night" | "accent" | "gradient";

/** Everything that makes two visuals look alike (the format and the texts are not part of it). */
export type Look = {
  theme: LookTheme;
  /** Accent color, "#rrggbb". */
  accent: string;
  font: "serif" | "sans";
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
  /** False while the project still uses its starter style untouched. */
  saved: boolean;
};

export const LOOK_THEMES: LookTheme[] = ["paper", "night", "accent", "gradient"];
export const MAX_TONE = 3000;
export const MAX_SKILL = 300;
/** A logo is kept small (the browser shrinks it before sending). */
export const MAX_LOGO = 400_000;

export const PRESETS: { id: PresetId; label: string; hint: string; look: Look; tone: string }[] = [
  {
    id: "antoine",
    label: "AntoineQuarroz",
    hint: "Sombre, orange, texte net",
    look: { theme: "night", accent: "#ff5a1f", font: "sans", align: "left", valign: "middle", grain: true, numbers: true, handle: "" },
    tone: `Antoine parle de développement et d'IA (outils, automatisation, retours d'expérience).
Ton direct, concret, à la première personne, sans jargon inutile.
Sur LinkedIn : une accroche forte en première ligne, des paragraphes courts, une question ou un appel à l'action à la fin.`,
  },
  {
    id: "livrematch",
    label: "LivreMatch",
    hint: "Dégradé violet, texte élégant centré",
    look: { theme: "gradient", accent: "#7c3aed", font: "serif", align: "center", valign: "middle", grain: true, numbers: true, handle: "" },
    tone: `LivreMatch : lecture et recommandations de livres (romantasy, fantasy).
Tutoiement, ton chaleureux et accrocheur.
Ni prix, ni note, ni Amazon. Aucun spoiler au-delà de la 4e de couverture.
Invitation au quiz sur livrematch.fr dans la description.`,
  },
  {
    id: "carnadzons",
    label: "Carnadzons",
    hint: "Couleur vive, texte net centré",
    look: { theme: "accent", accent: "#e11d48", font: "sans", align: "center", valign: "middle", grain: true, numbers: true, handle: "" },
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
  return { preset: p.id, look: { ...p.look, handle }, tone: p.tone, skill: "", saved: false };
};

const LOOK_KEYS = ["theme", "accent", "font", "align", "valign", "grain", "numbers", "handle", "logo"] as const;

/** Only the look, from an object that holds more (a deck). */
export function lookOf(from: Look): Look {
  return { theme: from.theme, accent: from.accent, font: from.font, align: from.align, valign: from.valign, grain: from.grain, numbers: from.numbers, handle: from.handle, ...(from.logo ? { logo: from.logo } : {}) };
}

export const sameLook = (a: Look, b: Look) => LOOK_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? "") || (k === "accent" && a.accent.toLowerCase() === b.accent.toLowerCase()));

const isLogo = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_LOGO && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(v);

/** Keeps what makes sense in a look sent by a browser; the rest comes from `base`. */
export function cleanLook(raw: unknown, base: Look): Look | string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, among: readonly T[], or: T) => (among.includes(v as T) ? (v as T) : or);
  if (r.logo !== undefined && r.logo !== null && r.logo !== "" && !isLogo(r.logo)) return "Logo illisible ou trop lourd";
  const logo = r.logo === undefined ? base.logo : isLogo(r.logo) ? r.logo : undefined;
  return {
    theme: pick(r.theme, LOOK_THEMES, base.theme),
    accent: typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent.toLowerCase() : base.accent,
    font: pick(r.font, ["serif", "sans"] as const, base.font),
    align: pick(r.align, ["left", "center"] as const, base.align),
    valign: pick(r.valign, ["top", "middle", "bottom"] as const, base.valign),
    grain: typeof r.grain === "boolean" ? r.grain : base.grain,
    numbers: typeof r.numbers === "boolean" ? r.numbers : base.numbers,
    handle: typeof r.handle === "string" ? r.handle.replace(/\s+/g, " ").trim().slice(0, 40) : base.handle,
    ...(logo ? { logo } : {}),
  };
}
