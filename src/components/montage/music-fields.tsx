"use client";

import { MUSIC_FADE, type MusicCue } from "@/lib/montage";
import { inputClass } from "./look-parts";
import { cn } from "@/lib/utils";

type Value = MusicCue & { track?: string };

/**
 * The music of a video: which file of the Mac's music folder, where it starts in the file, its fades.
 * `tracks`: the files the Mac last reported (none when it has not said yet, or when the folder is empty).
 */
export function MusicFields({ value, onChange, tracks, disabled, auto }: { value: Value; onChange: (patch: Value) => void; tracks?: string[]; disabled?: boolean; auto: string }) {
  const known = tracks ?? [];
  // A name typed earlier, or a file since removed, stays selectable: the Mac falls back and says so.
  const options = value.track && !known.includes(value.track) ? [value.track, ...known] : known;
  const row = "flex items-center gap-2 text-[12px] text-ink-2";
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
      <span className="tabular w-12 text-right font-mono text-[11.5px]">{(value[key] ?? or).toFixed(key === "start" ? 0 : 1)} s</span>
    </label>
  );
  return (
    <div className={cn("flex flex-col gap-2", disabled && "opacity-60")}>
      <label className={row}>
        <span className="w-24 shrink-0">Morceau</span>
        <select aria-label="Morceau" value={value.track ?? ""} disabled={disabled} onChange={(e) => onChange({ track: e.target.value || undefined })} className={cn(inputClass, "h-8 min-w-0 flex-1")}>
          <option value="">{auto}</option>
          {options.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {tracks && !tracks.length && <p className="text-[11.5px] text-warn">Le dossier Musique de ton Mac est vide : ajoute des MP3 ou M4A dans Movies/Metricove/musique.</p>}
      {slider("Début du morceau", "start", 120, 1, 0)}
      {slider("Fondu d'entrée", "fadeIn", MUSIC_FADE.maxIn, 0.1, MUSIC_FADE.in)}
      {slider("Fondu de sortie", "fadeOut", MUSIC_FADE.maxOut, 0.1, MUSIC_FADE.out)}
    </div>
  );
}
