import "server-only";
// Voices and music from outside providers (ElevenLabs, Google Gemini / Lyria). The keys live on the server only: the
// Mac and the pages ask the server, which calls the provider. Nothing here is ever sent back with a key in it.
import {
  type AudioOverview,
  type AudioPrefs,
  cleanEffort,
  cleanModel,
  DEFAULT_AUDIO_PREFS,
  GOOGLE_VOICES,
  MUSIC_PROMPT_MAX,
  MUSIC_PROVIDERS,
  MUSIC_SECONDS,
  type MusicProvider,
  TTS_MAX,
  type Voice,
  VOICE_PROVIDERS,
  type VoiceProvider,
} from "@/lib/audio-ai";
import { getSetting, setSetting } from "./db";

type Keys = { elevenlabs?: string; google?: string };
const KEYS = "audioKeys";
const PREFS = "audioPrefs";

const ENV: Record<keyof Keys, string | undefined> = {
  elevenlabs: process.env.ELEVENLABS_API_KEY,
  google: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
};

const stored = () => getSetting<Keys>(KEYS) ?? {};
export const audioKey = (p: keyof Keys) => stored()[p] || ENV[p]?.trim() || "";

export function audioPrefs(): AudioPrefs {
  const p = getSetting<Partial<AudioPrefs>>(PREFS) ?? {};
  return {
    voiceProvider: VOICE_PROVIDERS.some((v) => v.id === p.voiceProvider) ? p.voiceProvider! : DEFAULT_AUDIO_PREFS.voiceProvider,
    ...(typeof p.voiceId === "string" && p.voiceId ? { voiceId: p.voiceId.slice(0, 100) } : {}),
    ...(typeof p.voiceName === "string" && p.voiceName ? { voiceName: p.voiceName.slice(0, 100) } : {}),
    musicProvider: MUSIC_PROVIDERS.some((m) => m.id === p.musicProvider) ? p.musicProvider! : DEFAULT_AUDIO_PREFS.musicProvider,
    claudeModel: cleanModel(p.claudeModel),
    claudeEffort: cleanEffort(p.claudeEffort),
  };
}

export function audioOverview(): AudioOverview {
  const s = stored();
  return {
    ...audioPrefs(),
    keys: { elevenlabs: !!audioKey("elevenlabs"), google: !!audioKey("google") },
    fromEnv: { elevenlabs: !s.elevenlabs && !!ENV.elevenlabs, google: !s.google && !!ENV.google },
  };
}

/** Saves the choices of Réglages; a field left out keeps its value. */
export function setAudioPrefs(raw: Record<string, unknown>): AudioPrefs | string {
  const cur = audioPrefs();
  const next: AudioPrefs = { ...cur };
  if (raw.voiceProvider !== undefined) {
    if (!VOICE_PROVIDERS.some((v) => v.id === raw.voiceProvider)) return "Fournisseur de voix inconnu";
    if (raw.voiceProvider !== cur.voiceProvider) {
      delete next.voiceId;
      delete next.voiceName;
    }
    next.voiceProvider = raw.voiceProvider as VoiceProvider;
  }
  if (raw.voiceId !== undefined) {
    const id = typeof raw.voiceId === "string" ? raw.voiceId.trim().slice(0, 100) : "";
    if (id && !/^[A-Za-z0-9_-]+$/.test(id)) return "Voix inconnue";
    if (id) next.voiceId = id;
    else delete next.voiceId;
    const name = typeof raw.voiceName === "string" ? raw.voiceName.replace(/[\0-\x1f]/g, "").trim().slice(0, 100) : "";
    if (id && name) next.voiceName = name;
    else delete next.voiceName;
  }
  if (raw.musicProvider !== undefined) {
    if (!MUSIC_PROVIDERS.some((m) => m.id === raw.musicProvider)) return "Fournisseur de musique inconnu";
    next.musicProvider = raw.musicProvider as MusicProvider;
  }
  if (raw.claudeModel !== undefined) {
    const m = cleanModel(raw.claudeModel);
    if (raw.claudeModel && !m) return "Nom de modèle invalide (par exemple opus, sonnet ou claude-opus-5-5)";
    next.claudeModel = m;
  }
  if (raw.claudeEffort !== undefined) {
    const e = cleanEffort(raw.claudeEffort);
    if (raw.claudeEffort && !e) return "Puissance inconnue";
    next.claudeEffort = e;
  }
  setSetting(PREFS, next);
  return next;
}

export class AudioError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const providerName = (p: keyof Keys) => (p === "elevenlabs" ? "ElevenLabs" : "Google");
const need = (p: keyof Keys) => {
  const k = audioKey(p);
  if (!k) throw new AudioError(`Aucune clé ${providerName(p)} : ajoute-la dans Réglages → Voix et musique.`, 409);
  return k;
};

/** The error of a provider, in French, without echoing anything that could hold the key. */
async function fail(p: keyof Keys, r: Response): Promise<never> {
  let detail = "";
  try {
    const j = (await r.json()) as { detail?: { message?: string; status?: string } | string | { msg?: string }[]; error?: { message?: string } };
    const d = j.detail;
    detail = typeof d === "string" ? d : Array.isArray(d) ? String(d[0]?.msg ?? "") : (d?.message ?? d?.status ?? j.error?.message ?? "");
  } catch {
    /* not JSON */
  }
  detail = detail.replace(/\s+/g, " ").slice(0, 240);
  if (r.status === 401 || r.status === 403) throw new AudioError(`${providerName(p)} refuse la clé${detail ? ` (${detail})` : ""}.`, 502);
  if (r.status === 429) throw new AudioError(`${providerName(p)} : limite ou crédits épuisés${detail ? ` (${detail})` : ""}.`, 502);
  throw new AudioError(`${providerName(p)} : erreur ${r.status}${detail ? ` (${detail})` : ""}.`, 502);
}

/** Checks a key before it is saved: true when the provider accepts it. */
export async function checkKey(p: keyof Keys, key: string): Promise<boolean | undefined> {
  try {
    const r =
      p === "elevenlabs"
        ? await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(10_000) })
        : await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(10_000) });
    if (r.status === 401 || r.status === 403 || r.status === 400) return false;
    return r.ok ? true : undefined;
  } catch {
    return undefined; // network: saved anyway, the first real call will tell
  }
}

export function setAudioKey(p: keyof Keys, key: string) {
  const s = { ...stored() };
  if (key) s[p] = key;
  else delete s[p];
  setSetting(KEYS, s);
}

let voiceCache: { at: number; key: string; list: Voice[] } | undefined;

/** The voices a provider offers (ElevenLabs: the account's voices, cached 10 min; Google: the 30 prebuilt ones). */
export async function listVoices(p: VoiceProvider): Promise<Voice[]> {
  if (p === "google") return GOOGLE_VOICES.map((v) => ({ id: v, name: v }));
  const key = need("elevenlabs");
  if (voiceCache && voiceCache.key === key && Date.now() - voiceCache.at < 600_000) return voiceCache.list;
  const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) await fail("elevenlabs", r);
  const j = (await r.json()) as { voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string }[] };
  const list = (j.voices ?? []).slice(0, 200).map((v) => ({
    id: String(v.voice_id).slice(0, 100),
    name: String(v.name || v.voice_id).slice(0, 100),
    detail: [v.labels?.gender, v.labels?.accent, v.labels?.age, v.category === "cloned" ? "ta voix clonée" : ""].filter(Boolean).join(" · ").slice(0, 120) || undefined,
    preview: typeof v.preview_url === "string" && v.preview_url.startsWith("https://") ? v.preview_url : undefined,
  }));
  voiceCache = { at: Date.now(), key, list };
  return list;
}

export type Audio = { bytes: Buffer; type: string; ext: string };

/** A 16-bit PCM buffer wrapped in a WAV header. */
function wav(pcm: Buffer, rate = 24000, channels = 1) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Audio bytes from Gemini's inlineData (WAV, MP3 or raw PCM "audio/L16;rate=24000"). */
function fromInline(data: string, mime = ""): Audio {
  const bytes = Buffer.from(data, "base64");
  const m = mime.toLowerCase();
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF") return { bytes, type: "audio/wav", ext: "wav" };
  if (m.includes("mpeg") || m.includes("mp3") || bytes.subarray(0, 3).toString("latin1") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { bytes, type: "audio/mpeg", ext: "mp3" };
  const rate = Number(/rate=(\d+)/.exec(m)?.[1]) || 24000;
  return { bytes: wav(bytes, rate), type: "audio/wav", ext: "wav" };
}

type GeminiPart = { text?: string; inlineData?: { data?: string; mimeType?: string } };
const audioPart = (j: { candidates?: { content?: { parts?: GeminiPart[] } }[] }) => (j.candidates?.[0]?.content?.parts ?? []).find((x) => x.inlineData?.data);

/** Google models tried in order (a newer name first, then an older one the API may still serve). */
const GEMINI_TTS = (process.env.GEMINI_TTS_MODELS || "gemini-3.8-flash-tts,gemini-2.5-flash-preview-tts").split(",").map((s) => s.trim()).filter(Boolean);
const LYRIA = (process.env.LYRIA_MODELS || "lyria-3.5,lyria-3-clip-preview").split(",").map((s) => s.trim()).filter(Boolean);

async function gemini(model: string, body: unknown, key: string, timeout: number) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
}

/** Reads `text` aloud. ElevenLabs: multilingual v2, MP3; Google: Gemini TTS, WAV 24 kHz mono. */
export async function speak(p: VoiceProvider, voiceId: string | undefined, text: string, { style }: { style?: string } = {}): Promise<Audio> {
  const t = text.replace(/\s+/g, " ").trim().slice(0, TTS_MAX);
  if (!t) throw new AudioError("Rien à lire");
  if (p === "elevenlabs") {
    const key = need("elevenlabs");
    const voice = voiceId && /^[A-Za-z0-9_-]{4,100}$/.test(voiceId) ? voiceId : undefined;
    if (!voice) throw new AudioError("Choisis une voix ElevenLabs dans Réglages → Voix et musique.");
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: t, model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2 } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) await fail("elevenlabs", r);
    return { bytes: Buffer.from(await r.arrayBuffer()), type: "audio/mpeg", ext: "mp3" };
  }
  const key = need("google");
  const voice = (GOOGLE_VOICES as readonly string[]).includes(voiceId ?? "") ? voiceId! : "Kore";
  const say = style ? `${style.slice(0, 200)} : ${t}` : t;
  let last: Response | undefined;
  for (const model of GEMINI_TTS) {
    const r = await gemini(model, { contents: [{ parts: [{ text: say }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }, key, 60_000);
    // An unknown model (404) or one this method does not serve (400): the next name.
    if ((r.status === 404 || r.status === 400) && model !== (LYRIA.includes(model) ? LYRIA : GEMINI_TTS).at(-1)) {
      last = r;
      continue;
    }
    if (!r.ok) await fail("google", r);
    const part = audioPart(await r.json());
    if (!part?.inlineData?.data) throw new AudioError("Google n'a pas renvoyé de son.", 502);
    return fromInline(part.inlineData.data, part.inlineData.mimeType);
  }
  return fail("google", last!);
}

/**
 * Composes instrumental music of about `seconds`. ElevenLabs Music takes the exact length; Lyria takes it in the
 * prompt (the Mac cuts and fades it to the video). Returns the audio.
 */
export async function compose(p: MusicProvider, prompt: string, seconds: number): Promise<Audio> {
  const text = prompt.replace(/\s+/g, " ").trim().slice(0, MUSIC_PROMPT_MAX);
  if (!text) throw new AudioError("Décris la musique");
  const s = Math.round(Math.min(MUSIC_SECONDS[1], Math.max(MUSIC_SECONDS[0], seconds || 30)));
  if (p === "elevenlabs") {
    const key = need("elevenlabs");
    const r = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, music_length_ms: s * 1000, force_instrumental: true, ...(process.env.ELEVENLABS_MUSIC_MODEL ? { model_id: process.env.ELEVENLABS_MUSIC_MODEL } : {}) }),
      signal: AbortSignal.timeout(240_000),
    });
    if (!r.ok) await fail("elevenlabs", r);
    return { bytes: Buffer.from(await r.arrayBuffer()), type: "audio/mpeg", ext: "mp3" };
  }
  const key = need("google");
  const ask = `${text}\nInstrumental only, no vocals. Length: about ${s} seconds, with a clean ending.`;
  let last: Response | undefined;
  for (const model of LYRIA) {
    const r = await gemini(model, { contents: [{ parts: [{ text: ask }] }] }, key, 240_000);
    // An unknown model (404) or one this method does not serve (400): the next name.
    if ((r.status === 404 || r.status === 400) && model !== (LYRIA.includes(model) ? LYRIA : GEMINI_TTS).at(-1)) {
      last = r;
      continue;
    }
    if (!r.ok) await fail("google", r);
    const part = audioPart(await r.json());
    if (!part?.inlineData?.data) throw new AudioError("Lyria n'a pas renvoyé de musique.", 502);
    return fromInline(part.inlineData.data, part.inlineData.mimeType);
  }
  return fail("google", last!);
}
