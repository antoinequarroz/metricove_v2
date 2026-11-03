// Habillage HyperFrames (HTML + GSAP rendu en vidéo transparente), d'après le skill video-heds :
// sous-titres karaoké (mot entier coloré d'un coup), accroche masquée en ouverture, carton de fin.
// Règles reprises : chaque élément visible est un .clip ; états initiaux avec gsap.set ; immediateRender:false ;
// masques avec marge (accents et jambages jamais coupés) ; rendu --workers 1 (sinon ~30 Go d'images sur le disque).
import { writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { run, ensureDir } from "./util.mjs";

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
      if (linesOf([...cur, w], maxc).length > 2 || w.s - p.e > 0.35 || w.seg !== p.seg
          || (/[.?!,]$/.test(p.w) && cur.map((x) => x.w).join(" ").length >= 8)) { chunks.push(cur); cur = []; }
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  for (let k = 1; k < chunks.length; ) {
    const a = chunks[k - 1], b = chunks[k];
    if (b.length === 1 && b[0].s - a[a.length - 1].e < 0.35 && b[0].seg === a[a.length - 1].seg && linesOf([...a, ...b], maxc).length <= 2) { a.push(...chunks.splice(k, 1)[0]); continue; }
    k++;
  }
  return chunks;
}

/**
 * Page HTML de la surcouche.
 * words : [{ w, s, e, seg }] en secondes de timeline ; speechEnd : fin de la parole ; dur : durée totale (avec carton de fin).
 */
export function overlayPage({ W, H, fps, dur, speechEnd, words, title, endCard, theme, format }) {
  const k = Math.min(W, H) / 1080;
  const px = (v) => `${Math.round(v * k)}px`;
  const maxc = theme.captionsMaxChars?.[format] || 18;
  const capSize = format === "16:9" ? 64 : format === "9:16" ? 92 : 80;
  const capTop = format === "16:9" ? 0.76 : format === "9:16" ? 0.705 : 0.68;
  const A = theme.accent, T = theme.text, INK = theme.ink, DARK = theme.dark;
  const fontFaces = (theme.fontFiles || []).map((p) => `@font-face{font-family:"${theme.font}";src:url("assets/${basename(p)}");}`).join("\n");
  const els = [], js = [];

  // Sous-titres karaoké + ombre douce pendant la parole
  const chunks = chunksOf(words, maxc);
  const blocks = [];
  for (const c of chunks) {
    const a = c[0].s, b = c[c.length - 1].e;
    if (blocks.length && a - blocks[blocks.length - 1][1] < 1.6) blocks[blocks.length - 1][1] = b; else blocks.push([a, b]);
  }
  blocks.forEach(([a, b], i) => {
    a = Math.max(0, a - 0.3); b = Math.min(speechEnd, b + 0.4);
    els.push(`<div id="sh${i}" class="clip shade" data-start="${f(a)}" data-duration="${f(b - a)}" data-track-index="0"></div>`);
    js.push(`tl.fromTo("#sh${i}",{opacity:0},{opacity:1,duration:0.4,immediateRender:false},${f(a)}); tl.to("#sh${i}",{opacity:0,duration:0.4},${f(Math.max(a, b - 0.4))});`);
  });
  chunks.forEach((c, i) => {
    const a = Math.max(0, c[0].s - 0.04);
    const nxt = i + 1 < chunks.length ? chunks[i + 1][0].s - 0.04 : speechEnd;
    const b = Math.min(nxt, c[c.length - 1].e + 0.5);
    if (b - a < 0.1) return;
    let n = 0;
    const html = linesOf(c, maxc).map((line) => line.map((w) => `<span id="w${i}_${n++}" class="w">${E(w.w)}</span>`).join(" ")).join("<br>");
    els.push(`<div id="c${i}" class="clip cap" data-start="${f(a)}" data-duration="${f(b - a)}" data-track-index="1"><div class="ct">${html}</div></div>`);
    js.push(`tl.fromTo("#c${i} .ct",{scale:0.86,opacity:0},{scale:1,opacity:1,duration:0.16,ease:"back.out(2.2)",immediateRender:false},${f(a)});`);
    c.forEach((w, m) => {
      const on = Math.max(a, w.s), off = m + 1 < c.length ? c[m + 1].s : Math.min(b, w.e + 0.25);
      js.push(`tl.set("#w${i}_${m}",{color:"${A}"},${f(on)}); tl.set("#w${i}_${m}",{color:"${T}"},${f(Math.max(off, on + 0.04))});`);
    });
  });

  // Accroche en ouverture (bandeau couleur d'accent, texte révélé par masque)
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

  const css = `${fontFaces}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent}
#root{position:relative;width:${W}px;height:${H}px;font-family:"${theme.font}",${theme.fallbackFonts};color:${T}}
.m{overflow:hidden;padding:0.22em 0.05em 0.28em;margin:-0.22em -0.05em -0.28em}.m>span{display:inline-block}
.shade{position:absolute;left:0;right:0;top:${Math.round(H * (capTop - 0.2))}px;bottom:0;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,0.42) 45%,rgba(0,0,0,0.62) 100%)}
.cap{position:absolute;left:${px(60)};right:${px(60)};top:${Math.round(H * capTop)}px;height:${px(capSize * 3)};display:flex;align-items:center;justify-content:center}
.ct{text-align:center;font-weight:900;font-size:${px(capSize)};line-height:1.06;letter-spacing:-0.01em;text-shadow:0 0 3px rgba(0,0,0,0.55),0 4px 22px rgba(0,0,0,0.55)}
.w{display:inline-block;color:${T}}
.ttl{position:absolute;left:0;right:0;top:${Math.round(H * 0.16)}px;display:flex;justify-content:center}
.tb{background:${A};color:${INK};padding:${px(18)} ${px(36)};transform-origin:left center;max-width:${Math.round(W * 0.88)}px}
.tb span{font-weight:900;font-size:${px(format === "16:9" ? 66 : 78)};line-height:1.05;text-align:center}
.end{position:absolute;inset:0;background:${DARK};display:flex;align-items:center;justify-content:center;flex-direction:column;gap:${px(28)}}
.eb{width:${px(140)};height:${px(14)};background:${A};transform-origin:left center}
.end span{font-weight:900;font-size:${px(format === "16:9" ? 84 : 96)};line-height:1.05;text-align:center;color:${T};max-width:${Math.round(W * 0.84)}px}`;

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
  for (const p of theme.fontFiles || []) if (existsSync(p)) copyFileSync(p, join(dir, "assets", basename(p)));
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ paths: { assets: "assets" }, media: { autoProxy: true } }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "metricove-montage", private: true, type: "module" }));
  writeFileSync(join(dir, "index.html"), html);
  await run("npx", ["--yes", cfg.hyperframes, "render", "--format", "mov", "--fps", String(fps), "--workers", "1", "-o", out, "--quiet", "."], { cwd: dir });
  return out;
}
