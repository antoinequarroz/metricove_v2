// Reel animé (action "motion") : une vidéo 9:16 sans rush, faite de scènes de texte animées dans le style du
// projet (mêmes couleurs, champs, quadrillage, police et signature que les visuels du Studio : src/lib/visuals.ts).
// La page est rendue par HyperFrames, puis ffmpeg ajoute la musique (ou une piste muette).
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, home, run, log } from "./util.mjs";
import { googleFaces } from "./fonts.mjs";
import { pickTrack } from "./audio.mjs";

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

/** Ce qui vient de la tâche, remis au propre : rien de ce qui est écrit dans la page n'est pris tel quel. */
export function cleanMotion(m = {}) {
  const l = m.look || {};
  const pick = (v, among, or) => (among.includes(v) ? v : or);
  const fields = (Array.isArray(l.fields) ? l.fields : []).filter((x) => HEX.test(x?.bg || "") && HEX.test(x?.ink || "")).slice(0, 3).map((x) => ({ bg: x.bg.toLowerCase(), ink: x.ink.toLowerCase() }));
  const theme = pick(l.theme, ["paper", "night", "accent", "gradient", "custom"], "night");
  const logo = typeof l.logo === "string" && l.logo.length <= 400_000 && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(l.logo) ? l.logo : "";
  const scenes = (Array.isArray(m.scenes) ? m.scenes : [])
    .map((s) => ({ title: String(s?.title || "").replace(/\r/g, "").trim().slice(0, 120), body: String(s?.body || "").replace(/\r/g, "").trim().slice(0, 240) }))
    .filter((s) => s.title || s.body)
    .slice(0, MAX_SCENES);
  return {
    scenes,
    music: m.music !== false,
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
function colors(look, i) {
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
  return Math.round(Math.max(64, Math.min(byLength, 900 / (longest * cw))));
}

/** Durée d'une scène : le temps de la lire, plus celui de l'animation. */
export const sceneSeconds = (s, last) => Math.min(7, Math.max(2.8, 1.9 + 0.058 * (s.title.length + s.body.length))) + (last ? 1.2 : 0);

const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

const WIPES = [
  ["inset(100% 0% 0% 0%)", "inset(0% 0% 0% 0%)"],
  ["circle(0% at 50% 62%)", "circle(125% at 50% 62%)"],
  ["inset(0% 0% 0% 100%)", "inset(0% 0% 0% 0%)"],
];

/**
 * La page du reel. `fonts` : { display: [{ url, rules }], body: [...] } (fichiers déjà copiés à côté de la page).
 * Renvoie { html, duration }.
 */
export function motionPage(motion, fonts = { display: [], body: [] }, gsap = GSAP) {
  const { look, scenes } = motion;
  const F = FONTS[look.font];
  const face = (fam, list) => list.map((x) => `@font-face{font-family:"${fam}";src:url("${x.url}") format("woff2");${x.rules}}`).join("\n");
  const sameFamily = F.display.family === F.body.family;
  const n = scenes.length;
  const durs = scenes.map((s, i) => sceneSeconds(s, i === n - 1));
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0));
  const total = durs.reduce((a, b) => a + b, 0);
  const center = look.align === "center";
  const els = [], js = [];

  scenes.forEach((s, i) => {
    const c = colors(look, i);
    const t0 = starts[i], d = durs[i];
    const size = s.title ? titleSize(s.title, look.font === "grotesque") : 0;
    const words = s.title.split("\n").map((line) => line.split(/\s+/).filter(Boolean).map((w) => `<span class="m"><span class="w">${E(w)}</span></span>`).join(" ")).join("<br>");
    const pill = look.numbers && n > 1 ? `<div class="num${look.pill ? " pill" : ""}" style="${look.pill ? `background:${c.mark};color:${typeof c.bg === "string" && HEX.test(c.bg) ? c.bg : "#171716"}` : `color:${c.sub}`}">${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}</div>` : "";
    const sig = look.handle || look.logo ? `<div class="sig" style="color:${c.sub}">${look.logo ? `<img src="${look.logo}" alt="">` : ""}${look.handle ? `<span>${E(look.handle)}</span>` : ""}</div>` : "";
    const bars = n > 1 ? `<div class="bars">${scenes.map((_, k) => `<i style="background:${alpha(HEX.test(c.line) ? c.line : "#ffffff", 0.22)}"><b style="background:${c.ink};transform:scaleX(${k < i ? 1 : 0})"></b></i>`).join("")}</div>` : "";
    els.push(`<div id="s${i}" class="clip scene" data-start="${f(t0)}" data-duration="${f(total - t0)}" data-track-index="${i}" style="z-index:${i + 1};background:${c.bg};color:${c.ink}">
${c.glow ? `<div class="glow" style="background:radial-gradient(circle at 90% 0%, ${alpha(look.accent, look.theme === "night" ? 0.26 : 0.16)}, ${alpha(look.accent, 0)} 60%)"></div>` : ""}${look.grid ? `<div class="grid" style="background-image:linear-gradient(${alpha(HEX.test(c.line) ? c.line : "#ffffff", 0.09)} 2px, transparent 2px),linear-gradient(90deg, ${alpha(HEX.test(c.line) ? c.line : "#ffffff", 0.09)} 2px, transparent 2px)"></div>` : ""}
<div class="orb" style="border-color:${c.mark}"></div>
${look.grain ? `<div class="grain"></div>` : ""}${bars}
<div class="box ${look.valign}${center ? " center" : ""}">${pill}
${s.title ? `<h1 style="font-size:${size}px">${words}</h1>` : ""}
<div class="rule" style="background:${c.mark}"></div>
${s.body ? `<p style="color:${c.sub}">${E(s.body).replace(/\n/g, "<br>")}</p>` : ""}</div>
${sig}</div>`);

    // Entrée de la scène : la première est là dès le début, les suivantes recouvrent la précédente.
    const wipe = WIPES[i % WIPES.length];
    if (i > 0) {
      js.unshift(`gsap.set("#s${i}",{clipPath:"${wipe[0]}"});`);
      js.push(`tl.to("#s${i}",{clipPath:"${wipe[1]}",duration:0.6,ease:"expo.inOut"},${f(t0 - 0.3)});`);
    }
    const a = t0 + (i ? 0.12 : 0.25);
    const nw = s.title.split(/\s+/).filter(Boolean).length;
    const stagger = Math.min(0.07, 0.5 / Math.max(1, nw));
    js.unshift(`gsap.set("#s${i} .w",{yPercent:118});gsap.set("#s${i} .num",{opacity:0,y:24});gsap.set("#s${i} .rule",{scaleX:0});gsap.set("#s${i} p",{opacity:0,y:44});${i === 0 ? `gsap.set("#s0 .sig",{opacity:0});` : ""}`);
    js.push(`tl.to("#s${i} .num",{opacity:1,y:0,duration:0.4,ease:"expo.out"},${f(a)});`);
    js.push(`tl.to("#s${i} .w",{yPercent:0,duration:0.7,ease:"expo.out",stagger:${f(stagger)}},${f(a + 0.08)});`);
    const after = a + 0.08 + stagger * nw + (s.title ? 0.25 : 0);
    js.push(`tl.to("#s${i} .rule",{scaleX:1,duration:0.55,ease:"expo.out"},${f(after)});`);
    js.push(`tl.to("#s${i} p",{opacity:1,y:0,duration:0.6,ease:"expo.out"},${f(after + 0.12)});`);
    if (i === 0) js.push(`tl.to("#s0 .sig",{opacity:1,duration:0.5},${f(after + 0.3)});`);
    // Vie de la scène : le décor dérive, la barre de progression avance.
    js.push(`tl.fromTo("#s${i} .orb",{x:${i % 2 ? -60 : 60},y:40,scale:0.92,rotation:0},{x:${i % 2 ? 50 : -50},y:-70,scale:1.08,rotation:${i % 2 ? -24 : 24},duration:${f(d + 0.6)},ease:"none",immediateRender:false},${f(Math.max(0, t0 - 0.3))});`);
    if (look.grid) js.push(`tl.fromTo("#s${i} .grid",{backgroundPosition:"0px 0px"},{backgroundPosition:"0px -${Math.round(18 * d)}px",duration:${f(d + 0.6)},ease:"none",immediateRender:false},${f(Math.max(0, t0 - 0.3))});`);
    if (n > 1) js.push(`tl.fromTo("#s${i} .bars i:nth-child(${i + 1}) b",{scaleX:0},{scaleX:1,duration:${f(d)},ease:"none",immediateRender:false},${f(t0)});`);
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
.bars{position:absolute;left:90px;right:90px;top:170px;display:flex;gap:10px}
.bars i{flex:1;height:6px;border-radius:3px;overflow:hidden}
.bars b{display:block;width:100%;height:100%;border-radius:3px;transform-origin:left center}
.box{position:absolute;left:90px;right:90px;top:280px;bottom:470px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:40px}
.box.top{justify-content:flex-start}.box.bottom{justify-content:flex-end}
.box.center{align-items:center;text-align:center}
.num{font-size:38px;font-weight:600;letter-spacing:0.08em;font-variant-numeric:tabular-nums}
.num.pill{padding:10px 26px;border-radius:999px;font-weight:700}
h1{font-family:"${F.display.family}",${FALLBACK[look.font]};${F.display.css};max-width:900px;text-wrap:balance}
.m{display:inline-block;overflow:hidden;vertical-align:top;padding:0.14em 0.04em 0.2em;margin:-0.14em -0.04em -0.2em}
.w{display:inline-block}
.rule{width:200px;height:12px;border-radius:6px;transform-origin:${center ? "center" : "left"} center}
p{font-size:58px;line-height:1.26;max-width:880px;text-wrap:pretty}
.sig{position:absolute;left:90px;right:90px;bottom:380px;display:flex;align-items:center;gap:18px;font-size:34px;font-weight:600${center ? ";justify-content:center" : ""}}
.sig img{height:64px;width:auto}`;

  const html = `<!doctype html><html lang="fr" data-resolution="portrait"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="${gsap}"></script>
<style>${css}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${f(total)}" data-width="${W}" data-height="${H}" data-fps="${FPS}">
${els.join("\n")}
</div>
<script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
${js.join("\n")}
tl.to({},{duration:0.01},${f(total - 0.01)});
window.__timelines["main"]=tl; tl.seek(0);
</script></body></html>`;
  return { html, duration: total };
}

/** Fabrique le reel d'une tâche "motion". Renvoie { video, duration, notes }. */
export async function makeMotion(cfg, job, dir, step = async () => {}) {
  const motion = cleanMotion(job.motion);
  if (!motion.scenes.length) throw new Error("Aucune scène à animer.");
  const notes = [];
  const hf = ensureDir(join(dir, "hf"));
  ensureDir(join(hf, "assets"));

  await step("Préparation des polices…", 0.05);
  const F = FONTS[motion.look.font];
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
  const { html, duration } = motionPage(motion, fonts, local ? "assets/gsap.min.js" : undefined);
  writeFileSync(join(hf, "hyperframes.json"), JSON.stringify({ paths: { assets: "assets" }, media: { autoProxy: true } }));
  writeFileSync(join(hf, "package.json"), JSON.stringify({ name: "metricove-reel", private: true, type: "module" }));
  writeFileSync(join(hf, "index.html"), html);

  await step(`Animation des ${motion.scenes.length} scènes (${Math.round(duration)} s)…`, 0.15);
  const silent = join(dir, "reel-muet.mp4");
  await run("npx", ["--yes", cfg.hyperframes, "render", "--format", "mp4", "--fps", String(FPS), "--workers", "1", "-o", silent, "--quiet", "."], { cwd: hf });
  if (!existsSync(silent)) throw new Error("Le rendu du reel n'a produit aucune vidéo.");

  await step("Son et finition…", 0.85);
  const out = join(dir, "reel.mp4");
  const track = motion.music ? pickTrack(cfg, "", notes) : null;
  const fade = Math.max(0, duration - 1.2);
  const audio = track
    ? ["-stream_loop", "-1", "-i", track, "-filter_complex", `[1:a]atrim=0:${f(duration)},volume=0.7,afade=t=in:d=0.4,afade=t=out:st=${f(fade)}:d=1.2[a]`, "-map", "0:v", "-map", "[a]"]
    : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a"];
  await run("ffmpeg", ["-v", "error", "-y", "-i", silent, ...audio, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f(duration), "-movflags", "+faststart", out]);
  rmSync(silent, { force: true });
  rmSync(hf, { recursive: true, force: true });
  for (const n of notes) log("note :", n);
  return { video: out, duration, notes };
}
