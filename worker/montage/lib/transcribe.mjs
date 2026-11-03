// Transcription mot à mot avec whisper.cpp (whisper-cli), puis découpage en phrases.
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { run, ensureDir, log, round } from "./util.mjs";

/**
 * Renvoie les mots du rush : [{ t0, t1, w }] en secondes du rush. Résultat mis en cache (par chemin + taille + date).
 * Un fichier `<rush>.words.json` posé à côté du rush est utilisé tel quel (utile pour tester sans modèle).
 */
export async function transcribe(cfg, rushPath, stat) {
  const side = rushPath.replace(/\.\w+$/, ".words.json");
  if (existsSync(side)) return JSON.parse(readFileSync(side, "utf8"));
  const key = createHash("sha1").update(`${rushPath}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 16);
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
  try {
    // --max-len 1 + --split-on-word : un segment par mot, avec ses temps.
    await run(cfg.whisper.bin, ["-m", cfg.whisper.model, "-l", cfg.whisper.language, "-f", wav, "-ml", "1", "-sow", "-oj", "-of", outBase,
      ...(cfg.whisper.prompt ? ["--prompt", cfg.whisper.prompt] : [])]);
  } finally { rmSync(wav, { force: true }); }
  const j = JSON.parse(readFileSync(`${outBase}.json`, "utf8"));
  rmSync(`${outBase}.json`, { force: true });
  const words = [];
  for (const s of j.transcription || []) {
    const w = (s.text || "").trim();
    if (!w || /^\[.*\]$/.test(w)) continue;
    const t0 = s.offsets.from / 1000, t1 = s.offsets.to / 1000;
    // whisper colle parfois la ponctuation seule : on la rattache au mot précédent.
    if (/^[.,!?;:…»)]+$/.test(w) && words.length) { words[words.length - 1].w += w; words[words.length - 1].t1 = t1; continue; }
    words.push({ t0: round(t0), t1: round(Math.max(t1, t0 + 0.05)), w });
  }
  writeFileSync(cached, JSON.stringify(words));
  return words;
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
