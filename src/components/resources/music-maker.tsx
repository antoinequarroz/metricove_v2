"use client";

import { Loader2, Music, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type AudioOverview, MUSIC_PROMPT_MAX, MUSIC_PROVIDERS, type MusicProvider } from "@/lib/audio-ai";
import { cn } from "@/lib/utils";
import { inputClass } from "../montage/look-parts";
import { Button } from "../ui";

const IDEAS = [
  "lo-fi hip-hop doux, piano feutré et batterie légère, ambiance lecture du soir",
  "électro minimale et énergique, basse ronde, pour une démo tech",
  "cinématique qui monte, cordes et percussions, pour une révélation",
  "acoustique chaleureuse, guitare et claquements de mains, positive",
  "synthwave années 80, rythme moyen, néons",
];
const LENGTHS = [15, 30, 45, 60, 90, 120];

/** Reads Réglages → Voix et musique once per page. */
export function useAudioSettings() {
  const [data, setData] = useState<AudioOverview | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/settings/audio")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setData(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return data;
}

/**
 * "Composer une musique": a description, a length, the provider (ElevenLabs Music or Google Lyria); the server composes
 * it with the key of Réglages and puts it in the library (in the style picked in the filter).
 */
export function MusicMaker({ styleRef, onDone }: { styleRef?: string; onDone: () => void }) {
  const audio = useAudioSettings();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [provider, setProvider] = useState<MusicProvider | "">("");
  const [busy, setBusy] = useState(false);
  const chosen = (provider || audio?.musicProvider || "elevenlabs") as MusicProvider;
  const hasKey = audio ? audio.keys[chosen] : true;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/audio/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, seconds, provider: chosen, styles: styleRef ? [styleRef] : [] }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      toast.success("Musique ajoutée", { description: prompt.slice(0, 80) });
      setPrompt("");
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error("Musique non composée", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2/50 px-3.5 py-2.5">
          <Music className="size-4 shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">Décris l&apos;ambiance : ElevenLabs ou Google Lyria compose une vraie musique, sans voix, et la range ici.</p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Music className="size-3.5" />
            Composer une musique
          </Button>
        </div>
      ) : (
        <form onSubmit={send} className="rise flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/30 p-3.5">
          <div className="flex items-center gap-2">
            <Music className="size-4 text-accent" />
            <p className="min-w-0 flex-1 text-[13px] font-medium">Nouvelle musique</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="press grid size-7 place-items-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
          <textarea
            autoFocus
            aria-label="Description de la musique"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && send(e)}
            rows={2}
            maxLength={MUSIC_PROMPT_MAX}
            placeholder="Par ex. « lo-fi doux, piano et batterie légère, tempo 85, ambiance cosy »"
            className={cn(inputClass, "resize-y py-2 leading-snug")}
          />
          <div className="flex flex-wrap gap-1">
            {IDEAS.map((x) => (
              <button key={x} type="button" onClick={() => setPrompt(x)} className="press rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 hover:text-ink">
                {x}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              Durée
              <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Durée" className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none">
                {LENGTHS.map((n) => (
                  <option key={n} value={n}>
                    {n} s
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2">
              Avec
              <select value={chosen} onChange={(e) => setProvider(e.target.value as MusicProvider)} aria-label="Fournisseur" className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none">
                {MUSIC_PROVIDERS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {audio && !audio.keys[m.id] ? " (pas de clé)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="primary" size="sm" className="ml-auto h-9" disabled={busy || !prompt.trim() || !hasKey}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Music className="size-3.5" />}
              {busy ? "Composition…" : "Composer"}
            </Button>
          </div>
          {busy && <p className="text-[12px] text-ink-3">Compter une à deux minutes. Tu peux rester sur la page.</p>}
          {!hasKey && (
            <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-ink-2">
              Aucune clé {chosen === "elevenlabs" ? "ElevenLabs" : "Google"} pour l&apos;instant :{" "}
              <Link href="/settings#voix-musique" className="underline underline-offset-2">
                ajoute-la dans Réglages
              </Link>
              .
            </p>
          )}
        </form>
      )}
    </div>
  );
}
