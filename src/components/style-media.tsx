"use client";

import Link from "next/link";
import { MAX_MUSIC_STYLE, MUSIC_PROVIDERS, type MusicProvider, type StyleMedia, VOICE_PROVIDERS, type VoiceProvider } from "@/lib/audio-ai";
import { cn } from "@/lib/utils";
import { useVoices, VoicePicker } from "./audio-settings";
import { ClaudeSelects } from "./montage/audio-fields";
import { Switch } from "./montage/controls";
import { Field, inputClass } from "./montage/look-parts";
import { useAudioSettings } from "./resources/music-maker";

const selectClass = "h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-accent/60";

/** Two media choices are the same (the draft of a style against what is saved). */
export const sameMedia = (a?: StyleMedia, b?: StyleMedia) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** Drops the empty fields: `{}` means "everything from Réglages". */
const tidy = (m: StyleMedia): StyleMedia => {
  const out: StyleMedia = {};
  if (m.voice?.voiceId) out.voice = m.voice;
  if (m.voiceOn) out.voiceOn = true;
  if (m.musicProvider) out.musicProvider = m.musicProvider;
  if (m.musicStyle?.trim()) out.musicStyle = m.musicStyle;
  if (m.claudeModel) out.claudeModel = m.claudeModel;
  if (m.claudeEffort) out.claudeEffort = m.claudeEffort;
  return out;
};

/**
 * The voice, the music and the Claude of the videos made with one style (Ressources → Styles). Each field left on
 * "Réglages" takes the choice of Réglages; a video can still change everything.
 */
export function StyleMediaFields({ value, onChange }: { value: StyleMedia | undefined; onChange: (m: StyleMedia) => void }) {
  const audio = useAudioSettings();
  const m = value ?? {};
  const set = (p: Partial<StyleMedia>) => onChange(tidy({ ...m, ...p }));
  const provider: VoiceProvider | "" = m.voice?.provider ?? "";
  const listed = (provider || audio?.voiceProvider || "elevenlabs") as VoiceProvider;
  const hasKey = !!audio?.keys[listed];
  const { voices, error } = useVoices(listed, !!provider && hasKey);
  const voiceDefault = audio?.voiceName || audio?.voiceId;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg-2/40 p-3">
      <div>
        <p className="text-[13px] font-medium">Voix, musique et Claude des vidéos</p>
        <p className="mt-0.5 text-[11.5px] text-ink-3">
          Ce que les vidéos de ce style utilisent quand elles ne précisent rien. « Réglages » reprend le choix de la page{" "}
          <Link href="/settings#voix-musique" className="underline underline-offset-2">
            Réglages
          </Link>
          . Chaque vidéo peut encore tout changer.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <Field label="Voix off">
          <select
            aria-label="Fournisseur de voix du style"
            className={selectClass}
            value={provider}
            onChange={(e) => set({ voice: e.target.value ? { provider: e.target.value as VoiceProvider, voiceId: e.target.value === "google" ? "Kore" : "" } : undefined })}
          >
            <option value="">Réglages{voiceDefault ? ` (${voiceDefault})` : ""}</option>
            {VOICE_PROVIDERS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {audio && !audio.keys[v.id] ? " (pas de clé)" : ""}
              </option>
            ))}
          </select>
        </Field>
        {provider ? (
          <VoicePicker
            provider={provider}
            value={m.voice?.voiceId || undefined}
            voices={voices}
            error={hasKey ? error : undefined}
            unavailable={!hasKey}
            onChange={(v) => set({ voice: v ? { provider, voiceId: v.id, name: v.name } : { provider, voiceId: "" } })}
          />
        ) : (
          <span className="self-end pb-2 text-[12px] text-ink-3">La voix choisie dans Réglages.</span>
        )}
      </div>
      <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
        <Switch on={!!m.voiceOn} onChange={(voiceOn) => set({ voiceOn })} label="Voix off activée d'office" />
        {m.voiceOn ? "Un nouveau Reel animé de ce projet démarre avec la voix off" : "La voix off reste à activer dans chaque Reel animé"}
      </span>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <Field label="Musique composée par">
          <select aria-label="Fournisseur de musique du style" className={selectClass} value={m.musicProvider ?? ""} onChange={(e) => set({ musicProvider: (e.target.value || undefined) as MusicProvider | undefined })}>
            <option value="">Réglages ({MUSIC_PROVIDERS.find((p) => p.id === audio?.musicProvider)?.label ?? "ElevenLabs Music"})</option>
            {MUSIC_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {audio && !audio.keys[p.id] ? " (pas de clé)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Style de musique (facultatif)">
          <input
            aria-label="Style de musique du style"
            value={m.musicStyle ?? ""}
            onChange={(e) => onChange({ ...m, musicStyle: e.target.value })}
            onBlur={() => set({})}
            maxLength={MAX_MUSIC_STYLE}
            placeholder="Par ex. lo-fi chill, piano doux, 85 BPM"
            className={cn(inputClass, "h-9")}
          />
        </Field>
      </div>
      <span className="-mt-1.5 text-[11.5px] text-ink-3">Claude tient compte de ce style quand il écrit la consigne de la musique, et il est ajouté à chaque musique composée pour ce projet.</span>
      <Field label="Modèle et puissance de Claude">
        <ClaudeSelects
          model={m.claudeModel ?? ""}
          effort={m.claudeEffort ?? ""}
          onModel={(claudeModel) => set({ claudeModel: claudeModel || undefined })}
          onEffort={(claudeEffort) => set({ claudeEffort: (claudeEffort || undefined) as StyleMedia["claudeEffort"] })}
          audio={audio}
        />
      </Field>
    </div>
  );
}
