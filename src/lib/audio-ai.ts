// Voices, music and the Claude model used for the videos: shared by the pages and the server (no "use client").

export type VoiceProvider = "elevenlabs" | "google";
export type MusicProvider = "elevenlabs" | "google";

export const VOICE_PROVIDERS: { id: VoiceProvider; label: string }[] = [
  { id: "elevenlabs", label: "ElevenLabs" },
  { id: "google", label: "Google (Gemini)" },
];
export const MUSIC_PROVIDERS: { id: MusicProvider; label: string; detail: string }[] = [
  { id: "elevenlabs", label: "ElevenLabs Music", detail: "Musique instrumentale à la durée exacte de la vidéo." },
  { id: "google", label: "Google Lyria", detail: "Musique Lyria par la clé Gemini, coupée à la durée de la vidéo." },
];

/** The 30 prebuilt voices of Gemini text-to-speech. */
export const GOOGLE_VOICES = [
  "Kore", "Puck", "Charon", "Zephyr", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina",
  "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

export type Voice = { id: string; name: string; detail?: string; preview?: string };

/** What Réglages → Voix et musique holds (the keys stay on the server). */
export type AudioPrefs = {
  voiceProvider: VoiceProvider;
  /** ElevenLabs voice id, or a Gemini voice name. */
  voiceId?: string;
  voiceName?: string;
  musicProvider: MusicProvider;
  /** The Claude model of the videos ("" = the one set on the Mac). */
  claudeModel: string;
};

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { voiceProvider: "elevenlabs", musicProvider: "elevenlabs", claudeModel: "" };

/** What the page learns: which keys are set, never the keys. */
export type AudioOverview = AudioPrefs & { keys: { elevenlabs: boolean; google: boolean }; fromEnv: { elevenlabs: boolean; google: boolean } };

/**
 * The Claude models offered for the face cam montage and the animated reel. The value goes to `claude --model` on the
 * Mac: the short names follow the newest model of each family in Claude Code.
 */
export const CLAUDE_MODELS: { id: string; label: string; detail: string }[] = [
  { id: "opus", label: "Opus", detail: "Le plus fort, le plus lent et le plus cher en abonnement." },
  { id: "sonnet", label: "Sonnet", detail: "Bon équilibre entre qualité et vitesse." },
  { id: "haiku", label: "Haiku", detail: "Rapide et léger, pour les essais." },
  { id: "claude-fable-5-2", label: "Fable 5.2", detail: "Le modèle Fable de la famille Claude 5." },
];

/** A model name the Mac may pass to `claude --model`: a short name or an id (letters, digits, dots, dashes, [1m]). */
export const cleanModel = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim().slice(0, 60) : "";
  return /^[a-z][a-z0-9.\-]*(\[1m\])?$/i.test(s) ? s : "";
};
export const modelLabel = (id?: string) => (id ? (CLAUDE_MODELS.find((m) => m.id === id)?.label ?? id) : "celui du Mac");

/** Bounds of one voice-over line, one music request. */
export const TTS_MAX = 600;
export const MUSIC_PROMPT_MAX = 600;
export const MUSIC_SECONDS: [number, number] = [5, 180];

/** A music file of the library given as a track: "lib:<id>". "gen" asks the Mac to have one composed for the video. */
export const GEN_TRACK = "gen";
export const libTrack = (id: string) => `lib:${id}`;
export const libTrackId = (track?: string) => (track && /^lib:[a-z0-9]{12}$/.test(track) ? track.slice(4) : undefined);
