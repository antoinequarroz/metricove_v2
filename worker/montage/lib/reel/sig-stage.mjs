// Moteur « Signature » (engine 2), côté Node : la bibliothèque de scènes d'un reel marketing.
// Node est le chorégraphe : il décide de TOUS les instants (mots qui tombent, items, tapes du doigt, swipes, tampon,
// transitions), posés sur la grille du tempo de la musique (fpb images par temps), et en tire les bruitages. Chrome
// (sig-runtime.js, copié dans assets/sig.js) est la scène : il mesure, place et anime aux instants reçus. Les textes
// passent en JSON (assets/score.js) puis en textContent : aucune chaîne du plan n'entre dans le HTML.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { home, log } from "../util.mjs";
import { colors } from "../motion.mjs";
import { CSP, bigNumber, copyFonts, gsapCore, GSAP_MISSING, grainPng, logoOf, mulberry32, safeJson, tokens, words } from "./stage.mjs";
import { bare, commonWord, fpbOf, timeScore } from "./score.mjs";
import { FPB, FPS, GSAP, H, W } from "./vocab.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const r3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Les plugins GSAP de la bibliothèque (tous dans le paquet gsap 3.14 installé par --setup-reel). Sans l'un d'eux, la
 * scène qui s'en sert joue une version plus simple. */
export const SIG_PLUGINS = Object.freeze([
  { name: "CustomEase", file: "CustomEase.min.js" },
  { name: "DrawSVGPlugin", file: "DrawSVGPlugin.min.js" },
  { name: "MorphSVGPlugin", file: "MorphSVGPlugin.min.js" },
  { name: "Physics2DPlugin", file: "Physics2DPlugin.min.js" },
]);

/** Les axes variables de la police des titres (fichiers de Google Fonts) : l'accroche « gonfle » ses lettres. */
const VF = { grotesque: { wght: [200, 800], wdth: [75, 100] }, sans: { wght: [100, 900] }, serif: null };

// ─── Couleurs ──────────────────────────────────────────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (rgb) => `#${rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => hexOf(rgbOf(a).map((c, i) => c + (rgbOf(b)[i] - c) * t));
const lum = (h) => { const [r, g, b] = rgbOf(h).map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const toHex = (c) => {
  const s = String(c || "").trim();
  if (HEX.test(s)) return s.toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  return m ? hexOf(m.slice(1, 4).map(Number)) : null;
};
const best = (bg, list) => list.reduce((x, y) => (contrast(y, bg) > contrast(x, bg) + 0.01 ? y : x));
const dark = (h) => lum(h) < 0.35;
const chroma = (h) => { const c = rgbOf(h); return Math.max(...c) - Math.min(...c); };
/** Deux couleurs presque identiques à l'œil (distance RGB). */
const same = (a, b) => rgbOf(a).reduce((s, c, i) => s + (c - rgbOf(b)[i]) ** 2, 0) < 48 * 48;
/** Teinte tournée de `deg` degrés (HSL), pour un nuancier quand le style n'a qu'un accent. */
function hue(hex, deg) {
  let [r, g, b] = rgbOf(hex).map((c) => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h + deg / 360 + 1) % 1;
  const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  if (!s) return hexOf([l, l, l].map((x) => x * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return hexOf([f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map((x) => x * 255));
}

/**
 * Les quatre fonds du style (base, accent, ink, alt) : pour chacun, bg (couleur unie), ink (texte), sub (texte
 * secondaire), mk (couleur de la marque : emphase, surligneur, bouton) et onMk (texte posé sur mk). tones : le nuancier
 * des décors (couvertures des cartes, confettis, publications du fil). Un thème Perso donne ses propres champs.
 */
export function surfacesOf(look = {}) {
  const L = { theme: "night", accent: "#ff5a1f", fields: [], ...look };
  if (L.theme === "custom" && !(Array.isArray(L.fields) && L.fields.length && HEX.test(L.fields[0]?.bg || "") && HEX.test(L.fields[0]?.ink || ""))) L.theme = "night";
  const accent = HEX.test(L.accent || "") ? L.accent.toLowerCase() : "#ff5a1f";
  const c = colors({ ...L, accent }, 0);
  const gradient = L.theme === "gradient";
  const bg0 = gradient ? mix(accent, "#000000", 0.28) : toHex(c.bg) || "#151514";
  const ink0 = toHex(c.ink) || (dark(bg0) ? "#f6f3ec" : "#1a1917");
  const sub0 = mix(ink0, bg0, 0.34);
  const fields = L.theme === "custom" ? L.fields.filter((f) => HEX.test(f?.bg || "") && HEX.test(f?.ink || "")) : [];
  const nearBase = (h) => contrast(h, bg0) < 1.35;
  // L'accent comme fond : il doit se distinguer de la base (thème « accent »). Un accent foncé s'éclaircit ; un accent
  // clair (jaune, vert d'eau) assombri tournerait au kaki : la couleur du texte, teintée d'accent, le remplace.
  const accBg = !nearBase(accent) ? accent : dark(accent) ? mix(accent, "#ffffff", 0.42) : mix(ink0, accent, 0.12);
  const onAcc = best(accBg, [ink0, bg0, "#ffffff", "#15161f"]);
  // alt : le deuxième champ du thème Perso (même proche de la base : c'est la couleur choisie), sinon un accent
  // profond (fond sombre) ou une teinte (fond clair).
  const f2 = fields.find((f, i) => i > 0 && contrast(f.bg, bg0) >= 1.12 && contrast(f.bg, accBg) >= 1.25);
  const altBg = f2 ? f2.bg.toLowerCase() : dark(bg0) ? mix(accent, "#0b0b12", 0.62) : mix(accent, "#ffffff", 0.8);
  const altInk = f2 ? f2.ink.toLowerCase() : best(altBg, [ink0, bg0, "#ffffff", "#15161f"]);
  const markOn = (bg, ink) => {
    if (contrast(accent, bg) >= 2.2) return accent;
    // L'accent assombri (ou éclairci) jusqu'à se lire sur ce fond, distinct du texte : la marque garde la couleur de
    // la marque (un fond de la couleur même de l'accent garde la marque en négatif, ci-dessous).
    if (contrast(accent, bg) >= 1.08) {
      for (let i = 1; i <= 5; i++) {
        const x = mix(accent, dark(bg) ? "#ffffff" : "#000000", i * 0.15);
        if (contrast(x, bg) >= 2.2 && contrast(x, ink) >= 1.5) return x;
      }
    }
    const alt = [onAcc, ink0, bg0, "#ffffff", "#15161f"].filter((x) => x !== ink && contrast(x, bg) >= 2.2);
    return alt[0] || ink;
  };
  // Le texte secondaire : moins mêlé au fond quand le contraste est déjà juste (texte sombre sur un accent vif).
  const surface = (bg, ink, mk) => ({ bg, ink, sub: mix(ink, bg, contrast(ink, bg) < 7 ? 0.18 : 0.3), mk, onMk: best(mk, [bg, ink, "#ffffff", "#15161f"]) });
  const base = surface(bg0, ink0, markOn(bg0, ink0));
  base.sub = sub0;
  // Sur l'accent, la marque est en négatif : une barre de la couleur du texte, le texte dessus dans l'accent. Un accent
  // clair proche de la base (jaune sur crème) a pour fond l'encre teintée : la marque y reprend l'accent lui-même.
  const lightNear = nearBase(accent) && !dark(accent);
  const acc = surface(accBg, onAcc, lightNear ? accent : onAcc);
  if (!lightNear) acc.onMk = accBg;
  const inkS = surface(ink0, bg0, markOn(ink0, bg0));
  const alt = surface(altBg, altInk, markOn(altBg, altInk));
  // Le nuancier : l'accent (toujours), les champs du thème Perso, puis les voisins de l'accent (teintes proches, plus
  // sombre, plus clair) ; jamais une couleur complémentaire qui jure avec la marque, ni un gris moyen.
  const tones = [];
  const add = (h) => {
    const x = toHex(h);
    if (!x || tones.some((t) => same(t, x))) return;
    if (tones.length && chroma(x) < 24 && contrast(x, "#888888") < 1.3) return;
    tones.push(x);
  };
  add(accent);
  for (const f of fields) { add(f.bg); add(f.ink); }
  add(hue(accent, 38)); add(hue(accent, -42)); add(mix(accent, "#000000", 0.38)); add(mix(accent, "#ffffff", 0.45)); add(altBg);
  return {
    surfaces: { base, accent: acc, ink: inkS, alt },
    tones: tones.slice(0, 7),
    accent,
    gradient: gradient ? String(c.bg) : "",
    dark: dark(bg0),
  };
}

// ─── Transitions effectives ────────────────────────────────────────────────────────────────────────────────────────

/** Les transitions que la scène sait jouer telles quelles (les autres se rejouent autrement, voir effective()). */
const SOFT = new Set(["rise", "morph", "carry"]);
const WORDY = new Set(["hero", "stack", "list", "number", "cta", "bubbles"]);

/**
 * La transition jouée vers chaque temps fort gardé : { kind, phone } où phone dit ce que fait le téléphone partagé
 * (entre deux scènes téléphone : flip ou push de l'écran). Mode sûr : montée sur le même fond, coupe sinon.
 */
function effective(kept, safe) {
  return kept.map((b, k) => {
    if (k === 0) return { kind: "hook" };
    const prev = kept[k - 1];
    const same = (b.surface || "base") === (prev.surface || "base");
    let kind = b.bridge || "morph";
    if (safe) return { kind: same ? "rise" : "cut" };
    if (kind === "carry" && (!WORDY.has(prev.layout) || !WORDY.has(b.layout) || !commonWord(prev.text, b.text))) kind = "morph";
    if (SOFT.has(kind) && !same) kind = "wipe";
    // Deux scènes téléphone de suite : le téléphone reste, son écran se retourne (ou glisse) ; le fond suit.
    if (prev.layout === "phone" && b.layout === "phone") {
      const phone = kind === "push" ? "push" : "flip";
      return { kind: same ? "none" : kind === "whip" || kind === "push" || kind === "flip" || kind === "zoom" ? "wipe" : SOFT.has(kind) ? "wipe" : kind, phone };
    }
    return { kind };
  });
}

/** Quand le contenu d'une scène peut commencer à entrer, selon la transition qui l'amène (en temps de musique g). */
const ENTER = { hook: 0.1, none: 0.4, cut: 0, flood: 0.5, wipe: 0.4, whip: 0.3, push: 0.35, flip: 0.45, zoom: 0.05, rise: -0.15, morph: 0.05, carry: 0.05 };
/** Quand la sortie commence avant la frontière, selon la transition qui suit (en g ; 0 = rien ne sort). */
const EXIT = { end: 0, none: 0, cut: 0, flood: 0.75, wipe: 0, whip: 0.5, push: 0.45, flip: 0.5, zoom: 0.85, rise: 0.6, morph: 0.6, carry: 0.6 };

// ─── Chorégraphie ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les instants de chaque scène, sur la grille (h = un demi-temps), et les bruitages qui en découlent.
 * Chaque fonction reçoit le temps fort préparé B (avec enter, exit, g, h) et renvoie { cue, sfx }.
 */
function choreograph(B, ctx) {
  const { g, h } = B;
  const sfx = [];
  const fx = (t, k, gain = 1, o = {}) => { if (Number.isFinite(t) && t >= 0) sfx.push({ t: r3(t), k, g: r3(gain), ...o }); };
  const HB = (t) => Math.ceil((t - 1e-6) / h) * h; // demi-temps suivant
  const GB = (t) => Math.ceil((t - 1e-6) / g) * g; // temps suivant
  const room = Math.max(0.3, B.exit - B.enter); // le temps de jeu de la scène
  // Le premier geste de la scène tombe sur un demi-temps : celui de l'entrée, ou celui juste avant quand l'entrée le
  // suit de peu (métamorphose, mot porté, plongée : la scène part sur le temps fort lui-même, sans trou après la sortie).
  const t0 = Math.max(B.enter - 0.06, Math.min(HB(B.enter - 0.06), B.exit - 0.3));
  const punch = (t, a) => (B.camera === "still" ? null : { t: r3(t), a });
  const punches = [];
  const cue = { t0: r3(t0) };
  /** n événements réguliers à partir de `from`, pas `step` (resserré pour finir avant `until`, jamais sous `min`). */
  const steps = (n, from, step, until, min = h / 2) => {
    if (n <= 0) return [];
    const s = n > 1 ? Math.max(min, Math.min(step, (until - from) / (n - 1))) : step;
    return Array.from({ length: n }, (_, i) => r3(from + i * s));
  };
  /**
   * Le pas (en demi-temps entiers, de `base` à `max`) qui étale n éléments sur la scène en gardant `tail` secondes au
   * dernier : une longue scène ne reste plus figée après des éléments tous arrivés d'un coup.
   */
  const spread = (n, from, base, max, tail) => (n > 1 ? clamp(Math.floor((B.exit - tail - from) / (n - 1) / h + 1e-6) * h, base, max) : base);
  const markSfx = (t) => {
    if (!B.markOn) return;
    fx(t, B.mark === "highlight" ? "swish" : B.mark === "dot" ? "pop" : "scribble", B.mark === "dot" ? 0.7 : 0.75, { f: 1.2, p: -0.2 });
  };
  const nw = B.words.length;
  switch (B.layout) {
    case "hero": {
      // L'accroche se lit d'un coup (mots au demi-temps dès 4 mots) ; un autre héros pose ses mots sur les temps.
      const step = B.k === 0 ? (nw <= 3 ? h : h / 2) : nw <= 6 ? h : h / 2;
      cue.words = steps(nw, t0, step, Math.max(t0, B.exit - g * 1.2), 0.07);
      cue.words.forEach((t, i) => { fx(t, "tock", 0.55, { f: 1 + i * 0.07, p: i % 2 ? 0.2 : -0.2 }); punches.push(punch(t, 0.012)); });
      const last = cue.words[nw - 1] ?? t0;
      cue.mark = r3(Math.min(GB(last + h * 0.9), B.exit - h));
      markSfx(cue.mark);
      cue.beats = [];
      for (let t = GB(cue.mark + g); t < B.exit - g * 0.6; t += g) cue.beats.push(r3(t));
      break;
    }
    case "stack": {
      cue.words = steps(nw, t0, 0.05, t0 + 0.6, 0.03);
      fx(t0, "swish", 0.45, { p: 0.1 });
      punches.push(punch(t0, 0.01));
      cue.sub = r3(Math.min(GB(t0 + g * 0.9), B.exit - h));
      if (B.sub) fx(cue.sub, "tick", 0.5, { f: 0.9 });
      cue.mark = r3(Math.min(B.sub ? cue.sub + h : GB(t0 + g * 0.9), B.exit - h));
      markSfx(cue.mark);
      break;
    }
    case "number": {
      const n = B.number?.digits || 1;
      // Les mots d'avant le chiffre (lead) entrent d'abord, le chiffre tourne un demi-temps après.
      const lead = Math.min(B.number?.lead || 0, nw);
      let s0 = t0;
      if (lead) {
        cue.lead = steps(lead, t0, 0.05, t0 + 0.4, 0.03);
        fx(t0, "swish", 0.4, { p: -0.1 });
        s0 = Math.min(HB(t0 + h), B.exit - g * 2);
      }
      const first = HB(s0 + g);
      cue.spin = r3(s0);
      cue.land = steps(n, first, n > 4 ? h / 2 : h, Math.max(first, B.exit - g * 1.6), 0.06);
      const tf = cue.land[cue.land.length - 1] ?? first;
      cue.final = r3(tf);
      for (let t = s0 + h / 2; t < tf - 0.05; t += h / 2) fx(t, "tick", 0.28, { f: 1 + (t - s0) / Math.max(0.5, tf - s0) * 0.6, p: Math.sin(t * 7) * 0.3 });
      fx(tf, "impact", 0.5, { big: 0.45 });
      fx(tf + 0.02, "pop", 0.55, { f: 1.3 });
      punches.push(punch(tf, 0.035));
      cue.flash = r3(tf);
      cue.words = steps(nw - lead, r3(Math.min(tf + h, B.exit - h)), 0.05, B.exit - h * 0.5, 0.03);
      cue.sub = r3(Math.min(tf + g, B.exit - h * 0.5));
      if (B.sub) fx(cue.sub, "tick", 0.45, { f: 0.85 });
      // Le point (ou la barre) vient après le dernier mot sous le chiffre, jamais avant lui.
      cue.mark = r3(Math.min((cue.words.length ? cue.words[cue.words.length - 1] : tf) + h, B.exit - h));
      // Un chiffre qui reste longtemps à l'écran repulse toutes les 4 temps (anneau, rayons), jamais figé plus de 2 s.
      cue.pulses = [];
      for (let t = GB(cue.mark + 2 * g); t < B.exit - g; t += 4 * g) { cue.pulses.push(r3(t)); fx(t, "thump", 0.22); }
      break;
    }
    case "list": {
      cue.words = steps(nw, t0, 0.05, t0 + 0.6, 0.03);
      fx(t0, "swish", 0.45);
      const n = B.items.length;
      const first = GB(t0 + g * 0.9);
      cue.items = steps(n, first, g, Math.max(first, B.exit - h), h);
      cue.items.forEach((t, i) => { fx(t, "pop", 0.6, { f: 1 + i * 0.13, p: i % 2 ? 0.3 : -0.3 }); fx(t + 0.12, "tick", 0.35, { f: 1.4 }); punches.push(punch(t, 0.008)); });
      cue.mark = r3(Math.min(t0 + g, B.exit - h));
      markSfx(cue.mark);
      break;
    }
    case "slot": {
      cue.words = steps(nw, t0, 0.06, t0 + 0.5, 0.03);
      fx(t0, "swish", 0.45);
      const n = B.items.length;
      const first = HB(t0 + h);
      cue.items = steps(n, first, g, Math.max(first, B.exit - g), h);
      cue.items.forEach((t, i) => { fx(t - 0.03, "tock", i === n - 1 ? 1 : 0.75, { f: i === n - 1 ? 0.84 : 1 }); punches.push(punch(t, 0.018)); });
      cue.mark = r3((cue.items[n - 1] ?? first) + 0.06);
      // (hidden : le runtime n'entoure pas le dernier item, pas de griffonnage à entendre)
      if (B.mark !== "hidden") fx(cue.mark, "scribble", 0.85, { p: -0.3 });
      break;
    }
    case "phone": {
      const firstInRun = B.runFirst;
      cue.rise = firstInRun ? r3(B.enter) : null;
      if (firstInRun) fx(B.enter, "whoosh", 0.5, { d: 0.55, peak: 0.4 });
      cue.words = steps(nw, r3(Math.max(t0, firstInRun ? HB(B.enter + h) : t0)), 0.06, B.exit - g, 0.03);
      const tw = cue.words[0] ?? t0;
      const n = B.items.length;
      if (B.screen === "feed") {
        cue.scroll = [r3(HB(tw + h)), r3(Math.max(HB(tw + h) + 0.5, B.exit - 0.05))];
        fx(cue.scroll[0], "riser", 0.28, { d: Math.max(0.4, cue.scroll[1] - cue.scroll[0]), tone: 0 });
        cue.items = steps(n, r3(HB(tw + g)), h, B.exit - g * 0.8, h / 2);
        cue.items.forEach((t, i) => fx(t, "pop", 0.5, { f: 1.2 + i * 0.15, p: i % 2 ? 0.55 : -0.55 }));
        // Les bulles s'envolent avant la fin de la scène (0,42 s de vol, décalées de 0,018 s) : jamais par-dessus la suivante.
        cue.away = r3(Math.max(cue.items[n - 1] ?? tw, B.exit - 0.45 - 0.018 * Math.max(0, n - 1)));
        if (n) fx(cue.away, "whoosh", 0.45, { d: 0.45, peak: 0.35 });
      } else if (B.screen === "app") {
        // Les choix arrivent avec le titre (après un retournement, l'écran n'attend pas vide).
        cue.ui = r3(HB(tw));
        fx(cue.ui, "swish", 0.35);
        if (n) {
          cue.items = steps(n, cue.ui, 0.08, cue.ui + 0.3, 0.05);
          cue.tap = r3(clamp(GB(cue.ui + g * 1.5), cue.ui + h, B.exit - h));
        } else if (B.label) {
          cue.tap = r3(clamp(GB(B.exit - g * 1.1), cue.ui + h, B.exit - h * 0.6));
        } else {
          // Ni choix ni bouton : rien à taper à l'écran (le runtime ne pose pas de doigt), donc pas de bruit de tape.
          cue.tap = null;
        }
        if (cue.tap !== null) {
          fx(cue.tap - 0.01, "tap", 1);
          fx(cue.tap + 0.02, "pop", 0.55, { f: 1.1 });
        }
      } else if (B.screen === "chat") {
        cue.ui = r3(HB(tw + h * 0.5));
        const from = r3(HB(cue.ui + h));
        cue.items = steps(n, from, spread(n, from, g, 2 * g, Math.max(1.2, g)), B.exit - h, h);
        cue.items.forEach((t, i) => fx(t, "pop", 0.55, { f: i % 2 ? 1.35 : 0.95, p: i % 2 ? 0.3 : -0.3 }));
      } else {
        cue.ui = r3(HB(tw));
        const from = r3(HB(cue.ui + h));
        cue.items = steps(n, from, spread(n, from, g, 2 * g, Math.max(1.2, g)), B.exit - h, h);
        cue.items.forEach((t, i) => { fx(t, "ding", 0.32, { f: 1 + (i % 3) * 0.12 }); fx(t, "swish", 0.25); });
      }
      break;
    }
    case "cards": {
      const n = B.items.length;
      cue.words = steps(nw, t0, 0.05, t0 + 0.5, 0.03);
      cue.cards = r3(t0);
      fx(t0, "whoosh", 0.45, { d: 0.5, peak: 0.3 });
      const sw0 = GB(t0 + g * 1.1);
      // Le tampon : sur un temps, au moins deux temps après le dernier swipe, au plus tard 1,6 temps avant la sortie.
      const swipes = steps(n - 1, sw0, g, Math.max(sw0, B.exit - g * 3.6), h);
      const lastSw = swipes.length ? swipes[swipes.length - 1] : t0;
      let stamp = GB(lastSw + g * 1.9);
      if (stamp > B.exit - g * 1.4) stamp = Math.max(lastSw + h, HB(B.exit - g * 1.4));
      cue.swipes = swipes;
      cue.stamp = r3(stamp);
      swipes.forEach((t) => { fx(t - 0.1, "buzz", 0.45); fx(t, "whoosh", 0.55, { d: 0.32, peak: 0.45, p: -0.2 }); });
      // La tension : battements de cœur et montée avant le tampon.
      cue.tension = r3(Math.min(stamp - h, lastSw + h));
      const beatsT = [];
      for (let t = stamp - h; t > cue.tension + 0.01 && beatsT.length < 4; t -= h) beatsT.unshift(r3(t));
      cue.heart = beatsT;
      beatsT.forEach((t) => fx(t, "heartbeat", 0.85));
      if (stamp - cue.tension > 0.3) fx(cue.tension, "riser", 0.7, { d: r3(stamp - cue.tension), tone: 1 });
      fx(stamp, "impact", 1, { big: 1 });
      fx(stamp - 0.02, "tock", 0.7, { f: 0.62 });
      fx(stamp, "sparkle", 0.9, { d: 1.3 });
      punches.push(punch(stamp, 0.08));
      cue.flash = r3(stamp);
      cue.sub = B.sub ? r3(stamp + 0.05) : null;
      cue.out = r3(stamp - 0.25);
      cue.float = r3(GB(stamp + g));
      ctx.drops.push({ t: r3(stamp), id: B.id, w: 3 });
      break;
    }
    case "bubbles": {
      cue.words = steps(nw, t0, 0.05, t0 + 0.6, 0.03);
      fx(t0, "swish", 0.45);
      const n = B.items.length;
      const from = r3(HB(t0 + h));
      cue.items = steps(n, from, spread(n, from, h, 2 * g, Math.max(1, g)), B.exit - g, h / 2);
      cue.items.forEach((t, i) => fx(t, "pop", 0.55, { f: 1 + i * 0.16, p: i % 2 ? 0.5 : -0.5 }));
      cue.mark = r3(Math.min(GB(t0 + g), B.exit - h));
      markSfx(cue.mark);
      // L'envol des bulles (0,42 s, décalées de 0,018 s) finit avec la sortie des mots, avant la transition.
      const fly = 0.42 + 0.018 * Math.max(0, n - 1);
      cue.away = B.bout === "rise" || B.bout === "morph" || B.bout === "carry" || B.bout === "zoom" || B.bout === "flood" ? r3(Math.max(cue.items[n - 1] ?? t0, B.exit + 0.25 - fly)) : null;
      if (cue.away) fx(cue.away, "whoosh", 0.4, { d: 0.4, peak: 0.3 });
      break;
    }
    case "wall": {
      cue.box = r3(HB(t0 + h));
      fx(cue.box, "pop", 0.75, { f: 0.8 });
      punches.push(punch(cue.box, 0.02));
      cue.words = steps(nw, cue.box + 0.08, 0.05, cue.box + 0.5, 0.03);
      cue.inv = [];
      cue.pulse = [];
      let j = 0;
      for (let t = GB(cue.box + g * 0.9); t < B.exit - g * 0.7; t += g, j++) {
        if (j % 2 === 0) { cue.inv.push(r3(t)); fx(t, "clap", 0.5); fx(t, "impact", 0.4, { big: 0.22 }); punches.push(punch(t, 0.03)); }
        else { cue.pulse.push(r3(t)); fx(t, "tock", 0.45, { f: 1.1 }); }
      }
      break;
    }
    case "cta": {
      cue.brand = r3(t0);
      if (B.brand) { fx(t0, "shimmer", 0.7, { d: 0.6 }); fx(t0, "swish", 0.35); }
      cue.dot = r3(t0 + h * 2.5);
      if (B.brand) fx(cue.dot, "pop", 0.6, { f: 1.5 });
      cue.words = steps(nw, r3(B.brand ? HB(t0 + g) : t0), 0.045, B.exit - g, 0.03);
      const tw = cue.words[cue.words.length - 1] ?? t0;
      cue.button = r3(Math.min(HB(tw + h), B.exit - g * 1.5));
      fx(cue.button, "pop", 0.75, { f: 0.9 });
      cue.rings = [];
      for (let t = GB(cue.button + g * 0.9); t < B.exit - g * 0.4; t += g) cue.rings.push(r3(t));
      cue.rings.forEach((t) => fx(t, "thump", 0.32));
      cue.shine = r3(cue.button + g * 1.5);
      if (cue.shine < B.exit - h) fx(cue.shine, "shimmer", 0.6, { d: 0.5 });
      cue.tap = r3(Math.max(cue.button + h, HB(B.exit - g * 1.25)));
      if (cue.tap < B.exit - 0.2) { fx(cue.tap - 0.01, "tap", 1); fx(cue.tap + 0.05, "impact", 0.3, { big: 0.25 }); }
      else cue.tap = null;
      // Une fin longue : le reflet repasse sur le bouton toutes les 4 temps, jusqu'au temps qui précède la tape.
      cue.shines = [];
      for (let t = cue.shine + 4 * g; t < (cue.tap ?? B.exit) - g; t += 4 * g) { cue.shines.push(r3(t)); fx(t, "shimmer", 0.35, { d: 0.5 }); }
      break;
    }
    default: break;
  }
  cue.punches = punches.filter(Boolean);
  void room;
  return { cue, sfx };
}

/** Les bruitages d'une transition vers le temps fort B (à sa frontière S). */
function bridgeSfx(B, out) {
  const S = B.S, g = B.g;
  const fx = (t, k, gain = 1, o = {}) => out.push({ t: r3(Math.max(0, t)), k, g: r3(gain), ...o });
  switch (B.bin.kind) {
    case "cut": fx(S, "impact", 0.35, { big: 0.3 }); break;
    case "flood": fx(S - 0.08, "whoosh", 0.7, { d: 0.62, peak: 0.62 }); fx(S + 0.4, "impact", 0.35, { big: 0.3 }); break;
    case "wipe": fx(S - 0.1, "whoosh", 0.55, { d: 0.6, peak: 0.6 }); fx(S + 0.45, "impact", 0.25, { big: 0.25 }); break;
    case "whip": fx(S - 0.3, "whoosh", 0.9, { d: 0.55, peak: 0.45 }); break;
    case "push": fx(S - 0.22, "whoosh", 0.6, { d: 0.4, peak: 0.5 }); break;
    case "flip": fx(S - 0.25, "whoosh", 0.45, { d: 0.32, peak: 0.5 }); fx(S + 0.3, "shimmer", 0.6, { d: 0.6 }); break;
    case "zoom": fx(S - Math.min(0.42, g * 0.85), "riser", 0.7, { d: Math.min(0.42, g * 0.85), tone: 0 }); fx(S, "impact", 0.45, { big: 0.45 }); break;
    case "rise": case "morph": fx(S - 0.12, "swish", 0.35, { p: 0.15 }); break;
    case "carry": fx(S - 0.12, "swish", 0.4); fx(S + 0.1, "tick", 0.4); break;
    default: break;
  }
  if (B.bin.phone) { fx(S - 0.25, "whoosh", 0.45, { d: 0.32, peak: 0.5 }); fx(S + 0.3, "shimmer", 0.6, { d: 0.6 }); }
}

// ─── Page ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** GSAP et les plugins de la bibliothèque, copiés depuis cfg.gsapDir. */
function copyGsap(cfg, assets, notes) {
  const dir = home(cfg.gsapDir || "");
  const core = gsapCore(cfg);
  if (!core) throw new Error(GSAP_MISSING);
  copyFileSync(core, join(assets, GSAP.core));
  const out = [GSAP.core];
  const missing = [];
  for (const p of SIG_PLUGINS) {
    const src = dir ? join(dir, p.file) : "";
    if (src && existsSync(src)) { copyFileSync(src, join(assets, p.file)); out.push(p.file); }
    else missing.push(p.name);
  }
  if (missing.length) notes.push(`Plugins GSAP absents (${missing.join(", ")}) : certaines scènes sont jouées plus simplement. Lance « node montage.mjs --setup-reel ».`);
  return out;
}

// .plate coupe ce qui déborde (retournement, poussée : jamais le décor d'une scène sur sa voisine) par clip-path et non
// par overflow : l'audit de mise en page de HyperFrames prendrait sinon la dérive du contenu (×1,03 à ×1,06) pour un
// texte qui dépasse de la plaque.
const PAGE_CSS = (P, fonts, look) => {
  const s = P.surfaces;
  // --hz : la lueur des décors (horizon, halo), claire sur un fond sombre, la couleur de la marque sur un fond clair.
  const hz = (bg, ink, mk) => (dark(bg) ? mix(ink, mk, 0.45) : mk);
  const surf = Object.entries(s).map(([k, v]) => `.s-${k}{--bg:${v.bg};--fg:${v.ink};--sub:${v.sub};--mk:${v.mk};--onmk:${v.onMk};--hz:${hz(v.bg, v.ink, v.mk)}}`).join("\n");
  const inv = Object.entries(s).map(([k, v]) => `.s-${k}[data-inv="1"]{--bg:${v.ink};--fg:${v.bg};--sub:${v.bg};--mk:${v.mk === v.ink ? v.bg : v.mk};--onmk:${v.mk === v.ink ? v.ink : v.onMk};--hz:${hz(v.ink, v.bg, v.mk === v.ink ? v.bg : v.mk)}}`).join("\n");
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:${s.base.bg}}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${s.base.bg};font-family:var(--font-body);${fonts.bodyCss};-webkit-font-smoothing:antialiased}
#stage,#bg,#cam,.plate,.pbg,.deco,.pin,#fxl{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
#bg{background:${s.base.bg}}
${surf}
${inv}
.plate{visibility:hidden;color:var(--fg);clip-path:inset(0px)}
.pbg{background:var(--bg);visibility:hidden}
.plate.grad .pbg{background-image:var(--grad)}
.deco,.pin{pointer-events:none}
.disp{font-family:var(--font-display);${fonts.displayCss};line-height:0.92}
.vf{font-variation-settings:${fonts.vf ? `"wght" var(--wg,${fonts.vf.w})${fonts.vf.wd ? `,"wdth" var(--wd,${fonts.vf.wd})` : ""}` : "normal"}}
.tx{position:absolute;left:0;top:0;text-wrap:balance}
.tx.c{text-align:center}
.wm{display:inline-block;overflow:hidden;vertical-align:top;padding:0.14em 0.08em 0.2em;margin:-0.14em -0.08em -0.2em}
.w{display:inline-block;white-space:pre}
.em{color:var(--mk)}
.hlon .em{color:var(--onmk)}
.hl{position:absolute;background:var(--mk);transform-origin:0 50%}
.sub{position:absolute;left:0;top:0;font-family:var(--font-body);font-weight:600;color:var(--sub);line-height:1.22;text-wrap:balance}
.mkline{position:absolute;left:0;top:0;overflow:visible}
.mkline path{fill:none;stroke:var(--mk);stroke-linecap:round;stroke-linejoin:round}
.dotm{position:absolute;border-radius:50%;background:var(--mk)}
.flash{position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#fff;opacity:0;pointer-events:none}
#vig{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;background:radial-gradient(130% 85% at 50% 45%,transparent 58%,rgba(0,0,0,${P.dark ? 0.34 : 0.16}))}
#grain{position:absolute;left:-256px;top:-256px;width:${W + 512}px;height:${H + 512}px;background-image:url("assets/grain.png");background-size:256px 256px;opacity:0.075;mix-blend-mode:overlay;pointer-events:none}
#speed i{position:absolute;left:0;border-radius:4px;background:rgba(255,255,255,0.9);opacity:0}
#chrome{position:absolute;left:0;top:0;display:flex;align-items:center;gap:18px;font-family:var(--font-body);font-weight:700;white-space:nowrap;visibility:hidden}
#chrome img{display:block;height:64px;width:auto}
#caps{position:absolute;left:0;top:1450px;width:${W}px;height:250px;pointer-events:none}
${look.grid ? `.grid .pbg{background-image:linear-gradient(color-mix(in srgb,var(--fg) 8%,transparent) 3px,transparent 3px),linear-gradient(90deg,color-mix(in srgb,var(--fg) 8%,transparent) 3px,transparent 3px);background-size:108px 108px}` : ""}`;
};

/**
 * Écrit le projet HyperFrames d'un plan engine 2 dans hfDir (même contrat que stagePage). Renvoie en plus `sfx` (les
 * bruitages calés sur l'image, pour la finition), `drop` (l'instant du moment fort) et `fpb` (la grille du tempo).
 */
export async function stageSignature(cfg, plan, hfDir, { safe = false, notes = [] } = {}) {
  const video = plan.video;
  const pace = ["calm", "normal", "fast"].includes(plan.pace) ? plan.pace : "normal";
  const fpb = fpbOf(video) || FPB[pace];
  const timed = timeScore({ ...video, engine: 2, fpb }, { pace });
  const kept = timed.video.beats.filter((b) => !b.cut);
  if (!kept.length) throw new Error("Plan vidéo sans temps fort gardé.");
  const D = timed.duration;
  const g = fpb / FPS, h = g / 2;
  const look = { theme: "night", accent: "#ff5a1f", font: "grotesque", align: "center", fields: [], ...(plan.look || {}) };
  const assets = join(hfDir, "assets");
  mkdirSync(assets, { recursive: true });
  const seed = Number.isInteger(video.seed) ? video.seed : 0;
  const rnd = mulberry32(seed ^ 0x5157);
  const P = surfacesOf(look);
  const logo = logoOf(look);
  if (look.logo && !logo) notes.push("Logo illisible (PNG, JPEG, WebP ou SVG attendu) : la fin sort sans logo.");
  const handle = String(look.handle || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  const verbs = effective(kept, safe);

  // Les scènes téléphone qui se suivent partagent un téléphone (une « série »).
  const runOf = [];
  let run = -1;
  kept.forEach((b, k) => {
    if (b.layout !== "phone") { runOf.push(-1); return; }
    if (k === 0 || kept[k - 1].layout !== "phone") run++;
    runOf.push(run);
  });

  const ctx = { drops: [] };
  const sfx = [];
  const beats = kept.map((b, k) => {
    const S = b.start, E = b.end;
    const bin = verbs[k];
    const next = verbs[k + 1];
    const bout = next ? (next.phone ? "none" : next.kind) : "end";
    const enter = r3(Math.max(S === 0 ? 0.1 : S + (ENTER[bin.phone ? "none" : bin.kind] ?? 0) * g, 0.05));
    const exit = r3(Math.max(enter + 0.3, E - (EXIT[bout] ?? 0) * g));
    let main = tokens(b.text, b.emphasis);
    let number = null;
    if (b.layout === "number") {
      // Le grand chiffre sort de la phrase : les mots d'avant passent au-dessus (lead), ceux d'après dessous
      // (« Plus de » / 2000 / « livres »), une unité courte reste collée au chiffre (« 3 h »).
      const at = main.findIndex((w) => /\d/.test(w.t));
      const n = at >= 0 ? bigNumber(main.slice(at), true) : { number: null };
      if (n.number) {
        number = { text: n.number.text, prefix: n.number.prefix, suffix: n.number.suffix, value: n.number.value, decimals: n.number.decimals, em: n.number.em, lead: at };
        // Les rouleaux : les chiffres du nombre seul (« 4,8 » de « 4,8/5 ») ; ceux du préfixe ou du suffixe apparaissent.
        const core = number.text.slice(String(number.prefix || "").length, number.text.length - String(number.suffix || "").length);
        number.digits = (core.match(/\d/g) || []).length || 1;
        main = [...main.slice(0, at), ...n.main];
      }
    }
    const items = Array.isArray(b.items) ? b.items.map((x) => String(x)) : [];
    const markOn = b.actor !== "rest" && b.actor !== "hidden" && (b.actor === "dot" || main.some((w) => w.em));
    const B = {
      id: b.id, k, layout: number || b.layout !== "number" ? b.layout : "hero", surface: b.surface || "base", mark: b.actor || "rest", markOn,
      camera: safe ? "still" : b.camera || "drift", S: r3(S), E: r3(E), g: r3(g), h: r3(h), enter, exit, bin, bout,
      words: main, ...(b.sub ? { sub: b.sub, subWords: tokens(b.sub) } : {}), items, ...(b.label ? { label: b.label } : {}),
      ...(b.layout === "phone" ? { screen: b.screen || (items.length ? "app" : "feed"), ...(Number.isInteger(b.pick) ? { pick: b.pick } : {}) } : {}),
      ...(number ? { number } : {}),
      run: runOf[k], runFirst: runOf[k] >= 0 && (k === 0 || runOf[k - 1] !== runOf[k]), runLast: runOf[k] >= 0 && runOf[k + 1] !== runOf[k],
    };
    if (B.layout === "cta") B.brand = b.label || handle.replace(/^@/, "") || "";
    // Depuis un chiffre, les index des mots ne suivent plus le texte (le chiffre en est sorti) : métamorphose.
    if (bin.kind === "carry" && kept[k - 1].layout === "number") B.bin = { kind: "morph" };
    else if (b.bridge === "carry" && bin.kind === "carry") {
      const w = commonWord(kept[k - 1].text, b.text);
      const prevWords = tokens(kept[k - 1].text, kept[k - 1].emphasis);
      const from = prevWords.findIndex((x) => x.t.split(/[\s\u202f]+/).map(bare).includes(w));
      const to = main.findIndex((x) => x.t.split(/[\s\u202f]+/).map(bare).includes(w));
      // Un chiffre avec des mots au-dessus : le mot porté doit arriver dans le bloc du bas (ses index repartent de 0).
      const lead = B.number?.lead || 0;
      if (from >= 0 && to >= lead) B.carry = { from, to: to - lead };
      else B.bin = { kind: "morph" };
    }
    const c = choreograph(B, ctx);
    B.cue = c.cue;
    sfx.push(...c.sfx);
    if (k > 0) bridgeSfx(B, sfx);
    return B;
  });

  // Le moment fort (la musique y pose son « drop ») : celui choisi par Claude, sinon le tampon des cartes, sinon le
  // chiffre, sinon le début de la scène au milieu de la vidéo.
  const dropBeat = beats.find((B) => B.id === video.drop);
  const byLayout = (l) => beats.find((B) => B.layout === l);
  let drop = dropBeat ? (dropBeat.layout === "cards" ? dropBeat.cue.stamp : dropBeat.layout === "number" ? dropBeat.cue.final : dropBeat.S) : null;
  if (drop === null) drop = byLayout("cards")?.cue.stamp ?? byLayout("number")?.cue.final ?? beats[Math.min(beats.length - 1, Math.max(1, Math.floor(beats.length * 0.55)))].S;

  // Décor et hasard tirés de la graine (le navigateur n'en tire aucun).
  const confetti = Array.from({ length: 64 }, () => ({ a: r3(-90 + (rnd() - 0.5) * 150), v: Math.round(700 + rnd() * 1300), r: Math.round((rnd() - 0.5) * 1440), rx: Math.round(rnd() * 900), o: r3(1.6 + rnd() * 0.5), w: Math.round(12 + rnd() * 8), hh: Math.round(22 + rnd() * 14), c: Math.floor(rnd() * 7), round: rnd() < 0.25 }));
  const dust = Array.from({ length: 26 }, () => ({ x: Math.round(rnd() * W), y: Math.round(200 + rnd() * 1500), s: r3(2 + rnd() * 5), o: r3(0.15 + rnd() * 0.4), dy: Math.round(60 + rnd() * 140), dx: Math.round((rnd() - 0.5) * 60) }));
  const speed = Array.from({ length: 16 }, () => ({ y: Math.round(rnd() * H), hh: Math.round(3 + rnd() * 7), w: Math.round(260 + rnd() * 700), d: r3(0.24 + rnd() * 0.12), t: r3(0.06 + rnd() * 0.22) }));
  const jitter = Array.from({ length: 48 }, () => r3(rnd()));

  // Fichiers.
  const libs = copyGsap(cfg, assets, notes);
  const fonts = await copyFonts(cfg, look, assets, notes);
  const key = ["grotesque", "serif", "sans"].includes(look.font) ? look.font : "grotesque";
  const vf = /Plateau Display/.test(fonts.display) ? VF[key] : null;
  fonts.vf = vf ? { w: Math.min(800, vf.wght[1]), wd: vf.wdth ? 90 : 0 } : null;
  if (logo) writeFileSync(join(assets, `logo.${logo.ext}`), logo.buf);
  if (look.grain) writeFileSync(join(assets, "grain.png"), grainPng(256, rnd));

  const S = {
    engine: 2, W, H, fps: FPS, D: r3(D), g: r3(g), h: r3(h), fpb, pace, safe: !!safe, seed,
    align: look.align === "left" ? "left" : "center", grain: !!look.grain, grid: !!look.grid,
    fonts: { load: fonts.load, vf: fonts.vf ? { wght: vf.wght, wdth: vf.wdth || null, w: fonts.vf.w, wd: fonts.vf.wd } : null },
    pal: { surfaces: P.surfaces, tones: P.tones, accent: P.accent, dark: P.dark, gradient: P.gradient ? true : false },
    // name : le nom de marque affiché dans les écrans d'application (le label de l'appel à l'action, sinon le compte).
    brand: { handle, name: beats.find((B) => B.layout === "cta" && B.brand)?.brand || handle.replace(/^@/, ""), logo: logo ? `assets/logo.${logo.ext}` : "" },
    beats, drop: r3(drop), confetti, dust, speed, jitter,
  };
  writeFileSync(join(assets, "score.js"), `window.__SCORE = ${safeJson(S)};\n`);
  copyFileSync(join(HERE, "sig-runtime.js"), join(assets, "sig.js"));

  const tokensCss = Object.entries({ "--font-display": fonts.display, "--font-body": fonts.body, ...(P.gradient ? { "--grad": P.gradient.replace(/[<>"'\\{};]/g, "") } : {}) }).map(([k, v]) => `${k}:${v}`).join(";");
  const html = `<!doctype html>
<html lang="fr" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<meta name="viewport" content="width=${W}, height=${H}" />
<style>
${fonts.css}
:root{${tokensCss}}
${PAGE_CSS(P, fonts, look)}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${r3(D)}" data-width="${W}" data-height="${H}" data-fps="${FPS}">
<div id="stage" class="clip" data-start="0" data-duration="${r3(D)}">
<div id="bg"></div>
<div id="cam"></div>
<div id="fxl"><div id="speed"></div></div>
<div class="flash" id="flash"></div>
<div id="vig"></div>
${look.grain ? '<div id="grain"></div>\n' : ""}<div id="chrome">${logo ? `<img id="logo" src="assets/logo.${logo.ext}" alt="" />` : ""}<span id="handle"></span></div>
<div id="caps"></div>
<svg id="defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs></defs></svg>
</div>
</div>
<script>window.__timelines = window.__timelines || {}; /* window.__timelines["main"] est posé par assets/sig.js */</script>
${libs.map((f) => `<script src="assets/${f}"></script>`).join("\n")}
<script src="assets/score.js"></script>
<script src="assets/sig.js"></script>
</body>
</html>
`;
  writeFileSync(join(hfDir, "index.html"), html);
  writeFileSync(join(hfDir, "hyperframes.json"), `${JSON.stringify({ paths: { assets: "assets" }, media: { autoProxy: true } })}\n`);
  writeFileSync(join(hfDir, "package.json"), `${JSON.stringify({ name: "metricove-reel", private: true, type: "module" })}\n`);
  writeFileSync(join(hfDir, "index.motion.json"), `${JSON.stringify({
    duration: r3(D),
    assertions: [
      { kind: "appearsBy", selector: `#t-${kept[0].id}`, bySec: 1.0 },
      { kind: "keepsMoving", maxStaticSec: 1.5 },
    ],
  }, null, 2)}\n`);
  sfx.sort((a, b) => a.t - b.t);
  writeFileSync(join(hfDir, "sfx.json"), `${JSON.stringify({ D: r3(D), fpb, drop: r3(drop), events: sfx })}\n`);
  if (notes.length) log(`reel : ${notes.join(" | ").slice(0, 300)}`);
  // Instant posé de chaque scène (planche, couverture, relecture) : quand tout ce qui compte est à l'écran.
  const settle = beats.map((B) => r3(clamp(settleOf(B), B.S + 0.2, Math.max(B.S + 0.2, B.E - 0.15))));
  // Le milieu visible de chaque transition (planches de contrôle, relecture) : { id, kind, t }.
  const MID = { flood: 0.17, wipe: 0.03, whip: 0, push: 0.03, zoom: -0.12, rise: 0.12, morph: 0.12, carry: 0.12, cut: 0.02, none: 0.05 };
  const mids = beats.slice(1).map((B) => {
    const kind = B.bin.phone || B.bin.kind;
    return { id: B.id, kind, t: r3(clamp(B.S + (B.bin.phone ? (B.bin.phone === "flip" ? -0.05 : 0) : MID[B.bin.kind] ?? 0.05), 0, D - 0.05)) };
  });
  return {
    duration: D,
    settle,
    mids,
    marks: kept.map((b) => ({ id: b.id, title: b.title, start: b.start, end: b.end })),
    momentIds: [],
    sfx,
    drop: r3(drop),
    fpb,
  };
}

/** L'instant où une scène est complète (tous ses éléments posés, avant sa sortie). */
function settleOf(B) {
  const c = B.cue || {};
  const last = (a) => (Array.isArray(a) && a.length ? a[a.length - 1] : null);
  const t = {
    hero: (c.mark ?? last(c.words) ?? B.enter) + 0.45,
    stack: Math.max(c.sub ?? 0, c.mark ?? 0, last(c.words) ?? 0) + 0.45,
    number: Math.max(c.final ?? 0, c.sub ?? 0) + 0.5,
    list: (last(c.items) ?? B.enter) + 0.4,
    slot: (c.mark ?? B.enter) + 0.45,
    phone: Math.max(last(c.items) ?? 0, c.tap ?? 0, c.ui ?? 0, last(c.words) ?? 0) + 0.4,
    cards: (c.stamp ?? B.enter) + 0.55,
    bubbles: (last(c.items) ?? B.enter) + 0.4,
    wall: (c.box ?? B.enter) + 0.6,
    cta: (c.button ?? B.enter) + 0.55,
  }[B.layout];
  return Math.min(t ?? B.enter + 0.6, B.exit - 0.05);
}

/** Le texte du runtime (tests, empreinte du moteur). */
export const sigRuntimeSource = () => readFileSync(join(HERE, "sig-runtime.js"), "utf8");
export { words };
