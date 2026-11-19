// Habillage HyperFrames (HTML + GSAP rendu en vidéo transparente), d'après le skill video-heds :
// sous-titres (karaoké : mot dit coloré ; pop : mot par mot ; simple : ligne entière), mots clés en couleur, emojis,
// placés en bas, en haut, au milieu ou sous/au-dessus du visage ; accroche masquée en ouverture, carton de fin.
// Règles reprises : chaque élément visible est un .clip ; états initiaux avec gsap.set ; immediateRender:false ;
// masques avec marge (accents et jambages jamais coupés) ; rendu --workers 1 (sinon ~30 Go d'images sur le disque).
import { writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { run, ensureDir, home } from "./util.mjs";
import { fontFaceCss, fontPaths } from "./fonts.mjs";
import { textLayer } from "./texts.mjs";
import { stageLayer } from "./stage.mjs";

const E = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const f = (x) => Number(x).toFixed(3);

function linesOf(ws, maxc) {
  const L = []; let cur = [];
  for (const w of ws) {
    if (cur.length && [...cur, w].map((x) => x.w).join(" ").length > maxc) { L.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) L.push(cur);
  return L;
}

/** Blocs de 2 lignes max, coupés sur la ponctuation, les silences (> 0,35 s) et les changements de phrase. */
function chunksOf(words, maxc) {
  const chunks = []; let cur = [];
  for (const w of words) {
    if (cur.length) {
      const p = cur[cur.length - 1];
      // Limites posées à la main dans Metricove : `brk` = un bloc commence ici, `glue` = pas de coupe avant ce mot (3 lignes au plus).
      const auto = linesOf([...cur, w], maxc).length > 2 || w.s - p.e > 0.35
          || (/[.?!,]$/.test(p.w) && cur.map((x) => x.w).join(" ").length >= 8);
      if (w.seg !== p.seg || w.brk || (w.glue ? linesOf([...cur, w], maxc).length > 3 : auto)) { chunks.push(cur); cur = []; }
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  for (let k = 1; k < chunks.length; ) {
    const a = chunks[k - 1], b = chunks[k];
    if (b.length === 1 && !b[0].brk && b[0].s - a[a.length - 1].e < 0.35 && b[0].seg === a[a.length - 1].seg && linesOf([...a, ...b], maxc).length <= 2) { a.push(...chunks.splice(k, 1)[0]); continue; }
    k++;
  }
  return chunks;
}

const SIZE = { s: 0.8, m: 1, l: 1.2 };

/**
 * Page HTML de la surcouche.
 * words : [{ w, s, e, seg, hl?, emoji? }] en secondes de la vidéo rendue ; speechEnd : fin de la parole ; dur : durée totale.
 * captions : { on, position, look, size, highlight, emoji } ; faces : { [seg]: { y0, y1 } } visage dans l'image (0..1), pour « auto ».
 */
const luma = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function overlayPage({ W, H, fps, dur, speechEnd, words, title, endCard, theme, format, captions = {}, faces = {}, texts = [], stages = [] }) {
  const k = Math.min(W, H) / 1080;
  const px = (v) => `${Math.round(v * k)}px`;
  const maxc = Math.round((theme.captionsMaxChars?.[format] || 18) / (SIZE[captions.size] || 1));
  const capSize = (format === "16:9" ? 64 : format === "9:16" ? 92 : 80) * (SIZE[captions.size] || 1);
  const capTop = format === "16:9" ? 0.76 : format === "9:16" ? 0.705 : 0.68;
  const A = theme.accent, T = theme.text, INK = theme.ink, DARK = theme.dark;
  const HL = /^#[0-9a-f]{6}$/i.test(captions.highlight || "") ? captions.highlight : A;
  const look = captions.look || "karaoke";
  const STRETCH = /^\d{2,3}%$/.test(theme.fontStretch || "") ? `font-stretch:${theme.fontStretch};` : "";
  const fontFaces = fontFaceCss(theme, (p) => `assets/${basename(p)}`);
  // Look vidéo du style (worker 0.19.0) : graisse, capitales, contour, fond derrière la ligne ou le mot dit, accroche.
  const D = theme.design || {};
  const hex = (v, or) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : or);
  const WEIGHT = D.weight >= 100 && D.weight <= 900 ? D.weight : 900;
  const CASE = D.upper ? "text-transform:uppercase;" : "";
  const SC = hex(D.strokeColor, "#000000"), SW = Math.max(0, Math.min(16, Number(D.stroke) || 0));
  const ring = SW ? [0, 45, 90, 135, 180, 225, 270, 315].map((d) => `${px(SW * Math.cos((d * Math.PI) / 180))} ${px(SW * Math.sin((d * Math.PI) / 180))} 0 ${SC}`) : [];
  const SHADOW = [...ring, ...(D.shadow === false ? [] : ["0 0 3px rgba(0,0,0,0.55)", "0 4px 22px rgba(0,0,0,0.55)"])].join(",") || "none";
  const BOX = D.box === "line" || D.box === "word" ? D.box : "none";
  const BC = hex(D.boxColor, A);
  const onBox = luma(BC) > 0.55 ? "#111111" : "#ffffff";
  const HOOK = D.hook === "text" || D.hook === "box" ? D.hook : "band";
  const els = [], js = [];

  // Place des sous-titres : bas, haut, milieu, ou « auto » = sous le visage, sinon au-dessus.
  const bh = (capSize * 3 * k) / H; // hauteur de la boîte (3 lignes) en fraction de l'image
  const P = { bottom: { top: capTop, shade: "bottom" }, top: { top: format === "9:16" ? 0.12 : 0.07, shade: "top" }, middle: { top: 0.5 - bh / 2, shade: "none" } };
  const posOf = (seg) => {
    if (captions.position && captions.position !== "auto") return P[captions.position] || P.bottom;
    const fc = faces[seg];
    if (!fc) return P.bottom;
    const free = (y) => y + bh * 0.75 < fc.y0 - 0.01 || y + bh * 0.25 > fc.y1 + 0.01; // texte centré dans la boîte
    if (free(capTop)) return P.bottom;
    const below = fc.y1 + 0.02 - bh * 0.2;
    if (below + bh <= 0.97) return { top: below, shade: "bottom" };
    const above = fc.y0 - 0.02 - bh * 0.8;
    if (above >= 0.03) return { top: above, shade: "top" };
    return P.bottom;
  };

  // Pendant un temps fort en écran coupé (portrait), les sous-titres se posent sur la jointure des deux moitiés.
  const stageAt = (t) => stages.find((s) => t >= s.a - 0.05 && t < s.b);
  const placeOf = (c) => {
    const st = stageAt(c[0].s);
    if (st?.kind === "split" && H >= W) return { top: 0.5 - bh / 2, shade: "none" };
    if (st) return { ...P.bottom, shade: "none" };
    return posOf(c[0].seg);
  };

  // Un bloc de sous-titres ne chevauche pas l'entrée ou la sortie d'un temps fort : il change de place avec lui.
  const chunks = (captions.on === false ? [] : chunksOf(words, maxc)).flatMap((c) => {
    const out = [[c[0]]];
    for (let m = 1; m < c.length; m++) {
      if (stageAt(c[m].s) !== stageAt(c[m - 1].s)) out.push([]);
      out[out.length - 1].push(c[m]);
    }
    return out;
  });
  // Ombre douce derrière les sous-titres pendant la parole (côté où ils sont)
  const blocks = [];
  for (const c of chunks) {
    const a = c[0].s, b = c[c.length - 1].e, shade = placeOf(c).shade;
    const last = blocks[blocks.length - 1];
    if (last && a - last[1] < 1.6 && last[2] === shade) last[1] = b; else blocks.push([a, b, shade]);
  }
  blocks.forEach(([a, b, shade], i) => {
    if (shade === "none") return;
    a = Math.max(0, a - 0.3); b = Math.min(speechEnd, b + 0.4);
    els.push(`<div id="sh${i}" class="clip shade ${shade === "top" ? "shade-top" : "shade-bottom"}" data-start="${f(a)}" data-duration="${f(b - a)}" data-track-index="0"></div>`);
    js.push(`tl.fromTo("#sh${i}",{opacity:0},{opacity:1,duration:0.4,immediateRender:false},${f(a)}); tl.to("#sh${i}",{opacity:0,duration:0.4},${f(Math.max(a, b - 0.4))});`);
  });
  chunks.forEach((c, i) => {
    const a = Math.max(0, c[0].s - 0.04);
    const nxt = i + 1 < chunks.length ? chunks[i + 1][0].s - 0.04 : speechEnd;
    const b = Math.min(nxt, c[c.length - 1].e + 0.5);
    if (b - a < 0.1) return;
    const pos = placeOf(c);
    let n = 0;
    const html = linesOf(c, maxc).map((line) => line.map((w) => `<span id="w${i}_${n++}" class="w"${w.hl ? ` style="color:${HL}"` : ""}>${E(w.w)}</span>`).join(" ")).join("<br>");
    const em = captions.emoji !== false ? c.findIndex((w) => w.emoji) : -1;
    const emo = em >= 0 ? `<div id="e${i}" class="emo ${pos.shade === "top" ? "emo-below" : "emo-above"}">${E(c[em].emoji)}</div>` : "";
    els.push(`<div id="c${i}" class="clip cap" style="top:${Math.round(H * pos.top)}px" data-start="${f(a)}" data-duration="${f(b - a)}" data-track-index="1"><div class="ct">${emo}${html}</div></div>`);
    if (look === "simple") js.push(`tl.fromTo("#c${i} .ct",{opacity:0},{opacity:1,duration:0.12,immediateRender:false},${f(a)});`);
    else if (look === "karaoke") js.push(`tl.fromTo("#c${i} .ct",{scale:0.86,opacity:0},{scale:1,opacity:1,duration:0.16,ease:"back.out(2.2)",immediateRender:false},${f(a)});`);
    else js.unshift(`gsap.set("#c${i} .w",{opacity:0,scale:0.55});`); // pop : mot par mot
    c.forEach((w, m) => {
      const on = Math.max(a, w.s), off = m + 1 < c.length ? c[m + 1].s : Math.min(b, w.e + 0.25);
      if (look === "pop") js.push(`tl.to("#w${i}_${m}",{opacity:1,scale:1,duration:0.14,ease:"back.out(3)"},${f(on)});`);
      if (look !== "simple" && BOX === "word") js.push(`tl.set("#w${i}_${m}",{color:"${onBox}",backgroundColor:"${BC}",textShadow:"none"},${f(on)}); tl.set("#w${i}_${m}",{color:"${w.hl ? HL : T}",backgroundColor:"rgba(0,0,0,0)",textShadow:"inherit"},${f(Math.max(off, on + 0.04))});`);
      else if (look !== "simple") js.push(`tl.set("#w${i}_${m}",{color:"${HL}"},${f(on)}); tl.set("#w${i}_${m}",{color:"${w.hl ? HL : T}"},${f(Math.max(off, on + 0.04))});`);
    });
    if (em >= 0) {
      js.unshift(`gsap.set("#e${i}",{xPercent:-50,scale:0,opacity:0});`);
      js.push(`tl.to("#e${i}",{scale:1,opacity:1,duration:0.22,ease:"back.out(2.5)"},${f(Math.max(a, c[em].s))});`);
    }
  });

  // Accroche en ouverture (bandeau couleur d'accent, texte révélé par masque), sous les sous-titres s'ils sont en haut.
  const clash = title?.text && chunks.map((c) => placeOf(c)).find((p, i) => chunks[i][0].s < (title.until || 2.5) && p.shade === "top");
  const ttlTop = clash ? Math.min(0.6, clash.top + bh + 0.02) : 0.16;
  if (title?.text) {
    const until = Math.max(1.2, Math.min(title.until || 2.5, speechEnd));
    els.push(`<div id="ttl" class="clip ttl" data-start="0" data-duration="${f(until)}" data-track-index="2"><div class="tb"><div class="m"><span>${E(title.text)}</span></div></div></div>`);
    js.unshift(`gsap.set("#ttl .tb",{scaleX:0}); gsap.set("#ttl .m>span",{yPercent:140});`);
    js.push(`tl.to("#ttl .tb",{scaleX:1,duration:0.35,ease:"expo.out"},0.05); tl.to("#ttl .m>span",{yPercent:0,duration:0.45,ease:"expo.out"},0.2);`);
    js.push(`tl.to("#ttl .m>span",{yPercent:-140,duration:0.3,ease:"expo.in"},${f(until - 0.45)}); tl.to("#ttl .tb",{scaleX:0,transformOrigin:"right center",duration:0.3,ease:"expo.in"},${f(until - 0.3)});`);
  }

  // Carton de fin (opaque) après la parole
  if (endCard?.text && dur - speechEnd > 0.5) {
    const s = speechEnd, d = dur - speechEnd;
    els.push(`<div id="end" class="clip end" data-start="${f(s)}" data-duration="${f(d)}" data-track-index="3"><div class="eb"></div><div class="m"><span>${E(endCard.text)}</span></div></div>`);
    js.unshift(`gsap.set("#end .eb",{scaleX:0}); gsap.set("#end .m>span",{yPercent:140});`);
    js.push(`tl.to("#end .eb",{scaleX:1,duration:0.45,ease:"expo.out"},${f(s + 0.15)}); tl.to("#end .m>span",{yPercent:0,duration:0.5,ease:"expo.out"},${f(s + 0.3)});`);
  }

  // Cartes des temps forts : sous les sous-titres (posées en premier dans la page), au-dessus de l'image.
  const stg = stageLayer(stages, { W, H, theme, k });
  els.unshift(...stg.els); js.unshift(...stg.js.filter((x) => x.startsWith("gsap.set"))); js.push(...stg.js.filter((x) => !x.startsWith("gsap.set")));

  // Textes libres posés à la main (au-dessus du reste, sauf du carton de fin qui est opaque).
  const free = textLayer(texts, { W, H, total: endCard?.text ? speechEnd : dur, accent: A, onAccent: INK });
  els.push(...free.els); js.unshift(...free.js.filter((x) => x.startsWith("gsap.set"))); js.push(...free.js.filter((x) => !x.startsWith("gsap.set")));

  const css = `${fontFaces}
${free.css}
${stg.css}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent}
#root{position:relative;width:${W}px;height:${H}px;font-family:"${theme.font}",${theme.fallbackFonts};${STRETCH}color:${T}}
.m{overflow:hidden;padding:0.22em 0.05em 0.28em;margin:-0.22em -0.05em -0.28em}.m>span{display:inline-block}
.shade{position:absolute;left:0;right:0}
.shade-bottom{top:${Math.round(H * (capTop - 0.2))}px;bottom:0;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,0.42) 45%,rgba(0,0,0,0.62) 100%)}
.shade-top{top:0;height:${Math.round(H * 0.42)}px;background:linear-gradient(0deg,rgba(0,0,0,0) 0%,rgba(0,0,0,0.42) 55%,rgba(0,0,0,0.62) 100%)}
.cap{position:absolute;left:${px(60)};right:${px(60)};height:${px(capSize * 3)};display:flex;align-items:center;justify-content:center}
.ct{position:relative;text-align:center;font-weight:${WEIGHT};font-size:${px(capSize)};line-height:${BOX === "line" ? 1.18 : 1.06};letter-spacing:-0.01em;${CASE}text-shadow:${BOX === "line" ? "none" : SHADOW}${BOX === "line" ? `;background:${BC};padding:${px(14)} ${px(26)};border-radius:${px(18)}` : ""}}
.w{display:inline-block;color:${BOX === "line" ? onBox : T}${BOX === "word" ? `;padding:0 ${px(10)};margin:0 -${px(4)};border-radius:${px(12)}` : ""}}
.emo{position:absolute;left:50%;font-size:${px(capSize * 1.15)};line-height:1;font-family:"Apple Color Emoji","Noto Color Emoji",sans-serif;text-shadow:none}
.emo-above{bottom:100%;margin-bottom:${px(14)}}.emo-below{top:100%;margin-top:${px(14)}}
.ttl{position:absolute;left:0;right:0;top:${Math.round(H * ttlTop)}px;display:flex;justify-content:center}
.tb{background:${HOOK === "text" ? "transparent" : HOOK === "box" ? "#ffffff" : A};color:${HOOK === "text" ? T : HOOK === "box" ? "#111111" : INK};padding:${px(18)} ${px(36)};transform-origin:left center;max-width:${Math.round(W * 0.88)}px${HOOK === "box" ? `;border-radius:${px(22)}` : ""}}
.tb span{font-weight:${WEIGHT};font-size:${px((format === "16:9" ? 66 : 78) * (HOOK === "text" ? 1.25 : 1))};line-height:1.05;text-align:center;${CASE}${HOOK === "text" ? `text-shadow:${SHADOW}` : ""}}
.end{position:absolute;inset:0;background:${DARK};display:flex;align-items:center;justify-content:center;flex-direction:column;gap:${px(28)}}
.eb{width:${px(140)};height:${px(14)};background:${A};transform-origin:left center}
.end span{font-weight:${WEIGHT};${CASE}font-size:${px(format === "16:9" ? 84 : 96)};line-height:1.05;text-align:center;color:${T};max-width:${Math.round(W * 0.84)}px}`;

  return `<!doctype html><html lang="fr" data-resolution="${W >= H ? "landscape" : "portrait"}"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>${css}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${f(dur)}" data-width="${W}" data-height="${H}" data-fps="${fps}">
${els.join("\n")}
</div>
<script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
gsap.set(".shade",{opacity:0});
${js.join("\n")}
tl.to({},{duration:0.01},${f(dur - 0.01)});
window.__timelines["main"]=tl; tl.seek(0);
</script></body></html>`;
}

/** Rend la page en .mov transparent (ProRes 4444). */
export async function renderOverlay(cfg, dir, html, out, { fps, theme }) {
  ensureDir(join(dir, "assets"));
  for (const p of fontPaths(theme)) if (existsSync(p)) copyFileSync(p, join(dir, "assets", basename(p)));
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ paths: { assets: "assets" }, media: { autoProxy: true } }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "metricove-montage", private: true, type: "module" }));
  // `gsapFile` (config) : une copie de gsap.min.js sur le Mac, pour rendre sans réseau (comme pour un reel).
  if (cfg.gsapFile && existsSync(home(cfg.gsapFile))) {
    copyFileSync(home(cfg.gsapFile), join(dir, "assets", "gsap.min.js"));
    html = html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"]+/, "assets/gsap.min.js");
  }
  writeFileSync(join(dir, "index.html"), html);
  await run("npx", ["--yes", cfg.hyperframes, "render", "--format", "mov", "--fps", String(fps), "--workers", "1", "-o", out, "--quiet", "."], { cwd: dir });
  return out;
}
