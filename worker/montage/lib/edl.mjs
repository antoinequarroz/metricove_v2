// Calculs de timeline : mêmes règles que src/lib/montage.ts (mots coupés, plans raccourcis ou coupés en deux),
// plus le plan de coupe du rendu (mots coupés et silences retirés) et la conversion vers le temps de la vidéo rendue.
import { round } from "./util.mjs";

/** Mots de remplissage coupés d'office (même liste que « Couper les euh » dans Metricove). */
export const FILLER = /^(e+u+h+|h+e+u+h*|h+u+m+|h+m+|bah|ben)[.,!?…]*$/i;

export const DEFAULT_CAPTIONS = { on: true, position: "auto", look: "karaoke", size: "m", emoji: true };
export const DEFAULT_AUDIO = { denoise: true, silences: "tight", music: { on: false, volume: 0.15, duck: true } };

/** Réglages son de l'EDL complétés par les valeurs par défaut du contrat. */
export const audioOf = (edl) => ({ ...DEFAULT_AUDIO, ...(edl.audio || {}), music: { ...DEFAULT_AUDIO.music, ...(edl.audio?.music || {}) } });
/** Style des sous-titres : EDL, sinon style du projet (job.style), sinon défaut. */
export const captionsOf = (edl, style) => ({ ...DEFAULT_CAPTIONS, ...(edl.captions || style || {}) });

/** Partie d'un mot comprise dans le plan (in..out). */
const inside = (w, s) => [Math.max(w.t0, s.in), Math.min(w.t1, s.out)];

function merge(iv) {
  const out = [];
  for (const [a, b] of iv.filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0])) {
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Temps de rush retirés d'un segment : mots coupés, et part des silences entre les mots selon `mode`
 * (tight : silences > 0,3 s ramenés à 0,15 s ; cut : silences > 0,15 s, il reste 0,04 s).
 * Miroir exact de removedSpans (src/lib/montage.ts) : la timeline de l'éditeur et le rendu ont la même durée.
 * Les temps des mots sont déjà recalés sur les silences entendus à la transcription.
 */
export function removedSpans(s, mode = "keep") {
  const rem = [];
  const ws = (s.words || []).filter((w) => w.t1 > s.in && w.t0 < s.out);
  for (const w of ws) if (w.cut) rem.push(inside(w, s));
  const live = ws.filter((w) => !w.cut);
  if (mode !== "keep" && live.length) {
    const keep = mode === "tight" ? 0.15 : 0.04;
    const min = mode === "tight" ? 0.3 : 0.15;
    const gaps = [];
    let prev = s.in;
    for (const w of live) { if (w.t0 > prev) gaps.push([prev, w.t0]); prev = Math.max(prev, w.t1); }
    if (s.out > prev) gaps.push([prev, s.out]);
    for (const [a, b] of gaps) {
      if (b - a <= min) continue;
      const head = a <= s.in + 1e-3, tail = b >= s.out - 1e-3;
      const ra = head ? a : tail ? a + keep : a + keep / 2;
      const rb = tail ? b : head ? b - keep : b - keep / 2;
      if (rb - ra > 0.02) rem.push([ra, rb]);
    }
  }
  return merge(rem);
}

/** Vitesse d'un plan (0,5 à 2 ; absente : 1). Même règle que src/lib/montage.ts. */
export const speedOf = (s) => (s.speed >= 0.5 && s.speed <= 2 ? s.speed : 1);

const goneBefore = (gone, r) => gone.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, r) - a), 0);

/** Timeline de l'éditeur : segments gardés, dans l'ordre ; durée = out − in − parties retirées. */
export function timeline(edl) {
  let t = 0;
  const mode = audioOf(edl).silences;
  return edl.segments.filter((s) => s.kept && s.out > s.in).map((s) => {
    const gone = removedSpans(s, mode);
    const seg = { ...s, gone, start: round(t), dur: round(Math.max(0, s.out - s.in - goneBefore(gone, s.out)) / speedOf(s)) };
    t += seg.dur;
    return seg;
  });
}

/** Seconde de la timeline de l'éditeur d'une seconde de rush, dans un segment placé. */
export function toTimeline(s, r) {
  const x = Math.min(Math.max(r, s.in), s.out);
  return s.start + (x - s.in - goneBefore(s.gone || [], x)) / speedOf(s);
}

/** Seconde de rush d'une seconde de la timeline de l'éditeur, dans un segment placé (inverse de toTimeline). */
export function toRush(s, t) {
  let r = s.in + Math.max(0, t - s.start) * speedOf(s);
  for (const [a, b] of s.gone || []) if (a <= r) r += b - a;
  return Math.min(r, s.out);
}

/** Morceaux de rush gardés (complément des parties retirées), bornes calées sur les images pour garder son et image alignés. */
export function pieces(s, fps = 30) {
  const snap = (t) => Math.round(t * fps) / fps;
  const out = [];
  let cur = s.in;
  for (const [a, b] of s.gone) { if (a > cur) out.push([cur, a]); cur = Math.max(cur, b); }
  if (s.out > cur) out.push([cur, s.out]);
  return out.map(([a, b]) => [round(snap(a)), round(snap(b))]).filter(([a, b]) => b - a >= 1 / fps);
}

/** Seconde de la vidéo rendue d'une seconde de rush, pour un segment découpé en morceaux. */
function mapper(ps, start, sp = 1) {
  return (t) => {
    let o = start;
    for (const [a, b] of ps) {
      if (t < a) return o;
      if (t <= b) return o + (t - a) / sp;
      o += (b - a) / sp;
    }
    return o;
  };
}

/** Plan du rendu : segments gardés avec leurs morceaux, leur place dans la vidéo rendue (oStart, oDur) et `map`. */
export function renderPlan(edl, fps = 30) {
  let o = 0;
  const out = [];
  for (const s of timeline(edl)) {
    const ps = pieces(s, fps);
    const sp = speedOf(s);
    const dur = ps.reduce((x, [a, b]) => x + (b - a), 0) / sp;
    if (dur < 0.05) continue;
    out.push({ ...s, i: out.length, pieces: ps, speed: sp, oStart: round(o), oDur: round(dur), map: mapper(ps, o, sp) });
    o += dur;
  }
  return out;
}

/** Seconde de la vidéo rendue d'une seconde de la timeline de l'éditeur (zooms, accroche). */
export function toOutput(plan, t) {
  if (!plan.length) return 0;
  const s = plan.find((x) => t < x.start + x.dur) || plan[plan.length - 1];
  if (t < s.start) return s.oStart;
  return round(s.map(toRush(s, Math.min(t, s.start + s.dur))));
}

/** Mots des sous-titres en temps de la vidéo rendue (mots coupés exclus, mots rognés à in..out). */
export function outputWords(plan) {
  const out = [];
  for (const s of plan) {
    for (const w of s.words || []) {
      if (w.cut || w.t1 <= s.in || w.t0 >= s.out) continue;
      const [a, b] = inside(w, s);
      const S = round(s.map(a)), E = round(s.map(b));
      if (E - S < 0.02) continue;
      out.push({ w: w.w, s: S, e: E, seg: s.i, ...(w.hl ? { hl: true } : {}), ...(w.emoji ? { emoji: w.emoji } : {}) });
    }
  }
  return out;
}
