// Bruitages du moteur Signature (sig-sfx.mjs) : synthèse, bus, WAV, ligne de commande. `node --test test/sig-sfx.test.mjs`
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SFX_KINDS, renderSfx, sfxSpan, synthSfx, wavBuffer } from "../lib/reel/sig-sfx.mjs";

const SR = 48000;
const CLI = fileURLToPath(new URL("../lib/reel/sig-sfx.mjs", import.meta.url));
const r3 = (x) => Math.round(x * 1000) / 1000;

/** Une suite fixe (mulberry32) pour fabriquer des bruitages. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Les bruitages d'une vidéo de D secondes, comme sig-stage.mjs les écrit : tous les types, réglages variés. */
function reel(count = 200, D = 60, seed = 12345) {
  const rnd = prng(seed);
  return Array.from({ length: count }, (_, i) => {
    const k = SFX_KINDS[i % SFX_KINDS.length];
    const ev = { t: r3(rnd() * (D - 0.5)), k, g: r3(0.25 + 0.75 * rnd()), p: r3(rnd() * 1.2 - 0.6), f: r3(0.8 + rnd() * 0.6) };
    if (k === "whoosh") Object.assign(ev, { d: r3(0.3 + rnd() * 0.35), peak: r3(0.3 + rnd() * 0.35) });
    if (k === "riser") Object.assign(ev, { d: r3(0.4 + rnd() * 1.6), tone: rnd() < 0.5 ? 1 : 0 });
    if (k === "shimmer") ev.d = r3(0.5 + rnd() * 0.2);
    if (k === "sparkle") ev.d = 1.3;
    if (k === "impact") ev.big = r3(rnd());
    return ev;
  }).sort((a, b) => a.t - b.t);
}

const bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
const peakOf = (r) => { let p = 0; for (let i = 0; i < r.length; i++) p = Math.max(p, Math.abs(r.left[i]), Math.abs(r.right[i])); return p; };
const energy = (x, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return e; };
const rms = (r, t0, t1) => { const a = Math.round(t0 * SR), b = Math.round(t1 * SR); return Math.sqrt((energy(r.left, a, b) + energy(r.right, a, b)) / (2 * (b - a))); };
/** L'échantillon de début et la fin (exclue) du son d'un bruitage seul. */
const window = (ev) => { const s0 = Math.round(ev.t * SR); return [s0, s0 + Math.max(16, Math.round(sfxSpan(ev) * SR))]; };

/** Part de l'énergie (mono, fenêtre rectangulaire : chaque son commence et finit à zéro) entre lo et hi Hz. */
function bandShare(r, s0, s1, bands) {
  let N = 1;
  while (N < s1 - s0) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = s0; i < s1; i++) re[i - s0] = (r.left[i] + r.right[i]) / 2;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len / 2;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const br = re[i + k + h] * cr - im[i + k + h] * ci, bi = re[i + k + h] * ci + im[i + k + h] * cr;
        re[i + k + h] = re[i + k] - br; im[i + k + h] = im[i + k] - bi;
        re[i + k] += br; im[i + k] += bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  let tot = 0;
  const p = new Float64Array(N / 2);
  for (let k = 1; k < N / 2; k++) { p[k] = re[k] * re[k] + im[k] * im[k]; tot += p[k]; }
  return bands.map(([lo, hi]) => { let e = 0; for (let k = 1; k < N / 2; k++) { const f = (k * SR) / N; if (f >= lo && f < hi) e += p[k]; } return e / tot; });
}

// ─── Contrat ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("SFX_KINDS : les 16 sons de la bibliothèque, figés", () => {
  assert.ok(Object.isFrozen(SFX_KINDS));
  assert.deepEqual([...SFX_KINDS].sort(), ["buzz", "clap", "ding", "heartbeat", "impact", "pop", "riser", "scribble", "shimmer", "sparkle", "swish", "tap", "thump", "tick", "tock", "whoosh"]);
});

test("déterminisme : deux rendus identiques bit pour bit (piste et WAV) ; une autre graine change les bruits", () => {
  const ev = reel(80, 20);
  const a = synthSfx(ev, 20, { seed: 7 }), b = synthSfx(ev, 20, { seed: 7 });
  assert.equal(Buffer.compare(bytes(a.left), bytes(b.left)), 0);
  assert.equal(Buffer.compare(bytes(a.right), bytes(b.right)), 0);
  assert.equal(Buffer.compare(wavBuffer(a), wavBuffer(b)), 0);
  assert.equal(a.used, 80);
  assert.notEqual(Buffer.compare(bytes(a.left), bytes(synthSfx(ev, 20, { seed: 8 }).left)), 0);
  // L'objet bruitage n'est pas modifié.
  assert.deepEqual(ev, reel(80, 20));
});

test("longueur : ceil((D + tail) × sampleRate) échantillons sur deux canaux Float32Array", () => {
  for (const [D, tail, sampleRate] of [[10, 1, 48000], [12.345, 0.5, 48000], [3, 0, 44100], [0, 1, 48000]]) {
    const r = synthSfx([{ t: 0.1, k: "pop" }], D, { tail, sampleRate });
    const want = Math.ceil((D + tail) * sampleRate);
    assert.equal(r.length, want);
    assert.ok(r.left instanceof Float32Array && r.right instanceof Float32Array);
    assert.equal(r.left.length, want);
    assert.equal(r.right.length, want);
    assert.equal(r.sampleRate, sampleRate);
  }
  const r = synthSfx([], 5);
  assert.deepEqual([r.length, r.sampleRate, r.used, r.ignored], [6 * SR, SR, 0, 0]);
  assert.equal(peakOf(r), 0);
});

test("aucune valeur non finie, même avec des réglages hors bornes ou illisibles", () => {
  const evil = [
    { t: 0.2, k: "pop", g: "abc", p: 99, f: -5 }, { t: 0.3, k: "whoosh", d: 1e9, peak: -3 }, { t: 0.4, k: "riser", d: 0.0001, tone: 7 },
    { t: 0.5, k: "impact", big: 99, f: 1e6 }, { t: 0.6, k: "sparkle", f: 4, d: 8 }, { t: 0.7, k: "shimmer", f: 4, d: 8 }, { t: 0.8, k: "ding", f: 4 },
    { t: 0.9, k: "thump", f: 0.01 }, { t: 1, k: "buzz", f: Infinity }, { t: 1.1, k: "tick", g: -1 }, { t: "1.2", k: "clap" },
  ];
  for (const sampleRate of [48000, 22050]) {
    const r = synthSfx(evil, 3, { sampleRate, seed: 3 });
    for (let i = 0; i < r.length; i++) assert.ok(Number.isFinite(r.left[i]) && Number.isFinite(r.right[i]), `échantillon ${i} non fini`);
    assert.ok(peakOf(r) <= 0.89);
    assert.equal(r.used + r.ignored, evil.length);
  }
});

test("crête ≤ 0,89 (−1 dBFS) : le limiteur tient un empilement de 64 sons et une vidéo entière", () => {
  const pile = Array.from({ length: 64 }, (_, i) => ({ t: 0.5 + (i % 4) * 0.004, k: SFX_KINDS[i % 16], big: 1, tone: 1, p: i % 2 ? 1 : -1 }));
  const r = synthSfx(pile, 3);
  assert.ok(peakOf(r) <= 0.89, `crête ${peakOf(r)}`);
  assert.ok(peakOf(r) > 0.8, "le limiteur ne doit pas écraser le bus plus que nécessaire");
  const v = synthSfx(reel(), 60);
  assert.ok(peakOf(v) <= 0.89);
});

test("un son seul n'est jamais touché par le limiteur (pas de pompage) : sa crête reste sous le plafond", () => {
  for (const k of SFX_KINDS) {
    for (const p of [-1, 0, 1]) {
      const r = synthSfx([{ t: 0.1, k, p, big: 1, tone: 1 }], 2.5);
      assert.ok(peakOf(r) < 0.88, `${k} p=${p} : crête ${peakOf(r)}`);
    }
  }
});

// ─── Chaque son ─────────────────────────────────────────────────────────────────────────────────────────────────────

const VARIANTS = [
  ...SFX_KINDS.map((k) => ({ k })),
  { k: "whoosh", d: 0.32, peak: 0.45, p: -0.2 }, { k: "riser", d: 0.42, tone: 1 }, { k: "impact", big: 0 }, { k: "impact", big: 1 },
  { k: "shimmer", d: 0.5 }, { k: "sparkle", d: 2 }, { k: "tock", f: 0.62 }, { k: "tick", f: 1.6, p: 0.3 },
];

test("chaque son sonne dans sa fenêtre [t, t + sfxSpan], nulle part ailleurs, et commence et finit sans marche", () => {
  for (const v of VARIANTS) {
    const ev = { t: 0.5, ...v };
    const r = synthSfx([ev], 3.5);
    const [s0, s1] = window(ev);
    let outside = 0, pk = 0;
    for (let i = 0; i < r.length; i++) {
      const m = Math.max(Math.abs(r.left[i]), Math.abs(r.right[i]));
      if (i < s0 || i >= s1) outside = Math.max(outside, m);
      else pk = Math.max(pk, m);
    }
    const label = JSON.stringify(v);
    assert.equal(outside, 0, `${label} : du son hors de sa fenêtre`);
    assert.ok(rms(r, ev.t, ev.t + sfxSpan(ev)) > 0.01 && pk > 0.15, `${label} : trop faible (crête ${pk})`);
    for (const i of [s0, s1 - 1]) assert.ok(Math.max(Math.abs(r.left[i]), Math.abs(r.right[i])) <= 0.01 * pk, `${label} : marche au bord (${i - s0})`);
    assert.equal(r.used, 1);
  }
});

test("durées : clics courts, carillon 0,7 s, queue de l'impact de 0,35 s (big 0) à 1,6 s (big 1)", () => {
  const span = (ev) => sfxSpan(ev);
  assert.ok(span({ t: 0, k: "tick" }) >= 0.012 && span({ t: 0, k: "tick" }) <= 0.02);
  assert.ok(Math.abs(span({ t: 0, k: "tock" }) - 0.045) <= 0.01);
  assert.ok(Math.abs(span({ t: 0, k: "pop" }) - 0.07) <= 0.01);
  assert.ok(Math.abs(span({ t: 0, k: "swish" }) - 0.18) <= 0.01);
  assert.equal(span({ t: 0, k: "whoosh" }), 0.5);
  assert.equal(span({ t: 0, k: "whoosh", d: 0.62 }), 0.62);
  assert.equal(span({ t: 0, k: "riser" }), 1);
  assert.equal(span({ t: 0, k: "impact", big: 0 }), 0.35);
  assert.equal(span({ t: 0, k: "impact", big: 1 }), 1.6);
  assert.ok(Math.abs(span({ t: 0, k: "thump" }) - 0.16) <= 0.01);
  assert.ok(Math.abs(span({ t: 0, k: "scribble" }) - 0.35) <= 0.02);
  assert.ok(span({ t: 0, k: "shimmer" }) >= 0.6 && span({ t: 0, k: "shimmer" }) <= 0.8);
  assert.ok(Math.abs(span({ t: 0, k: "buzz" }) - 0.25) <= 0.01);
  assert.ok(Math.abs(span({ t: 0, k: "tap" }) - 0.035) <= 0.01);
  assert.equal(span({ t: 0, k: "ding" }), 0.7);
  assert.ok(Math.abs(span({ t: 0, k: "clap" }) - 0.2) <= 0.015);
  assert.ok(span({ t: 0, k: "sparkle" }) >= 1.3 && span({ t: 0, k: "sparkle" }) <= 1.6);
  assert.equal(span({ t: 0, k: "laser" }), 0);
  assert.equal(span({ t: -1, k: "pop" }), 0);
  // Le dernier échantillon non nul de l'impact suit big.
  for (const [big, want] of [[0, 0.35], [1, 1.6]]) {
    const r = synthSfx([{ t: 0, k: "impact", big }], 2);
    let last = 0;
    for (let i = 0; i < r.length; i++) if (r.left[i] !== 0) last = i;
    assert.ok(Math.abs(last / SR - want) < 0.01, `impact big ${big} : ${last / SR} s`);
  }
});

test("formes : maximum du whoosh à peak × d, riser qui monte et s'arrête net, lub-dub, carillon qui s'éteint, salves du clap", () => {
  // whoosh : la trame de 20 ms la plus forte tombe près de peak × d.
  for (const [d, peak] of [[0.5, 0.5], [0.6, 0.3], [0.4, 0.7]]) {
    const r = synthSfx([{ t: 0, k: "whoosh", d, peak }], 1.5);
    let best = -1, at = 0;
    for (let t = 0; t + 0.02 <= d; t += 0.005) { const v = rms(r, t, t + 0.02); if (v > best) { best = v; at = t + 0.01; } }
    assert.ok(Math.abs(at - peak * d) <= 0.12 * d, `whoosh d=${d} peak=${peak} : maximum à ${at.toFixed(3)} s`);
  }
  // riser : les 50 dernières ms sont les plus fortes (> 30 dB au-dessus du début), puis plus rien après t + d.
  for (const tone of [0, 1]) {
    const r = synthSfx([{ t: 0.2, k: "riser", d: 1, tone }], 2);
    const end = rms(r, 1.15, 1.2), start = rms(r, 0.2, 0.25);
    for (let t = 0.2; t < 1.15; t += 0.05) assert.ok(rms(r, t, t + 0.05) <= end * 1.05, `riser tone ${tone} : ${t.toFixed(2)} plus fort que la fin`);
    assert.ok(20 * Math.log10(end / start) > 30, `riser tone ${tone} : montée de ${(20 * Math.log10(end / start)).toFixed(1)} dB`);
    assert.equal(rms(r, 1.2, 1.4), 0);
  }
  // heartbeat : deux coups, à 0 et 0,17 s, le second plus doux, un creux entre les deux.
  const h = synthSfx([{ t: 0, k: "heartbeat" }], 1);
  const lub = rms(h, 0, 0.1), dub = rms(h, 0.17, 0.27), gap = rms(h, 0.155, 0.17);
  assert.ok(dub < lub && dub > 0.4 * lub, `lub ${lub} dub ${dub}`);
  assert.ok(gap < 0.25 * lub, `creux ${gap}`);
  // ding : attaque douce (crête après 2 ms), extinction exponentielle.
  const g = synthSfx([{ t: 0, k: "ding" }], 1);
  let ip = 0;
  for (let i = 0; i < 0.05 * SR; i++) if (Math.abs(g.left[i]) > Math.abs(g.left[ip])) ip = i;
  assert.ok(ip > 0.002 * SR, `crête du ding à ${(ip / SR * 1000).toFixed(1)} ms`);
  assert.ok(rms(g, 0.5, 0.6) < 0.2 * rms(g, 0, 0.1));
  // clap : au moins trois salves dans les 40 premières ms (maxima de l'enveloppe en trames de 2 ms).
  const c = synthSfx([{ t: 0, k: "clap" }], 1);
  const env = Array.from({ length: 20 }, (_, i) => rms(c, i * 0.002, i * 0.002 + 0.002));
  const bursts = env.filter((v, i) => i > 0 && i < env.length - 1 && v > env[i - 1] && v >= env[i + 1] && v > 0.2 * Math.max(...env)).length;
  assert.ok(bursts >= 3, `${bursts} salve(s)`);
});

test("chaque son a son énergie dans sa bande de fréquences", () => {
  // Pour les sons graves, la part au-dessus de 300 Hz est ce qu'en rend le haut-parleur d'un téléphone.
  const BANDS = {
    tick: [[[2000, 24000], 0.75]],
    tock: [[[400, 1500], 0.75]],
    pop: [[[300, 1500], 0.85]],
    swish: [[[1400, 12000], 0.9]],
    whoosh: [[[100, 8000], 0.9], [[100, 400], 0.12], [[1000, 6000], 0.3]],
    riser: [[[1000, 12000], 0.85]],
    impact: [[[30, 250], 0.7], [[500, 10000], 0.03], [[300, 24000], 0.05]],
    thump: [[[30, 160], 0.85], [[300, 24000], 0.025]],
    heartbeat: [[[30, 160], 0.8], [[300, 24000], 0.04]],
    scribble: [[[2300, 6000], 0.75]],
    shimmer: [[[2800, 16000], 0.95]],
    buzz: [[[100, 2000], 0.9], [[140, 220], 0.3]],
    tap: [[[150, 350], 0.3], [[2000, 5000], 0.1]],
    ding: [[[1200, 2800], 0.9]],
    clap: [[[700, 4000], 0.8]],
    sparkle: [[[1500, 12000], 0.95]],
  };
  for (const k of SFX_KINDS) {
    const ev = { t: 0.1, k };
    const r = synthSfx([ev], 2.5);
    const [s0, s1] = window(ev);
    const shares = bandShare(r, s0, s1, BANDS[k].map(([b]) => b));
    BANDS[k].forEach(([[lo, hi], min], i) => assert.ok(shares[i] >= min, `${k} : ${(shares[i] * 100).toFixed(0)} % entre ${lo} et ${hi} Hz (${min * 100} % attendus)`));
  }
});

test("continu : aucun son ne garde de composante continue", () => {
  for (const k of SFX_KINDS) {
    const ev = { t: 0.1, k, big: 1, tone: 1 };
    const r = synthSfx([ev], 2.5);
    const [s0, s1] = window(ev);
    let sum = 0;
    for (let i = s0; i < s1; i++) sum += r.left[i] + r.right[i];
    const mean = sum / (2 * (s1 - s0)), level = rms(r, s0 / SR, s1 / SR);
    assert.ok(Math.abs(mean) < 0.03 * level, `${k} : continu ${mean} pour ${level}`);
  }
});

// ─── Bus ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("panoramique à puissance constante : p = −1 à gauche, p = 1 à droite, p = 0 au centre sans perte", () => {
  for (const k of SFX_KINDS) {
    const L = synthSfx([{ t: 0.2, k, p: -1 }], 2.5), R = synthSfx([{ t: 0.2, k, p: 1 }], 2.5);
    const stereo = ["whoosh", "shimmer", "sparkle"].includes(k);
    const need = stereo ? 4 : 1e6;
    assert.ok(energy(L.left) > need * energy(L.right), `${k} p=−1 : gauche ${energy(L.left)}, droite ${energy(L.right)}`);
    assert.ok(energy(R.right) > need * energy(R.left), `${k} p=1`);
  }
  // Un son mono au centre : gauche = droite, et la puissance totale est celle du son tout à gauche.
  const C = synthSfx([{ t: 0.2, k: "pop", p: 0 }], 1), Lf = synthSfx([{ t: 0.2, k: "pop", p: -1 }], 1);
  for (let i = 0; i < C.length; i++) assert.ok(Math.abs(C.left[i] - C.right[i]) <= 1e-7);
  const tot = energy(C.left) + energy(C.right), ref = energy(Lf.left);
  assert.ok(Math.abs(tot / ref - 1) < 1e-4, `centre ${tot} contre ${ref}`);
  // Tout d'un côté, l'autre canal est un silence numérique, dans le WAV aussi (pas de dither sur un résidu de 1e−17).
  for (const k of SFX_KINDS.filter((x) => !["whoosh", "shimmer", "sparkle"].includes(x))) {
    for (const p of [-1, 1]) {
      const r = synthSfx([{ t: 0.2, k, p }], 2.5), far = p < 0 ? r.right : r.left;
      assert.ok(far.every((x) => x === 0), `${k} p=${p} : du son sur l'autre canal`);
      const w = wavBuffer(r), o = p < 0 ? 46 : 44;
      for (let i = 0; i < r.length; i++) assert.equal(w.readInt16LE(o + i * 4), 0, `${k} p=${p} : WAV, échantillon ${i}`);
    }
  }
});

test("gain : g = 0,5 donne exactement la moitié, g = 0 le silence (compté comme rendu)", () => {
  for (const k of SFX_KINDS) {
    const a = synthSfx([{ t: 0.2, k, g: 1, big: 1 }], 2.5), b = synthSfx([{ t: 0.2, k, g: 0.5, big: 1 }], 2.5);
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a.left[i] - 2 * b.left[i]) <= 1e-6 && Math.abs(a.right[i] - 2 * b.right[i]) <= 1e-6, `${k} : échantillon ${i}`);
    }
  }
  const z = synthSfx([{ t: 0.2, k: "impact", g: 0 }], 1);
  assert.equal(peakOf(z), 0);
  assert.deepEqual([z.used, z.ignored], [1, 0]);
  // Un gain infime (sous −120 dB) est un silence : aucun nombre dénormalisé n'entre dans le bus.
  const tiny = synthSfx([{ t: 0.2, k: "ding", g: 1e-40 }, { t: 0.2, k: "pop", g: 1e-30, p: 1 }], 1);
  assert.equal(peakOf(tiny), 0);
  assert.deepEqual([tiny.used, tiny.ignored], [2, 0]);
  const low = synthSfx([{ t: 0.2, k: "riser", g: 1e-6, p: 0.999 }, { t: 0.2, k: "pop", g: 2e-6, p: -1 }], 2);
  assert.ok(peakOf(low) > 0);
  for (const ch of [low.left, low.right]) assert.ok(ch.every((x) => x === 0 || Math.abs(x) >= 1.1754943508222875e-38), "nombre dénormalisé dans le bus");
  // g absent = 1, g au-delà de 1 ramené à 1.
  const one = synthSfx([{ t: 0.2, k: "ding" }], 1), more = synthSfx([{ t: 0.2, k: "ding", g: 3 }], 1);
  assert.equal(Buffer.compare(bytes(one.left), bytes(more.left)), 0);
});

test("types inconnus, instants illisibles ou négatifs : ignorés et comptés", () => {
  const r = synthSfx([
    { t: 0.5, k: "laser" }, { t: NaN, k: "pop" }, { t: -0.1, k: "pop" }, { t: 0.5, k: "pop" }, null, { k: "pop" }, { t: Infinity, k: "tick" },
    { t: 0.5, k: "toString" }, { t: 0.5, k: "__proto__" }, { t: 0.5, k: 3 }, "pop",
  ], 2);
  assert.deepEqual([r.used, r.ignored], [1, 10]);
  assert.ok(peakOf(r) > 0.1);
  assert.deepEqual([synthSfx(null, 1).used, synthSfx(undefined, 1).ignored, synthSfx({}, 1).length], [0, 0, 2 * SR]);
});

test("bruitages après la fin de la piste : sans erreur ; celui qui la chevauche est coupé en fondu", () => {
  const r = synthSfx([{ t: 3.5, k: "impact", big: 1 }, { t: 1e6, k: "pop" }, { t: 2.95, k: "sparkle" }, { t: 2, k: "riser", d: 5, tone: 1 }, { t: 3, k: "tick" }], 2);
  assert.equal(r.length, 3 * SR);
  assert.deepEqual([r.used, r.ignored], [2, 3]);
  assert.ok(rms(r, 2.9, 2.98) > 0.01, "les sons qui chevauchent la fin sont rendus");
  assert.equal(r.left[r.length - 1], 0);
  assert.equal(r.right[r.length - 1], 0);
  for (let i = 0; i < r.length; i++) assert.ok(Number.isFinite(r.left[i]) && Number.isFinite(r.right[i]));
});

// ─── Fichier ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("WAV : RIFF WAVE PCM 16 bits stéréo 48 kHz, taille des données, échantillons fidèles et silence numérique", () => {
  const r = synthSfx(reel(30, 4), 4);
  const buf = wavBuffer(r);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(buf.readUInt32LE(4), buf.length - 8);
  assert.equal(buf.toString("ascii", 8, 12), "WAVE");
  assert.equal(buf.toString("ascii", 12, 16), "fmt ");
  assert.equal(buf.readUInt32LE(16), 16);
  assert.equal(buf.readUInt16LE(20), 1); // PCM
  assert.equal(buf.readUInt16LE(22), 2); // canaux
  assert.equal(buf.readUInt32LE(24), 48000);
  assert.equal(buf.readUInt32LE(28), 48000 * 4);
  assert.equal(buf.readUInt16LE(32), 4);
  assert.equal(buf.readUInt16LE(34), 16);
  assert.equal(buf.toString("ascii", 36, 40), "data");
  assert.equal(buf.readUInt32LE(40), r.length * 4);
  assert.equal(buf.length, 44 + r.length * 4);
  let zeros = 0;
  for (let i = 0; i < r.length; i++) {
    const l = buf.readInt16LE(44 + i * 4), rr = buf.readInt16LE(46 + i * 4);
    assert.ok(Math.abs(l - r.left[i] * 32767) <= 1.5 && Math.abs(rr - r.right[i] * 32767) <= 1.5, `échantillon ${i}`);
    if (r.left[i] === 0) { assert.equal(l, 0); zeros++; }
  }
  assert.ok(zeros > 0, "le silence entre les sons reste un silence numérique");
  const odd = wavBuffer({ left: new Float32Array([0, 0.5, -1.2, 2]), right: new Float32Array([0, -0.5, 1.2, NaN]), sampleRate: 44100 });
  assert.equal(odd.readUInt32LE(24), 44100);
  assert.deepEqual([odd.readInt16LE(44), odd.readInt16LE(52), odd.readInt16LE(54), odd.readInt16LE(56), odd.readInt16LE(58)], [0, -32768, 32767, 32767, 0]);
});

test("renderSfx : écrit le WAV (dossier créé au besoin) et rend { file, seconds, peak, used, ignored }", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sig-sfx-"));
  try {
    const file = join(dir, "sous", "sfx.wav");
    const ev = [...reel(40, 8), { t: 1, k: "inconnu" }];
    const r = await renderSfx(ev, 8, file, { seed: 3 });
    assert.equal(r.file, file);
    assert.equal(r.seconds, 9);
    assert.ok(r.peak > 0.05 && r.peak <= 0.89, `crête ${r.peak}`);
    assert.deepEqual([r.used, r.ignored], [40, 1]);
    const buf = readFileSync(file);
    assert.equal(buf.length, 44 + 9 * SR * 4);
    assert.equal(Buffer.compare(buf, wavBuffer(synthSfx(ev, 8, { seed: 3 }))), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("60 s et 200 bruitages : rendus (synthèse, WAV, écriture) en moins de 3 s", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sig-sfx-"));
  try {
    const ev = reel(200, 60);
    const t0 = performance.now();
    const r = await renderSfx(ev, 60, join(dir, "sfx.wav"));
    const ms = performance.now() - t0;
    assert.equal(r.used, 200);
    assert.ok(ms < 3000, `${ms.toFixed(0)} ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ligne de commande : --demo (chaque son, un toutes les 0,8 s) et un sfx.json de sig-stage", () => {
  const dir = mkdtempSync(join(tmpdir(), "sig-sfx-"));
  try {
    const demo = join(dir, "demo.wav");
    const out = execFileSync(process.execPath, [CLI, "--demo", demo], { encoding: "utf8" });
    assert.match(out, /16 rendu\(s\), 0 ignoré/);
    const w = readFileSync(demo);
    assert.equal(w.toString("ascii", 0, 4), "RIFF");
    const frames = w.readUInt32LE(40) / 4;
    assert.equal(frames, Math.ceil((0.4 + 16 * 0.8 + 1) * SR));
    // Chaque son à sa place : du son 0,4 s + i × 0,8 s après le début.
    for (let i = 0; i < 16; i++) {
      const s = Math.round((0.4 + i * 0.8) * SR) + 200;
      let e = 0;
      for (let j = s; j < s + 0.01 * SR; j++) e += Math.abs(w.readInt16LE(44 + j * 4)) + Math.abs(w.readInt16LE(46 + j * 4));
      assert.ok(e > 0, `${SFX_KINDS[i]} absent de la démo`);
    }
    const json = join(dir, "sfx.json"), wav = join(dir, "out.wav");
    writeFileSync(json, `${JSON.stringify({ D: 4.5, fpb: 15, drop: 2, events: [{ t: 0.5, k: "whoosh", g: 0.5, d: 0.55, peak: 0.4 }, { t: 2, k: "impact", g: 1, big: 1 }, { t: 1, k: "nope" }] })}\n`);
    const out2 = execFileSync(process.execPath, [CLI, json, wav], { encoding: "utf8" });
    assert.match(out2, /2 rendu\(s\), 1 ignoré\(s\)/);
    assert.equal(readFileSync(wav).readUInt32LE(40), Math.ceil(5.5 * SR) * 4);
    assert.throws(() => execFileSync(process.execPath, [CLI], { stdio: "pipe" }), /usage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
