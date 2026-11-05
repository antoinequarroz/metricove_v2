// Son du montage : repérage des silences (ffmpeg silencedetect), débruitage de la voix (DeepFilterNet si le binaire
// deep-filter est installé, sinon ffmpeg afftdn), musique de fond qui baisse sous la voix (sidechaincompress),
// puis loudnorm à −14 LUFS (deux passes en final, une passe en aperçu).
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { run, ensureDir, home, log, round } from "./util.mjs";

const MUSIC_EXT = /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|opus)$/i;

/** Silences d'un fichier : [[début, fin]] en secondes. Mis en cache (chemin + taille + date). */
export async function detectSilences(cfg, file) {
  const st = statSync(file);
  const db = cfg.silenceDb ?? -35;
  const key = createHash("sha1").update(`${file}|${st.size}|${st.mtimeMs}|${db}`).digest("hex").slice(0, 16);
  const cached = join(ensureDir(join(cfg.workDir, "transcriptions")), `${key}.silences.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const err = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=noise=${db}dB:d=0.12`, "-f", "null", "-"], { stderr: true });
  const out = [];
  let a = null;
  for (const m of err.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === "start") a = Math.max(0, Number(m[2]));
    else if (a != null) { out.push([round(a), round(Number(m[2]))]); a = null; }
  }
  if (a != null) out.push([round(a), 1e6]);
  writeFileSync(cached, JSON.stringify(out));
  return out;
}

export const musicDir = (cfg) => ensureDir(home(cfg.musicDir || "~/Movies/Metricove/musique"));
export const listTracks = (cfg) => readdirSync(musicDir(cfg)).filter((f) => MUSIC_EXT.test(f) && !f.startsWith(".")).sort((a, b) => a.localeCompare(b, "fr"));

/** Fichier de musique : par nom (exact, puis approchant), sinon le premier du dossier ; null si le dossier est vide. */
export function pickTrack(cfg, name, notes) {
  const dir = musicDir(cfg);
  const list = listTracks(cfg);
  if (!list.length) { notes.push(`Musique demandée mais le dossier ${dir} est vide : vidéo sans musique. Ajoutez-y des MP3 ou M4A.`); return null; }
  if (name) {
    const n = name.toLowerCase();
    const bare = (f) => basename(f, extname(f)).toLowerCase();
    const f = list.find((x) => x.toLowerCase() === n) || list.find((x) => bare(x) === bare(n)) || list.find((x) => x.toLowerCase().includes(bare(n)));
    if (f) return join(dir, f);
    notes.push(`Morceau « ${name} » introuvable dans ${dir} : « ${list[0]} » à la place.`);
  }
  return join(dir, list[0]);
}

/** Débruitage de la voix (wav 48 kHz) ; renvoie le fichier débruité. */
async function denoise(cfg, wav, dir) {
  const bin = home(cfg.deepFilter || "~/Movies/Metricove/outils/deep-filter");
  if (existsSync(bin)) {
    try {
      const od = ensureDir(join(dir, "df"));
      await run(bin, ["-o", od, wav]);
      const f = join(od, basename(wav));
      if (existsSync(f)) return { file: f, how: "DeepFilterNet" };
    } catch (e) { log("DeepFilterNet a échoué, débruitage ffmpeg à la place :", e.message.slice(0, 200)); }
  }
  const out = join(dir, "voix-debruitee.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-i", wav, "-af", "highpass=f=70,afftdn=nr=14:nf=-38:tn=1", "-c:a", "pcm_s16le", out]);
  return { file: out, how: "ffmpeg afftdn" };
}

const LN = "I=-14:TP=-1.5:LRA=11";

/** Mesure loudnorm (1re passe) puis paramètres de la 2e passe, linéaire. */
async function loudnorm2(input) {
  const err = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", input, "-af", `loudnorm=${LN}:print_format=json`, "-f", "null", "-"], { stderr: true });
  const m = err.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) return `loudnorm=${LN}`;
  const j = JSON.parse(m[0]);
  if (!Number.isFinite(Number(j.input_i))) return `loudnorm=${LN}`; // piste muette
  return `loudnorm=${LN}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
}

/**
 * Piste son finale (wav 48 kHz stéréo) de la vidéo `base` : voix débruitée, musique, loudnorm.
 * `notes` reçoit ce qu'Antoine doit savoir (musique absente…). Renvoie le chemin du wav.
 */
export async function buildAudio(cfg, { base, dir, audio, final, total, notes }) {
  ensureDir(dir);
  const voice = join(dir, "voix.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-i", base, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", voice]);
  let v = voice;
  if (audio.denoise) {
    const d = await denoise(cfg, voice, dir);
    v = d.file;
    log(`débruitage : ${d.how}`);
  }
  const track = audio.music?.on ? pickTrack(cfg, audio.music.track, notes) : null;
  const mix = join(dir, final ? "mix.wav" : "son.wav");
  const out = join(dir, "son.wav");
  const tail = final ? "" : `,loudnorm=${LN}`; // aperçu : une seule passe
  if (track) {
    const vol = Math.min(1, Math.max(0, Number(audio.music.volume ?? 0.15)));
    const fadeOut = Math.max(0, total - 1.5).toFixed(3);
    const m = `[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},asetpts=N/SR/TB,volume=${vol},afade=t=in:d=0.6,afade=t=out:st=${fadeOut}:d=1.5[m]`;
    // La voix est d'abord mise à niveau pour que la baisse de la musique réagisse pareil d'une vidéo à l'autre.
    const vo = `[0:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo`;
    const fc = audio.music.duck !== false
      ? `${m};${vo},asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=400[md];[v][md]amix=inputs=2:duration=first:normalize=0${tail}[o]`
      : `${m};${vo}[v];[v][m]amix=inputs=2:duration=first:normalize=0${tail}[o]`;
    await run("ffmpeg", ["-v", "error", "-y", "-i", v, "-stream_loop", "-1", "-i", track, "-filter_complex", fc, "-map", "[o]", "-ar", "48000", "-c:a", "pcm_s16le", mix]);
    log(`musique : ${basename(track)} (volume ${vol}${audio.music.duck !== false ? ", baisse sous la voix" : ""})`);
  } else {
    await run("ffmpeg", ["-v", "error", "-y", "-i", v, "-af", `aresample=48000,aformat=channel_layouts=stereo${tail}`, "-ar", "48000", "-c:a", "pcm_s16le", mix]);
  }
  if (final) {
    await run("ffmpeg", ["-v", "error", "-y", "-i", mix, "-af", await loudnorm2(mix), "-ar", "48000", "-c:a", "pcm_s16le", out]);
  }
  return out;
}
