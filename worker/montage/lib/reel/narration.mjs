// Voix off et musique composée du reel vidéo (worker 0.19.0 ; style et fournisseur du projet : 0.21.0).
// - Voix off : Metricove lit la phrase `say` de chaque temps fort (ElevenLabs ou Google, clés sur le serveur) ; les
//   fichiers sont gardés en cache sur le Mac (même voix + même phrase = pas de nouvel appel) ; chaque temps fort dure
//   au moins le temps de sa phrase (fixed) ; au mixage chaque phrase part 0,15 s après le début de son temps fort.
// - Musique composée : Claude écrit la consigne (champ `music` de la partition) ; Metricove la fait composer à la
//   durée de la vidéo et la range dans Ressources → Musique ; le plan garde « lib:<id> » (une retouche la réutilise).
import { existsSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { run, ensureDir, home, log } from "../util.mjs";
import { minSeconds, quantize, onGrid, FPB, FPB_RANGE, VIDEO } from "./vocab.mjs";
import { sigFloor } from "./score.mjs";

/** Décalage de la phrase après le début du temps fort, et marge laissée après elle (secondes). */
export const VOICE_LEAD = 0.15;
export const VOICE_TAIL = 0.45;
/** Au-delà de 10 s de temps fort, une phrase trop longue est accélérée jusqu'à ×1,2, sinon coupée (avec une note). */
const MAX_TEMPO = 1.2;

/** La voix off demandée : { provider, voiceId } valides, sinon null. */
export function voiceOfJob(job) {
  const v = job?.motion?.voice;
  return v && (v.provider === "elevenlabs" || v.provider === "google") && /^[A-Za-z0-9_-]{1,100}$/.test(String(v.voiceId || "")) ? { provider: v.provider, voiceId: v.voiceId } : null;
}

const cacheDir = (cfg) => ensureDir(home(cfg.voiceCache || "~/Movies/Metricove/voix-cache"));

/** Durée d'un fichier son (ffprobe), en secondes. */
export async function audioSeconds(file, signal) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 20_000, signal });
  const d = Number(String(out).trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("son illisible");
  return d;
}

/** Le cache garde ~200 Mo (les plus anciens partent). */
function trim(dir, cap = 200 * 1024 * 1024) {
  const files = readdirSync(dir).map((n) => join(dir, n)).filter((p) => statSync(p).isFile()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  let total = 0;
  files.forEach((p, i) => { total += statSync(p).size; if (i > 0 && total > cap) rmSync(p, { force: true }); });
}

/**
 * Lit les phrases des temps forts gardés. Renvoie Map(id → { file, dur }). Une phrase qui échoue est sautée avec une
 * note ; si aucune ne passe (clé absente, crédits épuisés…), la vidéo sort sans voix, avec la raison.
 */
export async function speakBeats(cfg, api, video, voice, { signal, notes = [] } = {}) {
  const clips = new Map();
  if (!voice || !api) return clips;
  const dir = cacheDir(cfg);
  const kept = (video.beats || []).filter((b) => !b.cut && b.say);
  let firstError = "";
  for (const b of kept) {
    const key = createHash("sha1").update(`${voice.provider}|${voice.voiceId}|${b.say}`).digest("hex").slice(0, 20);
    const have = readdirSync(dir).find((n) => n.startsWith(`${key}.`));
    let file = have ? join(dir, have) : "";
    try {
      if (!file) {
        const a = await api.tts({ ...voice, text: b.say }, { signal });
        file = join(dir, `${key}.${a.ext}`);
        writeFileSync(file, a.bytes);
      }
      clips.set(b.id, { file, dur: await audioSeconds(file, signal) });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (file && !have) rmSync(file, { force: true });
      firstError ||= String(e.message || e).slice(0, 240);
      log(`voix off « ${b.id} » : ${e.message}`);
    }
  }
  if (kept.length && !clips.size) notes.push(`Voix off impossible (${firstError || "erreur inconnue"}) : la vidéo sort sans voix.`);
  else if (clips.size < kept.length) notes.push(`${kept.length - clips.size} phrase(s) de la voix off n'ont pas pu être lues (${firstError}).`);
  else if (!kept.length) notes.push("Voix off demandée mais Claude n'a écrit aucune phrase à dire.");
  trim(dir);
  return clips;
}

/**
 * Chaque temps fort avec une phrase dure au moins phrase + marges (fixed, pour que la mise à l'échelle et la relecture
 * ne le raccourcissent plus), et au moins son temps de lecture ; 10 s au plus. Engine 2 : au moins le plancher de sa
 * scène aussi (sigFloor), que cleanScore n'applique plus à un temps fort fixé.
 */
export function fitVoice(plan, clips) {
  if (!clips?.size) return plan;
  const pace = plan.pace || "normal";
  // Engine 2 : la durée va au temps de la grille suivant (fixed arrondit ensuite au plus proche : déjà dessus).
  const sig = Number(plan.video.engine) === 2;
  const fpb = sig ? (Number.isInteger(plan.video.fpb) && plan.video.fpb >= FPB_RANGE[0] && plan.video.fpb <= FPB_RANGE[1] ? plan.video.fpb : FPB[pace] || FPB.normal) : 0;
  const beats = plan.video.beats.map((b) => {
    const c = clips.get(b.id);
    if (!c || b.cut) return b;
    const raw = quantize(Math.min(VIDEO.seconds[1], Math.max(Number(b.seconds) || 0, minSeconds(b, pace, plan.video.engine), sig ? sigFloor(b, fpb) : 0, c.dur + VOICE_LEAD + VOICE_TAIL)));
    const want = fpb ? onGrid(raw, fpb) : raw;
    return { ...b, seconds: want, fixed: true };
  });
  return { ...plan, video: { ...plan.video, beats } };
}

/**
 * La voix off en filtres ffmpeg : chaque phrase posée VOICE_LEAD après le début de son temps fort (accélérée jusqu'à
 * ×1,2 si elle déborde, sinon coupée avec une note), toutes mixées en `[vo]`, coupé à `duration`. Les entrées sont
 * numérotées à partir de `first`. Renvoie { inputs, filters, count } (count = 0 : aucune phrase posée).
 */
export function voiceGraph({ clips, marks, duration, notes = [], first = 0 }) {
  const placed = (marks || []).filter((m) => clips?.has(m.id));
  const inputs = [];
  const filters = [];
  placed.forEach((m, i) => {
    const c = clips.get(m.id);
    const room = Math.max(0.5, m.end - m.start - VOICE_LEAD - 0.1);
    let tempo = 1;
    if (c.dur > room) {
      tempo = Math.min(MAX_TEMPO, c.dur / room);
      if (c.dur / tempo > room + 0.05) notes.push(`La phrase du temps fort « ${m.title || m.id} » est trop longue pour lui : sa fin est coupée. Raccourcis-la.`);
    }
    inputs.push("-i", c.file);
    const delay = Math.round((m.start + VOICE_LEAD) * 1000);
    filters.push(`[${first + i}:a]aresample=48000,aformat=channel_layouts=stereo${tempo > 1.001 ? `,atempo=${tempo.toFixed(3)}` : ""},atrim=0:${room.toFixed(3)},adelay=${delay}|${delay},apad[v${i}]`);
  });
  if (placed.length) filters.push(`${placed.map((_, i) => `[v${i}]`).join("")}amix=inputs=${placed.length}:duration=longest:normalize=0,atrim=0:${duration.toFixed(3)},asetpts=N/SR/TB[vo]`);
  return { inputs, filters, count: placed.length };
}

/**
 * La piste son du reel (wav 48 kHz stéréo) : phrases posées au début de leur temps fort, musique qui baisse sous la
 * voix, loudnorm −14 LUFS. `marks` : [{ id, start, end }] du moteur ; `track` : fichier de musique ou null.
 */
export async function narrationMix({ clips, marks, track, cue, volume = 0.7, duration, out, notes = [], signal }) {
  const vg = voiceGraph({ clips, marks, duration, notes });
  const inputs = [...vg.inputs];
  const n = vg.count;
  const fc = [...vg.filters];
  const LN = "loudnorm=I=-14:TP=-1.5:LRA=11";
  if (track) {
    inputs.push("-stream_loop", "-1", ...cue.seek, "-i", track);
    const vol = Math.min(1, Math.max(0, Number(volume ?? 0.7)));
    // Sous une voix, la musique part plus bas (la moitié du volume choisi) et baisse encore quand la voix parle.
    fc.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${duration.toFixed(3)},asetpts=N/SR/TB,volume=${(vol * 0.5).toFixed(3)}${cue.fades ? `,${cue.fades}` : ""}[m]`);
    fc.push(`[vo]asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=350[md];[v][md]amix=inputs=2:duration=first:normalize=0,${LN}[o]`);
  } else {
    fc.push(`[vo]${LN}[o]`);
  }
  await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", fc.join(";"), "-map", "[o]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-t", duration.toFixed(3), out], { timeoutMs: 180_000, signal });
  return out;
}

/** La consigne de musique quand Claude n'en a pas écrit : le ton et le rythme de la vidéo (`bpm` : celui de la grille Signature). */
export function fallbackMusicPrompt(plan, bpm) {
  const pace = bpm ? `${plan.pace === "calm" ? "warm" : "energetic"}, ${bpm} BPM` : plan.pace === "fast" ? "upbeat, 120 BPM" : plan.pace === "calm" ? "calm, 80 BPM" : "mid-tempo, 100 BPM";
  return `Modern instrumental background music for a short vertical social video, ${pace}, clean production, light percussion, warm synths, builds gently and ends cleanly. No vocals.`;
}

/** Secondes composées en plus de la vidéo pour un reel Signature : le départ est choisi dans cette marge. */
export const SIG_MUSIC_SLACK = 6;

/**
 * Fait composer la musique de la vidéo (plan.track === "gen") et renvoie le plan avec track = « lib:<id> ». Une panne
 * laisse la vidéo sans musique (track vidé) avec la raison dans les notes. `tempo` ({ bpm, drop }, reel Signature) :
 * la musique est demandée au tempo de la grille, avec sa montée SIG_MUSIC_SLACK / 2 s après le moment fort et
 * SIG_MUSIC_SLACK s de plus que la vidéo : le mixage (sig-mix.mjs) choisit son départ dans cette marge pour poser
 * la montée sur le moment fort, quelle que soit la précision du compositeur.
 */
export async function composeForVideo(api, plan, duration, { signal, notes = [], music, tempo } = {}) {
  if (plan.track !== "gen" || !plan.music) return plan;
  const bpm = tempo && Number(tempo.bpm) > 0 ? Math.round(Number(tempo.bpm)) : 0;
  const drop = bpm && Number.isFinite(Number(tempo.drop)) && Number(tempo.drop) >= 0 ? Number(tempo.drop) : null;
  const beat = bpm ? `Tempo exactly ${bpm} BPM, steady 4/4 pulse, crisp transients.${drop !== null ? ` Build up, then a clear drop at ${Math.round(drop + SIG_MUSIC_SLACK / 2)} seconds.` : ""} Full energy from the first second.` : "";
  // Le style de musique du projet (Ressources → Styles) s'ajoute à la consigne de Claude, 600 caractères au plus.
  const style = String(music?.style || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const base = String(plan.musicPrompt || "").trim() || fallbackMusicPrompt(plan, bpm);
  const room = 590 - (style ? style.length + 9 : 0) - (beat ? beat.length + 1 : 0);
  const prompt = [base.slice(0, Math.max(80, room)), beat, style ? `Style: ${style}.` : ""].filter(Boolean).join(" ").slice(0, 600);
  const provider = music?.provider === "google" || music?.provider === "elevenlabs" ? music.provider : undefined;
  const seconds = bpm ? Math.ceil(duration + SIG_MUSIC_SLACK) : Math.ceil(duration) + 1;
  try {
    log(`musique composée pour la vidéo (${seconds} s) : ${prompt.slice(0, 160)}`);
    const item = await api.composeMusic({ prompt, provider, seconds, name: `Reel · ${String(plan.video?.title || "musique").slice(0, 60)}`, tags: ["reel"] }, { signal });
    notes.push(`Musique composée pour cette vidéo, rangée dans Ressources → Musique (« ${prompt.slice(0, 140)}${prompt.length > 140 ? "…" : ""} »).`);
    const { musicPrompt: _p, ...rest } = plan;
    void _p;
    return { ...rest, track: `lib:${item.id}` };
  } catch (e) {
    if (signal?.aborted) throw e;
    log("musique composée :", e.message);
    notes.push(`La musique n'a pas pu être composée (${String(e.message).replace(/^POST \S+ → \d+ /, "").slice(0, 200)}) : la vidéo sort sans musique.`);
    const { musicPrompt: _p, ...rest } = plan;
    void _p;
    return { ...rest, track: "", music: false };
  }
}

export const hasFile = (f) => !!f && existsSync(f);
