// Transcription mot à mot avec whisper.cpp (whisper-cli), puis découpage en phrases.
// Temps des mots : alignement DTW de whisper.cpp (début de chaque mot), recalé sur les silences entendus par ffmpeg
// (fin du mot au début du silence, mot suivant à la fin du silence). Sans DTW : temps des segments de whisper.
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { run, ensureDir, log, round } from "./util.mjs";
import { detectSilences } from "./audio.mjs";

/**
 * Renvoie les mots du rush : [{ t0, t1, w }] en secondes du rush. Résultat mis en cache (par chemin + taille + date).
 * Un fichier `<rush>.words.json` posé à côté du rush est utilisé tel quel (utile pour tester sans modèle).
 */
export async function transcribe(cfg, rushPath, stat) {
  const side = rushPath.replace(/\.\w+$/, ".words.json");
  if (existsSync(side)) return JSON.parse(readFileSync(side, "utf8"));
  const key = createHash("sha1").update(`v3|${rushPath}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 16);
  const dir = ensureDir(join(cfg.workDir, "transcriptions"));
  const cached = join(dir, `${key}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  if (!existsSync(cfg.whisper.model)) {
    throw new Error(`Modèle Whisper absent : ${cfg.whisper.model}. Téléchargez-le avec « node montage.mjs --setup » (≈ 1,6 Go).`);
  }
  log("transcription de", basename(rushPath));
  const wav = join(dir, `${key}.wav`);
  await run("ffmpeg", ["-v", "error", "-y", "-i", rushPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  const outBase = join(dir, key);
  // DTW (temps des jetons) : incompatible avec flash attention, d'où -nfa.
  const dtw = cfg.whisper.dtw ? ["-nfa", "--dtw", cfg.whisper.dtw] : [];
  try {
    // --max-len 1 + --split-on-word : un segment par mot ; -ojf : JSON complet avec les jetons (t_dtw).
    await run(cfg.whisper.bin, ["-m", cfg.whisper.model, "-l", cfg.whisper.language, "-f", wav, "-ml", "1", "-sow", "-ojf", "-of", outBase, ...dtw,
      ...(cfg.whisper.prompt ? ["--prompt", cfg.whisper.prompt] : [])]);
  } finally { rmSync(wav, { force: true }); }
  const j = JSON.parse(readFileSync(`${outBase}.json`, "utf8"));
  rmSync(`${outBase}.json`, { force: true });
  const raw = [];
  for (const s of j.transcription || []) {
    const w = (s.text || "").trim();
    if (!w || /^\[.*\]$/.test(w)) continue;
    const from = s.offsets.from / 1000, to = s.offsets.to / 1000;
    const tok = (s.tokens || []).find((t) => !/^\[_/.test(t.text || "") && (t.text || "").trim() && t.t_dtw >= 0);
    // whisper colle parfois la ponctuation seule : on la rattache au mot précédent.
    if (/^[.,!?;:…»)]+$/.test(w) && raw.length) { raw[raw.length - 1].w += w; raw[raw.length - 1].to = to; continue; }
    raw.push({ w, from, to, dtw: tok ? tok.t_dtw / 100 : null });
  }
  const useDtw = raw.length && raw.filter((x) => x.dtw != null).length >= raw.length * 0.8;
  // Le temps DTW tombe un peu après le début réel du mot (≈ 0,15 s mesuré sur des prises face caméra).
  const shift = cfg.whisper.dtwShift ?? 0.15;
  const words = raw.map((x) => ({ w: x.w, t0: useDtw && x.dtw != null ? Math.max(0, Math.min(Math.max(x.dtw - shift, x.from - 1), x.to + 1)) : x.from, t1: x.to }));
  if (useDtw) {
    for (let i = 0; i < words.length; i++) {
      if (i && words[i].t0 < words[i - 1].t0 + 0.02) words[i].t0 = words[i - 1].t0 + 0.02;
      words[i].t1 = i + 1 < words.length ? Math.max(words[i].t0 + 0.05, words[i + 1].t0) : Math.max(words[i].t1, words[i].t0 + 0.2);
    }
    const sil = await detectSilences(cfg, rushPath).catch(() => []);
    snapToSilences(words, sil.filter(([a, b]) => b - a >= 0.2));
  }
  const out = words.map((x) => ({ t0: round(x.t0), t1: round(Math.max(x.t1, x.t0 + 0.05)), w: x.w }));
  writeFileSync(cached, JSON.stringify(out));
  log(`${out.length} mots${useDtw ? " (temps DTW recalés sur les silences)" : ""}`);
  return out;
}

/** Un silence entre deux mots : le 1er s'arrête à son début, le 2e commence à sa fin. */
function snapToSilences(words, sil) {
  for (const [a, b] of sil) {
    const i = words.findIndex((w) => w.t0 < a && w.t1 > a);
    if (i >= 0) {
      words[i].t1 = Math.max(words[i].t0 + 0.05, a);
      const n = words[i + 1];
      if (n && Math.abs(n.t0 - b) < 0.6) n.t0 = b;
    }
    // Mot qui commencerait dans le silence : il démarre à la fin du silence.
    for (const w of words) if (w.t0 >= a && w.t0 < b && b - w.t0 < 0.8) w.t0 = b;
  }
  for (let i = 0; i < words.length; i++) {
    if (i && words[i].t0 < words[i - 1].t0 + 0.02) words[i].t0 = words[i - 1].t0 + 0.02;
    const next = words[i + 1]?.t0 ?? Infinity;
    words[i].t1 = Math.min(Math.max(words[i].t1, words[i].t0 + 0.05), Math.max(next, words[i].t0 + 0.05));
  }
}

/** Regroupe les mots en phrases : ponctuation forte, ou silence de plus de 0,7 s. */
export function sentences(rushId, words) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ rush: rushId, in: round(Math.max(0, cur[0].t0 - 0.08)), out: round(cur[cur.length - 1].t1 + 0.12), text: cur.map((x) => x.w).join(" "), words: cur });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && w.t0 - cur[cur.length - 1].t1 > 0.7) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
  return out;
}
