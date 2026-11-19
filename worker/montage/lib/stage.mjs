// Mise en scène des temps forts d'un face cam (worker 0.17.0) : la mise en page change le temps d'une idée.
//   split : écran coupé en deux, une carte (titre, illustration) d'un côté, le visage recadré de l'autre ;
//   card  : carte plein écran, la voix continue ;
//   pip   : carte plein écran, le visage dans une pastille ronde.
// Chaque carte entre avec une animation différente de la précédente (rise, slide, pop, wipe). Les bruitages sont
// des fichiers de la bibliothèque Metricove (`sound` = id), ou des sons faits ici avec FFmpeg (`builtin:whoosh`…).
// Temps de la timeline de l'éditeur dans l'EDL ; convertis en temps rendu par render.mjs.
import { existsSync, createWriteStream, renameSync, readdirSync, statSync, rmSync, copyFileSync } from "node:fs";
import { join, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureDir, home, log } from "./util.mjs";
import { synth, RANGE } from "./asset.mjs";

export const STAGE_KINDS = ["split", "card", "pip"];
export const STAGE_ANIMS = ["rise", "slide", "pop", "wipe"];
export const BUILTIN_SFX = ["whoosh", "swoosh", "pop", "click", "ding", "impact", "riser", "thud"];

let API = null;
/** Client de l'API Metricove : pour les fichiers de la bibliothèque (posé par montage.mjs). */
export const setStageApi = (api) => { API = api; };

const E = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const f = (x) => Number(x).toFixed(3);
const cacheDir = (cfg) => ensureDir(home(cfg.libraryCache || "~/Movies/Metricove/bibliotheque-cache"));
const EXT = { "image/svg+xml": ".svg", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/ogg": ".ogg", "audio/mp4": ".m4a" };

/** Fichier de la bibliothèque Metricove en cache (téléchargé une fois), ou null. */
export async function libraryAsset(cfg, id) {
  const clean = String(id || "").replace(/[^\w-]/g, "");
  if (!clean) return null;
  const dir = cacheDir(cfg);
  const have = readdirSync(dir).find((n) => n.startsWith(`${clean}.`) && !n.endsWith(".part"));
  if (have) return join(dir, have);
  if (!API) return null;
  const r = await API.req("GET", `/api/library/${encodeURIComponent(clean)}/file`, { raw: true });
  if (!r.ok) throw new Error(`fichier de la bibliothèque ${clean} → ${r.status}`);
  const type = String(r.headers.get("content-type") || "").split(";")[0].trim();
  const file = join(dir, `${clean}${EXT[type] || ".bin"}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file + ".part"));
  renameSync(file + ".part", file);
  trimCache(dir);
  return file;
}

/** Le cache garde ~300 Mo (les plus anciens partent). */
function trimCache(dir, cap = 300 * 1024 * 1024) {
  const files = readdirSync(dir).map((n) => join(dir, n)).filter((p) => statSync(p).isFile()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  let total = 0;
  files.forEach((p, i) => { total += statSync(p).size; if (i > 0 && total > cap) rmSync(p, { force: true }); });
}

/** Fichier son d'un bruitage : la bibliothèque, ou un son fait ici (`builtin:<recette>`). */
export async function sfxFile(cfg, sound, dir) {
  const m = /^builtin:(\w+)$/.exec(String(sound || ""));
  if (m) {
    if (!RANGE[m[1]]) return null;
    const file = join(ensureDir(dir), `sfx-${m[1]}.wav`);
    if (!existsSync(file)) await synth(m[1], RANGE[m[1]][0], RANGE[m[1]][1], file);
    return file;
  }
  return libraryAsset(cfg, sound).catch((e) => { log("bruitage :", e.message); return null; });
}

/** Une animation différente de la précédente, quand Claude ou Antoine n'en a pas choisi. */
export function animsFor(stages) {
  let prev = "";
  return stages.map((s, i) => {
    let a = STAGE_ANIMS.includes(s.anim) ? s.anim : STAGE_ANIMS[(i * 3 + 1) % STAGE_ANIMS.length];
    if (a === prev && !STAGE_ANIMS.includes(s.anim)) a = STAGE_ANIMS[(STAGE_ANIMS.indexOf(a) + 1) % STAGE_ANIMS.length];
    prev = a;
    return a;
  });
}

/** Zone de la carte dans l'image. Split : moitié haute (portrait) ou gauche (paysage). */
export function cardRect(kind, W, H) {
  if (kind !== "split") return { x: 0, y: 0, w: W, h: H };
  return H >= W ? { x: 0, y: 0, w: W, h: Math.round(H / 2) } : { x: 0, y: 0, w: Math.round(W / 2), h: H };
}

/** Pastille du visage (pip) : un rond en haut à droite. */
export function pipRect(W, H) {
  const d = Math.round((Math.min(W, H) * 0.36) / 2) * 2, m = Math.round(Math.min(W, H) * 0.06);
  return { x: W - d - m, y: Math.round(H >= W ? H * 0.07 : m), d };
}

/**
 * Filtres FFmpeg du visage pendant les temps forts (à poser sur l'image montée, avant la surcouche) :
 * split = le visage recadré dans l'autre moitié, pip = une pastille ronde. `src` = étiquette d'une copie de l'image.
 * `stages` en temps rendu : [{ a, b, kind, face: { cx, cy } }].
 */
export function faceLayers(stages, W, H, srcs) {
  const filters = [], overlays = [];
  stages.forEach((s, i) => {
    if (s.kind === "card") return;
    const L = `fl${i}`, src = srcs[i];
    const fade = `fade=t=in:st=${f(s.a)}:d=0.2:alpha=1,fade=t=out:st=${f(Math.max(s.a, s.b - 0.2))}:d=0.2:alpha=1`;
    const head = `[${src}]trim=start=${f(s.a)}:end=${f(s.b)}`;
    const cx = Math.min(1, Math.max(0, s.face?.cx ?? 0.5)), cy = Math.min(1, Math.max(0, s.face?.cy ?? 0.4));
    if (s.kind === "split") {
      const portrait = H >= W;
      const cw = portrait ? W : Math.round(W / 2 / 2) * 2, ch = portrait ? Math.round(H / 2 / 2) * 2 : H;
      const x = portrait ? 0 : Math.round(Math.min(W - cw, Math.max(0, cx * W - cw / 2)));
      const y = portrait ? Math.round(Math.min(H - ch, Math.max(0, cy * H - ch * 0.45))) : 0;
      filters.push(`${head},crop=${cw}:${ch}:${x}:${y},format=yuva420p,${fade}[${L}]`);
      overlays.push({ L, x: portrait ? 0 : W - cw, y: portrait ? H - ch : 0, a: s.a, b: s.b });
    } else {
      const p = pipRect(W, H);
      const side = Math.round((Math.min(W, H) * 0.7) / 2) * 2;
      const x = Math.round(Math.min(W - side, Math.max(0, cx * W - side / 2))), y = Math.round(Math.min(H - side, Math.max(0, cy * H - side / 2)));
      const circle = `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2-1),255,0)'`;
      filters.push(`${head},crop=${side}:${side}:${x}:${y},scale=${p.d}:${p.d},format=yuva420p,${circle},${fade}[${L}]`);
      overlays.push({ L, x: p.x, y: p.y, a: s.a, b: s.b, pip: true });
    }
  });
  return { filters, overlays };
}

/**
 * Cartes des temps forts dans la page HyperFrames (sous les sous-titres).
 * `stages` en temps rendu : [{ a, b, kind, title, body?, img? (nom dans assets/), anim }].
 */
export function stageLayer(stages, { W, H, theme, k }) {
  const els = [], js = [];
  const A = theme.accent, T = theme.text, DARK = theme.dark;
  const px = (v) => `${Math.round(v * k)}px`;
  stages.forEach((s, i) => {
    const r = cardRect(s.kind, W, H);
    const id = `st${i}`;
    // Fond sombre (les sous-titres passent dessus, mots clés en couleur d'accent compris) ; une carte sur deux a son
    // titre en couleur d'accent, pour que le rythme change d'un temps fort à l'autre.
    const bg = DARK, fg = T, bar = A, tc = i % 2 ? A : T;
    const half = s.kind === "split";
    const len = s.title.length;
    const ts = (len <= 12 ? 124 : len <= 24 ? 100 : len <= 40 ? 80 : 64) * (half ? 0.82 : 1);
    const pad = s.kind === "pip" ? `${px(H >= W ? 320 : 120)} ${px(80)} ${px(H >= W ? 420 : 140)}` : `${px(70)} ${px(80)} ${half ? px(70) : px(H >= W ? 460 : 160)}`;
    const ring = s.kind === "pip" ? (() => { const p = pipRect(W, H), b = Math.round(10 * k); return `<div class="sring" style="left:${p.x - b}px;top:${p.y - b}px;width:${p.d + 2 * b}px;height:${p.d + 2 * b}px;border:${b}px solid ${bar}"></div>`; })() : "";
    const img = s.img ? `<img class="sil" src="assets/${E(s.img)}" alt="" style="max-height:${Math.round(r.h * (half ? 0.36 : 0.3))}px" />` : "";
    els.push(`<div id="${id}" class="clip stg" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${bg};color:${fg};padding:${pad}" data-start="${f(s.a)}" data-duration="${f(s.b - s.a)}" data-track-index="4">`
      + `<div class="sin">${img}<div class="sbar" style="background:${bar}"></div><div class="m"><span class="stt" style="font-size:${px(ts)};color:${tc}">${E(s.title)}</span></div>`
      + `${s.body ? `<div class="sbd" style="font-size:${px(half ? 44 : 50)}">${E(s.body)}</div>` : ""}</div>${ring}</div>`);
    const a = s.a, out = Math.max(a + 0.5, s.b - 0.3);
    const parts = `#${id} .sil,#${id} .sbar,#${id} .m>span,#${id} .sbd`;
    if (s.anim === "slide") {
      js.unshift(`gsap.set("#${id}",{xPercent:-100}); gsap.set("${parts}",{x:-160,opacity:0});`);
      js.push(`tl.to("#${id}",{xPercent:0,duration:0.42,ease:"expo.out"},${f(a)}); tl.to("${parts}",{x:0,opacity:1,duration:0.5,ease:"expo.out",stagger:0.07},${f(a + 0.12)});`);
      js.push(`tl.to("#${id}",{xPercent:100,duration:0.3,ease:"expo.in"},${f(out)});`);
    } else if (s.anim === "pop") {
      js.unshift(`gsap.set("#${id}",{opacity:0,scale:1.08}); gsap.set("${parts}",{scale:0.5,opacity:0});`);
      js.push(`tl.to("#${id}",{opacity:1,scale:1,duration:0.28,ease:"power2.out"},${f(a)}); tl.to("${parts}",{scale:1,opacity:1,duration:0.42,ease:"back.out(2.2)",stagger:0.08},${f(a + 0.1)});`);
      js.push(`tl.to("#${id}",{opacity:0,scale:0.94,duration:0.3,ease:"power2.in"},${f(out)});`);
    } else if (s.anim === "wipe") {
      js.unshift(`gsap.set("#${id}",{clipPath:"inset(0% 0% 100% 0%)"}); gsap.set("${parts}",{y:40,opacity:0});`);
      js.push(`tl.to("#${id}",{clipPath:"inset(0% 0% 0% 0%)",duration:0.45,ease:"expo.inOut"},${f(a)}); tl.to("${parts}",{y:0,opacity:1,duration:0.4,ease:"expo.out",stagger:0.06},${f(a + 0.25)});`);
      js.push(`tl.to("#${id}",{clipPath:"inset(100% 0% 0% 0%)",duration:0.3,ease:"expo.in"},${f(out)});`);
    } else {
      js.unshift(`gsap.set("#${id}",{yPercent:100}); gsap.set("${parts}",{y:90,opacity:0});`);
      js.push(`tl.to("#${id}",{yPercent:0,duration:0.45,ease:"expo.out"},${f(a)}); tl.to("${parts}",{y:0,opacity:1,duration:0.5,ease:"expo.out",stagger:0.08},${f(a + 0.15)});`);
      js.push(`tl.to("#${id}",{yPercent:-100,duration:0.3,ease:"expo.in"},${f(out)});`);
    }
  });
  const css = `.stg{position:absolute;overflow:hidden;display:flex;align-items:center;justify-content:center}
.sin{display:flex;flex-direction:column;align-items:center;gap:${px(30)};text-align:center;max-width:100%}
.sil{display:block;max-width:80%;object-fit:contain}
.sbar{width:${px(120)};height:${px(12)};border-radius:${px(6)}}
.stt{font-weight:${theme.design?.weight >= 100 && theme.design.weight <= 900 ? theme.design.weight : 900};line-height:1.02;letter-spacing:-0.02em${theme.design?.upper ? ";text-transform:uppercase" : ""}}
.sbd{font-weight:600;line-height:1.2;opacity:0.86;max-width:${px(860)}}
.sring{position:absolute;border-radius:50%;box-sizing:border-box}`;
  return { els, js, css };
}

/** Copie les illustrations des cartes dans le dossier de la page ; renvoie les cartes avec `img`. */
export async function stageFiles(cfg, stages, assetsDir) {
  ensureDir(assetsDir);
  const out = [];
  for (const [i, s] of stages.entries()) {
    let img;
    if (s.illustration) {
      const file = await libraryAsset(cfg, s.illustration).catch((e) => { log("illustration :", e.message); return null; });
      if (file && /\.(svg|png|jpe?g|webp)$/i.test(file)) {
        img = `ill-${i}${extname(file).toLowerCase()}`;
        copyFileSync(file, join(assetsDir, img));
      }
    }
    out.push({ ...s, ...(img ? { img } : {}) });
  }
  return out;
}
