"use client";

import { Circle, FlipHorizontal2, Loader2, Maximize2, Minimize2, Pause, Play, Send, Sparkles, Square, Trash2, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { MontageJob, Rush } from "@/lib/montage";
import { uploadInChunks } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { Segmented } from "../calendar";
import { Button } from "../ui";
import { fmtSec, PageHeader, VideoTabs } from "./parts";
import { montageApi, useMontage } from "./use-montage";

type Orientation = "portrait" | "landscape";
type Take = { id: string; blob: Blob; url: string; seconds: number; from: number; ext: string };

/** Sentences of the script: what the teleprompter shows, one block each. */
const sentences = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

function pickMime() {
  const options = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export function StudioPage() {
  const router = useRouter();
  const { data } = useMontage();
  const [script, setScript] = useState("");
  const [idea, setIdea] = useState("");
  const [scriptJob, setScriptJob] = useState<string | null>(null);
  const lines = useMemo(() => sentences(script), [script]);

  // ---- Camera ----
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [mirror, setMirror] = useState(true);
  const [camError, setCamError] = useState("");
  const [full, setFull] = useState(false);

  const startCamera = useCallback(async () => {
    setCamError("");
    stream?.getTracks().forEach((t) => t.stop());
    try {
      const portrait = orientation === "portrait";
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: portrait ? 1080 : 1920 },
          height: { ideal: portrait ? 1920 : 1080 },
          aspectRatio: { ideal: portrait ? 9 / 16 : 16 / 9 },
          frameRate: { ideal: 30 },
        },
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
      setStream(s);
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"));
    } catch (e) {
      setCamError((e as Error).name === "NotAllowedError" ? "Autorise la caméra et le micro dans ton navigateur." : `Caméra indisponible : ${(e as Error).message}`);
    }
  }, [deviceId, orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
  // Changing camera or orientation restarts it.
  useEffect(() => {
    if (stream) startCamera();
  }, [deviceId, orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Teleprompter ----
  const [speed, setSpeed] = useState(40);
  const [size, setSize] = useState(30);
  const [running, setRunning] = useState(false);
  const [offset, setOffset] = useState(0);
  const [from, setFrom] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  const jumpTo = (i: number) => {
    setFrom(i);
    setOffset(lineRefs.current[i]?.offsetTop ?? 0);
  };

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setOffset((o) => o + ((now - last) / 1000) * speed);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, speed]);

  // ---- Recording ----
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);

  const begin = () => {
    if (!stream) return;
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    const started = Date.now();
    const startLine = from;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const type = rec.mimeType || mime || "video/webm";
      const blob = new Blob(chunks, { type });
      setTakes((t) => [...t, { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), seconds: (Date.now() - started) / 1000, from: startLine, ext: type.includes("mp4") ? "mp4" : "webm" }]);
    };
    rec.start(1000);
    recorder.current = rec;
    setRecording(true);
    setRunning(lines.length > 0);
  };

  const record = () => {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      setRunning(false);
      return;
    }
    let n = 3;
    setCountdown(n);
    const id = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n === 0) {
        clearInterval(id);
        begin();
      }
    }, 800);
  };

  useEffect(() => {
    if (!recording) return setElapsed(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [recording]);

  // Space: pause or resume the scrolling. Enter: start or stop recording.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setRunning((r) => !r);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Script by Claude ----
  const pending = data?.jobs.find((j) => j.id === scriptJob);
  useEffect(() => {
    if (pending?.status === "done" && pending.script) {
      setScript(pending.script);
      setScriptJob(null);
      setOffset(0);
      toast.success("Texte prêt", { description: "Relis-le, ajuste-le, puis lance l'enregistrement." });
    } else if (pending?.status === "failed") {
      toast.error("Claude n'a pas pu écrire le texte", { description: pending.error });
      setScriptJob(null);
    }
  }, [pending?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const askClaude = async () => {
    try {
      const { job } = await montageApi<{ job: MontageJob }>("/api/montage/jobs", {
        method: "POST",
        body: JSON.stringify({ kind: "script", title: idea.slice(0, 80), brief: { format: orientation === "portrait" ? "9:16" : "16:9", instructions: idea } }),
      });
      setScriptJob(job.id);
    } catch (e) {
      toast.error("Demande impossible", { description: (e as Error).message });
    }
  };

  // ---- Send takes ----
  const [sending, setSending] = useState<{ done: number; total: number; pct: number } | null>(null);
  const send = async () => {
    setSending({ done: 0, total: takes.length, pct: 0 });
    const ids: string[] = [];
    try {
      for (const [i, t] of takes.entries()) {
        const name = `Prise ${i + 1} · ${new Date().toLocaleDateString("fr-CH")}.${t.ext}`;
        const upload = await uploadInChunks(t.blob, name, (pct) => setSending({ done: i, total: takes.length, pct }));
        const { rush } = await montageApi<{ rush: Rush }>("/api/montage/rushes", { method: "POST", body: JSON.stringify({ upload, name, duration: t.seconds }) });
        ids.push(rush.id);
      }
      takes.forEach((t) => URL.revokeObjectURL(t.url));
      setTakes([]);
      const q = new URLSearchParams({ rushes: ids.join(",") });
      if (script.trim()) q.set("script", script.trim());
      router.push(`/videos/montage?${q}`);
    } catch (e) {
      toast.error("Envoi impossible", { description: (e as Error).message });
    } finally {
      setSending(null);
    }
  };

  const toggleFull = async () => {
    if (!document.fullscreenElement) {
      await stage.current?.requestFullscreen?.().catch(() => {});
      setFull(true);
    } else {
      await document.exitFullscreen().catch(() => {});
      setFull(false);
    }
  };
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  return (
    <>
      <PageHeader kicker="Vidéos" title="Studio">
        <VideoTabs />
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ---------- Camera + teleprompter ---------- */}
          <div className="flex flex-col gap-3">
            <div
              ref={stage}
              className={cn(
                "relative mx-auto w-full overflow-hidden rounded-2xl border border-line bg-black shadow-card",
                full ? "flex h-full items-center justify-center rounded-none border-0" : orientation === "portrait" ? "max-w-[400px]" : "",
              )}
              style={full ? undefined : { aspectRatio: orientation === "portrait" ? "9 / 16" : "16 / 9" }}
            >
              <video ref={video} autoPlay muted playsInline className={cn("size-full object-cover", mirror && "-scale-x-100")} />

              {!stream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
                  <Video className="size-7 text-white/60" />
                  <p className="text-[13px] text-white/70">{camError || "Ta caméra s'affiche ici, avec le prompteur par-dessus."}</p>
                  <Button variant="primary" onClick={startCamera}>
                    Activer la caméra
                  </Button>
                </div>
              )}

              {/* Teleprompter, at the top: close to the lens. */}
              {stream && lines.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[38%] overflow-hidden bg-gradient-to-b from-black/80 via-black/60 to-transparent">
                  <div ref={scroller} className="px-6 pt-6 transition-transform duration-75 ease-linear" style={{ transform: `translateY(${-offset}px)` }}>
                    {lines.map((l, i) => (
                      <p
                        key={i}
                        ref={(el) => {
                          lineRefs.current[i] = el;
                        }}
                        className="mb-[0.6em] text-center leading-snug font-semibold text-white"
                        style={{ fontSize: size }}
                      >
                        {l}
                      </p>
                    ))}
                    <div className="h-[40vh]" />
                  </div>
                </div>
              )}

              {countdown > 0 && (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <span key={countdown} className="rise font-display text-[96px] text-white">
                    {countdown}
                  </span>
                </div>
              )}

              {stream && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pt-10 pb-4">
                  {recording && (
                    <span className="tabular absolute left-4 flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-0.5 font-mono text-[12px] text-white">
                      <span className="size-2 animate-pulse rounded-full bg-danger" /> {fmtSec(elapsed)}
                    </span>
                  )}
                  {lines.length > 0 && (
                    <button onClick={() => setRunning((r) => !r)} aria-label={running ? "Mettre le prompteur en pause" : "Lancer le prompteur"} className="press grid size-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25">
                      {running ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </button>
                  )}
                  <button
                    onClick={record}
                    disabled={countdown > 0}
                    aria-label={recording ? "Arrêter l'enregistrement" : "Enregistrer une prise"}
                    className="press grid size-16 place-items-center rounded-full border-4 border-white bg-white/10 backdrop-blur"
                  >
                    {recording ? <Square className="size-6 fill-danger text-danger" /> : <Circle className="size-11 fill-danger text-danger" />}
                  </button>
                  <button onClick={toggleFull} aria-label={full ? "Quitter le plein écran" : "Plein écran"} className="press grid size-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25">
                    {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                  </button>
                </div>
              )}
            </div>

            {/* Settings */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3 text-[12.5px]">
              <Segmented<Orientation>
                value={orientation}
                onChange={setOrientation}
                options={[
                  { value: "portrait", label: "Vertical" },
                  { value: "landscape", label: "Horizontal" },
                ]}
              />
              {devices.length > 1 && (
                <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Caméra" className="h-8 max-w-[220px] rounded-lg border border-line-strong bg-surface px-2">
                  <option value="">Caméra par défaut</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Caméra"}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2">
                Vitesse
                <input type="range" min={10} max={120} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-24 accent-[var(--accent)]" />
              </label>
              <label className="flex items-center gap-2">
                Taille
                <input type="range" min={18} max={56} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-24 accent-[var(--accent)]" />
              </label>
              <button onClick={() => setMirror((m) => !m)} className={cn("press inline-flex items-center gap-1.5 rounded-lg px-2 py-1", mirror ? "bg-accent-soft text-accent" : "text-ink-2")}>
                <FlipHorizontal2 className="size-3.5" /> Miroir
              </button>
              <span className="text-ink-3">Espace : pause du prompteur</span>
            </div>
          </div>

          {/* ---------- Script + takes ---------- */}
          <div className="flex flex-col gap-4">
            <section className="rounded-xl border border-line bg-surface p-4">
              <h2 className="mb-2 text-[13px] font-semibold">Texte du prompteur</h2>
              <div className="mb-3 flex gap-2">
                <input
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="Ton idée, par ex. « 3 livres pour aimer lire »"
                  aria-label="Idée de vidéo"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none focus:border-accent/60"
                />
                <Button onClick={askClaude} disabled={!idea.trim() || !!scriptJob}>
                  {scriptJob ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-accent" />}
                  Claude
                </Button>
              </div>
              {scriptJob && <p className="mb-2 text-[12px] text-ink-3">{data?.worker.online ? "Claude écrit ton texte sur ton Mac…" : "En attente de ton Mac pour écrire le texte…"}</p>}
              <textarea
                value={script}
                onChange={(e) => {
                  setScript(e.target.value);
                  setOffset(0);
                }}
                rows={8}
                placeholder="Écris ou colle ton texte. Une phrase par ligne, c'est encore mieux."
                aria-label="Texte du prompteur"
                className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent/60"
              />
              {lines.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[11.5px] text-ink-3">Reprendre à partir de :</p>
                  <ol className="scroll-thin flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                    {lines.map((l, i) => (
                      <li key={i}>
                        <button onClick={() => jumpTo(i)} className={cn("w-full truncate rounded px-1.5 py-0.5 text-left text-[12px]", i === from ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-2")}>
                          <span className="tabular mr-1.5 font-mono text-ink-3">{i + 1}.</span>
                          {l}
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-center">
                <h2 className="text-[13px] font-semibold">Prises</h2>
                <span className="ml-2 text-[12px] text-ink-3">{takes.length}</span>
              </div>
              {takes.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">Chaque enregistrement devient une prise. Garde-les toutes : l&apos;IA choisit la meilleure de chaque phrase.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {takes.map((t, i) => (
                    <li key={t.id} className="flex items-center gap-3">
                      <video src={t.url} className="h-14 w-10 shrink-0 rounded-md bg-black object-cover" muted playsInline />
                      <div className="min-w-0 flex-1 text-[12.5px]">
                        <p className="font-medium">Prise {i + 1}</p>
                        <p className="text-ink-3">
                          {fmtSec(t.seconds)}
                          {lines.length ? ` · depuis la phrase ${t.from + 1}` : ""}
                        </p>
                      </div>
                      <a href={t.url} target="_blank" rel="noreferrer" className="press grid size-8 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={`Revoir la prise ${i + 1}`}>
                        <Play className="size-3.5" />
                      </a>
                      <button
                        onClick={() => {
                          URL.revokeObjectURL(t.url);
                          setTakes((x) => x.filter((y) => y.id !== t.id));
                        }}
                        aria-label={`Supprimer la prise ${i + 1}`}
                        className="press grid size-8 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {sending && (
                <p className="mt-3 text-[12px] text-ink-3">
                  Envoi de la prise {sending.done + 1}/{sending.total} · {sending.pct}%
                </p>
              )}
              <Button variant="primary" className="mt-3 w-full" disabled={!takes.length || !!sending || recording} onClick={send}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Monter ces prises avec l&apos;IA
              </Button>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
