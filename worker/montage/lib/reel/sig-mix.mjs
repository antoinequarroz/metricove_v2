// La piste son d'un reel Signature (engine 2, worker 0.22.0) : un wav 48 kHz stéréo d'exactement D secondes.
// - Musique calée sur la grille de la vidéo : son tempo est mesuré (sig-tempo.mjs), elle est étirée de ±8 % au plus
//   pour qu'un temps de musique tombe sur chaque temps de la grille (fpb images par temps), et son départ est choisi
//   pour que sa plus forte montée tombe sur le moment fort (drop). Un départ choisi à la main (cue.start) est gardé,
//   recalé sur le temps de musique le plus proche.
// - Bruitages des coupes (sfx.json du moteur : whoosh, tick, impact…), synthétisés sans fichier (sig-sfx.mjs).
// - Voix off posée comme en engine 1 (narration.mjs) ; sous elle, la musique et les bruitages baissent.
// Le mélange est fait en flottant (aucun écrêtage), mesuré (EBU R128), mis à −14 LUFS par un gain fixe puis tenu
// sous −2 dBFS par un limiteur sans retard : la montée de la musique garde sa dynamique (un loudnorm dynamique
// l'aplatirait). Des bruitages seuls ne sont pas montés à −14 LUFS (ils seraient énormes) : gain fixe.
import { rmSync, statSync } from "node:fs";
import { run, log } from "../util.mjs";
import { analyzeMusic, planMusic, musicFilter } from "./sig-tempo.mjs";
import { renderSfx } from "./sig-sfx.mjs";
import { voiceGraph } from "./narration.mjs";
import { FPS } from "./vocab.mjs";

/** Gains du mélange : bruitages (sans voix ni musique mesurée), part de la musique et des bruitages sous une voix. */
export const SIG_GAIN = Object.freeze({ sfx: 0.8, musicUnderVoice: 0.5, sfxUnderVoice: 0.6 });
/**
 * Équilibre musique / bruitages : avec une musique, les bruitages sont posés `music` dB sous elle (sonies intégrées
 * mesurées, chacune quand elle joue), `voice` dB sous elle avec une voix off, gain borné à `gain`. Une musique très
 * compressée ou très douce garde ainsi des bruitages audibles sans qu'ils la couvrent.
 */
export const SIG_BALANCE = Object.freeze({ music: 6, voice: 9, gain: Object.freeze([0.2, 2.2]) });
/** Sonie visée (LUFS intégrés) et plafond du limiteur (−2 dBFS : marge pour les crêtes entre échantillons et l'AAC). */
export const SIG_LOUDNESS = Object.freeze({ target: -14, limit: 0.79, maxGainDb: 24 });

const f3 = (n) => Number(n).toFixed(3);
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Analyse de tempo gardée par fichier (chemin, taille, date) : une retouche ne la refait pas. */
const analyses = new Map();
async function analysisOf(file, signal) {
  let key = file;
  try { const s = statSync(file); key = `${file}|${s.size}|${s.mtimeMs}`; } catch { /* fichier distant ou absent : analyzeMusic le dira */ }
  if (analyses.has(key)) return analyses.get(key);
  const a = await analyzeMusic(file, { signal });
  analyses.set(key, a);
  if (analyses.size > 24) analyses.delete(analyses.keys().next().value);
  return a;
}

/**
 * Le calage de la musique : planMusic, ou, avec un départ choisi à la main (`start` s dans le fichier), ce départ
 * recalé sur le temps de la grille le plus proche (dans la musique étirée). Renvoie le plan de planMusic (+ `manual`).
 */
export function musicPlan(analysis, { fpb, D, drop, start = 0 }) {
  const P = fpb / FPS;
  const s = num(start) ?? 0;
  if (!(s > 0)) return planMusic(analysis, { fpb, D, drop, fps: FPS });
  // Sans moment fort, planMusic donne le premier départ calé : les autres en sont à un nombre entier de temps.
  const base = planMusic(analysis, { fpb, D, drop: null, fps: FPS });
  const want = s / base.ratio;
  let offset = want;
  if (base.aligned.grid) {
    offset = base.offset + Math.round((want - base.offset) / P) * P;
    if (offset < 0) offset += P;
  }
  offset = Math.round(offset * 10000) / 10000;
  const durS = (num(analysis?.duration) ?? 0) / base.ratio;
  const loop = durS > 0 && offset + D > durS + 1e-6;
  const why = `${base.why.replace(/ ; (pas de moment fort|morceau plus court)[^;]*\.$/, ".").replace(/\.$/, "")} ; départ choisi à la main (${String(s).replace(".", ",")} s)${base.aligned.grid ? ", recalé sur le temps le plus proche" : ""}${loop ? ", musique bouclée" : ""}.`;
  return { ...base, offset, loop, aligned: { grid: base.aligned.grid, drop: false }, manual: true, why };
}

/** La sonie intégrée (LUFS) d'un fichier (passé par la chaîne `af`, options d'entrée `pre`), null pour un silence. */
async function loudness(file, signal, { af = "", pre = [] } = {}) {
  const err = await run("ffmpeg", ["-hide_banner", "-nostats", ...pre, "-i", file, "-af", `${af ? `${af},` : ""}ebur128=framelog=quiet`, "-f", "null", "-"], { stderr: true, timeoutMs: 120_000, signal });
  const m = /Integrated loudness:\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/i.exec(String(err));
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > -70 ? v : null;
}

/**
 * La piste son d'un reel Signature. Entrées :
 * - clips (Map id → { file, dur }) et marks ([{ id, title, start, end }]) : la voix off (facultative) ;
 * - track : fichier de musique ou null ; cue : { start, fadeIn, fadeOut } choisis à la main (facultatifs) ;
 *   volume : 0 à 1 ;
 * - sfx : événements du moteur ([{ t, k, g, p, … }]) ; sfxOn : false pour s'en passer ;
 * - fpb, duration (D), drop (s), seed : la grille, la durée et le moment fort du moteur ;
 * - out : le wav ; notes : ce qu'Antoine doit savoir.
 * Renvoie { file, music: { ratio, offset, bpmIn, bpmOut, aligned, why } | null, sfx: n, voice: n, gainDb } ou null
 * si la vidéo n'a ni musique, ni voix, ni bruitage (la finition pose alors une piste muette).
 */
export async function signatureMix({ clips, marks, track, cue = {}, volume = 0.7, sfx = [], sfxOn = true, fpb, duration, drop = null, seed = 0, out, notes = [], signal }) {
  const D = Number(duration);
  if (!(D > 0)) throw new Error(`Durée du reel invalide (${duration}).`);
  const vol = Math.min(1, Math.max(0, num(volume) ?? 0.7));
  const inputs = [];
  const fc = [];
  let n = 0;

  // Voix off : entrées 0..k−1.
  const vg = voiceGraph({ clips, marks, duration: D, notes, first: 0 });
  inputs.push(...vg.inputs);
  fc.push(...vg.filters);
  n += vg.count;
  const voiced = vg.count > 0;

  // Musique.
  let music = null;
  if (track && vol > 0) {
    let mp;
    try {
      const a = await analysisOf(track, signal);
      mp = musicPlan(a, { fpb, D, drop, start: cue?.start });
      // Un départ tardif dans un morceau à peine plus long que la vidéo : bouclé plutôt que fini en silence.
      const durS = (num(a.duration) ?? 0) / mp.ratio;
      if (durS > 0 && mp.offset + D > durS + 0.05) mp = { ...mp, loop: true };
      log(`musique : ${mp.why}`);
      if (!mp.aligned.grid) notes.push(a.confidence > 0 && mp.bpmIn > 0 ? `La musique (${Math.round(mp.bpmIn)} BPM) est trop loin du rythme de la vidéo (${Math.round(1800 / fpb)} BPM) pour s'y caler : les coupes ne tombent pas sur ses temps. Une musique proche de ${Math.round(1800 / fpb)} BPM (ou de sa moitié) s'y calera.` : "La musique n'a pas de rythme assez net pour y caler les coupes : elle est posée telle quelle.");
    } catch (e) {
      if (signal?.aborted) throw e;
      log(`musique : analyse impossible (${e.message})`);
      mp = { ratio: 1, offset: num(cue?.start) ?? 0, loop: true, bpmIn: 0, bpmOut: 0, aligned: { grid: false, drop: false }, why: "analyse impossible" };
      notes.push("Le rythme de la musique n'a pas pu être mesuré : elle est posée telle quelle, sans calage sur les coupes.");
    }
    const fadeIn = num(cue?.fadeIn) ?? 0.02, fadeOut = num(cue?.fadeOut) ?? 1.2;
    const gain = vol * (voiced ? SIG_GAIN.musicUnderVoice : 1);
    // Bouclée en entrée (avant l'étirement) : la musique étirée reste continue au point de boucle.
    const pre = mp.loop ? ["-stream_loop", "-1"] : [];
    const chain = `aformat=channel_layouts=stereo,${musicFilter(mp, { D, fadeIn: Math.min(5, Math.max(0, fadeIn)), fadeOut: Math.min(8, Math.max(0, fadeOut)) })},volume=${f3(vol)}`;
    inputs.push(...pre, "-i", track);
    fc.push(`[${n}:a]${chain},volume=${f3(gain / Math.max(vol, 1e-6))}[m]`);
    n++;
    music = { ratio: mp.ratio, offset: mp.offset, bpmIn: mp.bpmIn, bpmOut: mp.bpmOut, aligned: mp.aligned, why: mp.why, pre, chain };
  }

  // Bruitages : synthétisés dans un wav à côté (D secondes, sans traîne).
  const events = sfxOn !== false && Array.isArray(sfx) ? sfx.filter((e) => e && num(e.t) !== null && num(e.t) < D) : [];
  let sfxFile = null, sfxGain = voiced ? SIG_GAIN.sfxUnderVoice : SIG_GAIN.sfx;
  if (events.length) {
    sfxFile = out.replace(/\.wav$/, "") + "-bruitages.wav";
    const r = await renderSfx(events, D, sfxFile, { seed: Number.isInteger(seed) ? seed : 0, tail: 0 });
    if (!r.used) { rmSync(sfxFile, { force: true }); sfxFile = null; }
    else {
      // Avec une musique : les bruitages à SIG_BALANCE dB sous elle (sa sonie au volume choisi, avant la baisse sous la voix).
      if (music) {
        const mI = await loudness(track, signal, { pre: music.pre, af: music.chain });
        const sI = await loudness(sfxFile, signal);
        if (mI !== null && sI !== null) {
          const [lo, hi] = SIG_BALANCE.gain;
          sfxGain = Math.min(hi, Math.max(lo, Math.pow(10, (mI - (voiced ? SIG_BALANCE.voice : SIG_BALANCE.music) - sI) / 20)));
        }
      }
      inputs.push("-i", sfxFile);
      fc.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${f3(sfxGain)},apad,atrim=0:${f3(D)}[s]`);
      n++;
    }
  }
  if (!voiced && !music && !sfxFile) return null;

  // Mélange en flottant : la voix baisse la musique (sidechain), les bruitages passent par-dessus.
  const layers = [];
  if (voiced && music) {
    fc.push("[vo]asplit=2[v][sc]", "[m][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=350[md]");
    layers.push("[v]", "[md]");
  } else if (voiced) layers.push("[vo]");
  else if (music) layers.push("[m]");
  if (sfxFile) layers.push("[s]");
  fc.push(`${layers.join("")}${layers.length > 1 ? `amix=inputs=${layers.length}:duration=longest:normalize=0,` : "anull,"}apad,atrim=0:${f3(D)},asetpts=N/SR/TB[o]`);
  const raw = out.replace(/\.wav$/, "") + "-brut.wav";
  try {
    await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", fc.join(";"), "-map", "[o]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", "-t", f3(D), raw], { timeoutMs: 180_000, signal });
    // Sonie : −14 LUFS par un gain fixe (des bruitages seuls gardent leur niveau), puis limiteur sans retard.
    const I = voiced || music ? await loudness(raw, signal) : null;
    const gainDb = I === null ? 0 : Math.max(-SIG_LOUDNESS.maxGainDb, Math.min(SIG_LOUDNESS.maxGainDb, SIG_LOUDNESS.target - I));
    await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${SIG_LOUDNESS.limit}:attack=5:release=60:level=false:latency=true,aresample=48000,apad,atrim=0:${f3(D)}`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-t", f3(D), out], { timeoutMs: 120_000, signal });
    log(`son Signature : ${[voiced ? `voix (${vg.count})` : "", music ? `musique ×${music.ratio}${music.aligned.drop ? ", montée sur le moment fort" : ""}` : "", sfxFile ? `${events.length} bruitages` : ""].filter(Boolean).join(", ")} ; ${I === null ? "niveau fixe" : `${I.toFixed(1)} LUFS → ${SIG_LOUDNESS.target} (${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB)`}`);
    if (music) { delete music.pre; delete music.chain; }
    return { file: out, music, sfx: sfxFile ? events.length : 0, sfxGain: sfxFile ? Math.round(sfxGain * 1000) / 1000 : 0, voice: vg.count, gainDb: Math.round(gainDb * 100) / 100 };
  } finally {
    rmSync(raw, { force: true });
    if (sfxFile) rmSync(sfxFile, { force: true });
  }
}
