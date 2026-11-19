// Le moteur Plateau, côté Node : écrit le projet HyperFrames d'un reel vidéo continu (index.html, assets/, réglages).
// Toute la mise en scène est décidée ici (temps, verbes effectifs, cadres, mots, hasard tiré de la graine) et écrite en
// DONNÉES dans assets/score.js ; assets/stage.js (copie de stage-runtime.js) la pose dans Chrome. Aucune chaîne du plan
// n'entre dans le HTML : les textes passent en JSON (caractères sensibles échappés) puis en textContent.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { home, log } from "../util.mjs";
import { googleFaces } from "../fonts.mjs";
import { colors } from "../motion.mjs";
import { cleanTexts, textLayer } from "../texts.mjs";
import { guardJs } from "./sandbox.mjs";
import { bare, commonWord, timeScore } from "./score.mjs";
import {
  ACTOR, ASSERTIONS, BRIDGE, CAMERA, CHROME, COUNT, DECOR, DEFAULTS, ENGINE, ENTER, FONTS, FPS, GSAP, H, MOMENT, MOMENT_ID,
  MOMENT_KEYS, RHYTHM, TYPE, W, ZONE_FRAMES,
} from "./vocab.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const r3 = (n) => Math.round(n * 1000) / 1000;
const HEX = /^#[0-9a-f]{6}$/i;
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixHex = (h, to, t) => `rgb(${rgbOf(h).map((c, i) => Math.round(c + (to[i] - c) * t)).join(",")})`;
const isDark = (h) => { const [r, g, b] = rgbOf(h); return 0.299 * r + 0.587 * g + 0.114 * b < 165; };
/** "r,g,b" d'une couleur #hex ou rgb(…) ; `or` sinon. */
function triplet(c, or) {
  if (HEX.test(c)) return rgbOf(c).join(",");
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(c));
  return m ? `${m[1]},${m[2]},${m[3]}` : or;
}

/** JSON sûr dans un <script> : dans chaque chaîne, < > & = : / ' et les fins de ligne Unicode sont échappés. */
export const safeJson = (v) => JSON.stringify(v).replace(/"(?:[^"\\]|\\.)*"/g, (s) => s.replace(/[<>&=:/'\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`));

/** PRNG mulberry32 : le seul hasard de la vidéo, tiré dans Node depuis la graine. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Mots ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const NNBSP = "\u202f";
/** Ponctuation française qui suit un mot après une espace (« : », « ? », « % »…) : collée au mot d'avant par une espace fine. */
const TRAILING = /^[:;!?»%€$×)\]]+[.,]?$|^[–—]$/;
const LEADING = /^[«(\[]$/;

/**
 * Découpe un texte en mots affichables : la ponctuation française isolée reste avec son mot (espace fine insécable),
 * les groupes de chiffres (10 000) restent ensemble. Renvoie des chaînes.
 */
export function words(text) {
  const raw = String(text ?? "").split(/[\s\u00a0]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    const prev = out[out.length - 1];
    if (prev !== undefined && TRAILING.test(w)) { out[out.length - 1] = prev + NNBSP + w; continue; }
    if (prev !== undefined && /^\d{3}$/.test(w) && /^\d{1,3}$/.test(prev.split(NNBSP).pop())) { out[out.length - 1] = prev + NNBSP + w; continue; }
    if (prev !== undefined && LEADING.test(prev)) { out[out.length - 1] = prev + NNBSP + w; continue; }
    out.push(w);
  }
  return out;
}

/** Les mots d'un texte avec l'emphase marquée : [{ t, em }]. L'emphase est la première suite de mots (forme nue) qui correspond. */
export function tokens(text, emphasis) {
  const ws = words(text);
  const out = ws.map((t) => ({ t }));
  const target = String(emphasis ?? "").split(/[\s\u00a0\u202f]+/).map(bare).filter(Boolean);
  if (!target.length) return out;
  // Chaque mot affiché peut porter plusieurs mots nus (« 1 : », « 10 000 ») : on compare sur la suite des mots nus.
  const flat = [];
  ws.forEach((w, i) => w.split(/[\s\u00a0\u202f]+/).map(bare).filter(Boolean).forEach((b) => flat.push({ b, i })));
  for (let k = 0; k + target.length <= flat.length; k++) {
    if (target.every((b, j) => flat[k + j].b === b)) {
      for (let j = 0; j < target.length; j++) out[flat[k + j].i].em = true;
      break;
    }
  }
  return out;
}

/** Le premier nombre d'un texte : { index, prefix, digits, suffix, value, decimals } ou null. */
export function numberIn(list) {
  const i = list.findIndex((w) => /\d/.test(w.t));
  if (i < 0) return null;
  const m = /^([^\d]*?)(\d[\d\s\u00a0\u202f.,]*\d|\d)(.*)$/su.exec(list[i].t);
  if (!m) return null;
  let digits = m[2].replace(/[\s\u00a0\u202f]/g, "");
  let decimals = 0;
  if (/,\d+$/.test(digits)) { decimals = digits.split(",").pop().length; digits = digits.replace(/\./g, "").replace(",", "."); }
  else if (/\.\d{3}(\.|$)/.test(digits)) digits = digits.replace(/\./g, "");
  else if (/\.\d+$/.test(digits)) decimals = digits.split(".").pop().length;
  digits = digits.replace(/,/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return { index: i, prefix: m[1], digits: m[2], suffix: m[3], value, decimals: Math.min(3, decimals) };
}

/** Une unité courte qui suit le nombre (« 3 h », « 15 min », « 2 ans ») : elle monte avec lui dans le grand chiffre. */
const UNIT = /^(?:h|min|s|ms|j|k|M|Md|Mds|x|kg|km|Go|Mo|To|pts?|ans?|mois|fois)$/;

/**
 * Le grand chiffre d'un temps fort « number » : { number, main } (main : les mots qui restent dessous). Une unité courte
 * collée au nombre le suit (seule sous le nombre, « h » avait l'air d'un reste : vu sur une vraie vidéo). Un nombre qui
 * n'ouvre pas le texte reste aussi dans la phrase (« Maintenant : 20 minutes »), qui se lit sans lui.
 */
export function bigNumber(main, count) {
  const n = numberIn(main);
  if (!n) return { number: null, main };
  const next = main[n.index + 1];
  const unit = n.index === 0 && !n.suffix.trim() && next && UNIT.test(next.t) ? next : null;
  // Espace insécable pleine : à la taille du grand chiffre, l'espace fine collait « 15min » (vu sur la vidéo).
  const glue = unit ? "\u00a0" + unit.t : "";
  const number = { text: main[n.index].t + glue, prefix: n.prefix, suffix: n.suffix + glue, value: n.value, decimals: n.decimals, count: count && n.value <= 1e9, em: !!main[n.index].em || !!unit?.em };
  return { number, main: n.index === 0 ? main.slice(unit ? 2 : 1) : main };
}

// ─── Verbes effectifs ───────────────────────────────────────────────────────────────────────────────────────────────

/** Les verbes que le moteur joue vraiment (mode sûr, forme aucune, zoom, coupes) pour chaque temps fort gardé. */
function effective(kept, { safe, shape }) {
  return kept.map((b, k) => {
    let bridge = k === 0 ? "hook" : b.bridge || DEFAULTS.bridge;
    let actor = b.actor || DEFAULTS.actor;
    let camera = b.camera || DEFAULTS.camera;
    if (safe) {
      if (bridge !== "hook" && bridge !== "cut") bridge = "rise";
      camera = "still";
      actor = actor === "underline" ? "underline" : "rest";
    }
    if (bridge === "zoom" && !kept[k - 1]?.emphasis) bridge = "rise";
    if (bridge === "carry" && !commonWord(kept[k - 1].text, b.text)) bridge = "morph";
    if (shape === "none" && actor !== "underline" && actor !== "highlight") actor = "hidden";
    if (actor === "highlight" && !b.emphasis) actor = "underline";
    return { bridge, actor, camera };
  }).map((v, k, all) => {
    // Jamais de mouvement de caméra pendant une plongée : le temps fort d'avant ne pousse pas.
    if (all[k + 1]?.bridge === "zoom" && v.camera === "push") v.camera = "drift";
    return v;
  });
}

// ─── Fichiers ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** CRC-32 (PNG). */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Tuile de grain (PNG en niveaux de gris, bruit tiré de la graine) : remplace la tuile SVG du design (pas d'http dans la page, moins cher à peindre). */
function grainPng(size, rnd) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size + 1);
    for (let x = 0; x < size; x++) row[x + 1] = Math.floor(rnd() * 256);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Le logo du look (data URL PNG, JPEG ou WebP, vérifié par ses premiers octets) : { buf, ext } ou null. */
function logoOf(look) {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(look?.logo || ""));
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 16 || buf.length > 3_000_000) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { buf, ext: "png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { buf, ext: "jpg" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { buf, ext: "webp" };
  return null;
}

/** Le fichier de GSAP de ce Mac (cfg.gsapDir, sinon cfg.gsapFile), ou "" : écrit par --setup-reel. */
export function gsapCore(cfg) {
  const dir = home(cfg.gsapDir || "");
  const file = home(cfg.gsapFile || "");
  return dir && existsSync(join(dir, GSAP.core)) ? join(dir, GSAP.core) : file && existsSync(file) ? file : "";
}
export const GSAP_MISSING = "GSAP introuvable sur ce Mac (gsapDir) : lance « node montage.mjs --setup-reel ».";

/** GSAP et ses plugins, copiés depuis cfg.gsapDir (ou cfg.gsapFile seul). Renvoie les noms de fichiers copiés, dans l'ordre. */
function copyGsap(cfg, assets, notes) {
  const dir = home(cfg.gsapDir || "");
  const core = gsapCore(cfg);
  if (!core) throw new Error(GSAP_MISSING);
  copyFileSync(core, join(assets, GSAP.core));
  const out = [GSAP.core];
  const missing = [];
  for (const p of GSAP.plugins) {
    const src = dir ? join(dir, p.file) : "";
    if (src && existsSync(src)) { copyFileSync(src, join(assets, p.file)); out.push(p.file); }
    else missing.push(p.name);
  }
  if (missing.length) notes.push(`Plugins GSAP absents (${missing.join(", ")}) : les animations sur mesure qui s'en servent seront moins riches. Lance « node montage.mjs --setup-reel ».`);
  return out;
}

/** Polices du style copiées à côté de la page : { css, display, body, load } (familles CSS avec repli générique seul). */
async function copyFonts(cfg, look, assets, notes) {
  const key = FONTS[look.font] ? look.font : "grotesque";
  const F = FONTS[key];
  const generic = key === "serif" ? "serif" : "sans-serif";
  const faces = async (spec, name, family) => {
    let list = [];
    try { list = await googleFaces(cfg, spec); } catch { list = []; }
    return list.map((f, i) => {
      const file = `${name}-${i}.woff2`;
      copyFileSync(f.file, join(assets, file));
      return `@font-face{font-family:"${family}";src:url("assets/${file}") format("woff2");font-display:block;${String(f.rules).replace(/[<>"'\\{}]/g, "")}}`;
    });
  };
  const display = await faces(F.display.spec, "display", "Plateau Display");
  const same = F.body.spec === F.display.spec;
  const body = same ? [] : await faces(F.body.spec, "body", "Plateau Body");
  const missing = [];
  if (!display.length) missing.push(F.display.family);
  if (!same && !body.length) missing.push(F.body.family);
  if (missing.length) notes.push(`Police ${missing.join(" et ")} indisponible : police de secours utilisée.`);
  // Une famille sans fichier n'est jamais nommée (le compilateur de HyperFrames irait la chercher chez Google).
  const displayFamily = display.length ? `"Plateau Display", ${generic}` : generic;
  const bodyFamily = same ? (display.length ? `"Plateau Display", sans-serif` : "sans-serif") : body.length ? `"Plateau Body", sans-serif` : "sans-serif";
  const weight = /font-weight:(\d+)/.exec(F.display.css)?.[1] || "700";
  return {
    css: [...display, ...body].join("\n"),
    display: displayFamily,
    body: bodyFamily,
    displayCss: F.display.css.replace(/[<>"'\\{}]/g, ""),
    bodyCss: (same ? "font-weight:500" : F.body.css).replace(/[<>"'\\{}]/g, ""),
    load: [display.length ? `${weight} 100px "Plateau Display"` : "", body.length ? `500 60px "Plateau Body"` : ""].filter(Boolean),
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const CSP = "default-src 'self' 'unsafe-inline' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/** Les couleurs du look : tokens CSS et pal des moments. */
function palette(look) {
  let L = look;
  if (L.theme === "custom" && !(Array.isArray(L.fields) && L.fields.length && HEX.test(L.fields[0]?.bg || "") && HEX.test(L.fields[0]?.ink || ""))) L = { ...L, theme: "night" };
  const accentIn = HEX.test(L.accent || "") ? L.accent.toLowerCase() : "#ff5a1f";
  const c = colors({ ...L, accent: accentIn }, 0);
  const gradient = L.theme === "gradient";
  const bg = gradient ? mixHex(accentIn, [0, 0, 0], 0.28) : HEX.test(c.bg) ? c.bg : "#151514";
  const accent = HEX.test(c.mark) ? c.mark.toLowerCase() : accentIn;
  const onAccent = isDark(accent) ? "#ffffff" : "#171716";
  const ink = c.ink;
  const glow = L.theme === "night" ? DECOR.glow.night : L.theme === "paper" ? DECOR.glow.paper : DECOR.glow.other;
  const haloRgb = c.glow ? triplet(accent, "255,90,31") : triplet(ink, "255,255,255");
  return {
    tokens: {
      "--bg": bg, "--bg-image": gradient ? c.bg : "none", "--ink": ink, "--sub": c.sub, "--accent": accent, "--on-accent": onAccent,
      "--accent-rgb": triplet(accent, "255,90,31"), "--ink-rgb": triplet(ink, "246,243,236"), "--bg-rgb": triplet(bg, "21,21,20"),
      "--halo-rgb": haloRgb,
    },
    pal: { bg, ink, sub: c.sub, accent, onAccent },
    glow,
  };
}

const ENGINE_CSS = (P, fonts, K) => `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:var(--bg)}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg);color:var(--ink);font-family:var(--font-body);${fonts.bodyCss}}
#stage,#bg,#bgpar,#cam,#drift,#behind,#type,#moments{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
#bg{background-color:var(--bg);background-image:var(--bg-image);overflow:hidden}
.halo{position:absolute;left:0;top:0;width:${DECOR.haloSize}px;height:${DECOR.haloSize}px;border-radius:50%}
.halo.h0{background:radial-gradient(circle closest-side,rgba(var(--halo-rgb),${P.glow[0]}) 0%,rgba(var(--halo-rgb),${r3(P.glow[0] * 0.45)}) 45%,rgba(var(--halo-rgb),0) 100%)}
.halo.h1{background:radial-gradient(circle closest-side,rgba(var(--halo-rgb),${P.glow[1]}) 0%,rgba(var(--halo-rgb),${r3(P.glow[1] * 0.45)}) 45%,rgba(var(--halo-rgb),0) 100%)}
#grid{position:absolute;left:0;top:-${DECOR.grid.step * 10}px;width:${W}px;height:${H + DECOR.grid.step * 20}px;background-image:linear-gradient(rgba(var(--ink-rgb),${DECOR.grid.alpha}) 2px,transparent 2px),linear-gradient(90deg,rgba(var(--ink-rgb),${DECOR.grid.alpha}) 2px,transparent 2px);background-size:${DECOR.grid.step}px ${DECOR.grid.step}px;background-position:0 0}
#grain{position:absolute;left:-${DECOR.grain.tile}px;top:-${DECOR.grain.tile}px;width:${W + DECOR.grain.tile * 2}px;height:${H + DECOR.grain.tile * 2}px;background-image:url("assets/grain.png");background-size:${DECOR.grain.tile}px ${DECOR.grain.tile}px;opacity:${DECOR.grain.alpha};pointer-events:none}
#actor{position:absolute;left:0;top:0;width:${K.ACTOR.rest.size}px;height:${K.ACTOR.rest.size}px;border-radius:${K.ACTOR.rest.size / 2}px;visibility:hidden}
#actor i{position:absolute;left:0;top:0;width:100%;height:100%;border-radius:inherit;background:var(--accent)}
.beat{position:absolute;left:0;top:0;visibility:hidden}
.beat.center{text-align:center}
.main,.big,.over{font-family:var(--font-display);${fonts.displayCss}}
.main{text-wrap:balance}
.over{text-wrap:balance}
.wm{display:inline-block;overflow:hidden;vertical-align:top;padding:0.16em 0.07em 0.22em;margin:-0.16em -0.07em -0.22em}
.w{display:inline-block;white-space:pre}
.w.em{color:var(--accent)}
.eg{white-space:nowrap}
.big{display:block;line-height:0.9;font-variant-numeric:tabular-nums;white-space:nowrap}
.big .wm{padding-top:0.1em;margin-top:-0.1em}
.cap{margin-top:0.32em}
.sub{display:block;font-family:var(--font-body);color:var(--sub);line-height:1.24;font-weight:500;text-wrap:pretty;margin-top:0.62em}
.items{display:block;margin-top:0.55em}
.item{display:flex;align-items:baseline;gap:0.55em;font-family:var(--font-body);font-weight:600;line-height:1.18;margin-top:0.42em;text-align:left}
.beat.center .item{justify-content:center}
.item b{flex:none;width:0.42em;height:0.42em;border-radius:50%;background:var(--accent);transform:translateY(-0.08em)}
.pillrow{display:block;margin-top:0.55em}
.pill{display:inline-block;background:var(--accent);color:var(--on-accent);border-radius:999px;padding:0.34em 0.95em 0.4em;font-family:var(--font-body);font-weight:700;line-height:1;white-space:nowrap}
.carrier{position:absolute;left:0;top:0;white-space:pre;visibility:hidden;font-family:var(--font-display);${fonts.displayCss}}
.mframe{position:absolute;overflow:hidden;contain:paint;isolation:isolate;visibility:hidden}
.mroot{position:absolute;left:0;top:0;width:100%;height:100%}
#chrome{position:absolute;left:0;top:0;display:flex;align-items:center;gap:20px;font-family:var(--font-body);font-weight:600;color:var(--sub);white-space:nowrap;visibility:hidden}
#chrome img{display:block;height:68px;width:auto}
#caps{position:absolute;left:0;top:1450px;width:${W}px;height:250px;pointer-events:none}
.fti{white-space:pre-line}`;

/**
 * Écrit le projet HyperFrames du plan dans hfDir. `safe` : mode sûr (rise et cut, caméra fixe, acteur rest ou
 * underline, aucun moment). `notes` reçoit les lignes en français pour la version (police de secours, plugins…).
 * Renvoie { duration, settle, marks: [{ id, title, start, end }], momentIds } (momentIds : les moments construits).
 */
export async function stagePage(cfg, plan, hfDir, { safe = false, notes = [] } = {}) {
  const video = plan?.video;
  if (!video || !Array.isArray(video.beats)) throw new Error("Plan vidéo illisible : aucun temps fort.");
  const pace = RHYTHM[plan.pace] ? plan.pace : "normal";
  const timed = timeScore(video, { pace });
  const kept = timed.video.beats.filter((b) => !b.cut);
  if (!kept.length) throw new Error("Plan vidéo sans temps fort gardé.");
  const D = timed.duration;
  const look = { theme: "night", accent: "#ff5a1f", font: "grotesque", align: "left", fields: [], ...(plan.look || {}) };
  const assets = join(hfDir, "assets");
  mkdirSync(assets, { recursive: true });
  const rnd = mulberry32(Number.isInteger(video.seed) ? video.seed : 0);
  const R = RHYTHM[pace];
  let shape = video.shape === "line" || video.shape === "none" ? video.shape : "orb";

  // Moments : début = start(from) − preroll, fin = end(to), sur les temps forts gardés de leur durée.
  const allIds = video.beats.map((b) => b.id);
  const moments = [];
  const frontOf = new Map();
  if (!safe) {
    for (const m of video.moments || []) {
      if (!m || !MOMENT_ID.test(String(m.id || "")) || !m.code || typeof m.code.js !== "string") continue;
      const a = allIds.indexOf(m.from), z = allIds.indexOf(m.to);
      if (a < 0 || z < a) continue;
      const span = new Set(allIds.slice(a, z + 1));
      const covered = kept.filter((b) => span.has(b.id));
      if (!covered.length) { notes.push(`L'animation « ${String(m.brief || m.id).slice(0, 80)} » n'a plus de temps fort gardé : sautée.`); continue; }
      const zone = ZONE_FRAMES[m.zone] && m.zone !== "none" ? m.zone : "above";
      const front = zone !== "behind";
      if (front && covered.some((b) => frontOf.has(b.id))) continue; // déjà un moment devant (cleanScore l'a normalement retiré)
      const start = r3(Math.max(0, covered[0].start - MOMENT.preroll));
      const end = covered[covered.length - 1].end;
      const frame = ZONE_FRAMES[zone].moment;
      if (front) for (const b of covered) frontOf.set(b.id, zone);
      moments.push({
        id: m.id, zone, start, end, D: r3(end - start), frame: { ...frame },
        last: covered[covered.length - 1].id === kept[kept.length - 1].id,
        beats: covered.map((b) => ({ id: b.id, t: r3(b.start - start), d: r3(b.end - b.start) })),
        html: String(m.code.html || ""), css: String(m.code.css || ""), js: m.code.js,
      });
    }
  }

  // Forme « aucune » : seulement si un moment construit porte la continuité (2 temps forts gardés ou plus). Sinon
  // (moment refusé, retiré après check, mode sûr), la forme de marque revient : sans elle, le repli serait une suite
  // de cartes.
  if (shape === "none" && !moments.some((m) => m.beats.length >= 2)) {
    shape = "orb";
    notes.push("Forme remise : l'animation sur mesure qui portait la continuité n'a pas été construite.");
  }
  const verbs = effective(kept, { safe, shape });

  // Temps forts : mots, emphase, nombre, cadre, verbes effectifs.
  let prevWords = null;
  const beats = kept.map((b, k) => {
    const v = verbs[k];
    const zone = frontOf.get(b.id) || "none";
    const box = { ...(ZONE_FRAMES[zone] || ZONE_FRAMES.none).text };
    let main = tokens(b.text, b.emphasis);
    let number = null;
    if (b.layout === "number" && zone !== "full") ({ number, main } = bigNumber(main, b.count === true));
    const out = {
      id: b.id, layout: zone === "full" ? "over" : b.layout, start: b.start, end: b.end, box,
      bridge: v.bridge, actor: v.actor, camera: v.camera, words: main,
      ...(b.sub && zone !== "full" ? { sub: b.sub } : {}),
      ...(b.layout === "list" && zone !== "full" && Array.isArray(b.items) ? { items: b.items.map((x) => words(x)) } : {}),
      ...(number ? { number } : {}),
      ...(b.layout === "cta" && zone !== "full" ? { pill: b.sub || DEFAULTS.ctaPill } : {}),
    };
    if (out.pill) delete out.sub;
    // carry : le mot commun, par sa place dans les mots affichés des deux temps forts.
    if (v.bridge === "carry") {
      const w = commonWord(kept[k - 1].text, b.text);
      const from = prevWords ? prevWords.findIndex((x) => x.t.split(/[\s\u202f]+/).map(bare).includes(w)) : -1;
      const to = main.findIndex((x) => x.t.split(/[\s\u202f]+/).map(bare).includes(w));
      if (from >= 0 && to >= 0) out.carry = { from, to };
      else out.bridge = "morph";
    }
    prevWords = main;
    return out;
  });

  // Signature : par le cta, sinon en bas de la boîte du dernier temps fort.
  const P = palette(look);
  const logo = logoOf(look);
  if (look.logo && !logo) notes.push("Logo illisible (PNG, JPEG ou WebP attendu) : la signature sort sans logo.");
  const handle = String(look.handle || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  const last = beats[beats.length - 1];
  const chrome = handle || logo ? { handle, logo: !!logo, beat: last.id, cta: last.layout === "cta", at: r3(last.start + CHROME.delay) } : null;

  // Décor : deux halos qui dérivent (points de passage tirés de la graine), quadrillage, grain.
  const n = Math.max(2, Math.ceil(D / 4.5) + 1);
  const halos = [
    { x: [470, 700], y: [-470, -230], s: [0.95, 1.2] },
    { x: [-470, -230], y: [1020, 1340], s: [0.85, 1.1] },
  ].map((zone) => Array.from({ length: n }, (_, i) => ({
    t: r3((D * i) / (n - 1)),
    x: Math.round(zone.x[0] + rnd() * (zone.x[1] - zone.x[0])),
    y: Math.round(zone.y[0] + rnd() * (zone.y[1] - zone.y[0])),
    s: r3(zone.s[0] + rnd() * (zone.s[1] - zone.s[0])),
  })));
  if (look.grain) writeFileSync(join(assets, "grain.png"), grainPng(DECOR.grain.tile, rnd));

  // Fichiers.
  const libs = copyGsap(cfg, assets, notes);
  const fonts = await copyFonts(cfg, look, assets, notes);
  if (logo) writeFileSync(join(assets, `logo.${logo.ext}`), logo.buf);
  const texts = cleanTexts(plan.texts);
  const free = textLayer(texts.map((t) => ({ ...t, text: "x" })), { W, H, total: D, accent: P.pal.accent, onAccent: P.pal.onAccent, family: fonts.display, track: 40 });
  const freeEls = free.els.map((e) => e.replace(/>x<\/span><\/div>$/, "></span></div>"));
  const freeTexts = texts.map((t, i) => ({ i, text: t.text })).filter((t) => texts[t.i].start <= D - 0.3);
  writeFileSync(join(assets, "texts.js"), `window.__TEXTS = function (tl, gsap) {\n${free.js.join("\n")}\n};\n`);

  // KEYS : la liste fermée des clés de tween, relue par la façade des moments à chaque appel (stage-runtime.js).
  const K = { ACTOR, BRIDGE, CAMERA, COUNT, DECOR, ENTER, MOMENT, KEYS: MOMENT_KEYS, TYPE, ZONE_FRAMES };
  const S = {
    engine: ENGINE, W, H, fps: FPS, D, pace, B: R.bridge, stagger: R.stagger, safe: !!safe, shape,
    align: look.align === "center" ? "center" : "left", grid: !!look.grid, grain: !!look.grain,
    fonts: { load: fonts.load }, pal: P.pal,
    beats, halos, chrome, texts: freeTexts,
    moments: moments.map((m) => { const o = { ...m }; delete o.js; return o; }),
    K,
  };
  writeFileSync(join(assets, "score.js"), `window.__SCORE = ${safeJson(S)};\n`);
  const params = [...MOMENT.params, ...MOMENT.shadowed].join(", ");
  // Garde-fou du moteur dans chaque boucle et chaque fonction (guardJs) : une boucle sans fin ou une récursion lance
  // une RangeError attribuée au moment (« moment <id>: … ») au lieu de figer check pendant 3 minutes.
  const guard = `var __n = 0, __g = function () { if (++__n > ${MOMENT.iterations}) throw new RangeError("boucle trop longue (plus de ${MOMENT.iterations} tours)"); };`;
  for (const m of moments) {
    let body;
    try { body = guardJs(m.js); } catch { body = 'throw new Error("code illisible");'; }
    writeFileSync(join(assets, `m-${m.id}.js`), `window.__MOMENTS = window.__MOMENTS || {};\nwindow.__MOMENTS["${m.id}"] = function (${params}) {\n"use strict";\n${guard}\n${body}\n};\n`);
  }
  copyFileSync(join(HERE, "stage-runtime.js"), join(assets, "stage.js"));

  const tokensCss = Object.entries({ ...P.tokens, "--font-display": fonts.display, "--font-body": fonts.body }).map(([k, v]) => `${k}:${v}`).join(";");
  const html = `<!doctype html>
<html lang="fr" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<meta name="viewport" content="width=${W}, height=${H}" />
<style>
${fonts.css}
:root{${tokensCss}}
${ENGINE_CSS(P, fonts, K)}
${free.css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${r3(D)}" data-width="${W}" data-height="${H}" data-fps="${FPS}">
<div id="stage" class="clip" data-start="0" data-duration="${r3(D)}">
<div id="bg"><div id="bgpar"><div class="halo h0" data-layout-allow-overflow></div><div class="halo h1" data-layout-allow-overflow></div>${look.grid ? '<div id="grid"></div>' : ""}</div></div>
<div id="cam"><div id="drift"><div id="behind"></div><div id="actor"><i></i></div><div id="type"></div><div id="moments"></div></div></div>
${look.grain ? '<div id="grain"></div>\n' : ""}<div id="chrome">${logo ? `<img id="logo" src="assets/logo.${logo.ext}" alt="" />` : ""}<span id="handle"></span></div>
<div id="caps"></div>
</div>
${freeEls.join("\n")}
</div>
<script>window.__timelines = window.__timelines || {}; /* window.__timelines["main"] est posé par assets/stage.js */</script>
${libs.map((f) => `<script src="assets/${f}"></script>`).join("\n")}
<script src="assets/score.js"></script>
${moments.map((m) => `<script src="assets/m-${m.id}.js"></script>`).join("\n")}
<script src="assets/texts.js"></script>
<script src="assets/stage.js"></script>
</body>
</html>
`;
  writeFileSync(join(hfDir, "index.html"), html);
  writeFileSync(join(hfDir, "hyperframes.json"), `${JSON.stringify({ paths: { assets: "assets" }, media: { autoProxy: true } })}\n`);
  writeFileSync(join(hfDir, "package.json"), `${JSON.stringify({ name: "metricove-reel", private: true, type: "module" })}\n`);
  writeFileSync(join(hfDir, "index.motion.json"), `${JSON.stringify({
    duration: r3(D),
    assertions: [
      { kind: "appearsBy", selector: `#t-${kept[0].id}`, bySec: ASSERTIONS.appearsBySec },
      { kind: "keepsMoving", maxStaticSec: ASSERTIONS.maxStaticSec },
    ],
  }, null, 2)}\n`);
  if (notes.length) log(`reel : ${notes.join(" | ").slice(0, 300)}`);
  return {
    duration: D,
    settle: timed.settle,
    marks: kept.map((b) => ({ id: b.id, title: b.title, start: b.start, end: b.end })),
    momentIds: moments.map((m) => m.id),
  };
}

/** Le texte du runtime (pour les tests et l'empreinte du moteur). */
export const runtimeSource = () => readFileSync(join(HERE, "stage-runtime.js"), "utf8");
