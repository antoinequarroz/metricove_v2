// Tempo de la musique (engine 2, sig-tempo.mjs) : analyse de pistes synthétiques (grosse caisse, clic, charleston,
// bruit, saut d'énergie), calage sur la grille (planMusic), chaîne ffmpeg (musicFilter) et bout en bout : rendu de la
// musique calée puis nouvelle analyse. `node --test test/sig-tempo.test.mjs` (ffmpeg et ffprobe requis).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeMusic, musicFilter, planMusic } from "../lib/reel/sig-tempo.mjs";

const DIR = mkdtempSync(join(tmpdir(), "sig-tempo-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const SR = 44100;

/** Hasard reproductible (les pistes sont identiques d'un passage à l'autre). */
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Écrit un WAV PCM 16 bits mono dans le dossier du test ; renvoie son chemin. */
function wav(name, y, sr = SR) {
  const n = y.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, y[i])) * 32767), 44 + i * 2);
  const file = join(DIR, name);
  writeFileSync(file, buf);
  return file;
}

/**
 * Piste synthétique : une grosse caisse (balayage 150 → 50 Hz) ou un clic sur chaque temps à partir de `first`, un
 * charleston à contretemps (`hats`, bruit filtré), une nappe de bruit (`noise`) ; à partir du temps `jump`, la grosse
 * caisse est plus forte et une basse en dents de scie s'ajoute (l'énergie saute d'environ 5 dB).
 */
function track({ bpm, first = 0.137, seconds = 30, click = false, hats = 0, noise = 0, jump = -1, seed = 7 }) {
  const n = Math.round(seconds * SR), y = new Float32Array(n), rnd = mulberry32(seed), p = 60 / bpm;
  for (let k = 0; first + k * p < seconds; k++) {
    const i0 = Math.round((first + k * p) * SR), loud = jump >= 0 && k >= jump;
    if (click) {
      for (let i = 0; i < 0.03 * SR && i0 + i < n; i++) {
        const t = i / SR;
        y[i0 + i] += (loud ? 1.6 : 1) * (0.35 * Math.exp(-t / 0.003) * (rnd() * 2 - 1) + 0.35 * Math.exp(-t / 0.008) * Math.sin(2 * Math.PI * 1800 * t));
      }
    } else {
      for (let i = 0; i < 0.35 * SR && i0 + i < n; i++) {
        const t = i / SR;
        y[i0 + i] += (loud ? 0.84 : 0.6) * Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * (50 * t + 3 * (1 - Math.exp(-t / 0.03))));
      }
    }
    if (hats) {
      const j0 = Math.round((first + (k + 0.5) * p) * SR);
      let prev = 0;
      for (let i = 0; i < 0.06 * SR && j0 + i < n; i++) {
        const w = rnd() * 2 - 1;
        y[j0 + i] += hats * Math.exp(-i / SR / 0.015) * (w - prev);
        prev = w;
      }
    }
    if (loud) {
      for (let i = 0; i < p * SR && i0 + i < n; i++) {
        const t = i / SR;
        y[i0 + i] += 0.25 * (2 * ((55 * t) % 1) - 1) * Math.min(1, t / 0.005) * Math.exp(-t / (p * 0.9));
      }
    }
  }
  if (noise) for (let i = 0; i < n; i++) y[i] += noise * (rnd() * 2 - 1);
  return y;
}

/**
 * Morceau construit comme une musique de reel : intro (grosse caisse, charleston), pont (nappe seule), montée
 * (bruit qui enfle, roulement de caisse claire qui se resserre), drop (grosse caisse, caisse claire, basse), fin. Une
 * nappe d'accord court tout du long. Renvoie { y, p, drop } (drop : instant du premier temps du drop, s).
 */
function song({ bpm, first = 0.3, bars = { intro: 8, brk: 4, build: 4, drop: 8, outro: 4 }, seed = 3 }) {
  const p = 60 / bpm, rnd = mulberry32(seed);
  const nb = 4 * (bars.intro + bars.brk + bars.build + bars.drop + bars.outro);
  const n = Math.round((first + nb * p + 1) * SR), y = new Float32Array(n);
  const add = (i, v) => { if (i >= 0 && i < n) y[i] += v; };
  const kick = (t0, a) => { const i0 = Math.round(t0 * SR); for (let i = 0; i < 0.3 * SR; i++) { const t = i / SR; add(i0 + i, a * Math.exp(-t / 0.1) * Math.sin(2 * Math.PI * (48 * t + 3.5 * (1 - Math.exp(-t / 0.025))))); } };
  const snare = (t0, a) => { const i0 = Math.round(t0 * SR); for (let i = 0; i < 0.15 * SR; i++) { const t = i / SR; add(i0 + i, a * (0.7 * Math.exp(-t / 0.04) * (rnd() * 2 - 1) + 0.3 * Math.exp(-t / 0.02) * Math.sin(2 * Math.PI * 200 * t))); } };
  const hat = (t0, a) => { const i0 = Math.round(t0 * SR); let pr = 0; for (let i = 0; i < 0.05 * SR; i++) { const w = rnd() * 2 - 1; add(i0 + i, a * Math.exp(-i / SR / 0.012) * (w - pr)); pr = w; } };
  const b0 = 4 * (bars.intro + bars.brk), d0 = b0 + 4 * bars.build, d1 = d0 + 4 * bars.drop;
  for (let k = 0; k < nb; k++) {
    const t0 = first + k * p;
    if (k < 4 * bars.intro) { kick(t0, 0.45); hat(t0 + p / 2, 0.07); }
    else if (k >= b0 && k < d0) {
      const prog = (k - b0) / (d0 - b0), div = prog < 0.5 ? 1 : prog < 0.75 ? 2 : 4;
      for (let j = 0; j < div; j++) snare(t0 + (j * p) / div, 0.12 + 0.3 * prog);
    } else if (k >= d0 && k < d1) {
      kick(t0, 0.7); hat(t0 + p / 2, 0.12); if (k % 2) snare(t0, 0.35);
      const i0 = Math.round(t0 * SR), f = [43.65, 43.65, 51.9, 38.9][Math.floor(k / 4) % 4];
      for (let i = 0; i < p * SR; i++) { const t = i / SR; add(i0 + i, 0.18 * (2 * ((f * t) % 1) - 1) * Math.min(1, t / 0.004) * Math.exp(-t / (p * 0.8))); }
    } else if (k >= d1) kick(t0, 0.4);
  }
  const tb = first + b0 * p, te = first + d0 * p;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    y[i] += 0.05 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 261.6 * t + 1) + Math.sin(2 * Math.PI * 329.6 * t + 2));
    if (t >= tb && t < te) y[i] += 0.25 * ((t - tb) / (te - tb)) ** 2 * (rnd() * 2 - 1);
  }
  return { y, p, drop: first + d0 * p };
}

/** Écart entre a et b modulo m (dans [0, m/2]). */
const modDist = (a, b, m) => {
  const d = (((a - b) % m) + m) % m;
  return Math.min(d, m - d);
};
const probe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=sample_rate", "-of", "json", file]).toString());
const render = (src, af, out, pre = []) => execFileSync("ffmpeg", ["-v", "error", "-y", ...pre, "-i", src, "-af", af, "-c:a", "pcm_s16le", out]);

// ─── analyzeMusic ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Vérifie tempo, octave, phase (premier temps à `first`, à 15 ms près modulo la période) et la liste des temps. */
function checkTrack(a, { bpm, first = 0.137, seconds = 30 }) {
  const p = 60 / bpm;
  assert.ok(Math.abs(a.bpm / bpm - 1) < 0.01, `bpm ${a.bpm} au lieu de ${bpm}`);
  assert.ok(Math.abs(a.period / p - 1) < 0.01, `période ${a.period} au lieu de ${p}`);
  assert.ok(a.phase >= 0 && a.phase < a.period, `phase ${a.phase} hors de [0, ${a.period})`);
  assert.ok(modDist(a.phase, first, a.period) < 0.015, `phase ${a.phase} au lieu de ${first} (modulo ${a.period})`);
  assert.ok(a.confidence >= 0.8, `confiance ${a.confidence}`);
  assert.ok(Math.abs(a.duration - seconds) < 0.01, `durée ${a.duration}`);
  const expected = Math.floor((seconds - first) / p) + 1;
  assert.ok(a.beats.length >= expected - 3 && a.beats.length <= expected + 1, `${a.beats.length} temps pour ~${expected}`);
  for (const t of a.beats) assert.ok(modDist(t, first, p) < 0.015, `temps ${t} hors de la grille`);
  assert.equal(a.energy.length, a.beats.length);
  assert.ok(a.energy.every((e) => e > 0 && Number.isFinite(e)));
}

for (const bpm of [100, 120, 128.57]) {
  test(`analyzeMusic : grosse caisse à ${bpm} BPM, seule puis avec nappe de bruit et charleston à contretemps`, async () => {
    checkTrack(await analyzeMusic(wav(`kick-${bpm}.wav`, track({ bpm }))), { bpm });
    // Le charleston à contretemps double les attaques : le tempo doit rester celui de la grosse caisse (pas 2×), et la
    // phase sur la grosse caisse (pas sur le contretemps).
    checkTrack(await analyzeMusic(wav(`kick-${bpm}-nh.wav`, track({ bpm, noise: 0.02, hats: 0.15 }))), { bpm });
  });
}

test("analyzeMusic : clics à 128,57 BPM (fpb 14) avec bruit et charleston, premier temps à 0,31 s", async () => {
  const opts = { bpm: 128.57, first: 0.31, click: true, noise: 0.02, hats: 0.15 };
  checkTrack(await analyzeMusic(wav("click.wav", track(opts))), opts);
});

test("analyzeMusic : le saut d'énergie de la mesure 9 est la plus forte montée", async () => {
  const bpm = 117, p = 60 / bpm, jump = 0.137 + 32 * p;
  const a = await analyzeMusic(wav("jump.wav", track({ bpm, seconds: 40, noise: 0.01, hats: 0.1, jump: 32 })));
  checkTrack(a, { bpm, seconds: 40 });
  assert.ok(a.rises.length >= 1);
  assert.ok(Math.abs(a.rises[0].t - jump) <= p, `montée à ${a.rises[0].t} au lieu de ${jump.toFixed(3)}`);
  for (let i = 1; i < a.rises.length; i++) assert.ok(a.rises[i - 1].score >= a.rises[i].score);
  // Une piste sans saut n'a pas de montée nette.
  const flat = await analyzeMusic(wav("flat.wav", track({ bpm, noise: 0.01, hats: 0.1 })));
  assert.deepEqual(flat.rises, []);
});

test("analyzeMusic : après une montée progressive, la plus forte montée est le premier temps du drop (pas le temps d'avant)", async () => {
  // Bruit qui enfle et roulement jusqu'au drop : le score des fenêtres (4 temps contre 8) est presque plat sur les
  // derniers temps de la montée ; sans recalage sur le saut d'énergie, 3 de ces 5 morceaux sortaient un temps trop tôt.
  for (const [bpm, first] of [[118, 0.6], [123, 1.3], [97, 0.05], [131, 0.9], [124, 0.3]]) {
    const s = song({ bpm, first });
    const a = await analyzeMusic(wav(`montee-${bpm}.wav`, s.y));
    assert.ok(Math.abs(a.bpm / bpm - 1) < 0.01, `bpm ${a.bpm} au lieu de ${bpm}`);
    assert.ok(a.rises.length >= 1, `${bpm} BPM : aucune montée`);
    assert.ok(Math.abs(a.rises[0].t - s.drop) < 0.03, `${bpm} BPM : montée à ${a.rises[0].t} au lieu de ${s.drop.toFixed(3)} (${((a.rises[0].t - s.drop) / s.p).toFixed(2)} temps)`);
  }
});

test("analyzeMusic : un accord plaqué à t = 0, à mi-chemin de deux temps, ne dérègle ni la phase ni la confiance", async () => {
  for (const bpm of [110, 140]) {
    const p = 60 / bpm, first = p / 2;
    const y = track({ bpm, first, seconds: 30, noise: 0.005, hats: 0.08 });
    for (let i = 0; i < SR * 30; i++) { const t = i / SR; y[i] += 0.08 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t)); }
    for (let i = 0; i < 0.4 * SR; i++) { const t = i / SR; y[i] += 0.5 * Math.exp(-t / 0.15) * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 660 * t)); }
    const a = await analyzeMusic(wav(`accord-${bpm}.wav`, y));
    assert.ok(Math.abs(a.bpm / bpm - 1) < 0.01, `bpm ${a.bpm}`);
    assert.ok(modDist(a.phase, first, p) < 0.015, `phase ${a.phase} au lieu de ${first.toFixed(4)}`);
    // Le premier temps (l'accord, hors grille) servait de référence à la numérotation : la droite était rejetée.
    assert.ok(a.confidence >= 0.8, `${bpm} BPM : confiance ${a.confidence}`);
  }
});

test("analyzeMusic : silence et fichier très court → confiance 0, et un plan sans étirement ni calage", async () => {
  for (const [name, y] of [["silence.wav", new Float32Array(SR * 8)], ["court.wav", track({ bpm: 120, seconds: 1 })]]) {
    const a = await analyzeMusic(wav(name, y));
    assert.equal(a.confidence, 0, name);
    assert.equal(a.bpm, 0);
    assert.deepEqual([a.beats, a.energy, a.rises], [[], [], []]);
    const plan = planMusic(a, { fpb: 15, D: 6, drop: 3 });
    assert.equal(plan.ratio, 1);
    assert.equal(plan.offset, 0);
    assert.deepEqual(plan.aligned, { grid: false, drop: false });
    assert.match(plan.why, /Tempo introuvable/);
  }
});

test("analyzeMusic : un son sans battue (bruit, note tenue) ne lève pas d'erreur et n'est pas étiré", async () => {
  const rnd = mulberry32(3);
  const noise = Float32Array.from({ length: SR * 12 }, () => 0.3 * (rnd() * 2 - 1));
  const tone = Float32Array.from({ length: SR * 10 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR));
  for (const [name, y] of [["bruit.wav", noise], ["note.wav", tone]]) {
    const a = await analyzeMusic(wav(name, y));
    assert.ok(a.confidence < 0.2, `${name} : confiance ${a.confidence}`);
    const plan = planMusic(a, { fpb: 15, D: 8, drop: 4 });
    assert.equal(plan.ratio, 1);
    assert.equal(plan.aligned.grid, false);
  }
});

test("analyzeMusic : erreurs claires, en français, avec le nom du fichier", async () => {
  await assert.rejects(analyzeMusic(join(DIR, "absent.wav")), /Musique introuvable : « .*absent\.wav »/);
  const fake = join(DIR, "faux.mp3");
  writeFileSync(fake, "ceci n'est pas de la musique\n".repeat(50));
  await assert.rejects(analyzeMusic(fake), /La musique « faux\.mp3 » n'a pas pu être décodée par ffmpeg/);
  const ok = wav("ok.wav", track({ bpm: 120, seconds: 5 }));
  await assert.rejects(analyzeMusic(ok, { ffmpeg: join(DIR, "pas-de-ffmpeg") }), /ffmpeg introuvable .*« ok\.wav »/);
  // Une vidéo sans son : ffmpeg 6 finit sur « Error opening output files » ; la cause est plus haut dans stderr.
  const mute = join(DIR, "muette.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=32x32:d=1", "-c:v", "mpeg4", mute]);
  await assert.rejects(analyzeMusic(mute), /La musique « muette\.mp4 » n'a pas pu être décodée par ffmpeg \(aucune piste son\)/);
});

test("analyzeMusic : maxSeconds borne l'analyse, duration reste celle du fichier entier", async () => {
  const a = await analyzeMusic(wav("long.wav", track({ bpm: 120 })), { maxSeconds: 10 });
  assert.ok(Math.abs(a.duration - 30) < 0.01, `durée ${a.duration}`);
  assert.ok(a.beats.length > 10 && a.beats.at(-1) < 10, `dernier temps ${a.beats.at(-1)}`);
  assert.ok(Math.abs(a.bpm - 120) < 1.2);
});

// ─── planMusic ──────────────────────────────────────────────────────────────────────────────────────────────────────

const P15 = 0.5;
const p117 = 60 / 117;
const rise117 = 0.137 + 32 * p117;
const A117 = { duration: 40, bpm: 117, period: p117, phase: 0.137, confidence: 0.9, beats: [], energy: [], rises: [{ t: rise117, score: 9 }, { t: 30.1, score: 4 }] };

test("planMusic : 117 BPM sur fpb 15 → atempo ×1,0256, la plus forte montée exactement sur le moment fort", () => {
  const plan = planMusic(A117, { fpb: 15, D: 20, drop: 8 });
  assert.equal(plan.ratio, 1.0256);
  assert.equal(plan.bpmIn, 117);
  assert.equal(plan.bpmOut, 120);
  assert.deepEqual(plan.aligned, { grid: true, drop: true });
  assert.equal(plan.loop, false);
  assert.ok(Math.abs(rise117 / plan.ratio - plan.offset - 8) < 0.001, `la montée tombe à ${rise117 / plan.ratio - plan.offset}`);
  // Congru à la phase étirée modulo P (à l'arrondi du ratio près : 32 temps × 0,02 ms entre le premier temps et la montée).
  assert.ok(modDist(plan.offset, 0.137 / plan.ratio, P15) < 0.002, "offset congru à la phase étirée modulo P");
  assert.ok(plan.offset >= 0 && plan.offset + 20 <= 40 / plan.ratio);
  // Chaque temps de la musique étirée tombe sur la grille t = n × P de la vidéo.
  for (let k = 0; k < 78; k++) {
    const v = (0.137 + k * p117) / plan.ratio - plan.offset;
    if (v >= 0 && v <= 20) assert.ok(modDist(v, 0, P15) < 0.002, `temps ${k} à ${v} s`);
  }
  assert.match(plan.why, /117 BPM étirée ×1,0256 \(120 BPM\)/);
  assert.match(plan.why, /plus forte montée/);
});

test("planMusic : la montée qui ne tient pas cède la place à la suivante, puis au premier temps", () => {
  const early = { ...A117, rises: [{ t: 3, score: 12 }, { t: rise117, score: 9 }] };
  const plan = planMusic(early, { fpb: 15, D: 20, drop: 8 });
  assert.equal(plan.aligned.drop, true);
  assert.ok(Math.abs(rise117 / plan.ratio - plan.offset - 8) < 0.001);
  assert.match(plan.why, /2e montée/);
  // Aucune montée ne tient (trop tôt, ou la vidéo sortirait du morceau) : premier départ calé, drop non calé.
  const none = planMusic({ ...A117, rises: [{ t: 3, score: 12 }, { t: 38, score: 5 }] }, { fpb: 15, D: 20, drop: 8 });
  assert.deepEqual(none.aligned, { grid: true, drop: false });
  assert.ok(Math.abs(none.offset - 0.137 / none.ratio) < 0.0005);
  assert.match(none.why, /aucune montée/);
});

test("planMusic : montée un peu avant le moment fort une fois étirée → silence de tête, montée exactement sur le moment fort", () => {
  // Demandée à 120 BPM avec son coup à 8 s, livrée à 119 BPM avec son coup à 8 s : accélérée ×1,0084, le coup passe à
  // 7,933 s. Partir 67 ms avant le début du morceau est impossible : la musique commence 67 ms après la vidéo. Avant,
  // le repli (premier temps) posait le coup un temps entier trop tôt, à 7,5 s.
  const p = 60 / 119, a = { duration: 40, bpm: 119, period: p, phase: 8 - 16 * p + p, confidence: 0.9, rises: [{ t: 8, score: 9 }] };
  const plan = planMusic(a, { fpb: 15, D: 20, drop: 8 });
  assert.equal(plan.ratio, 1.0084);
  assert.equal(plan.offset, 0);
  assert.ok(Math.abs(plan.delay - (8 - 8 / 1.0084)) < 0.0005, `delay ${plan.delay}`);
  assert.deepEqual(plan.aligned, { grid: true, drop: true });
  assert.ok(Math.abs(8 / plan.ratio - plan.offset + plan.delay - 8) < 0.001);
  // Chaque temps de la musique tombe sur la grille de la vidéo.
  for (let k = 0; k < 40; k++) {
    const v = (a.phase + k * p) / plan.ratio - plan.offset + plan.delay;
    if (v <= 20) assert.ok(modDist(v, 0, P15) < 0.002, `temps ${k} à ${v} s`);
  }
  assert.match(plan.why, /posée 0,067 s après le début de la vidéo/);
  // Coup posé 4 ms trop tôt sur une musique juste : 4 ms de silence (avant : coup un temps trop tôt).
  const exact = planMusic({ duration: 40, bpm: 120, period: 0.5, phase: 0.496, confidence: 0.9, rises: [{ t: 7.996, score: 9 }] }, { fpb: 15, D: 20, drop: 8 });
  assert.deepEqual([exact.ratio, exact.offset, exact.delay, exact.aligned.drop], [1, 0, 0.004, true]);
  // Plus d'un temps de grille d'avance (maxDelay) : la montée suivante, puis le premier temps, comme avant.
  const far = planMusic({ ...a, rises: [{ t: 7.3, score: 9 }] }, { fpb: 15, D: 20, drop: 8 });
  assert.deepEqual([far.delay, far.aligned.drop], [0, false]);
  assert.match(far.why, /aucune montée/);
  // maxDelay: 0 : jamais de silence de tête.
  const strict = planMusic(a, { fpb: 15, D: 20, drop: 8, maxDelay: 0 });
  assert.deepEqual([strict.delay, strict.aligned.drop], [0, false]);
  // Sans moment fort : pas de silence.
  assert.equal(planMusic(a, { fpb: 15, D: 20, drop: null }).delay, 0);
});

test("planMusic : sans moment fort, la grille seule ; musique plus courte que la vidéo : bouclée", () => {
  const plan = planMusic(A117, { fpb: 15, D: 20, drop: null });
  assert.deepEqual(plan.aligned, { grid: true, drop: false });
  assert.ok(Math.abs(plan.offset - 0.137 / 1.0256) < 0.0005);
  assert.match(plan.why, /pas de moment fort/);
  const short = planMusic({ ...A117, duration: 12 }, { fpb: 15, D: 20, drop: 8 });
  assert.equal(short.loop, true);
  assert.equal(short.ratio, 1.0256);
  assert.deepEqual(short.aligned, { grid: true, drop: false });
  assert.ok(Math.abs(short.offset - 0.137 / 1.0256) < 0.0005);
  assert.match(short.why, /bouclé/);
});

test("planMusic : 20 % d'écart → pas d'étirement, mais la montée reste posée sur le moment fort", () => {
  const a = { duration: 40, bpm: 100, period: 0.6, phase: 0.137, confidence: 0.9, rises: [{ t: 0.137 + 20 * 0.6, score: 8 }] };
  const plan = planMusic(a, { fpb: 15, D: 20, drop: 8 });
  assert.equal(plan.ratio, 1);
  assert.equal(plan.bpmOut, 100);
  assert.deepEqual(plan.aligned, { grid: false, drop: true });
  assert.equal(plan.offset, 4.137);
  assert.match(plan.why, /trop loin de la grille/);
  // maxStretch plus large : étiré.
  assert.equal(planMusic(a, { fpb: 15, D: 20, drop: 8, maxStretch: 0.25 }).ratio, 1.2);
});

test("planMusic : octave la plus proche de la grille (moitié ou double de la période)", () => {
  const base = { duration: 60, phase: 0.1, confidence: 0.9, rises: [] };
  const at = (bpm, fpb) => planMusic({ ...base, bpm, period: 60 / bpm }, { fpb, D: 20 });
  assert.equal(at(60, 15).ratio, 1); // un temps de musique tous les deux temps de grille
  assert.equal(at(900 / 14, 14).ratio, 1); // 64,29 BPM : moitié de 128,57
  assert.equal(at(64.29, 14).ratio, 1); // ×0,9999 : 1,4 ms de dérive sur 20 s, pas d'atempo
  assert.equal(at(120, 15).ratio, 1);
  const fast = at(236, 15); // deux temps de musique par temps de grille
  assert.equal(fast.ratio, 1.0169);
  assert.ok(Math.abs(fast.bpmOut - 240) < 0.05, `bpmOut ${fast.bpmOut}`);
  assert.equal(at(98, 18).ratio, 1.0204); // 98 → 100 BPM : accéléré
  // Deux temps de musique par temps de grille : n'importe quel temps (pair ou impair) peut tomber sur le moment fort.
  const p = 60 / 236, rise = 0.1 + 33 * p;
  const plan = planMusic({ ...base, bpm: 236, period: p, rises: [{ t: rise, score: 7 }] }, { fpb: 15, D: 20, drop: 6 });
  assert.equal(plan.aligned.drop, true);
  assert.ok(Math.abs(rise / plan.ratio - plan.offset - 6) < 0.001, `la montée tombe à ${rise / plan.ratio - plan.offset}`);
});

test("planMusic : presque au bon tempo, pas d'atempo (dérive de moins de 4 ms sur la vidéo)", () => {
  const a = { duration: 40, bpm: 119.99, period: 60 / 119.99, phase: 0.2, confidence: 0.9, rises: [{ t: 0.2 + 30 * (60 / 119.99), score: 7 }] };
  const plan = planMusic(a, { fpb: 15, D: 20, drop: 9 });
  assert.equal(plan.ratio, 1);
  assert.deepEqual(plan.aligned, { grid: true, drop: true });
  assert.ok(Math.abs(a.rises[0].t - plan.offset - 9) < 0.001);
  assert.match(plan.why, /déjà presque/);
  // Une vidéo plus longue dériverait trop : étirée.
  assert.equal(planMusic(a, { fpb: 15, D: 60, drop: 9 }).ratio, 1.0001);
});

test("planMusic : confiance nulle ou faible, entrées absentes", () => {
  const zero = planMusic({ duration: 30, bpm: 0, period: 0, phase: 0, confidence: 0, rises: [] }, { fpb: 15, D: 20, drop: 8 });
  assert.deepEqual([zero.ratio, zero.offset, zero.loop, zero.aligned], [1, 0, false, { grid: false, drop: false }]);
  const weak = planMusic({ ...A117, confidence: 0.1 }, { fpb: 15, D: 20, drop: 8 });
  assert.equal(weak.ratio, 1);
  assert.equal(weak.aligned.grid, false);
  assert.match(weak.why, /Pas de tempo net/);
  const nothing = planMusic(null, { fpb: 15, D: 20 });
  assert.deepEqual([nothing.ratio, nothing.offset, nothing.aligned.grid], [1, 0, false]);
  assert.equal(typeof nothing.why, "string");
});

// ─── musicFilter ────────────────────────────────────────────────────────────────────────────────────────────────────

test("musicFilter : la chaîne -af (atempo, départ corrigé, fondus, durée exacte, 48 kHz)", () => {
  assert.equal(
    musicFilter({ ratio: 1.0256, offset: 8.1336 }, { D: 20 }),
    "aresample=48000,atempo=1.0256,atrim=start=8.1436,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.02,afade=t=out:st=18.8:d=1.2,apad,atrim=duration=20,aresample=48000",
  );
  // Sans étirement : le départ tel quel.
  assert.equal(musicFilter({ ratio: 1, offset: 4.137 }, { D: 12.5 }), "atrim=start=4.137,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.02,afade=t=out:st=11.3:d=1.2,apad,atrim=duration=12.5,aresample=48000");
  // Ralenti avec un départ plus tôt que la correction : du silence est ajouté au début (après le fondu d'entrée de la
  // musique, et les pts refaits derrière adelay).
  assert.match(musicFilter({ ratio: 0.9667, offset: 0.004 }, { D: 10 }), /atempo=0\.9667,atrim=start=0,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0\.02,adelay=delays=6:all=1,asetpts=N\/SR\/TB,afade=t=out/);
  // Silence de tête du plan (delay) : ajouté à celui de la correction.
  assert.match(musicFilter({ ratio: 0.9667, offset: 0, delay: 0.25 }, { D: 10 }), /atrim=start=0,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0\.02,adelay=delays=260:all=1,asetpts=N\/SR\/TB,/);
  assert.match(musicFilter({ ratio: 1, offset: 0, delay: 0.134 }, { D: 10 }), /^atrim=start=0,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0\.02,adelay=delays=134:all=1,asetpts=N\/SR\/TB,/);
  // Un fondu arrondi à 0 est omis (afade d=0 ferait un fondu d'une seconde) ; une durée arrondie à 0 est refusée.
  assert.equal(musicFilter({ ratio: 1, offset: 0 }, { D: 10, fadeIn: 0.00004, fadeOut: 0.00004 }), "atrim=start=0,asetpts=PTS-STARTPTS,apad,atrim=duration=10,aresample=48000");
  assert.throws(() => musicFilter({ ratio: 1 }, { D: 0.00004 }), /durée de la vidéo invalide/);
  // atempo enchaîné hors de 0,5-2.
  assert.match(musicFilter({ ratio: 2.5, offset: 0 }, { D: 10 }), /atempo=2,atempo=1\.25,/);
  assert.match(musicFilter({ ratio: 0.3, offset: 0 }, { D: 10 }), /atempo=0\.5,atempo=0\.6,/);
  // Fondu de sortie plus long que la vidéo, fondus choisis, plan absent.
  assert.match(musicFilter({ ratio: 1, offset: 0 }, { D: 0.8 }), /afade=t=out:st=0:d=0\.8,/);
  assert.match(musicFilter(null, { D: 9, fadeIn: 0.5, fadeOut: 2 }), /^atrim=start=0,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0\.5,afade=t=out:st=7:d=2,apad,atrim=duration=9,/);
  // Au plus 4 décimales, jamais d'exposant.
  const f = musicFilter({ ratio: 1.0123456, offset: 3.123456789 }, { D: 17.3333333, fadeIn: 0.0123456 });
  assert.doesNotMatch(f, /\d\.\d{5,}|e[-+]?\d/i);
  assert.throws(() => musicFilter({ ratio: 1 }, { D: 0 }), /durée de la vidéo invalide/);
});

test("musicFilter : ffmpeg accepte la chaîne et la sortie dure exactement D (48 kHz)", () => {
  const src = wav("filtre.wav", track({ bpm: 117, seconds: 20, noise: 0.01, hats: 0.1 }));
  const short = wav("filtre-court.wav", track({ bpm: 117, seconds: 4 }));
  const cases = [
    [src, { ratio: 1.0256, offset: 3.2 }, 12.345, []],
    [src, { ratio: 0.9667, offset: 0.004 }, 9.5, []],
    [src, { ratio: 1, offset: 0 }, 7, []],
    [src, { ratio: 1, offset: 15 }, 8, []], // la musique s'arrête avant D : silence jusqu'à D
    [short, { ratio: 1.0256, offset: 0.13, loop: true }, 11, ["-stream_loop", "-1"]], // bouclée par l'appelant
    // Silence de tête derrière atempo, plus long qu'une trame d'adelay (2048 échantillons) : sans pts refaits, la
    // sortie durait 91 ms de moins que D et le silence était tronqué.
    [src, { ratio: 1.017, offset: 0, delay: 0.134 }, 10, []],
    [src, { ratio: 0.9756, offset: 0, delay: 0.4 }, 10, []],
  ];
  cases.forEach(([file, plan, D, pre], i) => {
    const out = join(DIR, `filtre-${i}.wav`);
    render(file, musicFilter(plan, { D }), out, pre);
    const j = probe(out);
    assert.ok(Math.abs(Number(j.format.duration) - D) < 0.001, `cas ${i} : ${j.format.duration} s au lieu de ${D}`);
    assert.equal(j.streams[0].sample_rate, "48000");
  });
});

// ─── Bout en bout ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Analyse, calage, rendu ffmpeg de la musique calée, puis nouvelle analyse : les temps tombent sur la grille de la
 * vidéo à 20 ms près (hors fondus) et la plus forte montée sur le moment fort, à un temps près.
 */
async function endToEnd(name, opts, { fpb, D, drop, ratio }) {
  const src = wav(`${name}.wav`, track(opts));
  const a = await analyzeMusic(src);
  const plan = planMusic(a, { fpb, D, drop });
  assert.equal(plan.ratio, ratio);
  assert.deepEqual(plan.aligned, { grid: true, drop: true });
  const out = join(DIR, `${name}-cale.wav`);
  render(src, musicFilter(plan, { D }), out);
  assert.ok(Math.abs(Number(probe(out).format.duration) - D) < 0.001);
  const b = await analyzeMusic(out);
  const P = fpb / 30;
  assert.ok(Math.abs(b.period / P - 1) < 0.005, `période ${b.period} au lieu de ${P}`);
  const inner = b.beats.filter((t) => t > 0.25 && t < D - 1.3);
  assert.ok(inner.length >= (D - 1.6) / P - 2, `${inner.length} temps`);
  for (const t of inner) assert.ok(modDist(t, 0, P) < 0.02, `temps ${t} à ${(modDist(t, 0, P) * 1000).toFixed(1)} ms de la grille`);
  assert.ok(b.rises.length && Math.abs(b.rises[0].t - drop) <= P, `montée à ${b.rises[0]?.t} pour le moment fort à ${drop}`);
  return { a, plan, b };
}

test("bout en bout : 117 BPM accéléré sur la grille de 120 BPM, la montée sur le moment fort", async () => {
  await endToEnd("e2e-117", { bpm: 117, seconds: 40, noise: 0.01, hats: 0.1, jump: 32 }, { fpb: 15, D: 20, drop: 8, ratio: 1.0256 });
});

test("bout en bout : 133 BPM ralenti sur la grille de 128,57 BPM (fpb 14)", async () => {
  await endToEnd("e2e-133", { bpm: 133, first: 0.29, seconds: 45, noise: 0.01, hats: 0.1, jump: 48 }, { fpb: 14, D: 24, drop: 11.2, ratio: 0.9667 });
});

test("bout en bout : musique composée un peu lente, drop sur le moment fort → silence de tête, temps sur la grille, drop sur le moment fort", async () => {
  // Demandée à 120 BPM avec son coup à 8 s, livrée à 118 BPM avec le premier temps du drop (après une montée) à 8 s.
  const bpm = 118, p = 60 / bpm, bars = { intro: 2, brk: 1, build: 2, drop: 8, outro: 2 };
  const s = song({ bpm, first: 8 - 4 * (bars.intro + bars.brk + bars.build) * p, bars });
  const src = wav("compose-118.wav", s.y);
  const a = await analyzeMusic(src);
  const D = 20, P = 0.5;
  const plan = planMusic(a, { fpb: 15, D, drop: 8 });
  assert.equal(plan.ratio, 1.017);
  assert.equal(plan.offset, 0);
  assert.ok(plan.delay > 0.1 && plan.delay < 0.2, `delay ${plan.delay}`);
  assert.deepEqual(plan.aligned, { grid: true, drop: true });
  const out = join(DIR, "compose-118-cale.wav");
  render(src, musicFilter(plan, { D }), out);
  assert.ok(Math.abs(Number(probe(out).format.duration) - D) < 0.001);
  const b = await analyzeMusic(out);
  const inner = b.beats.filter((t) => t > plan.delay + 0.25 && t < D - 1.3);
  assert.ok(inner.length >= (D - 1.8) / P - 2, `${inner.length} temps`);
  for (const t of inner) assert.ok(modDist(t, 0, P) < 0.02, `temps ${t} à ${(modDist(t, 0, P) * 1000).toFixed(1)} ms de la grille`);
  assert.ok(b.rises.length && Math.abs(b.rises[0].t - 8) < 0.03, `drop à ${b.rises[0]?.t} pour le moment fort à 8`);
});
