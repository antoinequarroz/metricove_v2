"use client";

import Link from "next/link";
import { useMemo } from "react";
import { type AudioOverview, CLAUDE_EFFORTS, CLAUDE_MODELS, effortLabel, GEN_TRACK, libTrack, libTrackId, modelLabel, VOICE_PROVIDERS, type VoiceProvider } from "@/lib/audio-ai";
import { useLibrary } from "@/lib/use-library";
import { cn } from "@/lib/utils";
import { useVoices, VoicePicker } from "../audio-settings";

const selectClass = "h-8 min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent/60 disabled:opacity-50";

/**
 * Where the music of a video comes from: composed for this video (ElevenLabs Music or Lyria), a music of Ressources →
 * Musique ("lib:<id>"), a file of the Mac's music folder, or "" (the Mac picks in its folder).
 */
export function TrackSelect({
  value,
  onChange,
  tracks,
  audio,
  disabled,
  allowGen = true,
  auto = "Au choix dans le dossier du Mac",
  className,
}: {
  value: string;
  onChange: (track: string) => void;
  tracks?: string[];
  audio: AudioOverview | null;
  disabled?: boolean;
  /** Offer "composed for this video" (the animated reel; the face cam composes from its music panel). */
  allowGen?: boolean;
  auto?: string;
  className?: string;
}) {
  const { items } = useLibrary();
  const music = useMemo(() => (items ?? []).filter((i) => i.kind === "music"), [items]);
  const canGen = !!audio && (audio.keys.elevenlabs || audio.keys.google);
  const provider = audio?.musicProvider === "google" ? "Google Lyria" : "ElevenLabs";
  const folder = [...new Set([...(tracks ?? []), ...(value && value !== GEN_TRACK && !libTrackId(value) ? [value] : [])])];
  const libId = libTrackId(value);
  return (
    <select aria-label="Musique" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(selectClass, className)}>
      {allowGen && (
        <option value={GEN_TRACK} disabled={!canGen && value !== GEN_TRACK}>
          {canGen ? `Composée pour cette vidéo (${provider})` : "Composée pour cette vidéo (ajoute une clé dans Réglages)"}
        </option>
      )}
      <option value="">{auto}</option>
      {(music.length > 0 || libId) && (
        <optgroup label="Ressources → Musique">
          {libId && !music.some((m) => m.id === libId) && <option value={value}>Musique de la bibliothèque</option>}
          {music.map((m) => (
            <option key={m.id} value={libTrack(m.id)}>
              {m.name}
            </option>
          ))}
        </optgroup>
      )}
      {folder.length > 0 && (
        <optgroup label="Dossier Musique du Mac">
          {folder.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/** The Claude model of one video: "" = the one of Réglages (or the Mac's). */
export function ModelSelect({ value, onChange, audio, disabled, className }: { value: string; onChange: (model: string) => void; audio: AudioOverview | null; disabled?: boolean; className?: string }) {
  const known = CLAUDE_MODELS.some((m) => m.id === value);
  const groups = [...new Set(CLAUDE_MODELS.map((m) => m.group))];
  return (
    <select aria-label="Modèle Claude" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(selectClass, className)}>
      <option value="">Par défaut ({audio?.claudeModel ? modelLabel(audio.claudeModel) : "celui du Mac"})</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {CLAUDE_MODELS.filter((m) => m.group === g).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
      {value && !known && <option value={value}>{value}</option>}
    </select>
  );
}

/** The thinking effort of one video (`claude --effort`): "" = the one of Réglages (or Claude Code's). */
export function EffortSelect({ value, onChange, audio, disabled, className }: { value: string; onChange: (effort: string) => void; audio: AudioOverview | null; disabled?: boolean; className?: string }) {
  return (
    <select aria-label="Puissance de Claude" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(selectClass, className)}>
      <option value="">Puissance par défaut ({effortLabel(audio?.claudeEffort)?.toLowerCase() ?? "celle de Claude Code"})</option>
      {CLAUDE_EFFORTS.map((e) => (
        <option key={e.id} value={e.id}>
          Puissance {e.label.toLowerCase()}
        </option>
      ))}
    </select>
  );
}

/** Model and effort side by side (they wrap on a narrow column). */
export function ClaudeSelects({
  model,
  effort,
  onModel,
  onEffort,
  audio,
  disabled,
  className,
}: {
  model: string;
  effort: string;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
  audio: AudioOverview | null;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-wrap gap-2", className)}>
      <ModelSelect value={model} onChange={onModel} audio={audio} disabled={disabled} className="min-w-0 flex-1 basis-40" />
      <EffortSelect value={effort} onChange={onEffort} audio={audio} disabled={disabled} className="min-w-0 flex-1 basis-40" />
    </span>
  );
}

export type VoiceChoice = { on: boolean; provider?: VoiceProvider; voiceId?: string; name?: string };

/** The voice-over of an animated reel: on or off, the provider and the voice (Réglages gives the default). */
export function VoiceOverFields({ value, onChange, audio }: { value: VoiceChoice; onChange: (v: VoiceChoice) => void; audio: AudioOverview | null }) {
  const provider = value.provider ?? audio?.voiceProvider ?? "elevenlabs";
  const hasKey = !!audio?.keys[provider];
  const { voices, error } = useVoices(provider, value.on && hasKey);
  const voiceId = value.voiceId ?? (provider === audio?.voiceProvider ? audio?.voiceId : undefined);
  if (!value.on) return null;
  return (
    <div className="grid gap-2 @min-[520px]:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-ink-2">Fournisseur</span>
        <select className="h-10 min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-accent/60" value={provider} onChange={(e) => onChange({ on: true, provider: e.target.value as VoiceProvider })} aria-label="Fournisseur de voix">
          {VOICE_PROVIDERS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
              {audio && !audio.keys[v.id] ? " (pas de clé)" : ""}
            </option>
          ))}
        </select>
      </label>
      <VoicePicker
        provider={provider}
        value={voiceId}
        voices={voices}
        error={!hasKey ? undefined : error}
        unavailable={!hasKey}
        onChange={(v) => onChange({ on: true, provider, voiceId: v?.id, name: v?.name })}
      />
      {!hasKey && audio && (
        <p className="text-[11.5px] text-warn @min-[520px]:col-span-2">
          Aucune clé {provider === "elevenlabs" ? "ElevenLabs" : "Google"} :{" "}
          <Link href="/settings#voix-musique" className="underline underline-offset-2">
            ajoute-la dans Réglages
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/** The voice a request sends, or undefined (off, or no voice chosen). */
export function voiceOfChoice(v: VoiceChoice, audio: AudioOverview | null) {
  if (!v.on) return undefined;
  const provider = v.provider ?? audio?.voiceProvider ?? "elevenlabs";
  const voiceId = v.voiceId ?? (provider === audio?.voiceProvider ? audio?.voiceId : undefined) ?? (provider === "google" ? "Kore" : undefined);
  const name = v.name ?? (voiceId === audio?.voiceId ? audio?.voiceName : undefined);
  return voiceId ? { provider, voiceId, ...(name ? { name } : {}) } : undefined;
}
