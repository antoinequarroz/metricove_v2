// Bruitages du moteur « Signature » (engine 2) : synthèse en JavaScript pur, sans fichier ni dépendance.
// sig-stage.mjs pose les bruitages sur la grille du tempo de la musique (fpb images par temps) et écrit
// <hfDir>/sfx.json = { D, fpb, drop, events } ; la finition rend ici une seule piste WAV 48 kHz stéréo qui couvre la
// vidéo, puis la mélange sous la musique et la voix (ffmpeg).
// Chaque son est fait de bruit filtré (filtres à variables d'état), de sinus et d'enveloppes ; il commence et finit
// sur une rampe (jamais de marche), est normalisé (à sa crête, ou pour un son de bruit à la valeur efficace de ses
// 50 ms les plus fortes, crête plafonnée) puis multiplié par g et placé dans l'espace stéréo (loi à puissance
// constante). Aucun son seul ne dépasse 0,85 : le bus est tenu sous −1 dBFS par un limiteur à anticipation qui ne
// travaille que quand des sons se superposent, et un son seul n'est jamais pompé. Déterministe : le seul hasard vient de mulberry32, tiré de la
// graine et de l'indice, du type et de l'instant de chaque bruitage ; les mêmes entrées donnent la même piste, bit
// pour bit.
//
//   node lib/reel/sig-sfx.mjs <sfx.json> <sortie.wav>   rend les bruitages d'une vidéo
//   node lib/reel/sig-sfx.mjs --demo <sortie.wav>       chaque son une fois, un toutes les 0,8 s
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Les sons de la bibliothèque. */
export const SFX_KINDS = Object.freeze(["tick", "tock", "pop", "swish", "whoosh", "riser", "impact", "thump", "heartbeat", "scribble", "shimmer", "buzz", "tap", "ding", "clap", "sparkle"]);

const KIND = new Map(SFX_KINDS.map((k, i) => [k, i]));
const TAU = 2 * Math.PI;
/** Plafond absolu du bus (−1 dBFS) et plafond visé par le limiteur (un peu de marge dessous). */
const CEIL = 0.89;
const LIMIT = 0.88;
/** Anticipation (= rampe d'attaque) et retour du limiteur, en secondes. */
const LOOKAHEAD = 0.005;
const RELEASE = 0.12;
/** Durée la plus longue rendue (s) : une vidéo fait 60 s au plus. */
const MAX_SECONDS = 600;
/** Gain sous lequel un bruitage est muet (−120 dB, bien sous le pas du WAV 16 bits) : il ne ferait entrer que des nombres dénormalisés dans le bus. */
const MIN_GAIN = 1e-6;
/** Durée par défaut (s) des sons qui en ont une. */
const DUR = { whoosh: 0.5, riser: 1, shimmer: 0.6, sparkle: 1.3 };
/** Durée (s) des sons à durée fixe. */
const FIXED = { tick: 0.016, tock: 0.05, pop: 0.075, swish: 0.18, thump: 0.16, heartbeat: 0.36, scribble: 0.36, buzz: 0.25, tap: 0.04, ding: 0.7, clap: 0.21 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const opt = (v, def, lo, hi) => { const x = num(v); return Number.isFinite(x) ? clamp(x, lo, hi) : def; };

/** PRNG mulberry32 (la même suite que stage.mjs) : une valeur dans [0, 1). */
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

/** La graine d'un bruitage : la graine de la vidéo mêlée à son indice, son type et son instant (en ms). */
function eventSeed(seed, i, k, ms) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (i | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (k | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h ^ (ms | 0), 0x27d4eb2f); h ^= h >>> 15;
  return h >>> 0;
}

/** Un bruitage lu et borné, ou null s'il est ignoré (type inconnu, instant illisible ou négatif). */
function normEvent(ev) {
  if (!ev || typeof ev !== "object") return null;
  const k = typeof ev.k === "string" ? ev.k : "";
  if (!KIND.has(k)) return null;
  const t = num(ev.t);
  if (!Number.isFinite(t) || t < 0) return null;
  return {
    t, k,
    g: opt(ev.g, 1, 0, 1),
    p: opt(ev.p, 0, -1, 1),
    f: opt(ev.f, 1, 0.25, 4),
    d: opt(ev.d, DUR[k] ?? 0.5, 0.05, 8),
    peak: opt(ev.peak, 0.5, 0.05, 0.95),
    tone: opt(ev.tone, 0, 0, 1),
    big: opt(ev.big, 0.5, 0, 1),
  };
}

/** Durée (s) du son d'un bruitage lu : il commence à t et tout est silence après t + durée. */
function spanOf(e) {
  if (Object.hasOwn(FIXED, e.k)) return FIXED[e.k];
  if (e.k === "impact") return 0.35 + 1.25 * e.big;
  if (e.k === "shimmer") return e.d + 0.18;
  if (e.k === "sparkle") return e.d + 0.2;
  return e.d; // whoosh, riser
}

/** Durée (s) du son d'un bruitage (0 s'il serait ignoré) : sa trace dans la piste va de t à t + cette durée. */
export function sfxSpan(ev) {
  const e = normEvent(ev);
  return e ? spanOf(e) : 0;
}

// ─── Outils de synthèse ────────────────────────────────────────────────────────────────────────────────────────────

const LP = 0, BP = 1, HP = 2;
const hz = (f, sr) => Math.min(Math.max(f, 10), sr * 0.45);
/**
 * Gains gauche/droite d'un panoramique à puissance constante (−1 gauche … 1 droite). Tout d'un côté, l'autre gain vaut
 * exactement 0 (cos π/2 donne 6e−17 : un résidu que le dither du WAV changerait en bruit sur le canal muet).
 */
const panGains = (p) => {
  const th = (clamp(p, -1, 1) + 1) * Math.PI / 4, l = Math.cos(th), r = Math.sin(th);
  return [l < 1e-9 ? 0 : l, r < 1e-9 ? 0 : r];
};

/** Bruit blanc dans [−1, 1) : mulberry32 en ligne, sa graine tirée de rnd. */
function white(buf, n, rnd) {
  let a = (rnd() * 4294967296) >>> 0;
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    buf[i] = ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  }
}

/** Bruit rose (filtre économique de P. Kellet sur un bruit blanc) : plus de grave, le souffle d'un passage d'air. */
function pink(buf, n, rnd) {
  white(buf, n, rnd);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = buf[i];
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    buf[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
  }
}

/**
 * Filtre à variables d'état (TPT, A. Simper), en place, fréquence fixe : mode LP passe-bas, BP passe-bande (gain 1 au
 * centre), HP passe-haut. Stable et sans artefact quand sa fréquence bouge (voir svfSwept).
 */
function svf(buf, n, mode, fc, q, sr) {
  const k = 1 / q, g = Math.tan(Math.PI * hz(fc, sr) / sr);
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  let ic1 = 0, ic2 = 0;
  for (let i = 0; i < n; i++) {
    const v0 = buf[i], v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    buf[i] = mode === LP ? v2 : mode === BP ? k * v1 : v0 - k * v1 - v2;
  }
}

/** Le même filtre, sa fréquence lue échantillon par échantillon dans fcs (coefficients recalculés tous les 4). */
function svfSwept(buf, n, mode, fcs, q, sr) {
  const k = 1 / q;
  let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 3) === 0) {
      const g = Math.tan(Math.PI * hz(fcs[i], sr) / sr);
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    }
    const v0 = buf[i], v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    buf[i] = mode === LP ? v2 : mode === BP ? k * v1 : v0 - k * v1 - v2;
  }
}

/** Coupe le continu (passe-haut du premier ordre à fc). */
function dcBlock(buf, n, fc, sr) {
  const r = Math.exp(-TAU * fc / sr);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < n; i++) {
    const x = buf[i], y = x - x1 + r * y1;
    x1 = x; y1 = y; buf[i] = y;
  }
}

/** Rampes d'entrée et de sortie en demi-cosinus (fin et fout échantillons) : le premier et le dernier valent 0. */
function edges(buf, n, fin, fout) {
  if (fin + fout > n) { const s = n / (fin + fout); fin = Math.floor(fin * s); fout = Math.floor(fout * s); }
  for (let i = 0; i < fin; i++) buf[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fin);
  for (let i = 0; i < fout; i++) buf[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fout);
}

/** Correction polyBLEP d'une discontinuité (dent de scie, carré limités en bande). t phase dans [0, 1), dt pas. */
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Saturation douce normalisée (tanh) : des harmoniques pour que les graves s'entendent sur un téléphone. */
function saturate(buf, n, drive) {
  const s = 1 / Math.tanh(drive);
  for (let i = 0; i < n; i++) buf[i] = Math.tanh(drive * buf[i]) * s;
}

// ─── Les sons ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Chaque voix reçoit les tampons de travail S (a et b : sortie mono ou gauche/droite ; c, d, e, fc : à elle), le
// bruitage lu e, son hasard rnd et sa longueur n en échantillons. Elle renvoie { stereo, target, loud? } : target est
// la crête du son à g = 1 (pour une voix stéréo, l'amplitude de son vecteur gauche/droite) ; loud, pour les sons faits
// surtout de bruit, la valeur efficace de ses 50 ms les plus fortes (même sonie d'un tirage à l'autre, target devient
// un plafond). Une voix stéréo place elle-même ses éléments autour de e.p.

/** tick : clic clair de 16 ms, salve de bruit en passe-bande et minuscule ping vers 2,4 kHz × f. */
function tick(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c;
  white(c, n, rnd);
  svf(c, n, BP, 5200 * e.f, 1.1, sr);
  const kn = Math.exp(-1 / (0.0032 * sr)), kp = Math.exp(-1 / (0.004 * sr));
  const w = TAU * hz(2400 * e.f, sr) / sr;
  let en = 2.2, ep = 0.3;
  for (let i = 0; i < n; i++) {
    a[i] = c[i] * en + Math.sin(w * i) * ep;
    en *= kn; ep *= kp;
  }
  edges(a, n, Math.round(0.0002 * sr), Math.round(0.004 * sr));
  return { stereo: false, target: 0.85, loud: 0.066 };
}

/** tock : coup sur du bois (≈ 45 ms), sinus vers 650 Hz × f qui chute vite, deux modes plus aigus et un souffle d'attaque. */
function tock(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c, f = e.f, top = 0.45 * sr / 1.5;
  white(c, n, rnd);
  svf(c, n, BP, 2300 * f, 1, sr);
  const f1 = Math.min(650 * f, top), f2 = Math.min(650 * 2.72 * f, top), f3 = Math.min(650 * 4.9 * f, top);
  const kd = Math.exp(-1 / (0.0028 * sr));
  const k1 = Math.exp(-1 / (0.012 * sr)), k2 = Math.exp(-1 / (0.006 * sr)), k3 = Math.exp(-1 / (0.003 * sr)), kn = Math.exp(-1 / (0.0015 * sr));
  let p1 = 0, p2 = 0, p3 = 0, dr = 1, e1 = 1, e2 = 0.42, e3 = 0.2, en = 0.9;
  for (let i = 0; i < n; i++) {
    const bend = (1 + 0.5 * dr) * TAU / sr;
    p1 += f1 * bend; p2 += f2 * bend; p3 += f3 * bend;
    a[i] = Math.sin(p1) * e1 + Math.sin(p2) * e2 + Math.sin(p3) * e3 + c[i] * en;
    dr *= kd; e1 *= k1; e2 *= k2; e3 *= k3; en *= kn;
  }
  dcBlock(a, n, 30, sr);
  edges(a, n, Math.round(0.0003 * sr), Math.round(0.01 * sr));
  return { stereo: false, target: 0.7 };
}

/** pop : bulle (≈ 70 ms), sinus qui monte de 350 à 1100 Hz × f et s'éteint vite, petit clic doux à l'attaque. */
function pop(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c, f = e.f;
  white(c, n, rnd);
  svf(c, n, BP, 3000 * f, 1, sr);
  const T = Math.round(0.022 * sr), step = Math.pow(1100 / 350, 1 / T), att = Math.round(0.002 * sr);
  const kA = Math.exp(-1 / (0.02 * sr)), kn = Math.exp(-1 / (0.0007 * sr)), fmax = 0.45 * sr / 2;
  let fr = 350 * f, ph = 0, env = 1, en = 0.16;
  for (let i = 0; i < n; i++) {
    ph += TAU * Math.min(fr, fmax) / sr;
    if (i < T) fr *= step;
    const at = i < att ? 0.5 - 0.5 * Math.cos(Math.PI * i / att) : 1;
    a[i] = (Math.sin(ph) + 0.08 * Math.sin(2 * ph)) * env * at + c[i] * en;
    env *= kA; en *= kn;
  }
  dcBlock(a, n, 30, sr);
  edges(a, n, Math.round(0.0002 * sr), Math.round(0.01 * sr));
  return { stereo: false, target: 0.6 };
}

/** swish : souffle d'air (180 ms), bruit dans un passe-bande qui monte de 1,5 à 6 kHz, enveloppe en cloche douce. */
function swish(S, e, rnd, n) {
  const sr = S.sr, a = S.a, fcs = S.fc, f = e.f;
  white(a, n, rnd);
  const lo = 1500 * f, step = Math.pow(4, 1 / n);
  let fc = lo;
  for (let i = 0; i < n; i++) { fcs[i] = fc; fc *= step; }
  svfSwept(a, n, BP, fcs, 1.4, sr);
  const pk = 0.42, last = n - 1;
  for (let i = 0; i < n; i++) {
    const x = i / last;
    const s = x < pk ? Math.sin(Math.PI / 2 * x / pk) : Math.cos(Math.PI / 2 * (x - pk) / (1 - pk));
    a[i] *= s * s;
  }
  return { stereo: false, target: 0.55, loud: 0.1349 };
}

/** Position dans un passage : 0 aux deux bouts, 1 au maximum (échantillon ip), linéaire de chaque côté. */
const passBy = (i, ip, n) => clamp(i <= ip ? i / ip : (n - 1 - i) / (n - 1 - ip), 0, 1);

/**
 * whoosh (d, peak) : passage d'air. Bruit rose dans un passe-bande résonant dont le centre monte puis redescend autour
 * du maximum (placé à peak × d), un souffle grave en passe-bande et l'air aigu qui suit le centre ; le son traverse
 * l'espace de p − 0,4 à p + 0,4.
 */
function whoosh(S, e, rnd, n) {
  const sr = S.sr, a = S.a, b = S.b, c = S.c, body = S.d, air = S.e, fcs = S.fc, f = e.f;
  const ip = clamp(Math.round(e.peak * (n - 1)), 1, n - 2);
  pink(c, n, rnd);
  body.set(c.subarray(0, n));
  white(air, n, rnd);
  // Centre du filtre : 240 Hz → 2,2 kHz → 240 Hz (× f) ; svfSwept ne lit qu'un échantillon sur 4.
  const lo = 240 * f, lr = Math.log(2200 / 240);
  for (let i = 0; i < n; i += 4) fcs[i] = lo * Math.exp(lr * Math.pow(passBy(i, ip, n), 0.9));
  svfSwept(c, n, BP, fcs, 2, sr);
  for (let i = 0; i < n; i += 4) fcs[i] *= 2.6;
  svfSwept(air, n, BP, fcs, 1.2, sr);
  svf(body, n, BP, 260 * f, 0.8, sr);
  // Enveloppe (calculée tous les 16 échantillons, interpolée) : monte en accélérant jusqu'au maximum, retombe un peu
  // plus vite ; le souffle grave et l'air suivent le maximum de plus près.
  const B = 16;
  let v0 = 0;
  for (let i0 = 0; i0 < n; i0 += B) {
    const i1 = Math.min(n, i0 + B), s = 0.5 - 0.5 * Math.cos(Math.PI * passBy(i1, ip, n));
    const v1 = Math.pow(s, i1 <= ip ? 1.7 : 1.25);
    for (let i = i0; i < i1; i++) {
      const env = v0 + (v1 - v0) * (i - i0) / B;
      c[i] = (c[i] + (body[i] * 0.8 + air[i] * 0.3) * env) * env;
    }
    v0 = v1;
  }
  dcBlock(c, n, 40, sr);
  // Mouvement stéréo : gains recalculés tous les 16 échantillons, interpolés entre deux.
  const p0 = e.p - 0.4, p1 = e.p + 0.4;
  for (let i0 = 0; i0 < n; i0 += B) {
    const [l0, r0] = panGains(p0 + (p1 - p0) * i0 / n);
    const i1 = Math.min(n, i0 + B), [l1, r1] = panGains(p0 + (p1 - p0) * i1 / n);
    for (let i = i0; i < i1; i++) {
      const x = (i - i0) / B;
      a[i] = c[i] * (l0 + (l1 - l0) * x);
      b[i] = c[i] * (r0 + (r1 - r0) * x);
    }
  }
  edges(a, n, Math.round(0.002 * sr), Math.round(0.004 * sr));
  edges(b, n, Math.round(0.002 * sr), Math.round(0.004 * sr));
  return { stereo: true, target: 0.6, loud: 0.1479 };
}

/**
 * riser (d, tone) : montée de tension. Bruit en passe-bande qui monte en fréquence et en niveau (exponentiels), large en
 * stéréo ; tone = 1 ajoute une dent de scie et un sinus désaccordés qui montent d'une octave, avec un trémolo qui
 * s'accélère et se creuse. S'arrête net à t + d (le coup est un autre bruitage).
 */
function riser(S, e, rnd, n) {
  const sr = S.sr, a = S.a, b = S.b, nl = S.c, nr = S.d, saw = S.e, fcs = S.fc, f = e.f, tone = e.tone;
  white(nl, n, rnd);
  white(nr, n, rnd);
  // Centre du filtre : 380 Hz → 6,5 kHz × f (svfSwept ne lit qu'un échantillon sur 4) ; niveau exponentiel.
  for (let i = 0; i < n; i += 4) fcs[i] = 380 * f * Math.pow(17, Math.pow(i / n, 1.2));
  svfSwept(nl, n, BP, fcs, 1.7, sr);
  svfSwept(nr, n, BP, fcs, 1.7, sr);
  const [gl, gr] = panGains(e.p), E1 = Math.exp(3.4) - 1, k1 = Math.exp(3.4 / n);
  let x1 = 1;
  for (let i = 0; i < n; i++) {
    const lev = (x1 - 1) / E1;
    a[i] = nl[i] * lev * gl;
    b[i] = nr[i] * lev * gr;
    x1 *= k1;
  }
  if (tone > 0) {
    // La note : hauteur (une octave, de plus en plus vite), profondeur du trémolo et ouverture du filtre calculées
    // tous les 32 échantillons ; le sinus (nl) et le gain de la dent de scie (nr) sont posés avant le filtrage.
    const f0 = 196 * f, E2 = Math.exp(2.4) - 1, k2 = Math.exp(2.4 / n), fmax = 0.45 * sr / 2.1, B = 32;
    let ps = 0, pn = 0, pt = 0, x2 = 1, fr0 = Math.min(f0, fmax);
    for (let i0 = 0; i0 < n; i0 += B) {
      const i1 = Math.min(n, i0 + B), x = i0 / n, fr1 = Math.min(f0 * Math.pow(2, Math.pow(i1 / n, 1.3)), fmax);
      const depth = 0.6 * Math.pow(x, 1.5), rate = TAU * (5 + 13 * x * x) / sr, cut = (900 + 4100 * x * x) * f;
      for (let i = i0; i < i1; i++) {
        const fr = fr0 + (fr1 - fr0) * (i - i0) / B, dt = fr * 1.005 / sr;
        ps += dt; if (ps >= 1) ps -= 1;
        pn += TAU * fr * 0.995 / sr; if (pn > TAU) pn -= TAU;
        pt += rate;
        const g = (1 - depth * (0.5 - 0.5 * Math.cos(pt))) * tone * 0.32 * (x2 - 1) / E2;
        saw[i] = 2 * ps - 1 - blep(ps, dt);
        nl[i] = Math.sin(pn) * 0.7 * g;
        nr[i] = 0.5 * g;
        fcs[i] = cut;
        x2 *= k2;
      }
      fr0 = fr1;
    }
    svfSwept(saw, n, LP, fcs, 0.8, sr);
    for (let i = 0; i < n; i++) {
      const s = saw[i] * nr[i] + nl[i];
      a[i] += s * gl;
      b[i] += s * gr;
    }
  }
  edges(a, n, Math.round(0.001 * sr), Math.round(0.003 * sr));
  edges(b, n, Math.round(0.001 * sr), Math.round(0.003 * sr));
  return { stereo: true, target: 0.5, loud: 0.1585 };
}

/**
 * impact (big) : coup de cinéma. Sub qui tombe (140 → 52 Hz × f) et corps vers 120 Hz, saturés ensemble ; bruit sourd
 * grave, « whomp » (bruit dont la bande descend de 1,6 kHz à 160 Hz) et craquement de bruit très bref, puis le tout
 * écrêté en douceur (une attaque dense, pas une pointe) ; tout s'éteint en 0,35 s (big 0) à 1,6 s (big 1). Dès
 * big 0,6, une queue réverbérée douce (bruit décorrélé à gauche et à droite, passe-bas qui s'assombrit).
 */
function impact(S, e, rnd, n) {
  const sr = S.sr, a = S.a, b = S.b, core = S.c, nz = S.d, nz2 = S.e, fcs = S.fc, f = e.f, big = e.big;
  const sub = 52 * f, top = 140 * f, body = 120 * f;
  const kDrop = Math.exp(-1 / (0.03 * sr)), kSub = Math.exp(-1 / ((0.08 + 0.4 * big) * sr));
  const kBd = Math.exp(-1 / (0.014 * sr)), kBody = Math.exp(-1 / ((0.05 + 0.09 * big) * sr));
  const att = Math.max(1, Math.round(0.0015 * sr)), drive = 1.6, nd = 1 / Math.tanh(drive);
  let ps = 0, pb = 0, dr = 1, bd = 1, es = 0.9, eb = 0.7;
  for (let i = 0; i < n; i++) {
    ps += TAU * (sub + (top - sub) * dr) / sr;
    pb += TAU * body * (1 + 0.5 * bd) / sr;
    core[i] = Math.tanh(drive * (Math.sin(ps) * es + Math.sin(pb) * eb)) * nd * (i < att ? i / att : 1);
    dr *= kDrop; bd *= kBd; es *= kSub; eb *= kBody;
  }
  // Bruit sourd (passe-bas 300 Hz) et whomp (passe-bande qui descend), dans nz2 ; craquement (700 Hz–8 kHz) dans nz.
  white(nz2, n, rnd);
  svf(nz2, n, LP, 300 * f, 0.8, sr);
  white(nz, n, rnd);
  const wl = Math.round((0.1 + 0.12 * big) * sr), kw = Math.pow(0.1, 1 / wl);
  let fw = 1600 * f;
  for (let i = 0; i < n; i++) { fcs[i] = fw; if (i < wl) fw *= kw; }
  svfSwept(nz, n, BP, fcs, 1.3, sr);
  const kT = Math.exp(-1 / ((0.05 + 0.1 * big) * sr)), kW = Math.exp(-1 / ((0.06 + 0.12 * big) * sr)), aw = Math.round(0.002 * sr);
  let et = 4.5, ew = 3.6;
  for (let i = 0; i < n; i++) {
    core[i] += nz2[i] * et + nz[i] * ew * (i < aw ? 0.5 - 0.5 * Math.cos(Math.PI * i / aw) : 1);
    et *= kT; ew *= kW;
  }
  white(nz, n, rnd);
  svf(nz, n, HP, 700 * f, 0.7, sr);
  svf(nz, n, LP, 8000 * f, 0.7, sr);
  const kC = Math.exp(-1 / ((0.015 + 0.025 * big) * sr)), ac = Math.max(1, Math.round(0.0003 * sr));
  let ec = 2.2;
  for (let i = 0; i < n; i++) {
    core[i] += nz[i] * ec * (i < ac ? i / ac : 1);
    ec *= kC;
  }
  saturate(core, n, 1.2);
  dcBlock(core, n, 18, sr);
  const [gl, gr] = panGains(e.p);
  for (let i = 0; i < n; i++) { a[i] = core[i] * gl; b[i] = core[i] * gr; }
  if (big >= 0.6) {
    const w = (big - 0.6) / 0.4, lvl = 0.45 + 0.4 * w, kd = Math.exp(-1 / ((0.22 + 0.3 * w) * sr));
    white(nz, n, rnd);
    white(nz2, n, rnd);
    const k = Math.exp(-1 / (0.35 * sr));
    let x = 1;
    for (let i = 0; i < n; i++) { fcs[i] = (450 + 2750 * x) * f; x *= k; }
    svfSwept(nz, n, LP, fcs, 0.6, sr);
    svfSwept(nz2, n, LP, fcs, 0.6, sr);
    svf(nz, n, HP, 110 * f, 0.7, sr);
    svf(nz2, n, HP, 110 * f, 0.7, sr);
    const pre = Math.round(0.006 * sr), sw = Math.round(0.045 * sr);
    let dec = lvl;
    for (let i = pre; i < n; i++) {
      let g = dec;
      if (i < pre + sw) g *= 0.5 - 0.5 * Math.cos(Math.PI * (i - pre) / sw);
      else dec *= kd;
      a[i] += nz[i] * g * gl;
      b[i] += nz2[i] * g * gr;
    }
  }
  const fin = Math.round(0.0002 * sr), rel = Math.round(n * 0.3);
  edges(a, n, fin, rel);
  edges(b, n, fin, rel);
  return { stereo: true, target: 0.62 + 0.23 * big };
}

/**
 * thump : grosse caisse douce (160 ms), sinus de 70 à 45 Hz × f, attaque arrondie qui part un peu plus haut (+80 Hz,
 * 4 ms) ; l'octave et la peau (bruit vers 550 Hz, 14 ms) la font entendre sur le petit haut-parleur d'un téléphone
 * (≈ −9 dB derrière un passe-haut à 300 Hz, contre −18 dB pour le sinus seul).
 */
function thump(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c, f = e.f;
  const lo = 45 * f, hi = 70 * f, punch = 80 * f;
  const kd = Math.exp(-1 / (0.028 * sr)), ke = Math.exp(-1 / (0.055 * sr)), k2 = Math.exp(-1 / (0.04 * sr)), kp = Math.exp(-1 / (0.004 * sr)), att = Math.round(0.0025 * sr);
  white(c, n, rnd);
  svf(c, n, BP, 550 * f, 0.7, sr);
  const kc = Math.exp(-1 / (0.014 * sr));
  let ph = 0, dr = 1, dp = 1, env = 1, e2 = 0.5, ec = 3;
  for (let i = 0; i < n; i++) {
    ph += TAU * (lo + (hi - lo) * dr + punch * dp) / sr;
    const at = i < att ? 0.5 - 0.5 * Math.cos(Math.PI * i / att) : 1;
    a[i] = (Math.sin(ph) * env + Math.sin(2 * ph) * e2 + c[i] * ec) * at;
    dr *= kd; dp *= kp; env *= ke; e2 *= k2; ec *= kc;
  }
  saturate(a, n, 2);
  dcBlock(a, n, 15, sr);
  edges(a, n, 0, Math.round(0.03 * sr));
  return { stereo: false, target: 0.7 };
}

/**
 * heartbeat : battement de cœur, deux coups sourds vers 55 Hz × f à 0 et 0,17 s (le second plus doux) ; le choc étouffé
 * qui les accompagne (bruit en passe-bas 600 Hz) les fait entendre sur un téléphone (≈ −10 dB derrière un passe-haut à
 * 300 Hz).
 */
function heartbeat(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c, f = e.f;
  white(c, n, rnd);
  svf(c, n, LP, 600 * f, 0.7, sr);
  const kd = Math.exp(-1 / (0.018 * sr)), att = Math.round(0.005 * sr), rel = Math.round(0.04 * sr);
  for (const [t0, amp, fm, tau] of [[0, 1, 1, 0.042], [0.17, 0.68, 1.07, 0.036]]) {
    const i0 = Math.round(t0 * sr), len = Math.min(n - i0, Math.round(0.16 * sr));
    const lo = 55 * f * fm, ke = Math.exp(-1 / (tau * sr)), kn = Math.exp(-1 / (0.025 * sr)), k2 = Math.exp(-1 / (0.024 * sr));
    let ph = 0, dr = 1, env = amp, e2 = amp * 0.45, en = amp * 4;
    for (let k = 0; k < len; k++) {
      ph += TAU * lo * (1 + 0.45 * dr) / sr;
      let g = k < att ? 0.5 - 0.5 * Math.cos(Math.PI * k / att) : 1;
      if (len - k < rel) g *= 0.5 - 0.5 * Math.cos(Math.PI * (len - k) / rel);
      a[i0 + k] += (Math.sin(ph) * env + Math.sin(2 * ph) * e2 + c[i0 + k] * en) * g;
      dr *= kd; env *= ke; e2 *= k2; en *= kn;
    }
  }
  saturate(a, n, 2.2);
  dcBlock(a, n, 18, sr);
  edges(a, n, 0, Math.round(0.02 * sr));
  return { stereo: false, target: 0.75 };
}

/** scribble : feutre sur papier (≈ 0,35 s), bruit en passe-bande 2,5–5 kHz × f, 4 à 6 traits inégaux et grain irrégulier. */
function scribble(S, e, rnd, n) {
  const sr = S.sr, a = S.a, env = S.c, fcs = S.fc, f = e.f;
  const K = 4 + Math.floor(rnd() * 3), w = [], gaps = [];
  let tot = 0, gapTot = 0;
  for (let j = 0; j < K; j++) { w.push(0.5 + rnd()); tot += w[j]; }
  for (let j = 0; j < K - 1; j++) { gaps.push(0.006 + 0.016 * rnd()); gapTot += gaps[j]; }
  const active = n / sr - 0.014 - gapTot;
  env.fill(0, 0, n);
  fcs.fill(3600 * f, 0, n);
  let t = 0.002;
  for (let j = 0; j < K; j++) {
    const dur = active * w[j] / tot;
    const i0 = Math.round(t * sr), i1 = Math.min(n - 1, Math.round((t + dur) * sr)), m = i1 - i0;
    const amp = 0.55 + 0.45 * rnd(), c0 = 3600 * f * (0.82 + 0.36 * rnd()), c1 = c0 * (0.88 + 0.24 * rnd());
    const att = Math.min(m / 3, 0.006 * sr), rel = Math.min(m / 2.5, 0.014 * sr);
    for (let i = i0; i < i1; i++) {
      const k = i - i0, u = k / m;
      let g = amp * (0.75 + 0.25 * Math.sin(Math.PI * u));
      if (k < att) g *= 0.5 - 0.5 * Math.cos(Math.PI * k / att);
      if (m - k < rel) g *= 0.5 - 0.5 * Math.cos(Math.PI * (m - k) / rel);
      env[i] = g;
      fcs[i] = c0 + (c1 - c0) * u;
    }
    t += dur + (gaps[j] || 0);
  }
  white(a, n, rnd);
  svfSwept(a, n, BP, fcs, 1.2, sr);
  svf(a, n, HP, 2300 * f, 0.7, sr);
  svf(a, n, LP, 5200 * f, 0.7, sr);
  // Le grain du papier : un aléa lissé, renouvelé environ 110 fois par seconde.
  const per = Math.max(2, Math.round(sr / 110));
  let g0 = rnd(), g1 = rnd();
  for (let i = 0; i < n; i++) {
    const ph = i % per;
    if (ph === 0) { g0 = g1; g1 = rnd(); }
    a[i] *= env[i] * (0.45 + 0.55 * (g0 + (g1 - g0) * ph / per));
  }
  edges(a, n, Math.round(0.001 * sr), Math.round(0.004 * sr));
  return { stereo: false, target: 0.62, loud: 0.1245 };
}

/** Forme d'un scintillement sur x ∈ [0, 1] : montée rapide, puis décroissance. */
const glow = (x) => (x < 0.18 ? Math.sin(Math.PI / 2 * x / 0.18) : Math.pow(Math.max(0, 1 - (x - 0.18) / 0.82), 1.5));

/**
 * Sinus amorti amp·rⁿ·sin(w n) par un résonateur à deux pôles (y[n] = 2 r cos w · y[n−1] − r² · y[n−2]) : la même
 * onde qu'un sinus × une exponentielle, sans fonction trigonométrique par échantillon. Ajouté à out[i0 .. i0 + len).
 */
function decaySine(out, i0, len, w, r, amp) {
  const c1 = 2 * r * Math.cos(w), c2 = r * r;
  let y0 = 0, y1 = amp * r * Math.sin(w);
  for (let q = 0; q < len; q++) {
    out[i0 + q] += y0;
    const y = c1 * y1 - c2 * y0;
    y0 = y1; y1 = y;
  }
}

/**
 * Tintement court ajouté aux tampons a et b avec son panoramique : sinus amorti (résonateur, comme decaySine), attaque
 * arrondie de 1,2 ms et dernier quart effilé (smoothstep), en une passe. h2 : niveau d'un partiel inharmonique
 * (× 2,76, verre, qui s'éteint plus vite) ; 0 pour un sinus pur.
 */
function ping(S, i0, len, fr, amp, tau, pan, h2) {
  const sr = S.sr, a = S.a, b = S.b;
  const att = Math.max(2, Math.round(0.0012 * sr)), tail = Math.max(2, Math.round(len * 0.25)), t0 = len - tail;
  const w = TAU * hz(fr, sr) / sr, r = Math.exp(-1 / (tau * sr)), c1 = 2 * r * Math.cos(w), c2 = r * r;
  const w2 = h2 > 0 && fr * 2.76 < 0.45 * sr ? TAU * fr * 2.76 / sr : 0, r2 = Math.exp(-2.2 / (tau * sr)), d1 = 2 * r2 * Math.cos(w2), d2 = r2 * r2;
  const [pl, pr] = panGains(pan);
  let y0 = 0, y1 = amp * r * Math.sin(w), z0 = 0, z1 = w2 ? amp * h2 * r2 * Math.sin(w2) : 0;
  for (let q = 0; q < len; q++) {
    let s = y0 + z0;
    if (q < att) { const u = q / att; s *= u * u * (3 - 2 * u); }
    if (q >= t0) { const u = (len - 1 - q) / tail; s *= u * u * (3 - 2 * u); }
    a[i0 + q] += s * pl;
    b[i0 + q] += s * pr;
    const y = c1 * y1 - c2 * y0; y0 = y1; y1 = y;
    const z = d1 * z1 - d2 * z0; z0 = z1; z1 = z;
  }
}

/** Lit d'air aigu : deux bruits décorrélés (c, d) passés en a (gauche) et b (droite) avec la forme shape(i / nd) × lvl, calculée tous les 16 échantillons. */
function airBed(S, n, nd, shape, lvl, gl, gr) {
  const a = S.a, b = S.b, c = S.c, d = S.d, B = 16;
  let v0 = shape(0) * lvl;
  for (let i0 = 0; i0 < n; i0 += B) {
    const i1 = Math.min(n, i0 + B), v1 = shape(i1 / nd) * lvl;
    for (let i = i0; i < i1; i++) {
      const s = v0 + (v1 - v0) * (i - i0) / B;
      a[i] = c[i] * s * gl;
      b[i] = d[i] * s * gr;
    }
    v0 = v1;
  }
}

/** shimmer (d) : scintillement aérien, beaucoup de tintements aigus (3–9 kHz × f) au hasard dans d, sur un souffle aigu. */
function shimmer(S, e, rnd, n) {
  const sr = S.sr, f = e.f, nd = Math.max(1, Math.round(e.d * sr));
  white(S.c, n, rnd);
  white(S.d, n, rnd);
  svf(S.c, n, HP, 6500 * f, 0.7, sr);
  svf(S.d, n, HP, 6500 * f, 0.7, sr);
  const [gl, gr] = panGains(e.p), a = S.a, b = S.b;
  airBed(S, n, nd, glow, 0.12, gl, gr);
  const count = Math.max(6, Math.round(40 * e.d));
  for (let j = 0; j < count; j++) {
    const x = rnd() * 0.94, i0 = Math.round(x * nd);
    const fr = 3000 * f * Math.pow(3, rnd()), amp = (0.35 + 0.65 * rnd()) * glow(x), tau = 0.025 + 0.055 * rnd();
    const pan = e.p + (rnd() * 2 - 1) * 0.8;
    const len = Math.min(n - i0, Math.round(5 * tau * sr));
    if (len > 8) ping(S, i0, len, fr, amp, tau, pan, 0);
  }
  edges(a, n, Math.round(0.002 * sr), Math.round(0.01 * sr));
  edges(b, n, Math.round(0.002 * sr), Math.round(0.01 * sr));
  return { stereo: true, target: 0.45, loud: 0.1161 };
}

/** buzz : vibreur de téléphone (0,25 s), son riche vers 170 Hz × f (carré et dent de scie filtrés), modulé à 28 Hz, et la table qui frise. */
function buzz(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c, f = e.f, f0 = 170 * f;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const dt = f0 * (1 + 0.012 * Math.sin(TAU * 6.5 * i / sr)) / sr;
    ph += dt; if (ph >= 1) ph -= 1;
    const ph2 = ph < 0.5 ? ph + 0.5 : ph - 0.5;
    const sq = (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep(ph2, dt);
    const saw = 2 * ph - 1 - blep(ph, dt);
    a[i] = 0.65 * sq + 0.35 * saw;
  }
  svf(a, n, LP, 1500 * f, 0.9, sr);
  svf(a, n, HP, 110 * f, 0.7, sr);
  white(c, n, rnd);
  svf(c, n, BP, 2700 * f, 2.2, sr);
  const wm = TAU * 28 / sr;
  for (let i = 0; i < n; i++) {
    const m = 0.5 - 0.5 * Math.cos(wm * i);
    a[i] = a[i] * (0.3 + 0.7 * m * m) + c[i] * 0.25 * m * m * m;
  }
  edges(a, n, Math.round(0.008 * sr), Math.round(0.03 * sr));
  return { stereo: false, target: 0.6 };
}

/** tap : doigt sur du verre (≈ 35 ms), clic vers 3 kHz × f et petit corps vers 220 Hz × f. */
function tap(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c, f = e.f;
  white(c, n, rnd);
  svf(c, n, BP, 3000 * f, 1.5, sr);
  const wc = TAU * hz(3000 * f, sr) / sr, ab = Math.max(1, Math.round(0.0007 * sr));
  const kc = Math.exp(-1 / (0.0025 * sr)), kp = Math.exp(-1 / (0.003 * sr)), kb = Math.exp(-1 / (0.008 * sr)), kd = Math.exp(-1 / (0.004 * sr));
  let ec = 2, ep = 0.4, eb = 0.45, dr = 1, pb = 0;
  for (let i = 0; i < n; i++) {
    pb += TAU * 220 * f * (1 + 0.45 * dr) / sr;
    a[i] = c[i] * ec + Math.sin(wc * i) * ep + Math.sin(pb) * eb * (i < ab ? i / ab : 1);
    ec *= kc; ep *= kp; eb *= kb; dr *= kd;
  }
  dcBlock(a, n, 40, sr);
  edges(a, n, Math.round(0.0001 * sr), Math.round(0.006 * sr));
  return { stereo: false, target: 0.85, loud: 0.081 };
}

/** ding : carillon de notification (0,7 s), partiels 1320 et 1980 Hz × f, 2640 plus doux, attaque douce, extinction exponentielle. */
function ding(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c, f = e.f;
  // La copie désaccordée du fondamental bat lentement (≈ 3 Hz) : un timbre vivant, pas un bip.
  for (const [fr, amp, tau] of [[1320, 1, 0.26], [1320 * 1.0024, 0.32, 0.22], [1980, 0.5, 0.16], [2640, 0.2, 0.1], [3960, 0.05, 0.045]]) {
    if (fr * f < 0.45 * sr) decaySine(a, 0, n, TAU * fr * f / sr, Math.exp(-1 / (tau * sr)), amp);
  }
  // La frappe : un souffle aigu de 2 ms, à peine audible, qui donne le contour de l'attaque.
  const m = Math.min(n, Math.round(0.012 * sr));
  white(c, m, rnd);
  svf(c, m, HP, 5000, 0.7, sr);
  const kc = Math.exp(-1 / (0.002 * sr));
  let ec = 0.06;
  for (let i = 0; i < m; i++) { a[i] += c[i] * ec; ec *= kc; }
  edges(a, n, Math.round(0.005 * sr), Math.round(0.09 * sr));
  return { stereo: false, target: 0.36 };
}

/** clap : 3 ou 4 salves de bruit (1–3 kHz × f) à 8–12 ms d'écart, puis une queue qui s'éteint (≈ 0,2 s). */
function clap(S, e, rnd, n) {
  const sr = S.sr, a = S.a, c = S.c, d = S.d, f = e.f;
  white(c, n, rnd);
  svf(c, n, BP, 1650 * f, 0.9, sr);
  svf(c, n, LP, 3800 * f, 0.7, sr);
  white(d, n, rnd);
  svf(d, n, BP, 1250 * f, 0.7, sr);
  svf(d, n, LP, 3800 * f, 0.7, sr);
  const m = 3 + (rnd() < 0.55 ? 1 : 0), times = [0];
  for (let j = 1; j < m; j++) times.push(times[j - 1] + 0.008 + 0.004 * rnd());
  const kB = Math.exp(-1 / (0.0026 * sr)), att = Math.max(1, Math.round(0.0004 * sr));
  for (let j = 0; j < m; j++) {
    const i0 = Math.round(times[j] * sr), len = Math.min(n - i0, Math.round(0.02 * sr));
    let env = j === m - 1 ? 1 : 0.62 + 0.3 * rnd();
    for (let k = 0; k < len; k++) { a[i0 + k] += c[i0 + k] * env * (k < att ? k / att : 1); env *= kB; }
  }
  const it = Math.round(times[m - 1] * sr), kT = Math.exp(-1 / (0.048 * sr)), at2 = Math.max(1, Math.round(0.0015 * sr));
  let env = 0.75;
  for (let i = it; i < n; i++) { const k = i - it; a[i] += d[i] * env * (k < at2 ? k / at2 : 1); env *= kT; }
  edges(a, n, Math.round(0.0002 * sr), Math.round(0.03 * sr));
  return { stereo: false, target: 0.78, loud: 0.1514 };
}

/** sparkle (d) : cascade d'éclats qui montent (de 1,7 à 9 kHz × f sur d), répartis de gauche à droite, sur un souffle aigu. */
function sparkle(S, e, rnd, n) {
  const sr = S.sr, a = S.a, b = S.b, f = e.f, nd = Math.max(1, Math.round(e.d * sr));
  white(S.c, n, rnd);
  white(S.d, n, rnd);
  svf(S.c, n, HP, 5500 * f, 0.7, sr);
  svf(S.d, n, HP, 5500 * f, 0.7, sr);
  // Le souffle monte en 60 ms puis s'éteint avec la cascade.
  const [gl, gr] = panGains(e.p), rise = Math.min(0.5, 0.06 / e.d);
  airBed(S, n, nd, (x) => (x < rise ? 0.5 - 0.5 * Math.cos(Math.PI * x / rise) : 1) * Math.pow(Math.max(0, 1 - x), 1.3), 0.08, gl, gr);
  const N = Math.max(8, Math.round(18 * e.d));
  for (let j = 0; j < N; j++) {
    const x = (j + 0.15 + 0.7 * rnd()) / N, i0 = Math.round(x * 0.9 * nd);
    const fr = 1700 * f * Math.pow(5.4, x) * (0.97 + 0.06 * rnd()), amp = (0.6 + 0.4 * rnd()) * (1 - 0.35 * x);
    const tau = 0.12 - 0.07 * x + 0.02 * rnd(), pan = e.p + (x - 0.5) * 1.0 + (rnd() - 0.5) * 0.6;
    const len = Math.min(n - i0, Math.round(5 * tau * sr));
    if (len > 8) ping(S, i0, len, fr, amp, tau, pan, 0.22);
  }
  edges(a, n, Math.round(0.002 * sr), Math.round(0.01 * sr));
  edges(b, n, Math.round(0.002 * sr), Math.round(0.01 * sr));
  return { stereo: true, target: 0.45, loud: 0.1303 };
}

const VOICES = { tick, tock, pop, swish, whoosh, riser, impact, thump, heartbeat, scribble, shimmer, buzz, tap, ding, clap, sparkle };

// ─── Rendu ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tampons de travail, agrandis à la demande et réutilisés d'un bruitage à l'autre. */
function scratch(sr) {
  return { sr, cap: 0, a: null, b: null, c: null, d: null, e: null, fc: null };
}
function prepare(S, n) {
  if (S.cap < n) {
    const cap = Math.ceil(n * 1.25) + 64;
    for (const key of ["a", "b", "c", "d", "e", "fc"]) S[key] = new Float64Array(cap);
    S.cap = cap;
  } else {
    S.a.fill(0, 0, n);
    S.b.fill(0, 0, n);
  }
}

/**
 * Ajoute le son d'une voix au bus, normalisé à sa crête (ou à la valeur efficace de ses 50 ms les plus fortes, crête
 * plafonnée) puis × g. Faux si le son est vide ou illisible. Les queues infimes (sous −300 dB) deviennent des zéros
 * exacts : aucun nombre dénormalisé n'entre dans le bus.
 */
function mixVoice(S, n, res, left, right, start, gain, p) {
  const a = S.a, b = S.b, st = res.stereo, W = Math.max(1, Math.round(0.05 * S.sr));
  let pk = 0, chk = 0, win = 0, best = 0;
  for (let i = 0; i < n; i++) {
    let m = st ? a[i] * a[i] + b[i] * b[i] : a[i] * a[i];
    if (m < 1e-30) { a[i] = 0; if (st) b[i] = 0; m = 0; }
    chk += m;
    if (m > pk) pk = m;
    win += m;
    if (i >= W) win -= st ? a[i - W] * a[i - W] + b[i - W] * b[i - W] : a[i - W] * a[i - W];
    if (win > best) best = win;
  }
  if (!Number.isFinite(chk) || !(pk > 1e-18)) return false;
  let s = res.target / Math.sqrt(pk);
  if (res.loud) s = Math.min(s, res.loud / Math.sqrt(best / W));
  s *= gain;
  const m = Math.min(n, left.length - start);
  if (st) {
    for (let i = 0; i < m; i++) { left[start + i] += a[i] * s; right[start + i] += b[i] * s; }
  } else {
    const [gl, gr] = panGains(p), kl = gl * s, kr = gr * s;
    for (let i = 0; i < m; i++) { left[start + i] += a[i] * kl; right[start + i] += a[i] * kr; }
  }
  return true;
}

/**
 * Limiteur du bus, hors ligne, à anticipation : gain requis r = min(1, LIMIT / crête) ; minimum glissant sur les A
 * échantillons à venir ; retour exponentiel (RELEASE) ; moyenne glissante sur A + 1 échantillons (rampe d'attaque
 * linéaire de 5 ms). Le gain appliqué ne dépasse jamais le gain requis : aucune crête ne passe LIMIT. Rien n'est
 * touché quand aucun échantillon ne dépasse le plafond (un son seul, toujours sous lui).
 */
function limitBus(left, right, sr) {
  const n = left.length;
  let over = false;
  for (let i = 0; i < n; i++) {
    const x = left[i], y = right[i];
    if (x > LIMIT || x < -LIMIT || y > LIMIT || y < -LIMIT) { over = true; break; }
  }
  if (!over) return false;
  const A = Math.max(1, Math.round(LOOKAHEAD * sr)), N = n + A;
  // g[j] porte l'échantillon j − A (A échantillons virtuels à gain 1 devant le début).
  const g = new Float32Array(N);
  g.fill(1, 0, A);
  for (let i = 0; i < n; i++) {
    const x = Math.abs(left[i]), y = Math.abs(right[i]), m = x > y ? x : y;
    g[A + i] = m > LIMIT ? LIMIT / m : 1;
  }
  // Minimum sur [j, j + A], en place (file monotone : chaque valeur est lue avant d'être remplacée).
  const size = A + 2, qi = new Int32Array(size), qv = new Float32Array(size);
  let head = 0, len = 0;
  for (let i = 0; i < N + A; i++) {
    const v = i < N ? g[i] : 1;
    while (len > 0 && qv[(head + len - 1) % size] >= v) len--;
    const slot = (head + len) % size;
    qi[slot] = i; qv[slot] = v; len++;
    const j = i - A;
    if (j >= 0) {
      while (qi[head] < j) { head = (head + 1) % size; len--; }
      g[j] = qv[head];
    }
  }
  // Retour : la descente est immédiate (déjà anticipée), la remontée exponentielle.
  const rc = 1 - Math.exp(-1 / (RELEASE * sr));
  let q = 1;
  for (let j = 0; j < N; j++) {
    const m = g[j];
    q = m < q ? m : q + (m - q) * rc;
    g[j] = q;
  }
  // Moyenne glissante sur [j − A, j], appliquée à l'échantillon j − A.
  let sum = 0;
  for (let j = 0; j < N; j++) {
    sum += g[j];
    if (j > A) sum -= g[j - A - 1];
    if (j >= A) {
      const k = sum / (A + 1);
      left[j - A] *= k;
      right[j - A] *= k;
    }
  }
  return true;
}

/**
 * Rend les bruitages en une piste stéréo couvrant D + tail secondes : { left, right, sampleRate, length, used,
 * ignored }. used : bruitages rendus ; ignored : type inconnu, instant illisible ou négatif, ou début après la fin de
 * la piste. Les sons sont additionnés puis le bus est tenu sous −1 dBFS (crête absolue ≤ 0,89).
 */
export function synthSfx(events, D, { sampleRate = 48000, seed = 0, tail = 1.0 } = {}) {
  const sr = Math.round(clamp(Number(sampleRate) || 48000, 8000, 192000));
  const dur = clamp(Number.isFinite(Number(D)) ? Number(D) : 0, 0, MAX_SECONDS);
  const tl = clamp(Number.isFinite(Number(tail)) ? Number(tail) : 1, 0, 30);
  const length = Math.ceil((dur + tl) * sr);
  const left = new Float32Array(length), right = new Float32Array(length);
  const sd = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 0;
  const list = Array.isArray(events) ? events : [];
  const S = scratch(sr);
  let used = 0, ignored = 0;
  for (let i = 0; i < list.length; i++) {
    const e = normEvent(list[i]);
    const start = e ? Math.round(e.t * sr) : length;
    if (!e || start >= length) { ignored++; continue; }
    if (e.g >= MIN_GAIN) {
      const n = Math.max(16, Math.round(spanOf(e) * sr));
      prepare(S, n);
      const rnd = mulberry32(eventSeed(sd, i, KIND.get(e.k), Math.round(e.t * 1000)));
      const res = VOICES[e.k](S, e, rnd, n);
      if (!mixVoice(S, n, res, left, right, start, e.g, e.p)) { ignored++; continue; }
    }
    used++;
  }
  // Garde-fou après le limiteur (qui tient déjà LIMIT) : plafond absolu contre un arrondi.
  if (limitBus(left, right, sr)) {
    for (let i = 0; i < length; i++) {
      const x = left[i], y = right[i];
      if (x > CEIL) left[i] = CEIL; else if (x < -CEIL) left[i] = -CEIL;
      if (y > CEIL) right[i] = CEIL; else if (y < -CEIL) right[i] = -CEIL;
    }
  }
  // 10 ms de fondu au bout de la piste : un son coupé par la fin n'y claque pas.
  const fade = Math.min(length, Math.round(0.01 * sr));
  for (let i = length - fade; i < length; i++) {
    const k = (length - 1 - i) / fade;
    left[i] = left[i] * k + 0; // + 0 : jamais de −0 au bout
    right[i] = right[i] * k + 0;
  }
  return { left, right, sampleRate: sr, length, used, ignored };
}

/**
 * Le fichier WAV d'une piste : RIFF WAVE, PCM 16 bits little-endian, stéréo. Dither triangulaire (±1 LSB, suite
 * mulberry32 fixe : déterministe) sur les seuls échantillons non nuls : le silence reste un silence numérique.
 */
export function wavBuffer({ left, right, sampleRate }) {
  const n = Math.min(left.length, right.length), sr = Math.round(Number(sampleRate) || 48000), bytes = n * 4;
  const buf = Buffer.alloc(44 + bytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stéréo
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(bytes, 40);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const rnd = mulberry32(0x2545f491);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    const x = left[i], y = right[i];
    let v = x === 0 || !Number.isFinite(x) ? 0 : Math.round(x * 32767 + rnd() - rnd());
    let w = y === 0 || !Number.isFinite(y) ? 0 : Math.round(y * 32767 + rnd() - rnd());
    v = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    w = w > 32767 ? 32767 : w < -32768 ? -32768 : w;
    dv.setInt16(o, v, true);
    dv.setInt16(o + 2, w, true);
  }
  return buf;
}

/** Rend les bruitages et écrit le WAV dans file : { file, seconds, peak, used, ignored }. opts : ceux de synthSfx. */
export async function renderSfx(events, D, file, opts = {}) {
  const r = synthSfx(events, D, opts);
  await mkdir(dirname(resolve(file)), { recursive: true });
  await writeFile(file, wavBuffer(r));
  let peak = 0;
  for (let i = 0; i < r.length; i++) {
    const x = Math.abs(r.left[i]), y = Math.abs(r.right[i]);
    if (x > peak) peak = x;
    if (y > peak) peak = y;
  }
  return { file, seconds: Math.round((r.length / r.sampleRate) * 1000) / 1000, peak: Math.round(peak * 10000) / 10000, used: r.used, ignored: r.ignored };
}

// ─── Ligne de commande ─────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = "usage : node lib/reel/sig-sfx.mjs <sfx.json> <sortie.wav>  |  node lib/reel/sig-sfx.mjs --demo <sortie.wav>";

async function main(args) {
  let events, D, seed = 0, out;
  if (args[0] === "--demo" && args[1]) {
    // Chaque son une fois, avec ses réglages par défaut, un toutes les 0,8 s.
    events = SFX_KINDS.map((k, i) => ({ t: Math.round((0.4 + i * 0.8) * 1000) / 1000, k }));
    D = 0.4 + SFX_KINDS.length * 0.8;
    out = args[1];
  } else if (args.length === 2 && !args[0].startsWith("--")) {
    const j = JSON.parse(await readFile(args[0], "utf8"));
    events = Array.isArray(j) ? j : Array.isArray(j?.events) ? j.events : [];
    const last = events.reduce((m, ev) => { const t = num(ev?.t); return Number.isFinite(t) ? Math.max(m, t) : m; }, 0);
    D = Number.isFinite(num(j?.D)) && num(j.D) > 0 ? num(j.D) : last + 1;
    if (Number.isInteger(j?.seed)) seed = j.seed;
    out = args[1];
  } else {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const t0 = Date.now();
  const r = await renderSfx(events, D, out, { seed });
  const fr = (x, d) => x.toFixed(d).replace(".", ",");
  console.log(`bruitages : ${r.used} rendu(s), ${r.ignored} ignoré(s), ${fr(r.seconds, 2)} s, crête ${fr(r.peak, 3)} (${Date.now() - t0} ms) → ${r.file}`);
}

const isMain = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isMain) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`bruitages : ${e.message}`);
    process.exitCode = 1;
  });
}
