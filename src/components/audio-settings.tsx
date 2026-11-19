"use client";

import { Check, Loader2, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type AudioOverview, CLAUDE_MODELS, MUSIC_PROVIDERS, type MusicProvider, type Voice, VOICE_PROVIDERS, type VoiceProvider } from "@/lib/audio-ai";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body as T;
}

const put = (body: unknown) => fetch("/api/settings/audio", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<AudioOverview>(r));

const inputClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";
const selectClass = "h-10 min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-[14px] outline-none focus:border-accent/60";

/** The voices of a provider (ElevenLabs: those of the account). */
export function useVoices(provider: VoiceProvider | undefined, enabled = true) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!provider || !enabled) return;
    let live = true;
    setVoices(null);
    setError("");
    fetch(`/api/audio/voices?provider=${provider}`)
      .then((r) => json<{ voices: Voice[] }>(r))
      .then((r) => live && setVoices(r.voices))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [provider, enabled]);
  return { voices, error };
}

/** Réglages → Voix et musique: ElevenLabs and Google keys, default voice, music provider. */
export function AudioSection({ delay = 0 }: { delay?: number }) {
  const [data, setData] = useState<AudioOverview | null>(null);
  const [failed, setFailed] = useState("");
  const load = useCallback(() => {
    fetch("/api/settings/audio")
      .then((r) => json<AudioOverview>(r))
      .then(setData)
      .catch((e: Error) => setFailed(e.message));
  }, []);
  useEffect(load, [load]);
  const save = async (body: Record<string, unknown>, ok?: string) => {
    try {
      setData(await put(body));
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error("Non enregistré", { description: (e as Error).message });
    }
  };
  const { voices, error: voiceError } = useVoices(data?.voiceProvider, !!data?.keys[data.voiceProvider]);

  return (
    <section id="voix-musique" className="rise scroll-mt-4" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="text-[15px] font-semibold">Voix et musique</h2>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Pour la voix off des reels animés et pour composer de vraies musiques à la durée de chaque vidéo. Les clés restent sur le serveur : ni le Mac ni la page ne les voient.
      </p>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {!data ? (
          <p className="p-4 text-[13px] text-ink-3">{failed ? `Illisible : ${failed}` : "Lecture…"}</p>
        ) : (
          <>
            <KeyRow
              label="ElevenLabs"
              hint={
                <>
                  Voix et musique (Eleven Music). Clé sur{" "}
                  <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    elevenlabs.io
                  </a>
                  , avec les droits Text to Speech, Voices et Music. C&apos;est la même clé que celle de ton Mac (pipeline LivreMatch).
                </>
              }
              on={data.keys.elevenlabs}
              fromEnv={data.fromEnv.elevenlabs}
              onSave={(key) => save({ provider: "elevenlabs", key }, key ? "Clé ElevenLabs enregistrée" : "Clé ElevenLabs retirée")}
            />
            <KeyRow
              label="Google (Gemini)"
              hint={
                <>
                  Voix Gemini et musique Lyria. Clé gratuite sur{" "}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    aistudio.google.com
                  </a>
                  .
                </>
              }
              on={data.keys.google}
              fromEnv={data.fromEnv.google}
              onSave={(key) => save({ provider: "google", key }, key ? "Clé Google enregistrée" : "Clé Google retirée")}
            />
            <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[12.5px] font-medium text-ink-2">Voix off : fournisseur</span>
                <select className={selectClass} value={data.voiceProvider} onChange={(e) => save({ voiceProvider: e.target.value })} aria-label="Fournisseur de voix">
                  {VOICE_PROVIDERS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                      {!data.keys[v.id] ? " (pas de clé)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <VoicePicker
                provider={data.voiceProvider}
                value={data.voiceId}
                voices={voices}
                error={!data.keys[data.voiceProvider] ? "Ajoute d'abord la clé ci-dessus." : voiceError}
                unavailable={!data.keys[data.voiceProvider]}
                onChange={(v) => save({ voiceId: v?.id ?? "", voiceName: v?.name ?? "" }, "Voix enregistrée")}
              />
              <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <span className="text-[12.5px] font-medium text-ink-2">Musique composée avec</span>
                <select className={selectClass} value={data.musicProvider} onChange={(e) => save({ musicProvider: e.target.value as MusicProvider })} aria-label="Fournisseur de musique">
                  {MUSIC_PROVIDERS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {!data.keys[m.id] ? " (pas de clé)" : ""} : {m.detail}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function KeyRow({ label, hint, on, fromEnv, onSave }: { label: string; hint: React.ReactNode; on: boolean; fromEnv: boolean; onSave: (key: string) => Promise<void> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (v: string) => {
    setBusy(true);
    await onSave(v);
    setBusy(false);
    setKey("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) go(key.trim());
      }}
      className="flex flex-col gap-2 border-line p-4 not-first:border-t"
    >
      <div className="flex items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", on ? "bg-ok" : "bg-ink/20")} />
        <span className="text-[13.5px] font-medium">{label}</span>
        <span className="text-[12px] text-ink-3">{fromEnv ? "clé du .env du serveur" : on ? "clé enregistrée" : "aucune clé"}</span>
      </div>
      <p className="text-[12.5px] text-ink-3">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="password" autoComplete="off" maxLength={300} value={key} onChange={(e) => setKey(e.target.value)} placeholder={on ? "Nouvelle clé pour remplacer l'actuelle" : `Colle ta clé ${label}`} aria-label={`Clé ${label}`} className={cn(inputClass, "min-w-0 flex-1")} />
        <Button variant="primary" disabled={busy || !key.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Enregistrer
        </Button>
        {on && !fromEnv && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => go("")}>
            Retirer
          </Button>
        )}
      </div>
    </form>
  );
}

/** A voice among those of the provider, with a button to hear it (the provider's sample, else a line read by the server). */
export function VoicePicker({
  provider,
  value,
  voices,
  error,
  onChange,
  label = "Voix",
  unavailable,
}: {
  provider: VoiceProvider;
  value?: string;
  voices: Voice[] | null;
  error?: string;
  onChange: (v: Voice | undefined) => void;
  label?: string;
  /** No key for the provider: nothing to list. */
  unavailable?: boolean;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const current = voices?.find((v) => v.id === value);
  const listen = async () => {
    if (state === "playing") {
      audio.current?.pause();
      return;
    }
    if (!value) return;
    setState("loading");
    try {
      let src = current?.preview;
      if (!src) {
        const r = await fetch("/api/audio/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, voiceId: value, text: "Salut ! Voici la voix de tes prochains reels." }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Erreur ${r.status}`);
        src = URL.createObjectURL(await r.blob());
      }
      audio.current?.pause();
      const a = new Audio(src);
      audio.current = a;
      a.onended = a.onpause = () => setState("idle");
      await a.play();
      setState("playing");
    } catch (e) {
      setState("idle");
      toast.error("Écoute impossible", { description: (e as Error).message });
    }
  };
  useEffect(() => () => audio.current?.pause(), []);
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
      <span className="flex min-w-0 gap-2">
        <select className={cn(selectClass, "flex-1")} value={value ?? ""} disabled={!voices} onChange={(e) => onChange(voices?.find((v) => v.id === e.target.value))} aria-label={label}>
          <option value="">{voices ? "Choisis une voix" : error || unavailable ? "Indisponible" : "Lecture des voix…"}</option>
          {value && voices && !current && <option value={value}>{value}</option>}
          {(voices ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.detail ? ` · ${v.detail}` : ""}
            </option>
          ))}
        </select>
        <Button type="button" variant="ghost" className="h-10 shrink-0" disabled={!value || state === "loading"} onClick={listen} aria-label="Écouter la voix">
          {state === "loading" ? <Loader2 className="size-4 animate-spin" /> : state === "playing" ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
      </span>
      {error && <span className="text-[11.5px] text-warn">{error}</span>}
    </label>
  );
}

/** Réglages → Modèle Claude: the model the Mac uses for the face cam montage and the animated reel, unless a video says otherwise. */
export function ModelSection({ delay = 0 }: { delay?: number }) {
  const [data, setData] = useState<AudioOverview | null>(null);
  const [custom, setCustom] = useState("");
  useEffect(() => {
    fetch("/api/settings/audio")
      .then((r) => json<AudioOverview>(r))
      .then((d) => {
        setData(d);
        if (d.claudeModel && !CLAUDE_MODELS.some((m) => m.id === d.claudeModel)) setCustom(d.claudeModel);
      })
      .catch(() => {});
  }, []);
  const save = async (claudeModel: string) => {
    try {
      setData(await put({ claudeModel }));
      toast.success(claudeModel ? `Modèle Claude : ${CLAUDE_MODELS.find((m) => m.id === claudeModel)?.label ?? claudeModel}` : "Modèle réglé sur ton Mac");
    } catch (e) {
      toast.error("Non enregistré", { description: (e as Error).message });
    }
  };
  const value = data?.claudeModel ?? "";
  const options = [{ id: "", label: "Celui du Mac", detail: "Le modèle de config.json, sinon celui de Claude Code." }, ...CLAUDE_MODELS];
  return (
    <section className="rise" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="text-[15px] font-semibold">Modèle Claude des vidéos</h2>
      <p className="mt-1.5 text-[13px] text-ink-3">Le modèle que ton Mac utilise pour le montage face cam et le Reel animé. Chaque vidéo peut en choisir un autre.</p>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="grid gap-1 p-2 sm:grid-cols-2">
          {options.map((m) => (
            <button
              key={m.id || "mac"}
              type="button"
              disabled={!data}
              onClick={() => save(m.id)}
              className={cn("press flex flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left", value === m.id ? "bg-accent-soft/60 shadow-[inset_0_0_0_1px_var(--accent)]" : "hover:bg-ink/[0.03]")}
            >
              <span className="text-[13.5px] font-medium">{m.label}</span>
              <span className="text-[12px] text-ink-3">{m.detail}</span>
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) save(custom.trim());
          }}
          className="flex flex-wrap items-center gap-2 border-t border-line p-3"
        >
          <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={60} placeholder="Autre identifiant, par ex. claude-opus-5-5" aria-label="Autre modèle" className={cn(inputClass, "h-9 min-w-0 flex-1 font-mono text-[13px]")} />
          <Button size="sm" disabled={!custom.trim() || custom.trim() === value}>
            Utiliser
          </Button>
        </form>
      </div>
    </section>
  );
}
