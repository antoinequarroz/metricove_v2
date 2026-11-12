// Reel animé (action "motion") : une vidéo 9:16 sans rush, faite de scènes de texte animées dans le style du
// projet (mêmes couleurs, champs, quadrillage, police et signature que les visuels du Studio : src/lib/visuals.ts).
// La page est rendue par HyperFrames, puis ffmpeg ajoute la musique (ou une piste muette).
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { ensureDir, home, run, log } from "./util.mjs";
import { googleFaces } from "./fonts.mjs";
import { pickTrack, musicCue } from "./audio.mjs";
import { writeArts, checkArt } from "./motion-art.mjs";

const W = 1080, H = 1920, FPS = 30;
export const MAX_SCENES = 8;

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, or) => (HEX.test(String(v || "")) ? String(v).toLowerCase() : or);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (h, to, t) => `rgb(${rgb(h).map((c, i) => Math.round(c + (to[i] - c) * t)).join(",")})`;
const alpha = (h, a) => `rgba(${rgb(h).join(",")},${a})`;
const isDark = (h) => { const [r, g, b] = rgb(h); return 0.299 * r + 0.587 * g + 0.114 * b < 165; };
const E = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const f = (n) => Number(n).toFixed(3);

export const ENTERS = ["rise", "type", "punch", "slide", "blur"];
export const TRANSITIONS = ["auto", "up", "circle", "side", "cut"];
export const DECORS = ["ring", "dots", "bars", "none"];
const PACE = { calm: 1.25, normal: 1, fast: 0.8 };

/** L'animation d'une scène : entrée du gros texte, mots en couleur, transition d'arrivée, décor, compteur. */
export function cleanAnim(a = {}) {
  const pick = (v, among) => (among.includes(v) ? v : among[0]);
  return {
    enter: pick(a?.enter, ENTERS),
    transition: pick(a?.transition, TRANSITIONS),
    decor: pick(a?.decor, DECORS),
    accent: String(a?.accent || "").replace(/\s+/g, " ").trim().slice(0, 60),
    count: a?.count === true,
  };
}

const BAD_HTML = /\bon[a-z]+\s*=|javascript:|https?:|\/\/[a-z0-9]|url\s*\(\s*(?!["']?#[\w-]+["']?\s*\))|<!--|<!|<\?/i;
const BAD_CSS = /@|url\s*\(|<|expression\s*\(|https?:|\/\/[a-z0-9]|\b(animation|transition)(-[a-z-]+)?\s*:|\/\*|\\/i;
const BAD_JS = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|import|require|eval|Function|constructor|setTimeout|setInterval|requestAnimationFrame|localStorage|sessionStorage|indexedDB|navigator|location|cookie|postMessage|Worker|document|ownerDocument|defaultView|getRootNode|parentNode|parentElement|closest|offsetParent|innerHTML|outerHTML|insertAdjacentHTML|createElement|__timelines|window|globalThis)\b|https?:|<\s*\/|<!--|repeat\s*:\s*-\s*1|Infinity/;
/** Les balises qu'un calque peut contenir : des boîtes et des formes, rien que la page anime elle-même (h1, p). */
const LAYER_TAGS = new Set("div span i b em svg g path circle rect line polyline polygon ellipse text tspan defs clippath mask lineargradient radialgradient stop".split(" "));

/** Les accolades d'un css s'ouvrent et se referment toutes : il peut être enfermé dans la règle de son calque. */
function balanced(css) {
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return false;
  }
  return depth === 0 && !/["']/.test(css);
}

/**
 * Le calque d'animation écrit par Claude pour la scène `n` (à partir de 1) ({ html, css, js }), ou undefined s'il
 * n'est pas sûr : pas de réseau, pas de script hors du corps de fonction, pas d'accès au reste de la page, rien d'infini,
 * des classes à lui (« k<n>- ») et des balises simples.
 */
export function cleanLayer(l, n = 1) {
  if (!l || typeof l !== "object") return undefined;
  // Un svg écrit dans une page n'a pas besoin de son espace de noms, que les modèles ajoutent par habitude.
  const html = String(l.html || "").replace(/\sxmlns(:\w+)?\s*=\s*("[^"]*"|'[^']*')/gi, "").trim();
  const css = String(l.css || "").trim(), js = String(l.js || "").trim();
  if (!html || !js) return undefined;
  if (html.length > 8000 || css.length > 6000 || js.length > 8000) return undefined;
  if (BAD_HTML.test(html) || BAD_CSS.test(css) || BAD_JS.test(js)) return undefined;
  for (const t of html.matchAll(/<\s*\/?\s*([a-z][\w:-]*)/gi)) if (!LAYER_TAGS.has(t[1].toLowerCase())) return undefined;
  // Ses classes et ses identifiants portent son préfixe : les animations de la page (.w, .num, .rule…) ne les touchent pas.
  // (Le numéro n'est pas imposé : une scène déplacée dans l'écran de montage garde son calque.)
  const own = /^k\d+-[\w-]+$/;
  for (const a of html.matchAll(/\s(class|id)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (!(a[3] ?? a[4] ?? a[5] ?? "").split(/\s+/).filter(Boolean).every((k) => own.test(k))) return undefined;
  }
  if (!balanced(css)) return undefined;
  // Le corps de fonction doit se lire seul, dans le mode strict où il tourne : une erreur de lecture casserait toute la page.
  try { new Function("tl", "gsap", "root", "t0", "d", "c", `"use strict";\n${js}`); } catch { return undefined; }
  return { html, css, js };
}

/** Ce qui vient de la tâche, remis au propre : rien de ce qui est écrit dans la page n'est pris tel quel. */
export function cleanMotion(m = {}) {
  const l = m.look || {};
  const pick = (v, among, or) => (among.includes(v) ? v : or);
  const fields = (Array.isArray(l.fields) ? l.fields : []).filter((x) => HEX.test(x?.bg || "") && HEX.test(x?.ink || "")).slice(0, 3).map((x) => ({ bg: x.bg.toLowerCase(), ink: x.ink.toLowerCase() }));
  const theme = pick(l.theme, ["paper", "night", "accent", "gradient", "custom"], "night");
  const logo = typeof l.logo === "string" && l.logo.length <= 400_000 && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(l.logo) ? l.logo : "";
  const scenes = (Array.isArray(m.scenes) ? m.scenes : [])
    .map((s) => ({
      // Ce que l'écran de montage garde d'une version à l'autre : l'identité de la scène, sa durée choisie, si elle
      // est coupée, et le code que Claude a écrit pour elle (revérifié avant chaque rendu).
      id: String(s?.id || "").replace(/[^\w-]/g, "").slice(0, 40) || `s-${randomUUID().slice(0, 8)}`,
      ...(Number(s?.seconds) >= 1.5 ? { seconds: Math.min(15, Number(s.seconds)) } : {}),
      ...(s?.cut === true ? { cut: true } : {}),
      ...(s?.layer && typeof s.layer === "object" ? { layer: s.layer } : {}),
      ...(s?.art && typeof s.art === "object" ? { art: s.art } : {}),
      title: String(s?.title || "").replace(/\r/g, "").trim().slice(0, 120),
      body: String(s?.body || "").replace(/\r/g, "").trim().slice(0, 240),
      // Consigne de motion design libre : Claude écrit lui-même cette scène (lib/motion-art.mjs).
      anim: String(s?.anim || "").replace(/\s+/g, " ").trim().slice(0, 300),
      // Réglages d'animation de la scène (entrée, transition, décor…), choisis par Claude d'après la consigne générale.
      fx: cleanAnim(s?.fx),
    }))
    .filter((s) => s.title || s.body)
    .slice(0, MAX_SCENES);
  return {
    scenes,
    // Avec ou sans le logo du projet (l'image elle-même arrive avec la tâche).
    logo: m.logo !== false,
    music: m.music !== false,
    // Volume de la musique (0 à 1) et morceau choisi dans le dossier du Mac.
    volume: Number.isFinite(Number(m.volume)) && m.volume !== null && m.volume !== undefined ? Math.min(1, Math.max(0, Number(m.volume))) : 0.7,
    track: String(m.track || "").slice(0, 200),
    // Départ dans le morceau et fondus, quand Antoine les a réglés.
    ...(m.cue && typeof m.cue === "object" ? { cue: { start: m.cue.start, fadeIn: m.cue.fadeIn, fadeOut: m.cue.fadeOut } } : {}),
    pace: Object.hasOwn(PACE, m.pace) ? m.pace : "normal",
    // Un rythme choisi par Antoine : Claude ne le change pas.
    paceSet: Object.hasOwn(PACE, m.pace),
    // Ce qu'Antoine demande pour l'animation, en français : Claude en fait des animations (lib/motion-direct.mjs).
    direction: String(m.direction || "").replace(/\r/g, "").trim().slice(0, 1000),
    look: {
      theme,
      accent: hex(l.accent, "#ff5a1f"),
      font: pick(l.font, ["serif", "sans", "grotesque"], "sans"),
      fields: theme === "custom" ? (fields.length ? fields : [{ bg: "#15161f", ink: "#f7f5ed" }]) : [],
      grid: l.grid === true,
      pill: l.pill === true,
      align: pick(l.align, ["left", "center"], "left"),
      valign: pick(l.valign, ["top", "middle", "bottom"], "middle"),
      grain: l.grain === true,
      numbers: l.numbers !== false,
      handle: String(l.handle || "").replace(/\s+/g, " ").trim().slice(0, 40),
      logo,
    },
  };
}

/** Couleurs d'une scène : fond, texte, texte secondaire, marque (même règle que les visuels du Studio). */
export function colors(look, i) {
  if (look.theme === "custom") {
    const fd = look.fields[i % look.fields.length];
    return { bg: fd.bg, ink: fd.ink, sub: mix(fd.ink, rgb(fd.bg), 0.3), mark: look.accent === fd.bg ? fd.ink : look.accent, line: fd.ink, glow: false };
  }
  if (look.theme === "night") return { bg: "#151514", ink: "#f6f3ec", sub: "#aaa69c", mark: look.accent, line: "#f6f3ec", glow: true };
  if (look.theme === "accent") {
    const d = isDark(look.accent);
    return { bg: look.accent, ink: d ? "#ffffff" : "#171716", sub: d ? "rgba(255,255,255,0.84)" : "rgba(23,23,22,0.74)", mark: d ? "#ffffff" : "#171716", line: d ? "#ffffff" : "#171716", glow: false };
  }
  if (look.theme === "gradient") {
    return {
      bg: `radial-gradient(circle at 85% 8%, rgba(255,255,255,0.28), rgba(255,255,255,0) 55%), linear-gradient(150deg, ${mix(look.accent, [255, 255, 255], 0.08)} 0%, ${mix(look.accent, [0, 0, 0], 0.28)} 55%, ${mix(look.accent, [10, 8, 30], 0.72)} 100%)`,
      ink: "#ffffff", sub: "rgba(255,255,255,0.84)", mark: "#ffffff", line: "#ffffff", glow: false,
    };
  }
  return { bg: "#f4f1ea", ink: "#1a1917", sub: "#5d5a53", mark: look.accent, line: "#1a1917", glow: true };
}

/** Polices du style : titres et textes. `spec` = police Google à télécharger. */
const FONTS = {
  grotesque: {
    display: { family: "Bricolage Grotesque", spec: "Bricolage Grotesque:opsz,wdth,wght@12..96,75..100,200..800", css: "font-weight:700;font-stretch:90%;letter-spacing:-0.035em;line-height:0.98" },
    body: { family: "Manrope", spec: "Manrope:wght@200..800", css: "font-weight:500" },
  },
  serif: {
    display: { family: "Instrument Serif", spec: "Instrument Serif", css: "font-weight:400;letter-spacing:-0.01em;line-height:1.02" },
    body: { family: "Geist", spec: "Geist:wght@100..900", css: "font-weight:400" },
  },
  sans: {
    display: { family: "Geist", spec: "Geist:wght@100..900", css: "font-weight:700;letter-spacing:-0.03em;line-height:1.02" },
    body: { family: "Geist", spec: "Geist:wght@100..900", css: "font-weight:400" },
  },
};
const FALLBACK = { grotesque: "'Helvetica Neue', Arial, sans-serif", serif: "Georgia, 'Times New Roman', serif", sans: "-apple-system, 'Helvetica Neue', Arial, sans-serif" };

/** Taille du gros texte : il doit tenir en 5 lignes au plus, sans couper un mot. */
function titleSize(title, condensed) {
  const cw = condensed ? 0.5 : 0.56; // largeur moyenne d'un caractère, en fraction de la taille
  const longest = Math.max(1, ...title.split(/\s+/).map((w) => w.length));
  const n = title.length;
  const byLength = n <= 14 ? 200 : n <= 26 ? 172 : n <= 44 ? 140 : n <= 70 ? 112 : 92;
  return Math.round(Math.max(48, Math.min(byLength, 900 / (longest * cw))));
}

/** Durée d'une scène : le temps de la lire, plus celui de l'animation. */
export const sceneSeconds = (s, last, pace = "normal") =>
  // Une durée choisie par Antoine dans l'écran de montage passe avant le calcul.
  s.seconds ? s.seconds : (Math.min(7, Math.max(2.8, 1.9 + 0.058 * (s.title.length + s.body.length))) + (s.anim ? 1.5 : 0) + (last ? 1.2 : 0)) * (PACE[pace] || 1);

/** Un mot sans casse, accent ni ponctuation, pour reconnaître les mots à mettre en couleur. */
const bare = (w) => String(w).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

const WIPES = {
  up: ["inset(100% 0% 0% 0%)", "inset(0% 0% 0% 0%)"],
  circle: ["circle(0% at 50% 62%)", "circle(125% at 50% 62%)"],
  side: ["inset(0% 0% 0% 100%)", "inset(0% 0% 0% 0%)"],
};
const AUTO = ["up", "circle", "side"];

/**
 * La page du reel. `fonts` : { display: [{ url, rules }], body: [...] } (fichiers déjà copiés à côté de la page).
 * `arts` : { [index]: { html, css, js } } — scènes libres écrites par Claude (déjà vérifiées par checkArt).
 * Renvoie { html, duration }.
 */
export function motionPage(motion, fonts = { display: [], body: [] }, gsap = GSAP, arts = {}) {
  const { look, scenes } = motion;
  const F = FONTS[look.font];
  const face = (fam, list) => list.map((x) => `@font-face{font-family:"${fam}";src:url("${x.url}") format("woff2");${x.rules}}`).join("\n");
  const sameFamily = F.display.family === F.body.family;
  const n = scenes.length;
  const durs = scenes.map((s, i) => sceneSeconds(s, i === n - 1, motion.pace));
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0));
  const total = durs.reduce((a, b) => a + b, 0);
  const center = look.align === "center";
  const els = [], js = [], extraCss = [];

  scenes.forEach((s, i) => {
    const art = arts[i];
    // Une scène libre a ses couleurs écrites dans son code : elle garde celles de la place pour laquelle elle a été écrite.
    const c = colors(look, art && Number.isInteger(s.art?.at) ? s.art.at : i);
    const t0 = starts[i], d = durs[i];
    // La scène existe dès le début de sa transition (0,3 s avant son tour) : elle recouvre la précédente.
    const on = Math.max(0, t0 - 0.3);
    const size = s.title ? titleSize(s.title, look.font === "grotesque") : 0;
    const an = cleanAnim(s.fx);
    const marked = new Set(an.accent.split(/\s+/).map(bare).filter(Boolean));
    // Le mot en couleur prend la couleur de marque ; si elle est celle du texte, il est souligné.
    const hl = c.mark === c.ink ? `box-shadow:inset 0 -0.08em 0 ${c.ink}` : `color:${c.mark}`;
    let counted = false;
    const word = (w) => {
      const inner = an.enter === "type" ? [...w].map((ch) => `<span class="l">${E(ch)}</span>`).join("") : E(w);
      const num = an.count && !counted && /^\d{1,6}$/.test(w.replace(/[%+.,!?]+$/, "")) ? w.match(/^\d+/)[0] : "";
      if (num) counted = true;
      // Le compteur garde la largeur de sa valeur finale (le texte ne bouge pas pendant qu'il monte) et part de 0.
      const cnt = num ? `<span class="cnt" data-to="${num}" style="min-width:${num.length}ch">0</span>${E(w.slice(num.length))}` : "";
      const body = num ? (an.enter === "type" ? `<span class="l">${cnt}</span>` : cnt) : inner;
      return `<span class="m"><span class="w"${marked.has(bare(w)) ? ` style="${hl}"` : ""}>${body}</span></span>`;
    };
    const words = s.title.split("\n").map((line) => line.split(/\s+/).filter(Boolean).map(word).join(" ")).join("<br>");
    const decor = an.decor === "ring" ? `<div class="orb" style="border-color:${c.mark}"></div>`
      : an.decor === "dots" ? `<div class="dots" style="background-image:radial-gradient(${c.mark} 5px, transparent 6px)"></div>`
      : an.decor === "bars" ? `<div class="stripes">${[0, 1, 2].map((k) => `<i style="background:${c.mark};top:${k * 150}px"></i>`).join("")}</div>`
      : "";
    const pill = look.numbers && n > 1 ? `<div class="num${look.pill ? " pill" : ""}" style="${look.pill ? `background:${c.mark};color:${typeof c.bg === "string" && HEX.test(c.bg) ? c.bg : "#171716"}` : `color:${c.sub}`}">${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}</div>` : "";
    const sig = look.handle || look.logo ? `<div class="sig" style="color:${c.sub}">${look.logo ? `<img src="${look.logo}" alt="">` : ""}${look.handle ? `<span>${E(look.handle)}</span>` : ""}</div>` : "";
    const bars = n > 1 ? `<div class="bars">${scenes.map((_, k) => `<i style="background:${alpha(HEX.test(c.line) ? c.line : "#ffffff", 0.22)}"><b style="background:${c.ink};transform:scaleX(${k < i ? 1 : 0})"></b></i>`).join("")}</div>` : "";
    els.push(`<div id="s${i}" class="clip scene" data-start="${f(on)}" data-duration="${f(total - on)}" data-track-index="${i}" style="z-index:${i + 1};background:${c.bg};color:${c.ink}">
${c.glow ? `<div class="glow" style="background:radial-gradient(circle at 90% 0%, ${alpha(look.accent, look.theme === "night" ? 0.26 : 0.16)}, ${alpha(look.accent, 0)} 60%)"></div>` : ""}${look.grid ? `<div class="grid" style="background-image:linear-gradient(${alpha(HEX.test(c.line) ? c.line : "#ffffff", 0.09)} 2px, transparent 2px),linear-gradient(90deg, ${alpha(HEX.test(c.line) ? c.line : "#ffffff", 0.09)} 2px, transparent 2px)"></div>` : ""}
${art ? "" : decor}${!art && s.layer ? `<div class="layer" id="x${i}"></div>` : ""}
${look.grain ? `<div class="grain"></div>` : ""}${bars}
${art ? `<div class="art"></div>` : `<div class="box ${look.valign}${center ? " center" : ""}">${pill}
${s.title ? `<h1 class="${an.enter === "rise" ? "" : "free"}" style="font-size:${size}px">${words}</h1>` : ""}
<div class="rule" style="background:${c.mark}"></div>
${s.body ? `<p style="color:${c.sub}">${E(s.body).replace(/\n/g, "<br>")}</p>` : ""}</div>`}
${sig}</div>`);
    if (art && art.css) extraCss.push(art.css);

    // Entrée de la scène : la première est là dès le début, les suivantes recouvrent la précédente.
    const cut = an.transition === "cut";
    const wipe = WIPES[an.transition === "auto" || cut ? AUTO[i % AUTO.length] : an.transition];
    if (i > 0) {
      js.unshift(`gsap.set("#s${i}",{clipPath:"${wipe[0]}"});`);
      js.push(cut ? `tl.set("#s${i}",{clipPath:"${wipe[1]}"},${f(t0)});` : `tl.to("#s${i}",{clipPath:"${wipe[1]}",duration:0.6,ease:"expo.inOut"},${f(t0 - 0.3)});`);
    }
    if (art) {
      // Scène libre : son code ajoute ses propres tweens à la timeline. Une erreur reste dans la scène.
      // Son html est posé par le navigateur dans sa boîte : une balise mal fermée ne déborde pas sur les autres scènes.
      js.push(`(function(){const root=document.querySelector("#s${i} .art");let ctx;try{root.innerHTML=${JSON.stringify(art.html).replace(/</g, "\\u003c")};const run=function(){(function(tl,root,T,D,gsap){\n${art.js}\n})(tl,root,${f(t0)},${f(d)},gsap);};if(gsap.context)ctx=gsap.context(run,root);else run();}catch(e){if(ctx)ctx.revert();console.error("scène libre s${i} : "+e.message);}})();`);
      if (i === 0) js.push(`gsap.set("#s0 .sig",{opacity:0});tl.to("#s0 .sig",{opacity:1,duration:0.5},${f(t0 + 0.8)});`);
      if (n > 1) js.push(`tl.fromTo("#s${i} .bars i:nth-child(${i + 1}) b",{scaleX:0},{scaleX:1,duration:${f(d)},ease:"none",immediateRender:false},${f(t0)});`);
      if (look.grid) js.push(`tl.fromTo("#s${i} .grid",{backgroundPosition:"0px 0px"},{backgroundPosition:"0px -${Math.round(18 * d)}px",duration:${f(d + 0.6)},ease:"none",immediateRender:false},${f(Math.max(0, t0 - 0.3))});`);
      if (i < n - 1) js.push(`tl.to("#s${i} .art",{y:-36,opacity:0,duration:0.35,ease:"power2.in"},${f(t0 + d - 0.42)});`);
      return;
    }
    const a = t0 + (i ? 0.12 : 0.25);
    const nw = s.title.split(/\s+/).filter(Boolean).length;
    const nl = [...s.title.replace(/\s+/g, "")].length;
    js.unshift(`gsap.set("#s${i} .num",{opacity:0,y:24});gsap.set("#s${i} .rule",{scaleX:0});gsap.set("#s${i} p",{opacity:0,y:44});${i === 0 ? `gsap.set("#s0 .sig",{opacity:0});` : ""}`);
    js.push(`tl.to("#s${i} .num",{opacity:1,y:0,duration:0.4,ease:"expo.out"},${f(a)});`);
    // Entrée du gros texte. `took` : le temps qu'elle prend avant que la suite (trait, petit texte) arrive.
    const at = a + 0.08;
    let took = 0;
    if (!s.title) took = 0;
    else if (an.enter === "type") {
      const each = Math.min(0.045, 1.3 / Math.max(1, nl));
      js.unshift(`gsap.set("#s${i} .l",{opacity:0});`);
      js.push(`tl.to("#s${i} .l",{opacity:1,duration:0.01,stagger:${f(each)}},${f(at)});`);
      took = each * nl + 0.15;
    } else if (an.enter === "punch") {
      js.unshift(`gsap.set("#s${i} h1",{opacity:0,scale:1.7,transformOrigin:"${center ? "50%" : "0%"} 50%"});`);
      js.push(`tl.to("#s${i} h1",{opacity:1,scale:1,duration:0.5,ease:"back.out(1.5)"},${f(at)});`);
      took = 0.45;
    } else if (an.enter === "slide") {
      const st = Math.min(0.07, 0.5 / Math.max(1, nw));
      js.unshift(`gsap.set("#s${i} .w",{opacity:0,x:-90});`);
      js.push(`tl.to("#s${i} .w",{opacity:1,x:0,duration:0.6,ease:"expo.out",stagger:${f(st)}},${f(at)});`);
      took = st * nw + 0.3;
    } else if (an.enter === "blur") {
      const st = Math.min(0.09, 0.6 / Math.max(1, nw));
      js.unshift(`gsap.set("#s${i} .w",{opacity:0,filter:"blur(18px)"});`);
      js.push(`tl.to("#s${i} .w",{opacity:1,filter:"blur(0px)",duration:0.7,ease:"power2.out",stagger:${f(st)}},${f(at)});`);
      took = st * nw + 0.35;
    } else {
      const st = Math.min(0.07, 0.5 / Math.max(1, nw));
      js.unshift(`gsap.set("#s${i} .w",{yPercent:118});`);
      js.push(`tl.to("#s${i} .w",{yPercent:0,duration:0.7,ease:"expo.out",stagger:${f(st)}},${f(at)});`);
      took = st * nw + 0.25;
    }
    // Compteur : le premier nombre du gros texte monte de 0 à sa valeur.
    if (counted) js.push(`(()=>{const el=document.querySelector("#s${i} .cnt");if(!el)return;const to=+el.dataset.to,o={v:0};tl.fromTo(o,{v:0},{v:to,duration:0.9,ease:"power2.out",immediateRender:false,onUpdate(){el.textContent=o.v>=to?el.dataset.to:String(Math.round(o.v))}},${f(at)});})();`);
    const after = at + took;
    js.push(`tl.to("#s${i} .rule",{scaleX:1,duration:0.55,ease:"expo.out"},${f(after)});`);
    js.push(`tl.to("#s${i} p",{opacity:1,y:0,duration:0.6,ease:"expo.out"},${f(after + 0.12)});`);
    if (i === 0) js.push(`tl.to("#s0 .sig",{opacity:1,duration:0.5},${f(after + 0.3)});`);
    // Vie de la scène : le décor dérive, la barre de progression avance.
    if (an.decor === "ring") js.push(`tl.fromTo("#s${i} .orb",{x:${i % 2 ? -60 : 60},y:40,scale:0.92,rotation:0},{x:${i % 2 ? 50 : -50},y:-70,scale:1.08,rotation:${i % 2 ? -24 : 24},duration:${f(d + 0.6)},ease:"none",immediateRender:false},${f(on)});`);
    if (an.decor === "dots") js.push(`tl.fromTo("#s${i} .dots",{backgroundPosition:"0px 0px",opacity:0},{backgroundPosition:"-60px -120px",opacity:0.5,duration:${f(d + 0.6)},ease:"none",immediateRender:false},${f(on)});`);
    if (an.decor === "bars") {
      js.unshift(`gsap.set("#s${i} .stripes i",{xPercent:120});`);
      js.push(`tl.to("#s${i} .stripes i",{xPercent:-30,duration:${f(Math.min(1.6, d))},ease:"expo.out",stagger:0.12},${f(on + 0.1)});`);
    }
    if (look.grid) js.push(`tl.fromTo("#s${i} .grid",{backgroundPosition:"0px 0px"},{backgroundPosition:"0px -${Math.round(18 * d)}px",duration:${f(d + 0.6)},ease:"none",immediateRender:false},${f(Math.max(0, t0 - 0.3))});`);
    if (n > 1) js.push(`tl.fromTo("#s${i} .bars i:nth-child(${i + 1}) b",{scaleX:0},{scaleX:1,duration:${f(d)},ease:"none",immediateRender:false},${f(t0)});`);
    // Calque écrit par Claude : dans son enveloppe, une erreur le retire sans toucher au reste de la vidéo.
    if (s.layer) {
      // Son css est enfermé dans la règle de son calque ; son html est posé par le navigateur dans sa boîte (une balise
      // mal fermée ne déborde pas sur la scène) ; ses sélecteurs GSAP ne cherchent que dans sa boîte.
      if (s.layer.css) extraCss.push(`#x${i}{${s.layer.css}}`);
      const safe = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
      js.push(`(function(){const root=document.getElementById("x${i}");let ctx;try{root.innerHTML=${safe(s.layer.html)};const run=function(){(function(tl,gsap,root,t0,d,c){"use strict";${s.layer.js}
})(tl,gsap,root,${f(t0)},${f(d)},${JSON.stringify({ bg: HEX.test(c.bg) ? c.bg : look.accent, ink: c.ink, sub: c.sub, mark: c.mark, accent: look.accent })});};if(gsap.context)ctx=gsap.context(run,root);else run();}catch(e){if(ctx)ctx.revert();root.style.display="none";console.warn("calque ${i} ignoré",e&&e.message);}})();`);
    }
    // Sortie : le texte s'efface un peu avant d'être recouvert. La dernière scène reste.
    if (i < n - 1) js.push(`tl.to("#s${i} .box",{y:-36,opacity:0.0,duration:0.35,ease:"power2.in"},${f(t0 + d - 0.42)});`);
    else js.push(`tl.to("#s${i} .rule",{scaleX:1.6,duration:0.8,ease:"sine.inOut",yoyo:true,repeat:1},${f(Math.min(total - 1.7, after + 0.9))});`);
  });

  const css = `${face(F.display.family, fonts.display)}
${sameFamily ? "" : face(F.body.family, fonts.body)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#111}
#root{position:relative;width:${W}px;height:${H}px;font-family:"${F.body.family}",${FALLBACK[look.font === "serif" ? "sans" : look.font]};${F.body.css}}
.scene{position:absolute;inset:0;overflow:hidden}
.glow,.grid,.grain{position:absolute;inset:0}
.grid{inset:-200px 0 -200px 0;background-size:${W / 8}px ${W / 8}px}
.grain{opacity:0.07;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>")}
.orb{position:absolute;right:-220px;top:150px;width:640px;height:640px;border-radius:50%;border:5px solid;opacity:0.2}
.dots{position:absolute;right:-40px;top:230px;width:520px;height:640px;background-size:60px 60px;-webkit-mask-image:linear-gradient(200deg,#000,transparent 75%);mask-image:linear-gradient(200deg,#000,transparent 75%)}
.stripes{position:absolute;right:-260px;bottom:120px;width:900px;height:420px;transform:rotate(-24deg)}
.stripes i{position:absolute;left:0;width:100%;height:84px;border-radius:42px;opacity:0.2}
h1.free .m{overflow:visible}
.l{display:inline-block}.cnt{display:inline-block;text-align:right;font-variant-numeric:tabular-nums}
.bars{position:absolute;left:90px;right:90px;top:170px;display:flex;gap:10px}
.bars i{flex:1;height:6px;border-radius:3px;overflow:hidden}
.bars b{display:block;width:100%;height:100%;border-radius:3px;transform-origin:left center}
.box{position:absolute;left:90px;right:90px;top:280px;bottom:470px;overflow:hidden;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:40px}
.box.top{justify-content:flex-start}.box.bottom{justify-content:flex-end}
.box.center{align-items:center;text-align:center}
.num{font-size:38px;font-weight:600;letter-spacing:0.08em;font-variant-numeric:tabular-nums}
.num.pill{padding:10px 26px;border-radius:999px;font-weight:700}
h1{font-family:"${F.display.family}",${FALLBACK[look.font]};${F.display.css};max-width:900px;text-wrap:balance;overflow-wrap:anywhere}
.m{display:inline-block;max-width:100%;overflow:hidden;vertical-align:top;padding:0.14em 0.04em 0.2em;margin:-0.14em -0.04em -0.2em}
.w{display:inline-block;max-width:100%}
.rule{width:200px;height:12px;border-radius:6px;transform-origin:${center ? "center" : "left"} center}
p{font-size:58px;line-height:1.26;max-width:880px;text-wrap:pretty;overflow-wrap:anywhere}
.sig{position:absolute;left:90px;right:90px;bottom:380px;display:flex;align-items:center;gap:18px;font-size:34px;font-weight:600${center ? ";justify-content:center" : ""}}
.sig img{height:64px;width:auto}
.art{position:absolute;inset:0}
.layer{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;isolation:isolate}
${extraCss.join("\n")}`;

  const html = `<!doctype html><html lang="fr" data-resolution="portrait"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="${gsap}"></script>
<style>${css}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${f(total)}" data-width="${W}" data-height="${H}" data-fps="${FPS}">
${els.join("\n")}
</div>
<script>
window.__timelines=window.__timelines||{};
// Un texte trop long pour la zone sûre est réduit jusqu'à tenir (refait quand les polices sont chargées), mesuré sans
// les déplacements de départ des animations (un titre « punch » agrandi ne compte pas comme trop long).
function fit(){document.querySelectorAll(".box").forEach((b)=>{const h=b.querySelector("h1"),p=b.querySelector("p");const els=[...b.children],was=els.map((e)=>e.style.transform);els.forEach((e)=>{e.style.transform="none"});for(let k=0;k<40&&b.scrollHeight>b.clientHeight+2;k++){if(h)h.style.fontSize=Math.max(40,parseFloat(getComputedStyle(h).fontSize)*0.94)+"px";if(p)p.style.fontSize=Math.max(30,parseFloat(getComputedStyle(p).fontSize)*0.95)+"px";}els.forEach((e,k)=>{e.style.transform=was[k]});});}
fit();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
const tl=gsap.timeline({paused:true});
${js.join("\n")}
tl.to({},{duration:0.01},${f(total - 0.01)});
window.__timelines["main"]=tl; tl.seek(0);
</script></body></html>`;
  return { html, duration: total, durs };
}

/**
 * Les scènes libres qui plantent dans Chrome : `hyperframes validate` charge la page et relève les erreurs de la console.
 * Une erreur d'une scène libre porte son nom (« scène libre sN ») ; une erreur qu'on ne sait pas attribuer les écarte toutes.
 */
async function brokenArts(cfg, hf, arts) {
  // `validate` sort en code 1 quand il trouve une erreur : sa réponse JSON (stdout) est lue dans tous les cas.
  const out = await new Promise((res) => {
    const p = spawn("npx", ["--yes", cfg.hyperframes, "validate", "--json", "--no-contrast", "--timeout", "5000", "."], { cwd: hf });
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.stderr.on("data", () => {});
    p.on("error", () => res(""));
    p.on("close", () => res(o));
  });
  let errors = [];
  try {
    const j = JSON.parse(out.slice(out.indexOf("{")));
    errors = (Array.isArray(j.errors) ? j.errors : []).map((x) => (typeof x === "string" ? x : x?.text || JSON.stringify(x)));
  } catch {
    // Pas de réponse lisible : on ne sait rien, on garde les scènes (le rendu a son propre filet).
    return [];
  }
  if (!errors.length) return [];
  const named = Object.keys(arts).filter((i) => errors.some((e) => e.includes(`scène libre s${i} `)));
  log("validation HyperFrames :", errors.slice(0, 3).join(" | ").slice(0, 400));
  return named.length ? named : Object.keys(arts);
}

/** Le code d'une scène libre écrit pour la scène `from`, replacé sur la scène `to` (ses sélecteurs commencent par #sN). */
export function moveArt(art, from, to) {
  if (from === to) return art;
  const re = new RegExp(`#s${from}(?![\\w-])`, "g");
  return { html: art.html, css: art.css.replace(re, `#s${to}`), js: art.js.replace(re, `#s${to}`) };
}

/**
 * Rend un plan de reel tel quel (sans rien demander à Claude) : `plan` = cleanMotion(...) dont les scènes portent
 * au besoin `seconds`, `cut`, `layer` et `art` ({ html, css, js, at } : `at` = la place pour laquelle il a été écrit).
 * Le code est revérifié, testé dans Chrome, et retiré s'il casse le rendu. `fresh` : les id des scènes dont le code
 * vient d'être écrit (retouche) ; si quelque chose casse, il est retiré en premier et le code des autres scènes reste.
 * Renvoie { video, duration, notes, plan } : `plan` est ce qui a vraiment été rendu (code retiré là où il a été
 * refusé, `dur` = secondes de chaque scène à l'écran), à garder avec la version.
 */
export async function renderPlan(cfg, plan, dir, step = async () => {}, notes = [], fresh = new Set()) {
  const kept = plan.scenes.filter((s) => !s.cut);
  if (!kept.length) throw new Error("Aucune scène à animer.");
  const hf = ensureDir(join(dir, "hf"));
  ensureDir(join(hf, "assets"));

  await step("Préparation des polices…", 0.12);
  const F = FONTS[plan.look.font];
  const fonts = { display: [], body: [] };
  for (const [k, part] of Object.entries({ display: F.display, body: F.body })) {
    if (k === "body" && F.body.spec === F.display.spec) { fonts.body = fonts.display; continue; }
    const faces = await googleFaces(cfg, part.spec);
    if (!faces.length) notes.push(`Police « ${part.family} » indisponible : une police proche du Mac la remplace.`);
    faces.forEach((x, i) => {
      const name = `${k}-${i}.woff2`;
      copyFileSync(x.file, join(hf, "assets", name));
      fonts[k].push({ url: `assets/${name}`, rules: x.rules });
    });
  }
  // `gsapFile` (config) : une copie de gsap.min.js sur le Mac, pour rendre sans réseau.
  const local = cfg.gsapFile && existsSync(home(cfg.gsapFile));
  if (local) copyFileSync(home(cfg.gsapFile), join(hf, "assets", "gsap.min.js"));
  const gsapSrc = local ? "assets/gsap.min.js" : undefined;
  writeFileSync(join(hf, "hyperframes.json"), JSON.stringify({ paths: { assets: "assets" }, media: { autoProxy: true } }));
  writeFileSync(join(hf, "package.json"), JSON.stringify({ name: "metricove-reel", private: true, type: "module" }));

  // Le code gardé avec le plan repasse les mêmes contrôles que le jour où Claude l'a écrit.
  const arts = {};
  const scenes = kept.map((s, i) => {
    const out = { ...s };
    delete out.art; delete out.layer;
    if (s.art) {
      const at = Number.isInteger(s.art.at) ? s.art.at : i;
      const ok = checkArt(s.art, at);
      if (typeof ok === "string") notes.push(`Scène ${i + 1} : animation sur mesure refusée (${ok}), animation standard.`);
      else { arts[i] = moveArt(ok, at, i); out.art = { ...ok, at }; }
    } else if (s.layer) {
      const ok = cleanLayer(s.layer, i + 1);
      if (ok) out.layer = ok;
      else notes.push(`Scène ${i + 1} : animation de fond refusée par les règles de sécurité, décor standard.`);
    }
    return out;
  });
  let live = { ...plan, scenes };
  if (Object.keys(arts).length) {
    await step("Vérification des animations…", 0.16);
    writeFileSync(join(hf, "index.html"), motionPage(live, fonts, gsapSrc, arts).html);
    const drop = (list) => {
      for (const i of list) {
        delete arts[i];
        delete scenes[i].art;
        notes.push(`Scène ${Number(i) + 1} : l'animation de Claude plante dans Chrome, animation standard.`);
      }
    };
    let bad = await brokenArts(cfg, hf, arts);
    const isNew = (i) => fresh.has(scenes[i].id);
    // Une erreur que l'on ne sait pas attribuer désigne toutes les scènes libres : on retire d'abord celles qui viennent d'être écrites.
    if (bad.length > 1 && bad.length === Object.keys(arts).length && bad.some(isNew) && !bad.every(isNew)) {
      drop(bad.filter(isNew));
      writeFileSync(join(hf, "index.html"), motionPage(live, fonts, gsapSrc, arts).html);
      bad = await brokenArts(cfg, hf, arts);
    }
    drop(bad);
  }

  const silent = join(dir, "reel-muet.mp4");
  const render = async (m, a) => {
    const page = motionPage(m, fonts, gsapSrc, a);
    writeFileSync(join(hf, "index.html"), page.html);
    rmSync(silent, { force: true });
    await run("npx", ["--yes", cfg.hyperframes, "render", "--format", "mp4", "--fps", String(FPS), "--workers", "1", "-o", silent, "--quiet", "."], { cwd: hf });
    if (!existsSync(silent)) throw new Error("Le rendu du reel n'a produit aucune vidéo.");
    return page;
  };
  await step(`Animation des ${scenes.length} scènes…`, 0.2);
  let page;
  try {
    page = await render(live, arts);
  } catch (e) {
    const coded = (x) => !!(x.layer || x.art);
    if (!scenes.some(coded)) throw e;
    log("rendu refusé avec les animations de Claude :", String(e.message).slice(0, 300));
    // Premier filet (retouche) : seul le code qui vient d'être écrit est retiré, celui des autres scènes reste.
    if (scenes.some((x) => coded(x) && fresh.has(x.id)) && scenes.some((x) => coded(x) && !fresh.has(x.id))) {
      await step("Nouvel essai sans la nouvelle animation…", 0.45);
      const older = { ...live, scenes: scenes.map((x) => (fresh.has(x.id) ? (({ layer: _l, art: _a, ...y }) => y)(x) : x)) };
      const olderArts = Object.fromEntries(Object.entries(arts).filter(([i]) => !fresh.has(scenes[i].id)));
      try {
        page = await render(older, olderArts);
        live = older;
        notes.push("La nouvelle animation écrite par Claude a fait échouer le rendu : ces scènes ont l'animation standard, le reste du reel n'a pas bougé.");
      } catch (e2) {
        log("toujours refusé :", String(e2.message).slice(0, 300));
      }
    }
    if (!page) {
      // Dernier filet : on garde les choix d'entrées, de transitions et de décors, sans aucun code de Claude.
      notes.push("Une animation écrite par Claude a fait échouer le rendu : le reel est sorti sans ses animations sur mesure.");
      await step("Nouvel essai avec les animations standard…", 0.5);
      live = { ...live, scenes: scenes.map(({ layer: _l, art: _a, ...x }) => x) };
      page = await render(live, {});
    }
  }
  const duration = page.duration;

  await step("Son et finition…", 0.85);
  const out = join(dir, "reel.mp4");
  const track = plan.music ? pickTrack(cfg, plan.track || "", notes) : null;
  const cue = musicCue(plan.cue, duration);
  const audio = track
    ? ["-stream_loop", "-1", ...cue.seek, "-i", track, "-filter_complex", `[1:a]atrim=0:${f(duration)},asetpts=N/SR/TB,volume=${f(plan.volume ?? 0.7)}${cue.fades ? `,${cue.fades}` : ""}[a]`, "-map", "0:v", "-map", "[a]"]
    : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a"];
  await run("ffmpeg", ["-v", "error", "-y", "-i", silent, ...audio, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f(duration), "-movflags", "+faststart", out]);
  rmSync(silent, { force: true });
  rmSync(hf, { recursive: true, force: true });
  for (const n of notes) log("note :", n);
  // Le plan rendu : les scènes coupées gardent leur place, les autres portent leur durée à l'écran.
  let k = 0;
  const { look: _look, paceSet: _p, ...rest } = live;
  const done = { ...rest, look: { ...plan.look, logo: "" }, duration, scenes: plan.scenes.map((s) => (s.cut ? s : { ...live.scenes[k], dur: Number(page.durs[k++].toFixed(3)) })) };
  return { video: out, duration, notes, plan: done };
}

/**
 * Fabrique le reel d'une tâche "motion" pour la première fois : Claude dirige et écrit les animations demandées,
 * puis le plan est rendu. Renvoie { video, duration, notes, plan }.
 */
export async function makeMotion(cfg, job, dir, step = async () => {}, direct = null) {
  const motion = cleanMotion(job.motion);
  if (!motion.scenes.length) throw new Error("Aucune scène à animer.");
  const notes = [];

  // Consigne générale : Claude choisit les animations de chaque scène et écrit ses calques HyperFrames (derrière le texte).
  let directed = motion;
  if (motion.direction && direct) {
    await step("Claude imagine les animations…", 0.04);
    try {
      directed = await direct(cfg, motion, dir);
      const layers = directed.scenes.filter((x) => x.layer).length;
      log(`animations de Claude : ${layers} calque(s) sur ${directed.scenes.length} scène(s)`);
      if (directed.refused) notes.push(`${directed.refused} animation(s) écrite(s) par Claude refusée(s) par les règles de sécurité : ces scènes gardent les animations prêtes à l'emploi.`);
    } catch (e) {
      notes.push(`Claude n'a pas pu préparer les animations (${String(e.message).slice(0, 160)}) : animations standard.`);
    }
  }

  // Scènes libres (consigne d'une scène) : Claude écrit leur code ; il est vérifié puis testé dans Chrome au rendu.
  if (directed.scenes.some((s) => s.anim)) {
    await step("Claude écrit les animations demandées…", 0.08);
    const r = await writeArts(cfg, directed, artContext(directed), dir);
    notes.push(...r.notes);
    directed = { ...directed, scenes: directed.scenes.map((s, i) => (r.arts[i] ? { ...s, art: { ...r.arts[i], at: i } } : s)) };
  }
  return renderPlan(cfg, directed, dir, step, notes);
}

/** Ce que Claude doit savoir pour écrire une scène libre : polices, couleurs et durées du plan. */
export function artContext(plan) {
  const F = FONTS[plan.look.font];
  const n = plan.scenes.length;
  return {
    look: plan.look,
    fonts: { display: F.display.family, body: F.body.family },
    durs: plan.scenes.map((s, i) => sceneSeconds(s, i === n - 1, plan.pace)),
    n,
    colors: (i) => {
      const c = colors(plan.look, i);
      return { ...c, bgLabel: HEX.test(c.bg) ? c.bg : `dégradé autour de ${plan.look.accent}` };
    },
  };
}
