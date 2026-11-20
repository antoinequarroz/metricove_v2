"use client";

import { Loader2, Music } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { libTrack, MUSIC_PROMPT_MAX, type StyleMedia } from "@/lib/audio-ai";
import { MUSIC_FADE, SIG_MUSIC_FADE, type MusicCue } from "@/lib/montage";
import { reloadLibrary } from "@/lib/use-library";
import { cn } from "@/lib/utils";
import { useAudioSettings } from "../resources/music-maker";
import { TrackSelect } from "./audio-fields";
import { inputClass } from "./look-parts";

type Value = MusicCue & { track?: string };

/**
 * The music of a video: a music of Ressources → Musique, a file of the Mac's music folder, or one composed now for
 * this video (ElevenLabs Music or Lyria, `duration` seconds); where it starts in the file, its fades.
 * `tracks`: the files the Mac last reported (none when it has not said yet, or when the folder is empty).
 * `signature`: an engine-2 video. Left at 0, the start is chosen by the Mac (the music's rise lands on the strong
 * moment), and the fades left out are the engine's own (SIG_MUSIC_FADE).
 */
export function MusicFields({
  value,
  onChange,
  tracks,
  disabled,
  auto,
  duration,
  media,
  signature,
}: {
  value: Value;
  onChange: (patch: Value) => void;
  tracks?: string[];
  disabled?: boolean;
  auto: string;
  duration?: number;
  /** The choices of the video's style: its music provider, and its music style to start the description from. */
  media?: StyleMedia;
  signature?: boolean;
}) {
  const audio = useAudioSettings();
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const canCompose = !!audio && (audio.keys.elevenlabs || audio.keys.google);
  const compose = async () => {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    try {
      const seconds = Math.max(10, Math.min(180, Math.ceil((duration ?? 30) + 2)));
      const res = await fetch("/api/audio/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, seconds, ...(media?.musicProvider ? { provider: media.musicProvider } : {}) }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      await reloadLibrary();
      onChange({ track: libTrack(body.item.id), start: 0 });
      toast.success("Musique composée", { description: "Rangée dans Ressources → Musique et choisie pour cette vidéo." });
      setAsking(false);
      setPrompt("");
    } catch (e) {
      toast.error("Musique non composée", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const row = "flex items-center gap-2 text-[12px] text-ink-2";
  /** What a slider shows: « Auto » for an engine-2 start left at 0, two decimals for a fade under 0.1 s (0.02 s). */
  const shown = (key: "start" | "fadeIn" | "fadeOut", v: number) =>
    key === "start" ? (signature && !v ? "Auto" : `${v.toFixed(0)} s`) : `${v.toFixed(v > 0 && v < 0.1 ? 2 : 1)} s`;
  const fade = signature ? SIG_MUSIC_FADE : MUSIC_FADE;
  const slider = (label: string, key: "start" | "fadeIn" | "fadeOut", max: number, step: number, or: number) => (
    <label className={row}>
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value[key] ?? or}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: Number(e.target.value) })}
        aria-label={label}
        className="min-w-0 flex-1 accent-[var(--accent)]"
      />
      <span className="tabular w-12 text-right font-mono text-[11.5px]">{shown(key, value[key] ?? or)}</span>
    </label>
  );
  return (
    <div className={cn("flex flex-col gap-2", disabled && "opacity-60")}>
      <label className={row}>
        <span className="w-24 shrink-0">Morceau</span>
        <TrackSelect value={value.track ?? ""} onChange={(t) => onChange({ track: t || undefined })} tracks={tracks} audio={audio} disabled={disabled} allowGen={false} auto={auto} className="flex-1" />
      </label>
      {!asking ? (
        <button type="button" disabled={disabled || !canCompose} onClick={() => {
            setAsking(true);
            if (!prompt && media?.musicStyle) setPrompt(media.musicStyle);
          }} title={canCompose ? undefined : "Ajoute une clé ElevenLabs ou Google dans Réglages → Voix et musique"} className="press flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-[12px] text-accent hover:bg-accent-soft/50 disabled:text-ink-3 disabled:opacity-60">
          <Music className="size-3.5" /> Composer une musique pour cette vidéo
        </button>
      ) : (
        <div className="flex flex-col gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/30 p-2">
          <textarea autoFocus rows={2} maxLength={MUSIC_PROMPT_MAX} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ambiance, instruments, tempo : « lo-fi doux, piano, 85 BPM »" aria-label="Description de la musique" className={cn(inputClass, "resize-y py-1.5 text-[12.5px] leading-snug")} />
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[11.5px] text-ink-3">{busy ? "Composition, une à deux minutes…" : `${Math.ceil((duration ?? 30) + 2)} s, sans voix, par ${audio?.musicProvider === "google" ? "Google Lyria" : "ElevenLabs"}`}</span>
            <button type="button" onClick={() => setAsking(false)} className="press rounded-md px-2 py-1 text-[12px] text-ink-3 hover:text-ink" disabled={busy}>
              Annuler
            </button>
            <button type="button" onClick={compose} disabled={busy || !prompt.trim()} className="press flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink disabled:opacity-50">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Music className="size-3.5" />} Composer
            </button>
          </div>
        </div>
      )}
      {tracks && !tracks.length && !value.track && <p className="text-[11.5px] text-ink-3">Le dossier Musique de ton Mac est vide : compose une musique ci-dessus, ou choisis-en une dans Ressources → Musique.</p>}
      {slider("Début du morceau", "start", 120, 1, 0)}
      {signature && <p className="text-[11.5px] text-ink-3">À 0, le morceau part au bon endroit pour que sa montée tombe sur le moment fort. Un début choisi à la main annule ce calage (le morceau reste calé sur les temps).</p>}
      {slider("Fondu d'entrée", "fadeIn", MUSIC_FADE.maxIn, 0.1, fade.in)}
      {slider("Fondu de sortie", "fadeOut", MUSIC_FADE.maxOut, 0.1, fade.out)}
    </div>
  );
}
