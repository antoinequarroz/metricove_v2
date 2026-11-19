"use client";

import { Circle, FlipHorizontal2, Loader2, Maximize2, Mic, Minimize2, Pause, Play, Send, Sparkles, Square, Trash2, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { MontageJob, Rush } from "@/lib/montage";
import { useStore } from "@/lib/store";
import { uploadInChunks } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { Segmented } from "../calendar";
import { Button } from "../ui";
import { fmtSec, MediaHeader, StudioTabs } from "./parts";
import { useVoiceFollow } from "./use-voice-follow";
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
  // An idea sent from the Stratégie page (?idee=…): it waits in the field for the teleprompter text.
  useEffect(() => {
    const sent = new URLSearchParams(window.location.search).get("idee")?.trim();
    if (!sent) return;
    setIdea(sent.slice(0, 2000));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
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

  // Voice mode: the text follows what is said instead of scrolling at a fixed speed.
  const [voice, setVoice] = useState(false);
  const follow = useVoiceFollow(lines, voice, from);
  useEffect(() => {
    if (voice) setOffset(lineRefs.current[follow.line]?.offsetTop ?? 0);
  }, [voice, follow.line]);

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
  // Texts Claude wrote earlier, even if the page was closed while it worked.
  const recentScripts = (data?.jobs ?? []).filter((j) => j.kind === "script" && j.status === "done" && j.script).slice(0, 6);
  // On a computer they stand on one line that scrolls sideways: its edges fade where more texts are hidden.
  const chips = useRef<HTMLDivElement>(null);
  const [chipsHidden, setChipsHidden] = useState({ start: false, end: false });
  const measureChips = useCallback(() => {
    const el = chips.current;
    const start = !!el && el.scrollLeft > 1;
    const end = !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setChipsHidden((h) => (h.start === start && h.end === end ? h : { start, end }));
  }, []);
  const showChips = recentScripts.length > 0 && !scriptJob;
  useEffect(() => {
    const el = chips.current;
    if (!showChips || !el) return;
    measureChips();
    const observer = new ResizeObserver(measureChips);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showChips, recentScripts.length, measureChips]);
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

  const activeProject = useStore((s) => s.activeProject);
  const askClaude = async () => {
    try {
      const { job } = await montageApi<{ job: MontageJob }>("/api/montage/jobs", {
        method: "POST",
        body: JSON.stringify({ kind: "script", title: idea.slice(0, 80), projectId: activeProject !== "all" ? activeProject : undefined, brief: { format: orientation === "portrait" ? "9:16" : "16:9", instructions: idea } }),
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

  // Vertical camera with room on its sides (computers): the settings stand next to it as a small card, so the camera
  // takes the full height. Otherwise (horizontal camera, narrow screens) they sit under it as a bar.
  // The card goes on the side when that gives the bigger camera: a camera area at least 440px wide and not much taller
  // than wide. Those classes use the `[@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:` variant.
  // The card's own layout follows its width (`@max-3xs/set:`), so it only needs to be narrow to stack its settings.
  const portrait = orientation === "portrait";

  return (
    <>
      <MediaHeader />
      {/* On a computer the screen fits the window: the camera and its settings never scroll, only the side column does. */}
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4 lg:flex lg:min-h-0 lg:flex-col">
        <div className="mx-auto grid w-full max-w-[1680px] grid-cols-[minmax(0,1fr)] gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_480px]">
          {/* ---------- Camera + teleprompter: as large as the window allows ---------- */}
          <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
            <div className="flex lg:shrink-0">
              <StudioTabs />
            </div>
            {/* The camera area is a size container: the camera is sized from the room it has, height included. */}
            <div className="min-w-0 [container-name:cam] lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:justify-center lg:[container-type:size]">
              {/* The camera and its settings are centred together: the prompter stays close to the webcam, at the top
                  middle of the screen. A card next to a vertical camera has its bottom on the camera's bottom. */}
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:justify-center",
                  portrait &&
                    "[@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:h-auto [@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:flex-row [@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:items-end [@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:gap-4",
                )}
              >
                {/* As tall as the camera at full width, less when the room is shorter. Next to the card, just the camera's size. */}
                <div
                  className={cn(
                    "flex min-w-0 items-center justify-center lg:min-h-0 lg:[container-type:size]",
                    portrait
                      ? "lg:basis-[calc(100cqw*16/9)] [@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:basis-auto [@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:[container-type:normal]"
                      : "lg:basis-[calc(100cqw*9/16)]",
                  )}
                >
                  {/* On a phone the whole camera, record button included, fits the first screen. */}
                  <div
                    ref={stage}
                    className={cn(
                      "relative w-full overflow-hidden rounded-2xl border border-line bg-black shadow-card",
                      full
                        ? "flex h-full items-center justify-center rounded-none border-0"
                        : portrait
                          ? "max-lg:max-w-[min(400px,max(11rem,calc((100dvh-18rem)*9/16)))] lg:w-[min(100cqw,100cqh*9/16)] [@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:w-[min(100cqh*9/16,100cqw-14rem)]"
                          : "lg:w-[min(100cqw,100cqh*16/9)]",
                    )}
                    style={full ? undefined : { aspectRatio: portrait ? "9 / 16" : "16 / 9" }}
                  >
                    <video ref={video} autoPlay muted playsInline className={cn("size-full object-cover", mirror && "-scale-x-100")} />

                    {!stream && (
                      // A narrow camera (small window) gets a smaller button, so it keeps a margin on both sides.
                      <div className="@container absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
                        <Video className="size-7 text-white/60" />
                        <p className="text-[13px] text-white/70">{camError || "Ta caméra s'affiche ici, avec le prompteur par-dessus."}</p>
                        <Button variant="primary" onClick={startCamera} className="@max-[11rem]:h-8 @max-[11rem]:px-2.5 @max-[11rem]:text-[12.5px]">
                          Activer la caméra
                        </Button>
                      </div>
                    )}

                    {/* Teleprompter, at the top: close to the lens. */}
                    {stream && lines.length > 0 && (
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-[38%] overflow-hidden bg-gradient-to-b from-black/80 via-black/60 to-transparent">
                        <div ref={scroller} className={cn("px-6 pt-6 transition-transform ease-linear", voice ? "duration-300" : "duration-75")} style={{ transform: `translateY(${-offset}px)` }}>
                          {lines.map((l, i) => (
                            <p
                              key={i}
                              ref={(el) => {
                                lineRefs.current[i] = el;
                              }}
                              className="mb-[0.6em] text-center leading-snug font-semibold break-words text-white"
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

                    {/* Transport, at the bottom. The take's time sits above the buttons, so a narrow camera never hides it. */}
                    {stream && (
                      <div className="@container absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-4 pt-10 pb-4">
                        {recording && (
                          <span className="tabular flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-0.5 font-mono text-[12px] text-white">
                            <span className="size-2 animate-pulse rounded-full bg-danger" /> {fmtSec(elapsed)}
                          </span>
                        )}
                        <div className="flex items-center justify-center gap-3 @max-[11rem]:gap-2">
                          {lines.length > 0 && !voice && (
                            <button
                              onClick={() => setRunning((r) => !r)}
                              aria-label={running ? "Mettre le prompteur en pause" : "Lancer le prompteur"}
                              className="press grid size-10 shrink-0 place-items-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25 @max-[11rem]:size-8"
                            >
                              {running ? <Pause className="size-4" /> : <Play className="size-4" />}
                            </button>
                          )}
                          <button
                            onClick={record}
                            disabled={countdown > 0}
                            aria-label={recording ? "Arrêter l'enregistrement" : "Enregistrer une prise"}
                            className="press grid size-16 shrink-0 place-items-center rounded-full border-4 border-white bg-white/10 backdrop-blur @max-[11rem]:size-12 @max-[11rem]:border-[3px]"
                          >
                            {recording ? <Square className="size-6 fill-danger text-danger @max-[11rem]:size-5" /> : <Circle className="size-11 fill-danger text-danger @max-[11rem]:size-8" />}
                          </button>
                          <button
                            onClick={toggleFull}
                            aria-label={full ? "Quitter le plein écran" : "Plein écran"}
                            className="press grid size-10 shrink-0 place-items-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25 @max-[11rem]:size-8"
                          >
                            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Settings: the camera's first, then the teleprompter's. A bar under the camera, or a card next to it. */}
                <div
                  className={cn(
                    "rounded-xl border border-line bg-surface px-4 py-3 text-[12.5px] lg:shrink-0 lg:self-center",
                    portrait ? "lg:w-full lg:max-w-2xl lg:@container/set [@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:w-52 [@container_cam_(min-width:440px)_and_(min-aspect-ratio:4/5)]:self-end" : "lg:max-w-full",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:justify-center lg:gap-x-4 @max-3xs/set:flex-col @max-3xs/set:flex-nowrap @max-3xs/set:items-stretch @max-3xs/set:gap-3 @max-3xs/set:py-0.5">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:gap-x-4 @max-3xs/set:flex-col @max-3xs/set:items-start @max-3xs/set:gap-2.5">
                      <Segmented<Orientation>
                        value={orientation}
                        onChange={setOrientation}
                        options={[
                          { value: "portrait", label: "Vertical" },
                          { value: "landscape", label: "Horizontal" },
                        ]}
                      />
                      {devices.length > 1 && (
                        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Caméra" className="h-8 max-w-[220px] rounded-lg border border-line-strong bg-surface px-2 lg:max-w-[180px] @max-3xs/set:w-full @max-3xs/set:max-w-full">
                          <option value="">Caméra par défaut</option>
                          {devices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || "Caméra"}
                            </option>
                          ))}
                        </select>
                      )}
                      <button onClick={() => setMirror((m) => !m)} className={cn("press inline-flex items-center gap-1.5 rounded-lg px-2 py-1", mirror ? "bg-accent-soft text-accent" : "text-ink-2")}>
                        <FlipHorizontal2 className="size-3.5" /> Miroir
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:gap-x-4 @max-3xs/set:flex-col @max-3xs/set:items-stretch @max-3xs/set:gap-2.5 @max-3xs/set:border-t @max-3xs/set:border-line @max-3xs/set:pt-3">
                      <button
                        onClick={() => {
                          setRunning(false);
                          setVoice((v) => !v);
                        }}
                        title="Le texte avance quand tu parles"
                        className={cn("press inline-flex items-center gap-1.5 rounded-lg px-2 py-1 @max-3xs/set:self-start", voice ? "bg-accent-soft text-accent" : "text-ink-2")}
                      >
                        <Mic className="size-3.5" /> Suivre ma voix
                      </button>
                      {!voice && (
                        <label className="flex items-center gap-2 @max-3xs/set:justify-between">
                          Vitesse
                          <input type="range" min={10} max={120} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-24 accent-[var(--accent)] lg:w-18 @max-3xs/set:w-24" />
                        </label>
                      )}
                      <label className="flex items-center gap-2 @max-3xs/set:justify-between">
                        Taille
                        <input type="range" min={18} max={56} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-24 accent-[var(--accent)] lg:w-18 @max-3xs/set:w-24" />
                      </label>
                    </div>
                    {/* Its own line, as wide as the settings above it and never wider. */}
                    {voice && follow.error && <p className="w-0 min-w-full text-[12px] text-danger lg:text-center @max-3xs/set:text-left">{follow.error}</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ---------- Script + takes: the text fills the column, the takes and their button stay at the bottom ---------- */}
          {/* When the window is short, the text and its sentences get shorter and scroll inside, so the card itself stays
              still (it only scrolls as a last resort, on a very short window). */}
          <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
            <section className="scroll-thin rounded-xl border border-line bg-surface p-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto">
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
              {/* On a computer, one line that scrolls sideways (the mouse wheel works too), so the text keeps its room. */}
              {showChips && (
                <div
                  ref={chips}
                  onScroll={measureChips}
                  onWheel={(e) => {
                    const el = e.currentTarget;
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
                  }}
                  style={
                    chipsHidden.start || chipsHidden.end
                      ? { maskImage: `linear-gradient(to right, ${chipsHidden.start ? "transparent" : "#000"}, #000 2rem, #000 calc(100% - 2rem), ${chipsHidden.end ? "transparent" : "#000"})` }
                      : undefined
                  }
                  className="mb-3 flex flex-wrap gap-1.5 [scrollbar-width:none] lg:shrink-0 lg:flex-nowrap lg:overflow-x-auto"
                >
                  {recentScripts.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => {
                        setScript(j.script ?? "");
                        setOffset(0);
                      }}
                      title={j.script}
                      className="press max-w-full shrink-0 truncate rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 hover:text-ink lg:max-w-56"
                    >
                      <Sparkles className="mr-1 inline size-3 text-accent" />
                      {j.title}
                    </button>
                  ))}
                </div>
              )}
              {scriptJob && <p className="mb-2 text-[12px] text-ink-3">{data?.worker.online ? "Claude écrit ton texte sur ton Mac…" : "En attente de ton Mac pour écrire le texte…"}</p>}
              {/* Fills the card on a tall screen and keeps about three lines on a short one. On a phone it can be pulled taller. */}
              <textarea
                value={script}
                onChange={(e) => {
                  setScript(e.target.value);
                  setOffset(0);
                }}
                rows={8}
                placeholder="Écris ou colle ton texte. Une phrase par ligne, c'est encore mieux."
                aria-label="Texte du prompteur"
                className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent/60 lg:h-28 lg:min-h-18 lg:flex-[1_1_auto]"
              />
              {lines.length > 0 && (
                // Gives up its height before the text does, down to two sentences.
                <div className="mt-2 lg:flex lg:min-h-[4.125rem] lg:shrink-[3] lg:flex-col">
                  {/* The keyboard hint lives here, next to the sentences it moves through. */}
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[11.5px] text-ink-3">
                    <p>Reprendre à partir de :</p>
                    <span>Espace : pause du prompteur</span>
                  </div>
                  <ol className="scroll-thin flex max-h-40 flex-col gap-0.5 overflow-y-auto lg:min-h-0">
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

            {/* Room for two takes on a laptop screen; more scroll inside the list. */}
            <section className="rounded-xl border border-line bg-surface p-4 lg:flex lg:max-h-[45%] lg:min-h-0 lg:shrink-0 lg:flex-col">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[13px] font-semibold">Prises</h2>
                <span className="text-[12px] text-ink-3">{takes.length}</span>
                {/* In the header, so the list keeps its room while the takes are sent. */}
                {sending && (
                  <span className="tabular ml-auto min-w-0 truncate text-[12px] text-ink-3">
                    Envoi de la prise {sending.done + 1}/{sending.total} · {sending.pct}%
                  </span>
                )}
              </div>
              {takes.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">Chaque enregistrement devient une prise. Garde-les toutes : l&apos;IA choisit la meilleure de chaque phrase.</p>
              ) : (
                <ul className="scroll-thin flex flex-col gap-2 lg:min-h-0 lg:overflow-y-auto">
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
              <Button variant="primary" className="mt-3 w-full shrink-0" disabled={!takes.length || !!sending || recording} onClick={send}>
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
