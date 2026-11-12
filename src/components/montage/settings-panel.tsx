"use client";

import { Clapperboard, Crop, Megaphone, Music, MonitorSmartphone } from "lucide-react";
import { DEFAULT_AUDIO, FORMATS, type AudioSettings, type Edl } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Row, Section, Segmented, Switch } from "./controls";
import { MusicFields } from "./music-fields";

/** Hook, end card, sound, extra formats and framing of a version. */
export function SettingsPanel({ edl, onChange, tracks }: { edl: Edl; onChange: (next: Edl) => void; tracks?: string[] }) {
  const set = (patch: Partial<Edl>) => onChange({ ...structuredClone(edl), ...patch });
  const audio = edl.audio ?? DEFAULT_AUDIO;
  const setAudio = (patch: Partial<AudioSettings>) => set({ audio: { ...audio, ...patch } });
  const setMusic = (patch: Partial<AudioSettings["music"]>) => setAudio({ music: { ...audio.music, ...patch } });
  const hooks = [...new Set([...(edl.hooks ?? []), ...(edl.title?.text ? [edl.title.text] : [])])];
  const exports = edl.exports ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Section title="Accroche et fin" icon={<Megaphone className="size-3.5 text-accent" />}>
        {hooks.length > 1 && (
          <div className="py-2">
            <p className="mb-1.5 text-[12.5px] font-medium">Accroches proposées par Claude</p>
            <div className="flex flex-col gap-1">
              {hooks.map((h) => {
                const on = edl.title?.text === h;
                return (
                  <button
                    key={h}
                    onClick={() => set({ title: { text: h, until: edl.title?.until ?? 3 } })}
                    className={cn("press rounded-lg border px-2.5 py-1.5 text-left text-[13px]", on ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-2")}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <Field
          label="Accroche à l'écran"
          hint="Les 2 premières secondes"
          value={edl.title?.text ?? ""}
          onChange={(t) => set({ title: t ? { text: t, until: edl.title?.until ?? 3 } : null })}
        />
        <Field label="Carton de fin" hint="L'appel à l'action" value={edl.endCard?.text ?? ""} onChange={(t) => set({ endCard: t ? { text: t } : null })} />
      </Section>

      <Section title="Son" icon={<Music className="size-3.5 text-accent" />}>
        <Row label="Enlever le bruit de fond" hint="Voix nettoyée, volume réglé pour les réseaux">
          <Switch on={audio.denoise} onChange={(denoise) => setAudio({ denoise })} label="Enlever le bruit de fond" />
        </Row>
        <Row label="Silences">
          <Segmented
            label="Silences"
            value={audio.silences}
            onChange={(silences) => setAudio({ silences })}
            options={[
              { value: "keep", label: "Garder" },
              { value: "tight", label: "Raccourcir" },
              { value: "cut", label: "Couper" },
            ]}
          />
        </Row>
        <Row label="Musique de fond" hint="Elle baisse quand tu parles">
          <Switch on={audio.music.on} onChange={(on) => setMusic({ on })} label="Musique de fond" />
        </Row>
        {audio.music.on && (
          <>
            <div className="py-2">
              <MusicFields value={audio.music} onChange={setMusic} tracks={tracks} auto="Claude choisit" />
            </div>
            <Row label="Volume de la musique">
              <input
                type="range"
                min={0.02}
                max={0.6}
                step={0.01}
                value={audio.music.volume}
                onChange={(e) => setMusic({ volume: Number(e.target.value) })}
                aria-label="Volume de la musique"
                className="w-32 accent-[var(--accent)]"
              />
              <span className="tabular w-9 text-right font-mono text-[12px] text-ink-3">{Math.round(audio.music.volume * 100)}%</span>
            </Row>
            <Row label="Baisser sous la voix">
              <Switch on={audio.music.duck} onChange={(duck) => setMusic({ duck })} label="Baisser sous la voix" />
            </Row>
          </>
        )}
      </Section>

      <Section title="B-roll" icon={<Clapperboard className="size-3.5 text-accent" />}>
        <Row label="Images d'illustration automatiques" hint="Tes plans du dossier B-roll d'abord, sinon Pexels">
          <Switch on={edl.brollAuto ?? true} onChange={(brollAuto) => set({ brollAuto })} label="B-roll automatique" />
        </Row>
        <p className="py-2 text-[11.5px] text-ink-3">
          {edl.broll?.length ? `${edl.broll.length} plan${edl.broll.length > 1 ? "s" : ""} dans la timeline.` : "Aucun plan pour l'instant."} Ajoute, déplace ou change un plan
          dans la piste B-roll de la timeline.
        </p>
      </Section>

      <Section title="Autres formats au rendu final" icon={<MonitorSmartphone className="size-3.5 text-accent" />}>
        <div className="flex flex-wrap gap-1.5 py-2">
          {FORMATS.map((f) => {
            const main = f.value === edl.format;
            const on = main || exports.includes(f.value);
            return (
              <button
                key={f.value}
                disabled={main}
                onClick={() => set({ exports: on ? exports.filter((x) => x !== f.value) : [...exports, f.value] })}
                className={cn("press rounded-lg border px-2.5 py-1.5 text-left text-[12px]", on ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-2", main && "opacity-70")}
              >
                <span className="font-medium">{f.label}</span> <span className="text-ink-3">{main ? "· principal" : f.hint}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Cadrage" icon={<Crop className="size-3.5 text-accent" />}>
        <Row label="Recadrage" hint="Suivre le visage ou garder le centre">
          <Segmented
            label="Recadrage"
            value={edl.crop ?? "face"}
            onChange={(crop) => set({ crop })}
            options={[
              { value: "face", label: "Visage" },
              { value: "center", label: "Centre" },
            ]}
          />
        </Row>
      </Section>
    </div>
  );
}

function Field({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 py-2">
      <span className="text-[12.5px] font-medium">
        {label} {hint && <span className="font-normal text-ink-3">· {hint}</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Aucun"
        maxLength={200}
        className="h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent/60"
      />
    </label>
  );
}
