// Textes libres posés sur la vidéo depuis l'écran de montage (sans Claude) : un texte, un moment, une place, une taille.
// Les mêmes pour une vidéo face caméra (surcouche des sous-titres) et pour un reel animé (page du reel).
const E = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const f = (n) => Number(n).toFixed(3);
const num = (v, or) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : or);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const MAX_TEXTS = 12;
/** Hauteur des lettres pour une image de 1080 de large. */
const SIZE = { s: 44, m: 64, l: 92, xl: 128 };

/** Les textes d'un plan, bornés : [{ id, text, start, end, x, y, size, style }] (x, y : centre du texte, de 0 à 1). */
export function cleanTexts(raw) {
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_TEXTS) break;
    const text = String(t?.text ?? "").replace(/\r/g, "").trim().slice(0, 200);
    const start = Math.max(0, num(t?.start, 0));
    const end = num(t?.end, start + 3);
    if (!text || !(end - start >= 0.3)) continue;
    out.push({
      id: String(t?.id || "").replace(/[^\w-]/g, "").slice(0, 40) || `t${out.length + 1}`,
      text, start: Number(start.toFixed(2)), end: Number(Math.min(end, start + 600).toFixed(2)),
      x: clamp(num(t?.x, 0.5), 0, 1), y: clamp(num(t?.y, 0.5), 0, 1),
      size: Object.hasOwn(SIZE, t?.size) ? t.size : "m",
      style: t?.style === "band" ? "band" : "plain",
    });
  }
  return out;
}

/**
 * Le calque des textes libres pour une page HyperFrames : { els, js, css }.
 * W, H : taille de l'image ; total : durée de la vidéo ; ink / accent / onAccent : couleurs ; family : police (CSS).
 */
// Un texte simple est toujours blanc avec une ombre : lisible sur toutes les scènes qu'il traverse, et pareil que
// l'aperçu qu'on fait glisser dans Metricove. Un bandeau prend la couleur de marque.
export function textLayer(texts, { W, H, total, accent = "#ff5a1f", onAccent = "#ffffff", family = "inherit", track = 40 }) {
  const k = Math.min(W, H) / 1080;
  const els = [], js = [];
  cleanTexts(texts).forEach((t, i) => {
    // Un texte placé après la fin (la vidéo a raccourci depuis) n'est pas dessiné.
    if (t.start > total - 0.3) return;
    const a = t.start, b = Math.min(t.end, total);
    const px = Math.round(SIZE[t.size] * k);
    els.push(`<div id="ft${i}" class="clip ft" data-start="${f(a)}" data-duration="${f(b - a)}" data-track-index="${track + i}" style="left:${Math.round(t.x * W)}px;top:${Math.round(t.y * H)}px"><span class="fti ${t.style === "band" ? "ftb" : "ftp"}" style="font-size:${px}px">${E(t.text).replace(/\n/g, "<br>")}</span></div>`);
    js.unshift(`gsap.set("#ft${i} .fti",{opacity:0,scale:0.92});`);
    js.push(`tl.to("#ft${i} .fti",{opacity:1,scale:1,duration:0.25,ease:"back.out(2)"},${f(a)});`);
    // Un texte qui va jusqu'à la fin de la vidéo reste à l'écran.
    if (b < total - 0.05) js.push(`tl.to("#ft${i} .fti",{opacity:0,duration:0.2,ease:"power1.in"},${f(b - 0.2)});`);
  });
  const css = `.ft{position:absolute;width:${W}px;margin-left:${-W / 2}px;display:flex;justify-content:center;transform:translateY(-50%);z-index:90;pointer-events:none}
.fti{display:inline-block;max-width:${Math.round(W * 0.9)}px;text-align:center;font-family:${family};font-weight:800;line-height:1.12;letter-spacing:-0.01em;overflow-wrap:anywhere}
.ftp{color:#fff;text-shadow:0 0 4px rgba(0,0,0,0.6),0 4px 24px rgba(0,0,0,0.6)}
.ftb{background:${accent};color:${onAccent};padding:0.22em 0.5em;border-radius:0.18em}`;
  return { els, js, css: els.length ? css : "" };
}
