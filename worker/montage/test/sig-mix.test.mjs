// Piste son d'un reel Signature (engine 2, sig-mix.mjs) : musique calée sur la grille (étirée, départ choisi pour la
// montée), départ choisi à la main recalé sur un temps, bruitages, voix off, sonie −14 LUFS, durée exacte, cas sans son.
// `node --test test/sig-mix.test.mjs` (ffmpeg et ffprobe requis).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signatureMix, musicPlan, SIG_LOUDNESS } from "../lib/reel/sig-mix.mjs";
import { analyzeMusic } from "../lib/reel/sig-tempo.mjs";
import { voiceGraph } from "../lib/reel/narration.mjs";

const DIR = mkdtempSync(join(tmpdir(), "sig-mix-"));
after(() => rmSync(DIR, { recursive: true, force: true }));
const SR = 44100;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Musique pleine : grosse caisse sur chaque temps, charleston à contretemps, nappe ; énergie qui saute au temps `jump`. */
function music({ bpm, first = 0.137, seconds = 45, jump = 40, seed = 5 }) {
  const n = Math.round(seconds * SR), y = new Float32Array(n), rnd = mulberry32(seed), p = 60 / bpm;
  for (let k = 0; first + k * p < seconds; k++) {
    const i0 = Math.round((first + k * p) * SR), loud = k >= jump;
    for (let i = 0; i < 0.35 * SR && i0 + i < n; i++) {
      const t = i / SR;
      y[i0 + i] += (loud ? 0.7 : 0.5) * Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * (50 * t + 3 * (1 - Math.exp(-t / 0.03))));
    }
    const j0 = Math.round((first + (k + 0.5) * p) * SR);
    let prev = 0;
    for (let i = 0; i < 0.06 * SR && j0 + i < n; i++) { const w = rnd() * 2 - 1; y[j0 + i] += 0.12 * Math.exp(-i / SR / 0.015) * (w - prev); prev = w; }
    if (loud) for (let i = 0; i < p * SR && i0 + i < n; i++) { const t = i / SR; y[i0 + i] += 0.2 * (2 * ((55 * t) % 1) - 1) * Math.min(1, t / 0.005) * Math.exp(-t / (p * 0.9)); }
  }
  for (let i = 0; i < n; i++) y[i] += 0.01 * (rnd() * 2 - 1);
  return y;
}

/** Une « phrase » de voix : 1 s de voyelle synthétique (220 Hz et harmoniques) avec attaque et fin douces. */
function voice(seconds = 1) {
  const n = Math.round(seconds * SR), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = Math.min(1, t / 0.03, (seconds - t) / 0.05);
    y[i] = 0.4 * env * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 660 * t)) / 1.75;
  }
  return y;
}

const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=sample_rate,channels,duration,codec_name", "-of", "json", f], { encoding: "utf8" })).streams[0];
/** Sonie intégrée, crête et RMS (dB) d'un fichier, ou de sa tranche [from, to] s. */
function measured(f, from = 0, to = 0) {
  const trim = to > from ? `atrim=${from}:${to},` : "";
  const r = execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i "${f}" -af "${trim}ebur128=framelog=quiet,astats=metadata=0:measure_perchannel=none" -f null - 2>&1`], { encoding: "utf8" });
  const I = /I:\s*(-?[\d.]+|-inf)\s*LUFS/.exec(r);
  const peak = /Peak level dB:\s*(-?[\d.]+|-inf)/.exec(r);
  const rms = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(r);
  return { I: I ? Number(I[1]) : NaN, peak: peak ? Number(peak[1]) : NaN, rms: rms ? Number(rms[1]) : NaN };
}
const md5 = (f) => createHash("md5").update(readFileSync(f)).digest("hex");

const TRACK = wav("music-116.wav", music({ bpm: 116 }));
const SFX = [{ t: 0.5, k: "whoosh" }, { t: 4, k: "impact" }, { t: 7.5, k: "riser" }, { t: 12, k: "tick" }, { t: 15.5, k: "pop" }];
const D = 20, FPB = 15, DROP = 8;

test("musicPlan : départ à la main recalé sur le temps de grille le plus proche", async () => {
  const a = await analyzeMusic(TRACK);
  const auto = musicPlan(a, { fpb: FPB, D, drop: DROP });
  assert.equal(auto.aligned.grid, true);
  assert.equal(auto.aligned.drop, true);
  const P = FPB / 30;
  const manual = musicPlan(a, { fpb: FPB, D, drop: DROP, start: 3.3 });
  assert.equal(manual.manual, true);
  assert.equal(manual.aligned.drop, false);
  // Même grille que le départ automatique (un nombre entier de temps d'écart), au plus près de 3,3 s étirées.
  const k = (manual.offset - auto.offset) / P;
  assert.ok(Math.abs(k - Math.round(k)) < 1e-3, `écart ${k} temps`);
  assert.ok(Math.abs(manual.offset - 3.3 / manual.ratio) <= P / 2 + 1e-6, `départ ${manual.offset}`);
  assert.match(manual.why, /départ choisi à la main \(3,3 s\), recalé/);
  // Pas de départ (0 ou absent) : le calage automatique.
  assert.deepEqual(musicPlan(a, { fpb: FPB, D, drop: DROP, start: 0 }), auto);
});

test("musique + bruitages : durée exacte, −14 LUFS, plafond, temps sur la grille, montée sur le moment fort", async () => {
  const out = join(DIR, "mix.wav");
  const notes = [];
  const r = await signatureMix({ clips: new Map(), marks: [], track: TRACK, cue: {}, volume: 0.7, sfx: SFX, fpb: FPB, duration: D, drop: DROP, seed: 3, out, notes });
  assert.equal(r.file, out);
  assert.equal(r.sfx, SFX.length);
  assert.equal(r.voice, 0);
  assert.equal(r.music.aligned.grid, true);
  assert.equal(r.music.aligned.drop, true);
  assert.equal(r.music.ratio, 1.0345);
  assert.deepEqual(notes, []);
  const s = probe(out);
  assert.equal(s.sample_rate, "48000");
  assert.equal(s.channels, 2);
  assert.ok(Math.abs(Number(s.duration) - D) < 0.001, `durée ${s.duration}`);
  const m = measured(out);
  assert.ok(Math.abs(m.I - SIG_LOUDNESS.target) <= 1, `sonie ${m.I}`);
  assert.ok(m.peak <= -1.9, `crête ${m.peak} dB`);
  // Les grosses caisses tombent sur la grille de 0,5 s (à 35 ms près : atempo déplace un peu les attaques).
  const a = await analyzeMusic(out);
  const off = a.beats.filter((t) => t > 1 && t < D - 2).map((t) => { let e = t % 0.5; if (e > 0.25) e -= 0.5; return e; });
  const med = off.slice().sort((x, y) => x - y)[Math.floor(off.length / 2)];
  assert.ok(Math.abs(med) < 0.035, `écart médian ${(med * 1000).toFixed(1)} ms`);
  // La montée de la musique (temps 40 du fichier, 20,83 s) tombe sur le moment fort : plus d'énergie juste après.
  const before = measured(out, DROP - 2, DROP - 0.05), afterDrop = measured(out, DROP + 0.05, DROP + 2);
  assert.ok(afterDrop.rms - before.rms > 2, `montée ${before.rms} → ${afterDrop.rms} dB`);
});

test("départ choisi à la main : la montée ne tombe plus sur le moment fort, le calage reste", async () => {
  const out = join(DIR, "mix-manual.wav");
  const r = await signatureMix({ clips: new Map(), marks: [], track: TRACK, cue: { start: 3.3 }, volume: 0.7, sfx: [], fpb: FPB, duration: D, drop: DROP, out });
  assert.equal(r.music.aligned.grid, true);
  assert.equal(r.music.aligned.drop, false);
  assert.equal(r.sfx, 0);
  assert.ok(Math.abs(Number(probe(out).duration) - D) < 0.001);
});

test("bruitages seuls : niveau fixe (pas de montée à −14 LUFS), bruitages coupés : aucun son", async () => {
  const out = join(DIR, "sfx.wav");
  const r = await signatureMix({ clips: new Map(), marks: [], track: null, sfx: SFX, fpb: FPB, duration: D, drop: DROP, seed: 3, out });
  assert.equal(r.music, null);
  assert.equal(r.gainDb, 0);
  const m = measured(out);
  assert.ok(m.peak <= -1.9 && m.peak > -12, `crête ${m.peak} dB`);
  assert.equal(await signatureMix({ clips: new Map(), marks: [], track: null, sfx: SFX, sfxOn: false, fpb: FPB, duration: D, drop: DROP, out: join(DIR, "none.wav") }), null);
  assert.equal(await signatureMix({ clips: new Map(), marks: [], track: null, sfx: [], fpb: FPB, duration: D, drop: DROP, out: join(DIR, "none.wav") }), null);
  // Volume à zéro : la musique ne compte pas.
  assert.equal(await signatureMix({ clips: new Map(), marks: [], track: TRACK, volume: 0, sfx: [], fpb: FPB, duration: D, drop: DROP, out: join(DIR, "none.wav") }), null);
});

test("voix off : posée sur son temps fort, la musique baisse dessous", async () => {
  const clip = wav("voix.wav", voice(1.2));
  const clips = new Map([["b2", { file: clip, dur: 1.2 }]]);
  const marks = [{ id: "b1", title: "Accroche", start: 0, end: 4 }, { id: "b2", title: "Idée", start: 4, end: 8 }, { id: "b3", title: "Fin", start: 8, end: D }];
  const out = join(DIR, "voix-mix.wav");
  const r = await signatureMix({ clips, marks, track: TRACK, volume: 0.7, sfx: SFX, fpb: FPB, duration: D, drop: DROP, seed: 3, out });
  assert.equal(r.voice, 1);
  const quiet = join(DIR, "sans-voix.wav");
  await signatureMix({ clips: new Map(), marks, track: TRACK, volume: 0.7, sfx: SFX, fpb: FPB, duration: D, drop: DROP, seed: 3, out: quiet });
  // Pendant la phrase (4,15 → 5,35 s), le son n'est plus le même ; avant elle (1 → 3,5 s), la musique est plus basse
  // qu'en l'absence de voix (moitié du volume sous une voix), la sonie totale restant −14 LUFS.
  const withV = measured(out, 1, 3.5), noV = measured(quiet, 1, 3.5);
  assert.ok(noV.rms - withV.rms > 1, `musique ${noV.rms} → ${withV.rms} dB`);
  assert.ok(Math.abs(measured(out).I - SIG_LOUDNESS.target) <= 1);
});

test("déterministe : deux mélanges identiques octet pour octet", async () => {
  const a = join(DIR, "det-a.wav"), b = join(DIR, "det-b.wav");
  await signatureMix({ clips: new Map(), marks: [], track: TRACK, sfx: SFX, fpb: FPB, duration: 12, drop: 5, seed: 9, out: a });
  await signatureMix({ clips: new Map(), marks: [], track: TRACK, sfx: SFX, fpb: FPB, duration: 12, drop: 5, seed: 9, out: b });
  assert.equal(md5(a), md5(b));
});

test("musique illisible : une note puis une erreur (la finition repasse alors au son simple)", async () => {
  const bad = join(DIR, "pas-une-musique.wav");
  writeFileSync(bad, "ceci n'est pas un fichier son");
  const notes = [];
  await assert.rejects(signatureMix({ clips: new Map(), marks: [], track: bad, sfx: SFX, fpb: FPB, duration: D, drop: DROP, out: join(DIR, "bad.wav"), notes }));
  assert.ok(notes.some((n) => /rythme de la musique n'a pas pu être mesuré/.test(n)), notes.join(" | "));
});

test("voiceGraph : entrées numérotées à partir de first, [vo] coupé à la durée", () => {
  const clips = new Map([["b", { file: "/x.mp3", dur: 1 }], ["c", { file: "/y.mp3", dur: 9 }]]);
  const notes = [];
  const g = voiceGraph({ clips, marks: [{ id: "a", start: 0, end: 2 }, { id: "b", start: 2, end: 4 }, { id: "c", start: 4, end: 6 }], duration: 6, notes, first: 2 });
  assert.equal(g.count, 2);
  assert.deepEqual(g.inputs, ["-i", "/x.mp3", "-i", "/y.mp3"]);
  assert.match(g.filters[0], /^\[2:a\].*adelay=2150\|2150,apad\[v0\]$/);
  assert.match(g.filters[1], /^\[3:a\].*atempo=1\.200.*\[v1\]$/);
  assert.match(g.filters[2], /^\[v0\]\[v1\]amix=inputs=2:duration=longest:normalize=0,atrim=0:6\.000,asetpts=N\/SR\/TB\[vo\]$/);
  assert.equal(notes.length, 1);
  assert.equal(voiceGraph({ clips: new Map(), marks: [{ id: "a", start: 0, end: 2 }], duration: 2 }).count, 0);
});

test("équilibre : les bruitages suivent la sonie de la musique (6 dB dessous), gain borné", async () => {
  const loud = wav("music-116-fort.wav", music({ bpm: 116 }).map((x) => x * 1.9));
  const a = await signatureMix({ clips: new Map(), marks: [], track: TRACK, sfx: SFX, fpb: FPB, duration: D, drop: DROP, seed: 3, out: join(DIR, "bal-a.wav") });
  const b = await signatureMix({ clips: new Map(), marks: [], track: loud, sfx: SFX, fpb: FPB, duration: D, drop: DROP, seed: 3, out: join(DIR, "bal-b.wav") });
  // Musique 5,6 dB plus forte : bruitages relevés d'autant (×1,9), dans les bornes.
  assert.ok(Math.abs(b.sfxGain / a.sfxGain - 1.9) < 0.15, `${a.sfxGain} → ${b.sfxGain}`);
  for (const r of [a, b]) assert.ok(r.sfxGain >= 0.2 && r.sfxGain <= 2.2, `gain ${r.sfxGain}`);
  // Sans musique : le gain fixe.
  const c = await signatureMix({ clips: new Map(), marks: [], track: null, sfx: SFX, fpb: FPB, duration: D, drop: DROP, out: join(DIR, "bal-c.wav") });
  assert.equal(c.sfxGain, 0.8);
});
