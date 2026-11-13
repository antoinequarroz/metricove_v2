"use client";

// Visuals made in the Studio: a carousel (2 to 10 slides) or a single image, drawn on a canvas.
// The same drawing code makes the preview on screen and the 1080-pixel JPEG that is published.

import type { Look, LookField, LookTheme } from "./profiles";

export type VisualFormat = "4:5" | "1:1" | "9:16";
export type ThemeId = LookTheme;

export type Slide = {
  id: string;
  title: string;
  body: string;
  /** Background photo: an address the browser can load (library file or a just-imported file). */
  photo?: string;
  /** Vertical framing of the photo, 0 (top) to 1 (bottom). */
  photoY?: number;
  /** How much the photo is darkened so the text stays readable, 0 to 0.85. */
  dim?: number;
  /** Animated reel only: a motion design instruction; the Mac has Claude write this scene in HyperFrames. */
  anim?: string;
};

/** The look (shared with the style profile of a project), plus what belongs to this post only. */
export type Deck = Look & {
  format: VisualFormat;
  /** The project whose style profile was applied last. */
  profileId?: string;
  /** The active project whose style was applied by itself: it is not applied again over a choice made by hand. */
  autoProject?: string;
  slides: Slide[];
  /** Description of the post, handed to the post editor. */
  caption: string;
};

export const W = 1080;
export const HEIGHTS: Record<VisualFormat, number> = { "4:5": 1350, "1:1": 1080, "9:16": 1920 };
export const MAX_SLIDES = 10;
const LOGO_H = 64;

export const FORMAT_OPTIONS: { value: VisualFormat; label: string; hint: string }[] = [
  { value: "4:5", label: "4:5", hint: "Fil Instagram et Facebook" },
  { value: "1:1", label: "1:1", hint: "Carré" },
  { value: "9:16", label: "9:16", hint: "Story" },
];

export const THEMES: { value: ThemeId; label: string }[] = [
  { value: "paper", label: "Papier" },
  { value: "night", label: "Nuit" },
  { value: "accent", label: "Couleur" },
  { value: "gradient", label: "Dégradé" },
  { value: "custom", label: "Perso" },
];

export const ACCENTS = ["#ff5a1f", "#e11d48", "#7c3aed", "#2563eb", "#0d9488", "#16a34a", "#ca8a04", "#171716"];

export const newSlide = (title = "", body = ""): Slide => ({ id: crypto.randomUUID(), title, body });

export const emptyDeck = (): Deck => ({
  format: "4:5",
  theme: "paper",
  accent: ACCENTS[0],
  font: "serif",
  fields: [],
  grid: false,
  pill: false,
  align: "left",
  valign: "middle",
  grain: true,
  numbers: true,
  handle: "",
  slides: [newSlide("Ton accroche ici", "Une phrase qui donne envie de faire défiler.")],
  caption: "",
});

/* ---------- Colors ---------- */

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0xff5a1f;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (hex: string, to: [number, number, number], t: number) => {
  const [r, g, b] = rgb(hex);
  return `rgb(${Math.round(r + (to[0] - r) * t)}, ${Math.round(g + (to[1] - g) * t)}, ${Math.round(b + (to[2] - b) * t)})`;
};

/** Is white text readable on this color? */
const isDark = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 165;
};

type Palette = { ink: string; sub: string; mark: string };

/** The field of a slide in the "custom" theme: the fields of the brand, taken in turn. */
function fieldOf(deck: Deck, index: number): LookField | undefined {
  if (deck.theme !== "custom") return undefined;
  const fields = deck.fields?.length ? deck.fields : [{ bg: "#15161f", ink: "#f7f5ed" }];
  return fields[index % fields.length];
}

function palette(deck: Deck, onPhoto: boolean, field?: LookField): Palette {
  if (onPhoto) return { ink: "#ffffff", sub: "rgba(255,255,255,0.86)", mark: deck.accent };
  if (field) {
    // A mark the same color as the field would vanish: it takes the color of the text instead.
    const mark = deck.accent.toLowerCase() === field.bg.toLowerCase() ? field.ink : deck.accent;
    return { ink: field.ink, sub: mix(field.ink, rgb(field.bg), 0.3), mark };
  }
  switch (deck.theme) {
    case "night":
      return { ink: "#f6f3ec", sub: "#aaa69c", mark: deck.accent };
    case "accent":
      return isDark(deck.accent) ? { ink: "#ffffff", sub: "rgba(255,255,255,0.84)", mark: "#ffffff" } : { ink: "#171716", sub: "rgba(23,23,22,0.74)", mark: "#171716" };
    case "gradient":
      return { ink: "#ffffff", sub: "rgba(255,255,255,0.84)", mark: "#ffffff" };
    default:
      return { ink: "#1a1917", sub: "#5d5a53", mark: deck.accent };
  }
}

/* ---------- Fonts ---------- */

export type Fonts = { serif: string; sans: string; grotesque: string; manrope: string };

/** The app's own fonts, as the canvas must name them. */
export function appFonts(): Fonts {
  const css = getComputedStyle(document.body);
  const serif = css.getPropertyValue("--font-display-serif").trim();
  const sans = css.getPropertyValue("--font-geist-sans").trim();
  const grotesque = css.getPropertyValue("--font-grotesque").trim();
  const manrope = css.getPropertyValue("--font-manrope").trim();
  const withFallback = (name: string, rest: string) => `${name ? `${name}, ` : ""}${rest}`;
  return {
    serif: withFallback(serif, "Georgia, serif"),
    sans: withFallback(sans, "system-ui, sans-serif"),
    grotesque: withFallback(grotesque, withFallback(sans, "system-ui, sans-serif")),
    manrope: withFallback(manrope, withFallback(sans, "system-ui, sans-serif")),
  };
}

/** Waits until the fonts are ready, so the first drawing does not use a fallback. */
export async function loadFonts(f: Fonts) {
  if (!document.fonts?.load) return;
  const wanted = [`400 80px ${f.serif}`, `400 40px ${f.sans}`, `600 40px ${f.sans}`, `700 80px ${f.sans}`, `700 80px ${f.grotesque}`, `500 40px ${f.manrope}`, `700 40px ${f.manrope}`];
  await Promise.all(wanted.map((font) => document.fonts.load(font))).catch(() => {});
}

/* ---------- Photos ---------- */

const images = new Map<string, HTMLImageElement | "loading" | "failed">();
const waiters = new Map<string, Set<() => void>>();

/** The decoded photo, or undefined while it loads (then every `onReady` given meanwhile is called once). */
export function photoOf(url: string, onReady?: () => void): HTMLImageElement | undefined {
  const hit = images.get(url);
  if (hit && typeof hit !== "string") return hit;
  if (hit === "failed") return undefined;
  if (onReady) {
    let set = waiters.get(url);
    if (!set) waiters.set(url, (set = new Set()));
    set.add(onReady);
  }
  if (hit === undefined) {
    images.set(url, "loading");
    const img = new Image();
    img.decoding = "async";
    const settle = (value: HTMLImageElement | "failed") => {
      images.set(url, value);
      const set = waiters.get(url);
      waiters.delete(url);
      set?.forEach((fn) => fn());
    };
    img.onload = () => settle(img);
    img.onerror = () => settle("failed");
    img.src = url;
  }
  return undefined;
}

export const photoFailed = (url: string) => images.get(url) === "failed";

/** Forgets a failed load, so the next drawing tries again (a library photo after a network hiccup). */
export const retryPhoto = (url: string) => {
  if (images.get(url) === "failed") images.delete(url);
};

function loadPhoto(url: string) {
  return new Promise<void>((resolve) => {
    const hit = images.get(url);
    if (hit && hit !== "loading") return resolve();
    photoOf(url, resolve);
  });
}

/* ---------- Grain ---------- */

let grainTile: HTMLCanvasElement | undefined;

/** A fixed noise tile: the same grain on the preview and on the published image. */
function grain() {
  if (grainTile) return grainTile;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const data = ctx.createImageData(size, size);
  let seed = 20261111;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = seed >>> 24;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return (grainTile = c);
}

/* ---------- Text ---------- */

/**
 * Breaks a text into lines no wider than `max`. Line breaks typed by the user are kept.
 * A word wider than the line on its own (a link, a chain of hashtags) is cut into pieces that fit.
 */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= max) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      while (word.length > 1 && ctx.measureText(word).width > max) {
        let n = word.length - 1;
        while (n > 1 && ctx.measureText(word.slice(0, n)).width > max) n--;
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      line = word;
    }
    lines.push(line);
  }
  // Empty lines at both ends only waste space.
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines;
}

const widest = (ctx: CanvasRenderingContext2D, lines: string[]) => Math.max(0, ...lines.map((l) => ctx.measureText(l).width));

/** Sets the context up to write at a size: the font, and for some fonts the spacing of the letters. */
type Style = (size: number) => void;
type Block = { lines: string[]; size: number; lineHeight: number };

/** The biggest size, from `from` down to `to`, at which the text fits in the box. */
function fit(ctx: CanvasRenderingContext2D, text: string, style: Style, box: { width: number; height: number }, from: number, to: number, leading: number): Block {
  let size = from;
  // A word cut in two is the last resort: the text shrinks first. A word too wide even at the smallest size
  // (a link) is cut anyway, so it must not drag the whole text down.
  style(to);
  const words = text.split(/\s+/).filter((w) => w && ctx.measureText(w).width <= box.width);
  for (;;) {
    style(size);
    const lines = wrap(ctx, text, box.width);
    const lineHeight = Math.round(size * leading);
    const cut = words.some((w) => ctx.measureText(w).width > box.width);
    if (size <= to || (!cut && lines.length * lineHeight <= box.height && widest(ctx, lines) <= box.width)) return { lines, size, lineHeight };
    size -= 4;
  }
}

/** Keeps only the lines that fit in `height`, and ends the last one with "…" when some were dropped. */
function clamp(ctx: CanvasRenderingContext2D, block: Block, style: Style, height: number, width: number): Block {
  const n = Math.max(1, Math.floor(height / block.lineHeight));
  if (block.lines.length <= n) return block;
  style(block.size);
  const lines = block.lines.slice(0, n);
  let last = lines[n - 1].replace(/[\s.,;:!?]+$/, "");
  while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  lines[n - 1] = `${last}…`;
  return { ...block, lines };
}

/** Letter spacing and width of the letters, where the browser's canvas knows them (else the plain font). */
function spacing(ctx: CanvasRenderingContext2D, letter: number, stretch: CanvasFontStretch = "normal") {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${letter.toFixed(2)}px`;
  if ("fontStretch" in ctx) ctx.fontStretch = stretch;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- Drawing ---------- */

/**
 * Draws one slide. The canvas context must already be scaled so that the slide is W wide
 * (and HEIGHTS[deck.format] tall) in its own units.
 */
export function drawSlide(ctx: CanvasRenderingContext2D, deck: Deck, index: number, fonts: Fonts, onPhotoReady?: () => void) {
  const slide = deck.slides[index];
  const H = HEIGHTS[deck.format];
  const total = deck.slides.length;
  const photo = slide?.photo ? photoOf(slide.photo, onPhotoReady) : undefined;
  const field = fieldOf(deck, index);
  const pal = palette(deck, !!photo, field);
  const brand = deck.font === "grotesque";
  ctx.save();
  ctx.textBaseline = "alphabetic";

  // ---- Background ----
  if (photo) {
    const scale = Math.max(W / photo.naturalWidth, H / photo.naturalHeight);
    const w = photo.naturalWidth * scale;
    const h = photo.naturalHeight * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(photo, (W - w) / 2, (H - h) * (slide.photoY ?? 0.5), w, h);
    const hasText = !!(slide.title.trim() || slide.body.trim());
    const dim = slide.dim ?? (hasText ? 0.45 : 0);
    if (dim > 0) {
      ctx.fillStyle = `rgba(12,11,10,${dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  } else if (deck.theme === "gradient") {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, mix(deck.accent, [255, 255, 255], 0.08));
    g.addColorStop(0.55, mix(deck.accent, [0, 0, 0], 0.28));
    g.addColorStop(1, mix(deck.accent, [10, 8, 30], 0.72));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, W * 0.9);
    glow.addColorStop(0, "rgba(255,255,255,0.28)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = field ? field.bg : deck.theme === "night" ? "#151514" : deck.theme === "accent" ? deck.accent : "#f4f1ea";
    ctx.fillRect(0, 0, W, H);
    if (deck.theme !== "accent" && !field) {
      // A soft tint of the accent in a corner, so a plain background is not flat.
      const glow = ctx.createRadialGradient(W * 0.9, 0, 0, W * 0.9, 0, W * 0.95);
      const [r, g, b] = rgb(deck.accent);
      glow.addColorStop(0, `rgba(${r},${g},${b},${deck.theme === "night" ? 0.22 : 0.14})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
  }
  if (deck.grid && !photo) {
    // Fine squared lines in the color of the text, eight squares across.
    const step = W / 8;
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = pal.ink;
    for (let x = step; x < W; x += step) ctx.fillRect(Math.round(x) - 1, 0, 2, H);
    for (let y = step; y < H; y += step) ctx.fillRect(0, Math.round(y) - 1, W, 2);
    ctx.restore();
  }
  if (deck.grain) {
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = ctx.createPattern(grain(), "repeat")!;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---- Small marks: page number, signature, swipe arrow ----
  const pad = 96;
  // A story hides its top and bottom under the app's own buttons.
  const safe = deck.format === "9:16" ? 150 : 0;
  const top = pad + safe;
  const bottom = H - pad - safe;
  const small = brand ? `700 30px ${fonts.manrope}` : `600 30px ${fonts.sans}`;
  spacing(ctx, 0);
  let headRoom = 0;
  let footRoom = 0;
  if (deck.numbers && total > 1) {
    const label = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
    ctx.font = small;
    ctx.textAlign = "left";
    if (deck.pill) {
      // A small label in the accent color, like a tag on a card.
      const w = ctx.measureText(label).width + 44;
      ctx.fillStyle = deck.accent;
      roundRect(ctx, pad, top - 10, w, 54, 27);
      ctx.fill();
      ctx.fillStyle = isDark(deck.accent) ? "#ffffff" : "#15161f";
      ctx.fillText(label, pad + 22, top + 27);
      headRoom = 96;
    } else {
      ctx.fillStyle = pal.sub;
      ctx.fillText(label, pad, top + 24);
      headRoom = 80;
    }
  }
  const handle = deck.handle.trim();
  const logo = deck.logo ? photoOf(deck.logo, onPhotoReady) : undefined;
  let handleX = pad;
  if (logo && logo.naturalHeight > 0) {
    // The logo sits on the signature line, 64 px tall, never wider than 220 px.
    const scale = Math.min(LOGO_H / logo.naturalHeight, 220 / logo.naturalWidth);
    const w = logo.naturalWidth * scale;
    const h = logo.naturalHeight * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logo, pad, bottom - 10 - h / 2, w, h);
    handleX = pad + w + 20;
    footRoom = 96;
  }
  if (handle) {
    ctx.font = small;
    ctx.fillStyle = pal.sub;
    ctx.textAlign = "left";
    ctx.fillText(handle.slice(0, 40), handleX, bottom);
    footRoom = Math.max(footRoom, 80);
  }
  if (total > 1 && index < total - 1) {
    // "Swipe" arrow on every slide but the last.
    const y = bottom - 11;
    const x = W - pad;
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x - 64, y);
    ctx.lineTo(x, y);
    ctx.moveTo(x - 22, y - 20);
    ctx.lineTo(x, y);
    ctx.lineTo(x - 22, y + 20);
    ctx.stroke();
    footRoom = Math.max(footRoom, 80);
  }

  // ---- Title and text ----
  const title = slide?.title.trim() ?? "";
  const body = slide?.body.trim() ?? "";
  if (title || body) {
    const box = { x: pad, y: top + headRoom, width: W - pad * 2, height: bottom - footRoom - (top + headRoom) };
    const mark = title ? 46 : 0;
    const gap = title && body ? 44 : 0;
    // Brand font: tight, slightly narrow titles (as on the site), and Manrope for the texts.
    const titleStyle: Style = (size) => {
      ctx.font = brand ? `700 ${size}px ${fonts.grotesque}` : deck.font === "serif" ? `400 ${size}px ${fonts.serif}` : `700 ${size}px ${fonts.sans}`;
      spacing(ctx, brand ? -0.035 * size : 0, brand ? "semi-condensed" : "normal");
    };
    const bodyStyle: Style = (size) => {
      ctx.font = brand ? `500 ${size}px ${fonts.manrope}` : `400 ${size}px ${fonts.sans}`;
      spacing(ctx, 0);
    };
    const titleFrom = brand ? (title.length > 60 ? 100 : 136) : deck.font === "serif" ? (title.length > 60 ? 112 : 148) : title.length > 60 ? 92 : 124;
    const titleLeading = brand ? 1 : deck.font === "serif" ? 1.04 : 1.1;
    // The text keeps at least a third of the height when there is a title, and the title takes the rest.
    let b0 = body ? fit(ctx, body, bodyStyle, { width: box.width, height: title ? box.height * 0.42 : box.height }, title ? 44 : 64, 30, 1.42) : undefined;
    let bodyH = b0 ? b0.lines.length * b0.lineHeight : 0;
    let t0 = title ? fit(ctx, title, titleStyle, { width: box.width, height: box.height - bodyH - gap - mark }, titleFrom, 48, titleLeading) : undefined;
    // Texts too long even at the smallest size are cut with "…" instead of running over the edge.
    if (t0) t0 = clamp(ctx, t0, titleStyle, body ? box.height * 0.5 - mark : box.height - mark, box.width);
    const titleH = t0 ? t0.lines.length * t0.lineHeight : 0;
    if (b0) {
      b0 = clamp(ctx, b0, bodyStyle, box.height - mark - titleH - gap, box.width);
      bodyH = b0.lines.length * b0.lineHeight;
    }
    const blockH = mark + titleH + gap + bodyH;
    let y = deck.valign === "top" ? box.y : deck.valign === "bottom" ? box.y + box.height - blockH : box.y + (box.height - blockH) / 2;
    y = Math.max(box.y, y);
    const center = deck.align === "center";
    const x = center ? W / 2 : box.x;
    ctx.textAlign = center ? "center" : "left";
    if (t0) {
      ctx.fillStyle = pal.mark;
      ctx.fillRect(center ? W / 2 - 44 : box.x, y, 88, 10);
      y += mark;
      titleStyle(t0.size);
      ctx.fillStyle = pal.ink;
      for (const line of t0.lines) {
        ctx.fillText(line, x, y + t0.size * 0.86);
        y += t0.lineHeight;
      }
      y += gap;
    }
    if (b0) {
      bodyStyle(b0.size);
      ctx.fillStyle = title ? pal.sub : pal.ink;
      for (const line of b0.lines) {
        ctx.fillText(line, x, y + b0.size * 0.9);
        y += b0.lineHeight;
      }
    }
  }
  ctx.restore();
}

/** One slide as the JPEG that is published (1080 pixels wide). */
export async function renderSlide(deck: Deck, index: number, fonts: Fonts): Promise<Blob> {
  const photo = deck.slides[index]?.photo;
  if (photo) {
    await loadPhoto(photo);
    if (photoFailed(photo)) throw new Error(`La photo du visuel ${index + 1} ne se charge plus : remets-la.`);
  }
  // A logo that no longer loads is simply left out: it must not block a post.
  if (deck.logo) await loadPhoto(deck.logo);
  await loadFonts(fonts);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = HEIGHTS[deck.format];
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Dessin impossible dans ce navigateur");
  drawSlide(ctx, deck, index, fonts);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Création de l'image impossible"))), "image/jpeg", 0.93));
}

/* ---------- Draft kept in the browser ---------- */

const KEYS = { visuals: "metricove-visuals-v1", motion: "metricove-reel-v1" };
export type DraftKind = keyof typeof KEYS;
/** The deck being edited, per editor. It outlives a visit to another page of the app, imported photos included. */
const live: Partial<Record<DraftKind, Deck>> = {};

export function loadDraft(kind: DraftKind = "visuals"): Deck | undefined {
  if (live[kind]) return live[kind];
  try {
    const raw = localStorage.getItem(KEYS[kind]);
    if (!raw) return undefined;
    const d = JSON.parse(raw) as Partial<Deck>;
    if (!Array.isArray(d.slides) || !d.slides.length) return undefined;
    const base = emptyDeck();
    return {
      ...base,
      ...d,
      format: d.format && d.format in HEIGHTS ? d.format : base.format,
      theme: THEMES.some((t) => t.value === d.theme) ? d.theme! : base.theme,
      accent: /^#[0-9a-f]{6}$/i.test(d.accent ?? "") ? d.accent! : base.accent,
      logo: typeof d.logo === "string" && d.logo.startsWith("data:image/") ? d.logo : undefined,
      profileId: typeof d.profileId === "string" ? d.profileId : undefined,
      autoProject: typeof d.autoProject === "string" ? d.autoProject : undefined,
      slides: d.slides.slice(0, MAX_SLIDES).map((s) => ({ ...newSlide(String(s.title ?? ""), String(s.body ?? "")), photo: typeof s.photo === "string" ? s.photo : undefined, photoY: s.photoY, dim: s.dim, anim: typeof s.anim === "string" ? s.anim.slice(0, 300) : undefined })),
      caption: String(d.caption ?? ""),
    };
  } catch {
    return undefined;
  }
}

export function saveDraft(deck: Deck, kind: DraftKind = "visuals") {
  live[kind] = deck;
  try {
    // A photo imported from the disk only lives in this tab: it is not kept. Library photos are.
    const slides = deck.slides.map((s) => ({ ...s, photo: s.photo?.startsWith("/api/") ? s.photo : undefined }));
    localStorage.setItem(KEYS[kind], JSON.stringify({ ...deck, slides }));
  } catch {
    // Private window or full storage: the draft simply is not kept.
  }
}
