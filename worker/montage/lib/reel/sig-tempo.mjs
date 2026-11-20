// Tempo de la musique (engine 2, « Signature ») : battue d'un fichier audio et calage sur la grille de la vidéo.
//
// Dans l'engine 2, chaque changement de scène, chaque mot posé et chaque bruitage tombe sur une grille de fpb images
// par temps à 30 i/s (fpb 15 = 0,5 s par temps = 120 BPM ; 18 = 100 BPM ; 14 = 128,57 BPM ; 12 à 20). La musique vient
// du compositeur (demandée à N BPM avec son plus gros coup à X s : à peu près juste, jamais exactement) ou de la
// bibliothèque (tempo inconnu). À la finition, elle est étirée (atempo) et coupée pour que ses temps tombent sur la
// grille (t = n × fpb / 30) et sa plus forte montée sur le moment fort de la vidéo (le « drop »).
//
// - analyzeMusic(file) : ffmpeg décode en PCM float32 mono 22 050 Hz ; enveloppe d'attaques (flux spectral sur un
//   spectre en log compressé, une bande par raie sous 120 Hz puis des quarts d'octave, redressé, lissé, moyenne locale
//   retirée) ; tempo par autocorrélation sur 60-200 BPM avec un a priori log-gaussien large autour de 120 BPM (les
//   harmoniques 2τ et 3τ tranchent l'octave), période affinée sur les pics multiples ; temps suivis par programmation
//   dynamique (Ellis 2007, comme librosa), puis recalés à l'échantillon sur l'attaque (énergie des 10 ms suivantes
//   contre celle des 30 ms d'avant) ; période et phase finales par régression robuste sur ces attaques (repli : train
//   d'impulsions qui maximise l'enveloppe) ; énergie (RMS) entre deux temps ; montées (candidats au drop, recalées sur
//   le temps où l'énergie saute).
// - planMusic(analyse, { fpb, D, drop }) : facteur atempo, départ dans la musique étirée (ou court silence avant elle
//   quand sa montée tombe juste avant le moment fort), bouclage, explication.
// - musicFilter(plan, { D }) : la chaîne -af de ffmpeg de l'entrée musique (48 kHz, atempo, coupe corrigée du
//   décalage moyen d'atempo, fondus, silence de tête, durée exacte D).
//
// Calcul en JavaScript pur, sans dépendance : ~0,7 s (décodage compris) pour deux minutes de musique.
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { run } from "../util.mjs";

// ─── Réglages ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SR = 22050; // Hz : la musique est décodée en mono à cette fréquence
const WIN = 1024; // fenêtre de la TFCT (46 ms)
const HOP = 256; // pas de la TFCT (11,6 ms)
const FR = SR / HOP; // trames par seconde (86,13)
const BPM_MIN = 60, BPM_MAX = 200;
const PRIOR_BPM = 120, PRIOR_OCT = 1; // a priori log-gaussien sur le tempo : centre, écart en octaves
const GAMMA = 1e5; // compression log(1 + γ × puissance relative) : les sons très faibles (charleston) pèsent peu
const F_LIN = 120; // Hz : une bande par raie en dessous (la grosse caisse), des quarts d'octave au-dessus
const TIGHT = 100; // raideur du suivi des temps (Ellis 2007, librosa)
const ATTACK_AFTER = Math.round(0.01 * SR); // attaque : énergie moyenne des 10 ms qui suivent…
const ATTACK_BEFORE = Math.round(0.03 * SR); // … contre celle des 30 ms d'avant (assez longues pour lisser une basse)
const ATTACK_DB = 6; // une attaque nette : au moins 6 dB de plus après qu'avant
const BIAS0 = 0.004; // s : retard typique de l'attaque réelle sur la trame du flux (−4 à +9 ms mesurés ; repli sans attaques nettes)
const MIN_SECONDS = 4; // en dessous : trop court pour un tempo
const SILENCE = 1e-4; // crête sous −80 dBFS : silence
/** Confiance de tempo en dessous de laquelle planMusic n'étire pas : le tempo est trop incertain pour caler la grille. */
export const MIN_CONF = 0.2;
const RISE_MIN = 2; // score minimal d'une montée gardée (dB, bonus d'attaque compris)
const DRIFT_OK = 0.004; // s : sans étirement, la musique ne dérive pas de plus sur la vidéo → pas d'atempo (et de son flou)

const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mod = (x, m) => ((x % m) + m) % m;

function median(list) {
  const s = Float64Array.from(list).sort();
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function quantile(list, q) {
  const s = Float64Array.from(list).sort();
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Décalage (−0,5 à 0,5) du sommet de la parabole passant par y[m−1], y[m], y[m+1] (0 si m n'est pas un sommet). */
function parab(y, m) {
  if (m <= 0 || m >= y.length - 1) return 0;
  const a = y[m - 1], b = y[m], c = y[m + 1], den = a - 2 * b + c;
  if (!(den < 0)) return 0;
  return clamp((0.5 * (a - c)) / den, -0.5, 0.5);
}

// ─── TFCT ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const HANN = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
const REV = new Uint16Array(WIN);
for (let i = 0, bits = Math.log2(WIN); i < WIN; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  REV[i] = r;
}
const COS = Float64Array.from({ length: WIN / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / WIN));
const SIN = Float64Array.from({ length: WIN / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / WIN));

/** FFT complexe en place (radix 2, taille WIN). */
function fft(re, im) {
  for (let i = 0; i < WIN; i++) {
    const j = REV[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= WIN; size <<= 1) {
    const half = size >> 1, step = WIN / size;
    for (let s = 0; s < WIN; s += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = s + j, b = a + half, c = COS[k], d = SIN[k];
        const tr = re[b] * c + im[b] * d, ti = im[b] * c - re[b] * d;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** Bandes du flux : une par raie de 43 à 108 Hz, puis des quarts d'octave jusqu'à 11 kHz (31 bandes). */
const BANDS = (() => {
  const of = new Int16Array(WIN / 2 + 1).fill(-1);
  let nb = 0, last = null;
  for (let k = 2; k <= WIN / 2; k++) {
    const f = (k * SR) / WIN;
    const key = f < F_LIN ? `l${k}` : `o${Math.floor(4 * Math.log2(f / F_LIN))}`;
    if (key !== last) { last = key; nb++; }
    of[k] = nb - 1;
  }
  const count = new Float64Array(nb);
  for (let k = 2; k <= WIN / 2; k++) count[of[k]]++;
  return { of, count, nb };
})();

/**
 * Enveloppe d'attaques, une valeur par trame (trame f centrée sur f × HOP) : `flux` (flux spectral redressé, lissé)
 * et `o` (le même, moyenne locale sur 2 s retirée). null si le signal ne contient rien.
 */
function onsetEnvelope(x) {
  const n = x.length, nf = Math.floor(n / HOP) + 1;
  const { of, count, nb } = BANDS;
  const pw = new Float64Array(nf * nb);
  const re = new Float64Array(WIN), im = new Float64Array(WIN);
  // Deux trames réelles par FFT complexe : la première en partie réelle, la suivante en partie imaginaire.
  for (let f = 0; f < nf; f += 2) {
    const s0 = f * HOP - WIN / 2, s1 = s0 + HOP, two = f + 1 < nf;
    for (let i = 0; i < WIN; i++) {
      const j0 = s0 + i, j1 = s1 + i;
      re[i] = j0 >= 0 && j0 < n ? x[j0] * HANN[i] : 0;
      im[i] = two && j1 >= 0 && j1 < n ? x[j1] * HANN[i] : 0;
    }
    fft(re, im);
    for (let k = 2; k <= WIN / 2; k++) {
      const b = of[k], nk = (WIN - k) & (WIN - 1);
      const zr = re[k], zi = im[k], cr = re[nk], ci = im[nk];
      const sr = zr + cr, di = zi - ci, si = zi + ci, dr = zr - cr;
      pw[f * nb + b] += (sr * sr + di * di) / 4;
      if (two) pw[(f + 1) * nb + b] += (si * si + dr * dr) / 4;
    }
  }
  let ref = 0;
  for (let f = 0; f < nf; f++) {
    for (let b = 0; b < nb; b++) {
      const v = (pw[f * nb + b] /= count[b]);
      if (v > ref) ref = v;
    }
  }
  if (!(ref > 0)) return null;
  const g = GAMMA / ref;
  for (let i = 0; i < pw.length; i++) pw[i] = Math.log1p(g * pw[i]);
  // Flux : montée de chaque bande d'une trame à la suivante (avant la première trame : silence).
  const flux = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    let s = 0;
    for (let b = 0; b < nb; b++) {
      const d = pw[f * nb + b] - (f ? pw[(f - 1) * nb + b] : 0);
      if (d > 0) s += d;
    }
    flux[f] = s / nb;
  }
  // Lissage gaussien (σ = 1 trame), puis moyenne glissante sur 2 s retirée (passe-haut ~0,5 Hz).
  const K = [0.0044, 0.054, 0.242, 0.399, 0.242, 0.054, 0.0044], ks = K.reduce((a, b) => a + b, 0);
  const sm = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    let s = 0;
    for (let j = -3; j <= 3; j++) s += K[j + 3] * flux[clamp(f + j, 0, nf - 1)];
    sm[f] = s / ks;
  }
  const half = Math.round(FR), cs = new Float64Array(nf + 1);
  for (let f = 0; f < nf; f++) cs[f + 1] = cs[f] + sm[f];
  const o = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = Math.max(0, f - half), b = Math.min(nf, f + half + 1);
    o[f] = sm[f] - (cs[b] - cs[a]) / (b - a);
  }
  return { flux: sm, o };
}

// ─── Tempo ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Tempo par autocorrélation de l'enveloppe : { tau (période en trames, fractionnaire), strength (autocorrélation
 * normalisée à cette période, 0 à 1) }, ou null. Chaque période de 60 à 200 BPM est notée A(τ) + A(2τ)/2 + A(3τ)/4,
 * pondérée par l'a priori ; la période gagnante est ensuite affinée sur les pics de A en τ, 2τ, 3τ… (jusqu'à 8 s).
 */
function estimateTempo(o) {
  const n = o.length;
  const maxLag = Math.min(n - 2, Math.ceil(FR * 8));
  const lo = Math.ceil((60 * FR) / BPM_MAX), hi = Math.floor((60 * FR) / BPM_MIN);
  if (maxLag < 3 * hi + 2) return null;
  const A = new Float64Array(maxLag + 1);
  for (let L = 0; L <= maxLag; L++) {
    let s = 0;
    for (let t = 0, e = n - L; t < e; t++) s += o[t] * o[t + L];
    A[L] = s / (n - L);
  }
  if (!(A[0] > 0)) return null;
  for (let L = maxLag; L >= 0; L--) A[L] /= A[0];
  const near = (L) => Math.max(A[L - 1], A[L], A[L + 1]);
  let best = -Infinity, L0 = 0;
  for (let L = lo; L <= hi; L++) {
    const z = Math.log2((60 * FR) / L / PRIOR_BPM) / PRIOR_OCT;
    const s = Math.exp(-0.5 * z * z) * (A[L] + 0.5 * near(2 * L) + 0.25 * near(3 * L));
    if (s > best) { best = s; L0 = L; }
  }
  // Le sommet de A le plus proche (la note pondérée peut tomber à côté).
  for (let k = 0; k < 3; k++) {
    if (A[L0 + 1] > A[L0]) L0++;
    else if (A[L0 - 1] > A[L0]) L0--;
  }
  let tau = L0 + parab(A, L0), num = 0, den = 0;
  for (let k = 1; ; k++) {
    const c = Math.round(k * tau);
    if (c + 3 > maxLag) break;
    let m = c;
    for (let j = c - 2; j <= c + 2; j++) if (A[j] > A[m]) m = j;
    if (m === c - 2 || m === c + 2 || !(A[m] > 0)) continue; // pas un vrai pic
    const pk = m + parab(A, m);
    num += A[m] * k * pk;
    den += A[m] * k * k;
    tau = num / den;
  }
  return { tau, strength: clamp(A[L0], 0, 1) };
}

/**
 * Suivi des temps par programmation dynamique (Ellis 2007) : maximise la somme de l'enveloppe aux temps moins
 * TIGHT × log²(écart / période) entre deux temps. Renvoie les trames des temps (fractionnaires, au sommet local de
 * l'enveloppe), sans les temps faibles du début et de la fin.
 */
function trackBeats(ls, tau) {
  const n = ls.length;
  const dmin = Math.max(1, Math.round(tau / 2)), dmax = Math.round(2 * tau);
  const cost = new Float64Array(dmax + 1);
  for (let d = dmin; d <= dmax; d++) cost[d] = -TIGHT * Math.log(d / tau) ** 2;
  const cum = new Float64Array(n), back = new Int32Array(n).fill(-1);
  let mx = 0;
  for (let t = 0; t < n; t++) if (ls[t] > mx) mx = ls[t];
  let first = true;
  for (let t = 0; t < n; t++) {
    let best = -Infinity, bi = -1;
    for (let d = dmin; d <= dmax && t - d >= 0; d++) {
      const v = cum[t - d] + cost[d];
      if (v > best) { best = v; bi = t - d; }
    }
    cum[t] = ls[t] + (bi >= 0 ? best : 0);
    // Tant qu'aucune attaque n'a passé 1 % du maximum, un temps n'a pas de prédécesseur.
    if (first && ls[t] < 0.01 * mx) back[t] = -1;
    else { back[t] = bi; first = false; }
  }
  // Dernier temps : le dernier maximum local du score cumulé au-dessus de la moitié de la médiane de ces maxima.
  const maxes = [];
  for (let t = 1; t < n - 1; t++) if (cum[t] > cum[t - 1] && cum[t] >= cum[t + 1]) maxes.push(t);
  if (!maxes.length) return [];
  const med = median(maxes.map((t) => cum[t]));
  let last = maxes[maxes.length - 1];
  for (let i = maxes.length - 1; i >= 0; i--) if (cum[maxes[i]] * 2 > med) { last = maxes[i]; break; }
  const beats = [];
  for (let b = last, guard = 0; b >= 0 && guard < n; b = back[b], guard++) beats.push(b);
  beats.reverse();
  // Les temps faibles du début et de la fin (lissés sur 3 temps) sont retirés.
  const sc = beats.map((b) => ls[b]);
  const sm = sc.map((v, i) => 0.5 * (sc[i - 1] ?? 0) + v + 0.5 * (sc[i + 1] ?? 0));
  const th = 0.5 * Math.sqrt(sm.reduce((a, v) => a + v * v, 0) / Math.max(1, sm.length));
  let i0 = 0, i1 = beats.length - 1;
  while (i0 <= i1 && !(sm[i0] > th)) i0++;
  while (i1 >= i0 && !(sm[i1] > th)) i1--;
  return beats.slice(i0, i1 + 1).map((b) => b + parab(ls, b));
}

/** Phase (trames, dans [0, τ)) du train d'impulsions de période τ qui recueille le plus d'enveloppe. */
function pulsePhase(o, tau) {
  let best = -Infinity, phi = 0;
  for (let p = 0; p < tau; p += 0.1) {
    let s = 0;
    for (let t = p; t < o.length - 1; t += tau) {
      const i = Math.floor(t), f = t - i;
      s += o[i] * (1 - f) + o[i + 1] * f;
    }
    if (s > best) { best = s; phi = p; }
  }
  return phi;
}

/**
 * Droite t = a + b × k par moindres carrés, en écartant les points aberrants (au-delà de 4 écarts médians, 4 ms au
 * moins ; 4 passes, puis la droite des points gardés) : { a, b, n (points gardés), rms (s), span (écart des k gardés) }
 * ou null.
 */
function fitGrid(list) {
  const pts = [...list].sort((u, v) => u.k - v.k);
  let use = pts, a = 0, b = 0;
  for (let it = 0; it <= 4; it++) {
    const m = use.length;
    if (m < 4) return null;
    let sk = 0, st = 0, skk = 0, skt = 0;
    for (const q of use) { sk += q.k; st += q.t; skk += q.k * q.k; skt += q.k * q.t; }
    const det = m * skk - sk * sk;
    if (!(det > 0)) return null;
    b = (m * skt - sk * st) / det;
    a = (st - b * sk) / m;
    if (it === 4) break;
    const lim = Math.max(0.004, 4 * 1.4826 * median(use.map((q) => Math.abs(q.t - a - b * q.k))));
    use = pts.filter((q) => Math.abs(q.t - a - b * q.k) <= lim);
  }
  const rms = Math.sqrt(use.reduce((s, q) => s + (q.t - a - b * q.k) ** 2, 0) / use.length);
  return { a, b, n: use.length, rms, span: use[use.length - 1].k - use[0].k };
}

// ─── Analyse ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les chiffres d'une musique sans tempo (silence, fichier trop court, son sans attaque). */
const noTempo = (duration) => ({ duration: round(duration, 3), bpm: 0, period: 0, phase: 0, confidence: 0, beats: [], energy: [], rises: [] });

/** Analyse d'un signal mono à SR Hz (voir analyzeMusic). */
function analyzeSamples(x, duration) {
  const n = x.length, seconds = n / SR;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(x[i]);
    if (v > peak) peak = v;
  }
  if (seconds < MIN_SECONDS || !(peak >= SILENCE)) return noTempo(duration);
  const env = onsetEnvelope(x);
  const tempo = env && estimateTempo(env.o);
  if (!tempo) return noTempo(duration);
  const p0 = tempo.tau / FR;

  // Temps suivis sur l'enveloppe normalisée (écart type 1).
  const sd = Math.sqrt(env.o.reduce((s, v) => s + v * v, 0) / env.o.length) || 1;
  const ls = env.o.map((v) => v / sd);
  const frames = trackBeats(ls, tempo.tau);
  if (frames.length < 2) return noTempo(duration);

  // Recalage sur l'attaque : dans ±50 ms (au plus un cinquième de temps) autour du temps attendu, l'instant où
  // l'énergie moyenne des 10 ms suivantes dépasse le plus celle des 30 ms d'avant (avant le début : silence).
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i] * x[i];
  const eps = Math.max(1e-14, peak * peak * 1e-8);
  const ratioDb = (i) => 10 * Math.log10(((cs[Math.min(n, i + ATTACK_AFTER)] - cs[i]) / ATTACK_AFTER + eps) / ((cs[i] - cs[Math.max(0, i - ATTACK_BEFORE)]) / ATTACK_BEFORE + eps));
  const half = Math.min(0.05, 0.2 * p0);
  const attack = (c) => {
    const i0 = Math.max(0, Math.round((c - half) * SR)), i1 = Math.min(n - 1, Math.round((c + half) * SR));
    let best = -Infinity, at = -1;
    for (let i = i0; i <= i1; i += 11) {
      const d = ratioDb(i);
      if (d > best) { best = d; at = i; }
    }
    if (at < 0) return null;
    for (let i = Math.max(i0, at - 10), e = Math.min(i1, at + 10); i <= e; i++) {
      const d = ratioDb(i);
      if (d > best) { best = d; at = i; }
    }
    return { t: at / SR, s: best };
  };
  const coarse = frames.map((f) => f / FR);
  const att = coarse.map((t) => attack(t + BIAS0));
  const sharp = att.map((a) => !!a && a.s >= ATTACK_DB);
  const deltas = att.flatMap((a, i) => (sharp[i] ? [a.t - coarse[i]] : []));
  const bias = deltas.length >= 4 ? median(deltas) : BIAS0;
  const beats = coarse.map((t, i) => (sharp[i] && Math.abs(att[i].t - t - bias) <= 0.025 ? att[i].t : t + bias));

  // Période et phase : régression sur les attaques nettes (indices de temps pris sur la période de l'autocorrélation,
  // puis repris sur la première droite), gardée si au moins 8 attaques s'y tiennent, étalées sur au moins 40 % des temps.
  // Les indices partent de la phase moyenne (circulaire) des attaques nettes, pas du premier temps : un premier temps
  // hors de la grille (accord plaqué à t = 0, à mi-chemin de deux temps) décalerait sinon la moitié de la numérotation.
  const sharpT = beats.filter((t, i) => sharp[i]);
  let cx = 0, cy = 0;
  for (const t of sharpT) { cx += Math.cos((2 * Math.PI * t) / p0); cy += Math.sin((2 * Math.PI * t) / p0); }
  const ref = sharpT.length ? (Math.atan2(cy, cx) / (2 * Math.PI)) * p0 : beats[0];
  let fit = fitGrid(sharpT.map((t) => ({ k: Math.round((t - ref) / p0), t })));
  if (fit && Math.abs(fit.b / p0 - 1) < 0.01) fit = fitGrid(sharpT.map((t) => ({ k: Math.round((t - fit.a) / fit.b), t }))) || fit;
  const good = !!fit && fit.n >= 8 && fit.span >= 0.4 * beats.length && Math.abs(fit.b / p0 - 1) < 0.01 && fit.rms < 0.012;
  const period = good ? fit.b : p0;
  let phase = good ? mod(fit.a, period) : mod(pulsePhase(env.o, tempo.tau) / FR + bias, period);
  if (period - phase < 5e-5) phase = 0;

  // Confiance : netteté de la périodicité et part des temps qui ont une attaque nette sur la grille.
  const onGrid = good ? fit.n / beats.length : 0;
  const confidence = clamp(0.4 * clamp(tempo.strength / 0.4, 0, 1) + 0.6 * clamp(onGrid / 0.8, 0, 1), 0.01, 1);

  // Énergie : RMS de chaque intervalle entre deux temps (le dernier : une période, au plus jusqu'à la fin).
  const energy = beats.map((t, i) => {
    const a = clamp(Math.round(t * SR), 0, n - 1);
    const b = clamp(Math.round((i + 1 < beats.length ? beats[i + 1] : t + period) * SR), a + 1, n);
    return Math.sqrt(Math.max(0, cs[b] - cs[a]) / (b - a));
  });

  // Montées : l'énergie des 4 temps suivants contre celle des 8 précédents (dB), plus un bonus pour une attaque bien
  // plus forte que les temps ordinaires (le coup du drop) ; un seul candidat par fenêtre de ±3 temps. Les 4 intervalles
  // suivants doivent être complets (le dernier, coupé par la fin du fichier, ne garde souvent que l'attaque).
  const hit = frames.map((f) => {
    let m = 0;
    for (let j = Math.round(f) - 2; j <= Math.round(f) + 2; j++) if (j >= 0 && j < env.flux.length && env.flux[j] > m) m = env.flux[j];
    return m;
  });
  const hitRef = quantile(hit, 0.9) || 1;
  const pow = energy.map((e) => e * e);
  const cand = [], scoreAt = new Map();
  for (let i = 4; i + 4 < beats.length; i++) {
    let prev = 0, next = 0;
    const a = Math.max(0, i - 8);
    for (let j = a; j < i; j++) prev += pow[j];
    for (let j = i; j < i + 4; j++) next += pow[j];
    const rise = 10 * Math.log10((next / 4 + 1e-10) / (prev / (i - a) + 1e-10));
    const bonus = 3 * clamp(hit[i] / hitRef - 1, 0, 2);
    cand.push({ i, score: rise + bonus });
    scoreAt.set(i, rise + bonus);
  }
  cand.sort((u, v) => v.score - u.score);
  // Recalage d'un temps : après une montée progressive (bruit qui monte, roulement de caisse claire), le score des
  // fenêtres est presque plat sur les deux ou trois temps d'avant le drop et son maximum tombe souvent un temps trop
  // tôt. Le saut d'énergie d'un temps au suivant, lui, est net sur le premier temps du drop : un voisin dont le saut
  // dépasse nettement (1,5 dB, et au moins 2 dB en tout) celui du candidat, pour un score presque égal (1,5 dB), le
  // remplace.
  const step = (j) => 10 * Math.log10((pow[j] + 1e-10) / (pow[j - 1] + 1e-10));
  const refine = (i) => {
    let best = i;
    for (const j of [i - 1, i + 1]) {
      if (!scoreAt.has(j) || scoreAt.get(j) < scoreAt.get(i) - 1.5) continue;
      if (step(j) >= 2 && step(j) >= step(i) + 1.5 && step(j) > step(best)) best = j;
    }
    return best;
  };
  const rises = [];
  for (const c of cand) {
    if (c.score < RISE_MIN || rises.length >= 8) break;
    const i = refine(c.i);
    if (rises.some((r) => Math.abs(r.i - i) <= 3)) continue;
    rises.push({ i, score: c.score });
  }

  return {
    duration: round(duration, 3),
    bpm: round(60 / period, 2),
    period: round(period, 6),
    phase: round(phase, 4),
    confidence: round(confidence, 2),
    beats: beats.map((t) => round(t, 4)),
    energy: energy.map((e) => Number(e.toPrecision(4))),
    rises: rises.map((r) => ({ t: round(beats[r.i], 4), score: round(r.score, 2) })),
  };
}

/** Décode les maxSeconds premières secondes en PCM float32 mono SR Hz (stdout de ffmpeg). */
async function decode(ffmpeg, file, name, limit, signal) {
  let buf;
  try {
    buf = await run(ffmpeg, ["-v", "error", "-nostdin", "-i", file, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(SR), "-t", String(limit), "-f", "f32le", "-c:a", "pcm_f32le", "-"], { binary: true, timeoutMs: 120_000, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e?.code === "ENOENT" || e?.code === "EACCES") throw new Error(`ffmpeg introuvable (${ffmpeg}) : impossible d'analyser la musique « ${name} ». Installez ffmpeg (brew install ffmpeg).`);
    // ffmpeg 6 et 7 finissent par une ligne générique (« Error opening output files: Invalid argument ») : l'absence
    // de piste son se lit dans tout stderr, pas dans sa dernière ligne.
    const all = String(e?.stderr || e?.message || "");
    const detail = all.trim().split("\n").filter(Boolean).pop() || "";
    const why = /matches no streams|does not contain any stream/i.test(all) ? "aucune piste son" : detail.replace(/^ffmpeg a échoué \(\d+\) : /, "").slice(-240);
    throw new Error(`La musique « ${name} » n'a pas pu être décodée par ffmpeg (${why || "erreur inconnue"}).`);
  }
  const m = Math.floor(buf.length / 4), x = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const v = buf.readFloatLE(i * 4);
    x[i] = Number.isFinite(v) ? v : 0;
  }
  return x;
}

/** Durée complète du fichier (ffprobe à côté de ffmpeg), 0 si inconnue : seulement quand l'analyse a été tronquée. */
async function probeDuration(ffmpeg, file, signal) {
  const ffprobe = String(ffmpeg).replace(/ffmpeg(?=[^/\\]*$)/i, "ffprobe");
  if (ffprobe === ffmpeg) return 0;
  try {
    const out = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 20_000, signal });
    const d = Number(String(out).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch (e) {
    if (signal?.aborted) throw e;
    return 0;
  }
}

/**
 * Analyse le tempo d'un fichier de musique (les maxSeconds premières secondes). Renvoie
 * { duration, bpm, period, phase, confidence, beats, energy, rises } :
 * - duration : durée du fichier entier (s) ;
 * - bpm, period : tempo et durée d'un temps (s) ; phase : instant du premier temps de la grille, dans [0, period) ;
 * - confidence : 0 à 1 (0 pour un silence, un fichier trop court ou un son sans attaques) ;
 * - beats : instants des temps suivis (s) ; energy : RMS de l'intervalle qui suit chaque temps (même longueur) ;
 * - rises : [{ t, score }] les temps où l'énergie des 4 temps suivants dépasse le plus celle des 8 précédents (score
 *   en dB, plus jusqu'à 6 pour une attaque très forte), recalés d'un temps sur le saut d'énergie quand il est net
 *   (fin d'une montée progressive), du plus fort au plus faible, 8 au plus, 3 temps d'écart.
 * Ne lève une erreur (en français, avec le nom du fichier) que si ffmpeg manque ou ne sait pas décoder le fichier.
 */
export async function analyzeMusic(file, { ffmpeg = "ffmpeg", maxSeconds = 120, signal } = {}) {
  const path = String(file ?? "");
  const name = basename(path) || path;
  if (!path || (!/^[a-z][\w+.-]*:\/\//i.test(path) && !existsSync(path))) throw new Error(`Musique introuvable : « ${path || "(aucun fichier)"} ».`);
  const limit = Number.isFinite(Number(maxSeconds)) && Number(maxSeconds) > 0 ? Math.min(Number(maxSeconds), 3600) : 120;
  const x = await decode(ffmpeg || "ffmpeg", path, name, limit, signal);
  let duration = x.length / SR;
  if (duration >= limit - 0.05) duration = Math.max(duration, await probeDuration(ffmpeg || "ffmpeg", path, signal));
  return analyzeSamples(x, duration);
}

// ─── Calage ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nombre à la française (virgule décimale). */
const fr = (x, n = 3) => String(round(x, n)).replace(".", ",");

/**
 * Calage d'une musique analysée sur la vidéo (durée D, grille de fpb images par temps à fps i/s, moment fort `drop`
 * en s ou null). Renvoie { ratio, offset, delay, loop, loopLen, bpmIn, bpmOut, aligned: { grid, drop }, why } :
 * - ratio : facteur atempo (> 1 accélère, 4 décimales) qui rend la période de la musique (ou son double, ou sa moitié :
 *   la plus proche de P = fpb / fps) égale à P ; 1 si l'écart dépasse maxStretch ou si le tempo est incertain
 *   (aligned.grid faux), et 1 aussi quand, sans étirement, les temps ne dériveraient pas de plus de 4 ms sur la vidéo ;
 * - offset : départ (s) dans la musique étirée. Les temps étirés valent (phase + k × period) / ratio : offset est
 *   congru à phase / ratio modulo P (modulo P / 2 quand deux temps de musique font un temps de grille), si bien que
 *   chaque temps tombe sur la grille t = n × P de la vidéo. Parmi ces départs, celui qui pose la plus forte montée
 *   exactement sur drop (sur le point de la grille le plus proche si drop n'y est pas), avec 0 ≤ offset et
 *   offset + D ≤ durée étirée ; sinon la montée suivante ; sinon le premier départ calé (le premier temps de la
 *   musique à t = 0). Sans grille, la montée est posée sur drop sans arrondi ;
 * - delay : silence (s) avant la musique, au début de la vidéo, 0 d'ordinaire. Une montée qui, étirée, tombe un peu
 *   avant le moment fort (le cas courant d'une musique composée « avec son coup à drop s », juste un peu lente, ou au
 *   coup posé quelques ms trop tôt) demanderait un départ négatif : la musique part alors de son début (offset 0)
 *   et commence `delay` s après la vidéo, au plus maxDelay (un temps de grille par défaut). Sans cela, la montée
 *   tomberait un temps entier avant le moment fort. musicFilter pose ce silence ;
 * - loop : la musique étirée est plus courte que D (départ sur le premier temps), sauf si une montée posée avec un
 *   `delay` la fait tenir (la vidéo ne demande alors que D − delay s de musique) ;
 * - loopLen : avec loop sur la grille, la longueur (s, musique étirée) d'un nombre entier de temps de grille depuis le
 *   départ, que musicFilter répète (aloop) : les temps restent sur la grille après chaque reprise. 0 sinon (l'appelant
 *   boucle alors le fichier entier, -stream_loop, et les temps quittent la grille à la reprise) ;
 * - bpmIn, bpmOut : tempo avant et après étirement ; why : l'explication, en français.
 * Silence ou fichier trop court (confidence 0) : ratio 1, offset 0, rien de calé.
 */
export function planMusic(analysis, { fpb, D, drop, fps = 30, maxStretch = 0.08, maxDelay } = {}) {
  const a = analysis && typeof analysis === "object" ? analysis : {};
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const dur = Math.max(0, num(a.duration) ?? 0);
  const period = num(a.period) ?? 0, conf = clamp(num(a.confidence) ?? 0, 0, 1);
  const bpmIn = round((num(a.bpm) ?? 0) > 0 ? num(a.bpm) : period > 0 ? 60 / period : 0, 2);
  const Dv = Math.max(0, num(D) ?? 0);
  const P = (num(fpb) ?? 0) > 0 && (num(fps) ?? 0) > 0 ? num(fpb) / num(fps) : 0;
  const maxS = (num(maxStretch) ?? -1) >= 0 ? num(maxStretch) : 0.08;
  const d0 = num(drop);
  const dropAt = d0 !== null && d0 >= 0 && (!Dv || d0 <= Dv) ? d0 : null;
  const rises = (Array.isArray(a.rises) ? a.rises : []).filter((r) => r && (num(r.t) ?? -1) >= 0);
  const gridBpm = P > 0 ? round(60 / P, 2) : 0;
  const loopOf = (ratio) => dur > 0 && Dv > 0 && dur / ratio < Dv - 1e-6;
  const maxD = (num(maxDelay) ?? -1) >= 0 ? num(maxDelay) : P > 0 ? P : 0.5;

  if (!(conf > 0) || !(period > 0)) {
    return {
      ratio: 1, offset: 0, delay: 0, loop: loopOf(1), loopLen: 0, bpmIn, bpmOut: bpmIn, aligned: { grid: false, drop: false },
      why: `Tempo introuvable (silence, fichier trop court ou son sans attaques) : musique prise depuis le début, sans étirement ni calage${loopOf(1) ? `, et bouclée (${fr(dur, 1)} s pour ${fr(Dv, 1)} s de vidéo)` : ""}.`,
    };
  }

  // Octave : la période, son double ou sa moitié, la plus proche de P.
  let chosen = period, mult = 1;
  if (P > 0) for (const [c, m] of [[2 * period, 2], [period / 2, 0.5]]) if (Math.abs(Math.log(c / P)) < Math.abs(Math.log(chosen / P))) { chosen = c; mult = m; }
  const want = P > 0 ? round(chosen / P, 4) : 1;
  const sure = conf >= MIN_CONF;
  const grid = P > 0 && sure && Math.abs(want - 1) <= maxS + 1e-9;
  // Presque au bon tempo : sans étirement, les temps dérivent d'au plus DRIFT_OK sur la vidéo, moins que le flou d'atempo.
  const drift = Math.abs(chosen / P - 1) * Dv;
  const ratio = grid && !(Dv > 0 && drift <= DRIFT_OK) ? want : 1;
  const parts = [];
  if (!(P > 0)) parts.push(`Musique à ${fr(bpmIn, 2)} BPM ; grille de la vidéo inconnue (fpb) : pas d'étirement`);
  else if (!sure) parts.push(`Pas de tempo net dans la musique (confiance ${fr(conf, 2)}) : pas d'étirement, la grille n'est pas calée`);
  else if (!grid) parts.push(`Musique à ${fr(bpmIn, 2)} BPM, trop loin de la grille (${fr(gridBpm, 2)} BPM, ${fpb} images par temps : il faudrait ×${fr(want, 4)}, au-delà de ±${fr(maxS * 100, 1)} %) : pas d'étirement, les temps ne tombent pas sur la grille`);
  else {
    const octave = mult === 2 ? ", deux temps de musique par temps de grille" : mult === 0.5 ? ", un temps de musique tous les deux temps de grille" : "";
    const how = ratio !== 1 ? `étirée ×${fr(ratio, 4)} (${fr(bpmIn * ratio, 2)} BPM)` : want === 1 ? "déjà" : `déjà presque (pas d'étirement : ${fr(drift * 1000, 1)} ms de dérive au plus sur la vidéo)`;
    parts.push(`Musique à ${fr(bpmIn, 2)} BPM ${how} sur la grille de ${fpb} images par temps (${fr(gridBpm, 2)} BPM)${octave}`);
  }

  const phase = mod(num(a.phase) ?? 0, period);
  const durS = dur / ratio, phaseS = phase / ratio, periodS = period / ratio;
  // Pas des départs calés : P (P / 2 quand deux temps de musique font un temps de grille) ; sans grille, la période.
  const step = grid ? (mult === 2 ? P / 2 : P) : periodS;
  let first = sure ? mod(phaseS, step) : 0;
  if (step - first < 0.002) first = 0;
  first = round(first, 4);
  // Un morceau un peu plus court que la vidéo peut encore tenir sans boucle : une montée posée avec un silence au début
  // (delay, au plus maxD) ne demande que D − delay s de musique. Les montées sont donc essayées avant de boucler.
  const short = loopOf(ratio);
  let offset = first, used = -1, delay = 0;
  if (dropAt !== null && rises.length && (!short || durS >= Dv - maxD - 1e-6)) {
    for (let i = 0; i < rises.length; i++) {
      // La montée, recalée sur la grille des temps de la musique, puis posée sur le point de la grille de la vidéo le
      // plus proche du moment fort (le moment fort lui-même s'il est sur la grille) : l'ancre est la montée, la petite
      // dérive (arrondi du ratio, ou pas d'étirement) se partage avant et après elle.
      const t = Number(rises[i].t);
      const rs = (sure ? phase + Math.round((t - phase) / period) * period : t) / ratio;
      let o = grid ? rs - Math.round(dropAt / step) * step : rs - dropAt;
      o = round(o, 4);
      // Un départ négatif (la montée tombe avant le moment fort même en partant du début) : silence au début, au plus maxD.
      // La vidéo ne demande alors que D − delay s de musique : la même condition o + D ≤ durée étirée.
      if (o >= -maxD - 1e-9 && o + Dv <= durS + 1e-6) { offset = Math.max(0, o); delay = round(Math.max(0, -o), 4); used = i; break; }
    }
  }
  const loop = short && used < 0;
  const loopLen = loop ? loopLength({ loop, offset, aligned: { grid } }, { durS, P }) : 0;
  if (loop) parts.push(`morceau plus court que la vidéo (${fr(durS, 1)} s pour ${fr(Dv, 1)} s) : il sera bouclé, départ sur le premier temps (${fr(first, 3)} s)${loopLen > 0 ? `, reprise tous les ${Math.round(loopLen / P)} temps (${fr(loopLen, 3)} s) pour rester sur la grille` : ""}`);
  else if (dropAt === null) parts.push(`pas de moment fort : départ sur le premier temps (${fr(first, 3)} s)`);
  else if (!rises.length) parts.push(`pas de montée nette dans la musique : départ sur le premier temps (${fr(first, 3)} s)`);
  else {
    if (used < 0) parts.push(`aucune montée de la musique ne peut tomber sur le moment fort (${fr(dropAt, 3)} s) sans sortir du morceau : départ sur le premier temps (${fr(first, 3)} s)`);
    else {
      const which = used === 0 ? "sa plus forte montée" : `sa ${used + 1}e montée (les plus fortes ne tiennent pas dans la vidéo)`;
      const at = Number(rises[used].t) / ratio - offset + delay;
      const where = Math.abs(at - dropAt) < 0.5 / 30 ? `tombe sur le moment fort (${fr(dropAt, 3)} s)` : `tombe sur le temps le plus proche du moment fort (${fr(at, 3)} s pour ${fr(dropAt, 3)} s)`;
      const start = delay > 0 ? `musique prise à son début et posée ${fr(delay, 3)} s après le début de la vidéo (silence avant)` : `départ à ${fr(offset, 3)} s de la musique étirée`;
      parts.push(`${start} : ${which}, à ${fr(Number(rises[used].t), 2)} s dans le fichier, ${where}`);
    }
  }
  return {
    ratio, offset, delay, loop, loopLen, bpmIn, bpmOut: round(bpmIn * ratio, 2),
    aligned: { grid, drop: used >= 0 },
    why: `${parts.join(" ; ")}.`,
  };
}

/**
 * La boucle calée d'un plan bouclé sur la grille : la longueur (s, dans la musique étirée de durée durS) d'un nombre
 * entier de temps de grille P depuis plan.offset, par mesures de 4 temps quand le morceau en a au moins 8 ; au moins
 * 4 temps, sinon 0 (pas de boucle calée possible : l'appelant boucle le fichier). Une marge de 20 ms couvre le
 * décalage d'atempo du départ (ATEMPO_SHIFT).
 */
export function loopLength(plan, { durS, P }) {
  if (!plan?.loop || !plan.aligned?.grid || !(P > 0) || !(durS > 0)) return 0;
  let k = Math.floor((durS - (Number(plan.offset) || 0) - 0.02) / P + 1e-6);
  if (k >= 8) k -= k % 4;
  return k >= 4 ? round(k * P, 4) : 0;
}

// ─── Filtre ffmpeg ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Nombre pour ffmpeg : au plus 4 décimales, jamais en notation exponentielle. */
const n4 = (x) => String(round(x, 4) || 0);

/**
 * Décalage moyen des attaques par atempo (s, dans la musique étirée). Son WSOLA recale chaque fragment de ±1024
 * échantillons (±21 ms à 48 kHz) sur le précédent : sur une musique pleine, une attaque sort en moyenne 10 ms plus
 * tard quand il accélère et 10 ms plus tôt quand il ralentit (mesuré de ×0,93 à ×1,07, à ±10 ms près). Le départ est
 * décalé d'autant. Une grosse caisse seule sur du silence sort, elle, ~21 ms en avance dans les deux sens.
 * Revu sur ×0,95 à ×1,05 : une musique avec nappe ou basse tenue atteint déjà ±10 à 15 ms dès ±0,2 % d'étirement ;
 * une batterie sans note tenue bouge moins sous ±0,5 % (0 à 5 ms), et la correction la décale alors de 5 à 10 ms. Sur
 * grosse caisse + bruit accélérée (×1,004 à ×1,037), le pire temps atteint 20 à 23 ms.
 */
const ATEMPO_SHIFT = 0.01;

/**
 * La chaîne -af de l'entrée musique pour un plan de planMusic et une vidéo de D secondes : passage à 48 kHz puis
 * atempo (enchaîné hors de 0,5-2 ; la fenêtre de WSOLA ne dépend plus du fichier), départ (atrim=start=offset, dans
 * la musique étirée, corrigé du décalage moyen d'atempo), fondu d'entrée court sur la musique elle-même, silence
 * ajouté au début par adelay (plan.delay, plus un départ corrigé négatif), fondu de sortie qui finit exactement à D,
 * silence ajouté puis coupe à exactement D, 48 kHz. Avec plan.loopLen (boucle calée), le morceau est coupé loopLen s
 * après le départ et ce bout est répété (aloop, à 48 kHz) : chaque reprise tombe sur un temps de la grille. Sans
 * loopLen, le bouclage (plan.loop) se fait à l'entrée (-stream_loop -1), par l'appelant. Les durées sont arrondies à
 * 4 décimales avant usage : un fondu arrondi à 0 est omis (afade d=0 ferait un fondu d'une seconde), une durée D
 * arrondie à 0 est refusée (atrim=duration=0 ne coupe plus rien).
 */
export function musicFilter(plan, { D, fadeIn = 0.02, fadeOut = 1.2 } = {}) {
  const d = round(Number(D), 4);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`musicFilter : durée de la vidéo invalide (${D}).`);
  const ratio = Number(plan?.ratio) > 0 && Number.isFinite(Number(plan.ratio)) ? Number(plan.ratio) : 1;
  const offset = Number(plan?.offset) > 0 && Number.isFinite(Number(plan.offset)) ? Number(plan.offset) : 0;
  const delay = Number(plan?.delay) > 0 && Number.isFinite(Number(plan.delay)) ? Number(plan.delay) : 0;
  const loopLen = plan?.loop && Number(plan?.loopLen) > 0 && Number.isFinite(Number(plan.loopLen)) ? round(Number(plan.loopLen), 4) : 0;
  const out = [];
  let start = offset;
  const stretch = Math.abs(ratio - 1) >= 5e-5;
  // La boucle calée compte ses échantillons à 48 kHz : le rééchantillonnage passe en tête même sans étirement.
  if (stretch || loopLen > 0) out.push("aresample=48000");
  if (stretch) {
    let r = ratio;
    while (r > 2) { out.push("atempo=2"); r /= 2; }
    while (r < 0.5) { out.push("atempo=0.5"); r /= 0.5; }
    out.push(`atempo=${n4(r)}`);
    start += ratio > 1 ? ATEMPO_SHIFT : -ATEMPO_SHIFT;
  }
  if (loopLen > 0) out.push(`atrim=start=${n4(Math.max(0, start))}:duration=${n4(loopLen)}`, "asetpts=PTS-STARTPTS", `aloop=loop=-1:size=${Math.round(loopLen * 48000)}`, "asetpts=N/SR/TB");
  else out.push(`atrim=start=${n4(Math.max(0, start))}`, "asetpts=PTS-STARTPTS");
  const fi = round(Math.min(Math.max(0, Number(fadeIn) || 0), d / 2), 4), fo = round(Math.min(Math.max(0, Number(fadeOut) || 0), d), 4);
  if (fi > 0) out.push(`afade=t=in:st=0:d=${n4(fi)}`);
  // Derrière atempo (qui ne rend rien avant une fenêtre pleine), adelay émet son silence avant d'avoir vu un
  // horodatage : ses trames de silence sortent sans pts valide et, au-delà de la première (2048 échantillons), atrim
  // les jette (mesuré avec ffmpeg 6.1 : 134 ms demandés, 43 ms posés, sortie trop courte de 91 ms). Les pts sont donc
  // refaits sur le compte des échantillons.
  const lead = round((delay + Math.max(0, -start)) * 1000, 1);
  if (lead > 0) out.push(`adelay=delays=${lead}:all=1`, "asetpts=N/SR/TB");
  if (fo > 0) out.push(`afade=t=out:st=${n4(d - fo)}:d=${n4(fo)}`);
  out.push("apad", `atrim=duration=${n4(d)}`, "aresample=48000");
  return out.join(",");
}
