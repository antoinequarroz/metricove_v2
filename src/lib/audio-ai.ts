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
  /** How hard Claude thinks ("" = the default of Claude Code), `claude --effort`. */
  claudeEffort: ClaudeEffort | "";
};

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { voiceProvider: "elevenlabs", musicProvider: "elevenlabs", claudeModel: "", claudeEffort: "" };

/** What the page learns: which keys are set, never the keys. */
export type AudioOverview = AudioPrefs & { keys: { elevenlabs: boolean; google: boolean }; fromEnv: { elevenlabs: boolean; google: boolean } };

/**
 * The Claude models offered for the face cam montage and the animated reel. The value goes to `claude --model` on the
 * Mac: the short names follow the newest model of each family in Claude Code.
 */
export const CLAUDE_MODELS: { id: string; label: string; detail: string; group: string }[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5", detail: "Le plus précis. Le meilleur pour écrire et monter, le plus lent.", group: "Versions précises" },
  { id: "claude-opus-5-5[1m]", label: "Opus 5.5 (1M de contexte)", detail: "Opus 5.5 avec une mémoire d'un million de jetons, pour les longs rushes.", group: "Versions précises" },
  { id: "claude-opus-5", label: "Opus 5", detail: "La version Opus d'avant.", group: "Versions précises" },
  { id: "claude-opus-4-8", label: "Opus 4.8", detail: "L'ancienne génération Opus.", group: "Versions précises" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", detail: "Bon équilibre entre qualité et vitesse.", group: "Versions précises" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", detail: "Rapide et léger, pour les essais.", group: "Versions précises" },
  { id: "claude-fable-5-2", label: "Fable 5.2", detail: "Le modèle Fable de la famille Claude 5.", group: "Versions précises" },
  { id: "opus", label: "Opus, toujours le dernier", detail: "Suit la version Opus la plus récente de Claude Code.", group: "Toujours le dernier" },
  { id: "sonnet", label: "Sonnet, toujours le dernier", detail: "Suit la version Sonnet la plus récente.", group: "Toujours le dernier" },
  { id: "haiku", label: "Haiku, toujours le dernier", detail: "Suit la version Haiku la plus récente.", group: "Toujours le dernier" },
];

/** How hard Claude thinks: `claude --effort` (Claude Code 2.1). More effort = better and slower, uses more of the plan. */
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";
export const CLAUDE_EFFORTS: { id: ClaudeEffort; label: string; detail: string }[] = [
  { id: "low", label: "Faible", detail: "Très rapide, réfléchit peu." },
  { id: "medium", label: "Moyenne", detail: "Rapide, pour les retouches simples." },
  { id: "high", label: "Élevée", detail: "Réfléchit bien. Le bon choix pour la plupart des vidéos." },
  { id: "xhigh", label: "Très élevée", detail: "Réfléchit longtemps, pour les montages exigeants." },
  { id: "max", label: "Maximale", detail: "Le plus de réflexion possible, le plus lent." },
];
export const cleanEffort = (v: unknown): ClaudeEffort | "" => (CLAUDE_EFFORTS.some((e) => e.id === v) ? (v as ClaudeEffort) : "");
export const effortLabel = (id?: string) => CLAUDE_EFFORTS.find((e) => e.id === id)?.label;
/** The worker that passes `--effort` to Claude. */
export const EFFORT_WORKER = "0.20.0";

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
