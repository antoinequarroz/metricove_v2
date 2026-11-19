"use client";

import { AlertTriangle, CalendarPlus, Check, Circle, Clock, CloudOff, Film, Laptop, Library, Loader2, PenLine, RotateCcw, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { VIDEO_WORKER, type MontageJob, type MontageVersion } from "@/lib/montage";
import type { Look } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { fmtLen, Progress } from "./parts";
import type { WorkerStatus } from "./use-montage";
import { aboutText, durationText, etaText, liveProgress, PHASE_LINES, quietMinutes, renderHead, runBeats, videoEstimate, type MacState, type ReelAsk, type ReelView } from "./use-reel-job";

/** Calm entrance of a card that replaces another (composite only; no movement when motion is reduced). */
export const ENTER = "transition-[opacity,transform] duration-180 ease-[var(--ease-out)] starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0";
const SPIN = "animate-spin motion-reduce:animate-none";
/** French spacing that never breaks: the narrow space before « : ; ! ? % » and after «, a number with its unit. */
export const nb = (s: string) =>
  s
    .replace(/ ([%:;!?»])/g, " $1")
    .replace(/« /g, "« ")
    // "30 s", "2 min 30": a number stays with its unit.
    .replace(/(\d) (s|min|h)(?![a-zA-Z\u00c0-\u024f\d])/g, "$1 $2");

/* ---------- The Mac ---------- */

const MAC_TONE: Record<MacState["kind"], string> = {
  ready: "bg-ok",
  mine: "bg-accent",
  busy: "bg-warn",
  silent: "bg-warn",
  offline: "bg-ink-3",
  old: "bg-danger",
  never: "bg-ink-3",
};

export function macPillText(mac: MacState) {
  switch (mac.kind) {
    case "ready":
      return `Mac prêt${mac.version ? ` · ${mac.version}` : ""}`;
    case "mine":
      return "Mac au travail";
    case "busy":
      return "Mac occupé";
    case "silent":
      return `Mac silencieux${mac.seen ? ` · vu ${mac.seen}` : ""}`;
    case "offline":
      return `Mac hors ligne${mac.seen ? ` · vu ${mac.seen}` : ""}`;
    case "old":
      return `Mac à mettre à jour (${mac.version ?? "version inconnue"} → ${VIDEO_WORKER})`;
    case "never":
      return "Mac jamais vu";
  }
}

/** What to do on a Mac too old for videos (the same steps as docs/MONTAGE.md, without --check). */
const OLD_STEPS = "Sur le Mac : git pull, node montage.mjs --setup-reel, puis relance le programme.";
const COMMANDS = /(git pull|node montage\.mjs --setup-reel)/;
/** A text with the Mac's commands kept on one line each (« --setup-reel » would break after its dashes), copied as typed. */
function Commands({ text }: { text: string }) {
  return text.split(COMMANDS).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part));
}

const MAC_HINT: Record<MacState["kind"], string> = {
  ready: "Le programme de montage tourne sur ton Mac : il prend les vidéos dès que tu les demandes.",
  mine: "Ton Mac fabrique la vidéo que tu suis ici.",
  busy: "Ton Mac termine une autre demande : la tienne suit dans la file.",
  silent: "Ton Mac a une vidéo en cours mais ne donne plus de nouvelles (veille ?). Elle reprendra à son retour.",
  offline: "Le Mac est éteint, en veille, ou le programme de montage est arrêté. Les demandes attendent son retour.",
  old: OLD_STEPS,
  never: "Le programme de montage n'a encore jamais contacté Metricove depuis un Mac.",
};

/** The Mac in a few words, before anything is asked: ready, busy, asleep, too old, never seen. */
export function MacPill({ mac, className }: { mac: MacState; className?: string }) {
  return (
    <span title={nb(MAC_HINT[mac.kind])} className={cn("inline-flex h-8 max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink-2", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", MAC_TONE[mac.kind])} />
      <span className="truncate">{macPillText(mac)}</span>
    </span>
  );
}

/** One line under the request, beside the button: what will happen if you click now. */
export function MacStatus({ mac, worker, target, legacy }: { mac: MacState; worker?: WorkerStatus; target?: number; legacy?: string }) {
  let text: React.ReactNode;
  if (mac.kind === "ready") text = `Mac prêt · prête dans ${aboutText(videoEstimate(worker, target))}`;
  else if (mac.kind === "mine") text = "Ton Mac fabrique ta vidéo.";
  else if (mac.kind === "busy") text = nb(`Ton Mac termine « ${mac.busyTitle} » ; ta vidéo suivra.`);
  else if (mac.kind === "silent") text = `Ton Mac ne répond plus depuis ${mac.quiet ?? 1} min (veille ?). ${mac.mine ? "La vidéo reprendra à son retour." : "Ta vidéo attendra son retour."}`;
  else if (mac.kind === "offline") text = `Ton Mac est éteint ou en veille${mac.seen ? ` (vu ${mac.seen})` : ""}.`;
  else if (mac.kind === "old")
    text = (
      <>
        <Commands text={nb(`${mac.version ? `Programme du Mac trop ancien (${mac.version}, il faut ${VIDEO_WORKER}).` : `Programme du Mac de version inconnue : il faut ${VIDEO_WORKER} pour les vidéos.`} ${OLD_STEPS}`)} />{" "}
        {legacy && (
          <Link href={legacy} className="font-medium text-accent underline-offset-2 hover:underline">
            Ancien éditeur par scènes
          </Link>
        )}
      </>
    );
  else text = "Le programme du Mac n'a jamais été lancé.";
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-ink-3">
      <span className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", MAC_TONE[mac.kind])} />
      <span className="min-w-0">{typeof text === "string" ? nb(text) : text}</span>
    </p>
  );
}

/* ---------- Waiting for the Mac ---------- */

export function waitReason(mac: MacState) {
  switch (mac.kind) {
    case "offline":
      return `Ton Mac est éteint ou en veille${mac.seen ? ` (vu ${mac.seen})` : ""}. La vidéo démarrera dès qu'il se réveille.`;
    case "old":
      return `${mac.version ? `Le programme du Mac est trop ancien (${mac.version}, il faut ${VIDEO_WORKER}).` : `Le programme du Mac n'a pas dit sa version (il faut ${VIDEO_WORKER}).`} ${OLD_STEPS} Ta demande attendra.`;
    case "busy":
      return nb(`Ton Mac termine « ${mac.busyTitle} » ; ta vidéo suit.`);
    case "silent":
      return `Ton Mac ne répond plus depuis ${mac.quiet ?? 1} min (veille ?). Ta vidéo démarrera à son retour.`;
    case "never":
      return "Le programme de montage n'a jamais été lancé sur le Mac. Ta demande attendra son premier passage.";
    default:
      return "Ton Mac va la prendre dans quelques secondes.";
  }
}

export function WaitingCard({ mac, ahead, onCancel, cancelLabel = "Annuler", busy }: { mac: MacState; ahead?: number; onCancel: () => void; cancelLabel?: string; busy?: boolean }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-3.5", ENTER)}>
      <p className="flex items-center gap-2 text-[13.5px] font-semibold">
        <Clock className="size-4 shrink-0 text-warn" />
        En attente du Mac
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2" aria-live="polite">
        <Commands text={nb(waitReason(mac))} />
      </p>
      {!!ahead && ahead > 0 && <p className="tabular mt-1.5 text-[12px] text-ink-3">{ahead === 1 ? "1 demande avant la tienne" : `${ahead} demandes avant la tienne`}</p>}
      <Button size="sm" className="mt-3" onClick={onCancel} disabled={busy}>
        <X className="size-3.5" />
        {cancelLabel}
      </Button>
    </section>
  );
}

/* ---------- Running ---------- */

/** The bar never goes back while it follows one run (a new report can be lower than what was drawn ahead of it). */
function useMonotone(value: number, key: string) {
  const top = useRef({ key, value });
  if (top.current.key !== key) top.current = { key, value };
  else top.current.value = Math.max(top.current.value, value);
  return top.current.value;
}

/** Percent, remaining time and title of a running job, as the Studio and the editing screen show them. */
export function useRunInfo(job: MontageJob, now: number) {
  const run = job.run;
  const phased = !!run?.phase;
  const key = `${job.id}:${run?.startedAt ?? ""}`;
  const value = useMonotone(phased ? liveProgress(job, now) : (job.progress ?? 0), key);
  const etaAt = run?.etaAt ? Date.parse(run.etaAt) : NaN;
  const left = Number.isFinite(etaAt) ? (etaAt - now) / 1000 : NaN;
  const line = PHASE_LINES.find((l) => run?.phase && l.phases.includes(run.phase));
  const started = run?.startedAt ? Date.parse(run.startedAt) : NaN;
  return {
    phased,
    /** 0..1, or undefined when an old Mac gives no number (indeterminate bar). */
    value: phased || job.progress !== undefined ? value : undefined,
    pct: Math.floor(value * 100),
    eta: phased && Number.isFinite(left) ? etaText(left) : "",
    title: line?.title ?? (job.step || "Le Mac travaille…"),
    since: Number.isFinite(started) ? durationText((now - started) / 1000) : "",
  };
}

/**
 * One short line for screen readers (the Studio's live region): it changes with the phase or the state only, never
 * with the percent or the remaining time.
 */
export function announceText(view: ReelView) {
  switch (view.kind) {
    case "queued":
      return "En attente du Mac";
    case "running": {
      if (view.silent) return "Ton Mac ne répond plus (veille ?)";
      const run = view.job.run;
      return PHASE_LINES.find((l) => run?.phase && l.phases.includes(run.phase))?.title ?? "Le Mac travaille sur ta vidéo";
    }
    case "ready":
      return view.failed ? FAILED_TITLE[view.ask ?? "unknown"] : "Ta vidéo est prête";
    case "library":
      return "Ta vidéo est dans ta bibliothèque";
    case "failed":
      return "La vidéo n'a pas pu être générée";
    default:
      return "";
  }
}

/** The steps of a video, with the real time of those done and a detail on the one running. */
export function PhaseTrack({ job, compact }: { job: MontageJob; compact?: boolean }) {
  const run = job.run;
  if (!run?.phase) return null;
  const planned = run.phases?.length ? run.phases : [run.phase];
  const lines = PHASE_LINES.filter((l) => l.phases.some((p) => planned.includes(p)));
  const done = run.done ?? [];
  const at = planned.indexOf(run.phase);
  const frames = run.frames;
  const written = /(\d+) temps forts?/.exec(job.step ?? "")?.[1];
  return (
    <ol className={cn("flex flex-col", compact ? "gap-1" : "gap-1.5")}>
      {lines.map((l) => {
        const active = l.phases.includes(run.phase!);
        const finished = !active && l.phases.filter((p) => planned.includes(p)).every((p) => planned.indexOf(p) < at || done.some((d) => d.phase === p));
        const seconds = done.filter((d) => l.phases.includes(d.phase)).reduce((t, d) => t + d.s, 0);
        const detail = active ? (l.key === "render" && frames ? `image ${frames[0]}/${frames[1]}` : l.key === "write" && written ? `${written} temps fort${written === "1" ? "" : "s"}` : "") : "";
        return (
          <li key={l.key} className={cn("flex flex-wrap items-center gap-x-2 text-[12.5px]", active ? "font-medium text-ink" : finished ? "text-ink-2" : "text-ink-3")}>
            <span className="grid size-4 shrink-0 place-items-center">
              {active ? (
                <Loader2 className={cn("size-3.5 text-accent", SPIN)} />
              ) : finished ? (
                <Check className="size-3.5 text-ok transition-[opacity,transform] duration-160 ease-[var(--ease-out)] starting:scale-90 starting:opacity-0" />
              ) : (
                <Circle className="size-2.5 text-ink-3/70" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate" title={l.title}>{l.label}</span>
            {finished && seconds > 0 && <span className="tabular shrink-0 font-mono text-[11px] text-ink-3">{durationText(seconds)}</span>}
            {/* Under the label in a narrow rail, beside it when there is room. */}
            {detail && <span className="tabular shrink-0 basis-full pl-6 font-mono text-[11px] font-normal text-ink-3 @min-[300px]:basis-auto @min-[300px]:pl-0">{detail}</span>}
          </li>
        );
      })}
    </ol>
  );
}


/** The beats Claude wrote, each with its length; while rendering, the one under the render head stands out. */
export function BeatList({ job }: { job: MontageJob }) {
  const beats = runBeats(job);
  if (!beats.length) return null;
  const head = job.run?.phase === "render" || job.run?.phase === "finish" || job.run?.phase === "upload" ? (renderHead(job) ?? (job.run?.phase === "render" ? 0 : Infinity)) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">Temps forts</p>
      <ol className="flex flex-col">
        {beats.map((b, i) => {
          const rendered = head !== undefined && head >= b.end - 0.01;
          const under = head !== undefined && !rendered && head >= b.start;
          return (
            <li key={b.id} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px] transition-colors duration-200", under ? "bg-accent-soft text-ink" : rendered ? "text-ink-2" : "text-ink-2")}>
              <span className="tabular w-4 shrink-0 font-mono text-[10.5px] text-ink-3">{rendered ? <Check className="size-3 text-ok" /> : i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              <span className="tabular shrink-0 font-mono text-[11px] text-ink-3">{fmtLen(b.end - b.start)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The rail while the Mac works: phase, percent and remaining time, the steps, the beats, a way out. */
export function RunningCard({ job, now, silent, worker, onCancel, cancelLabel = "Annuler", busy }: { job: MontageJob; now: number; silent?: boolean; worker?: WorkerStatus; onCancel: () => void; cancelLabel?: string; busy?: boolean }) {
  const info = useRunInfo(job, now);
  const quiet = quietMinutes(worker, now);
  return (
    <section className={cn("@container flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5", ENTER)}>
      <div className={cn("flex flex-col gap-2 transition-opacity duration-200", silent && "opacity-55")}>
        <div>
          <p className="text-[13.5px] font-semibold">{info.title}</p>
          {/* Not a live region: it moves every few seconds. The Studio announces the phase (announceText). */}
          <p className="tabular mt-0.5 text-[12.5px] text-ink-3">
            {nb(info.phased ? `${info.pct} %${info.eta ? ` · ${info.eta}` : ""}` : `${info.value !== undefined ? `${info.pct} % · ` : ""}${info.since ? `depuis ${info.since}` : ""}`)}
          </p>
        </div>
        <Progress value={info.value} />
        {/* An old Mac gives no phases: its step is already the title. */}
        {!info.phased && job.step && job.step !== info.title && <p className="text-[12px] text-ink-3">{job.step}</p>}
      </div>
      {silent && (
        <p className="rounded-lg bg-warn/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink-2">
          {nb(`Ton Mac ne répond plus depuis ${quiet} min (veille ?). La vidéo reprendra à son retour.`)}
        </p>
      )}
      <div className={cn("flex flex-col gap-3 transition-opacity duration-200", silent && "opacity-55")}>
        <PhaseTrack job={job} />
        <BeatList job={job} />
      </div>
      <Button size="sm" className="self-start" onClick={onCancel} disabled={busy}>
        <X className="size-3.5" />
        {cancelLabel}
      </Button>
    </section>
  );
}

/** The phase track in one line, for the header of the editing screen. */
export function CompactRun({ job, now, onStop, busy }: { job: MontageJob; now: number; onStop?: () => void; busy?: boolean }) {
  const info = useRunInfo(job, now);
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-1.5">
      <Loader2 className={cn("size-3.5 shrink-0 text-accent", SPIN)} />
      <div className="min-w-0">
        {/* Read out when the phase changes, not the percent beside it (which moves every few seconds). */}
        <p className="truncate text-[12.5px] font-medium" aria-live="polite">{job.status === "queued" ? "En attente du Mac" : info.title}</p>
        <div className="mt-1 w-40">
          <Progress value={job.status === "queued" ? undefined : info.value} />
        </div>
      </div>
      <span className="tabular shrink-0 text-[11.5px] text-ink-3">{nb(job.status === "queued" ? "" : info.phased ? `${info.pct} %${info.eta ? ` · ${info.eta}` : ""}` : info.since)}</span>
      {onStop && (
        <Button size="sm" variant="ghost" onClick={onStop} disabled={busy}>
          <X className="size-3.5" /> Arrêter
        </Button>
      )}
    </div>
  );
}

/* ---------- The frame ---------- */

type Pal = { bg: string; ink: string; sub: string; mark: string };
const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0xff5a1f;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (hex: string, to: [number, number, number], t: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgb(${Math.round(r + (to[0] - r) * t)}, ${Math.round(g + (to[1] - g) * t)}, ${Math.round(b + (to[2] - b) * t)})`;
};
const dark = (hex: string) => {
  const [r, g, b] = hexRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 165;
};

/** The colors of the video, as the Mac's engine takes them from the look (worker/montage/lib/motion.mjs colors). */
export function lookColors(look: Look): Pal {
  if (look.theme === "custom") {
    const f = look.fields?.[0] ?? { bg: "#15161f", ink: "#f7f5ed" };
    return { bg: f.bg, ink: f.ink, sub: mix(f.ink, hexRgb(f.bg), 0.3), mark: look.accent.toLowerCase() === f.bg.toLowerCase() ? f.ink : look.accent };
  }
  if (look.theme === "night") return { bg: "#151514", ink: "#f6f3ec", sub: "#aaa69c", mark: look.accent };
  if (look.theme === "accent") {
    const d = dark(look.accent);
    return { bg: look.accent, ink: d ? "#ffffff" : "#171716", sub: d ? "rgba(255,255,255,0.84)" : "rgba(23,23,22,0.74)", mark: d ? "#ffffff" : "#171716" };
  }
  if (look.theme === "gradient")
    return {
      bg: `radial-gradient(circle at 85% 8%, rgba(255,255,255,0.28), rgba(255,255,255,0) 55%), linear-gradient(150deg, ${mix(look.accent, [255, 255, 255], 0.08)} 0%, ${mix(look.accent, [0, 0, 0], 0.28)} 55%, ${mix(look.accent, [10, 8, 30], 0.72)} 100%)`,
      ink: "#ffffff",
      sub: "rgba(255,255,255,0.84)",
      mark: "#ffffff",
    };
  return { bg: "#f4f1ea", ink: "#1a1917", sub: "#5d5a53", mark: look.accent };
}

export const DISPLAY_FONT: Record<Look["font"], React.CSSProperties> = {
  serif: { fontFamily: "var(--font-display-serif), Georgia, serif", fontWeight: 400, letterSpacing: "-0.01em", lineHeight: 1.02 },
  sans: { fontFamily: "var(--font-geist-sans), system-ui, sans-serif", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.02 },
  grotesque: { fontFamily: "var(--font-grotesque), var(--font-geist-sans), sans-serif", fontWeight: 700, fontStretch: "90%", letterSpacing: "-0.035em", lineHeight: 0.98 },
};
const BODY_FONT: Record<Look["font"], string> = {
  serif: "var(--font-geist-sans), system-ui, sans-serif",
  sans: "var(--font-geist-sans), system-ui, sans-serif",
  grotesque: "var(--font-manrope), var(--font-geist-sans), sans-serif",
};
/** Pixels of the 1080 px wide video, in the frame (a container of inline size). */
const px = (n: number) => `calc(100cqw * ${n} / 1080)`;
const DEFAULT_LOOK: Look = { theme: "night", accent: "#ff5a1f", font: "grotesque", fields: [], grid: false, pill: false, align: "left", valign: "middle", grain: true, numbers: false, handle: "" };

/** A few words at most, so the poster stays a poster. */
function firstWords(text: string, max = 9) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.length > max ? `${words.slice(0, max).join(" ")}…` : words.join(" ");
}

/**
 * A calm poster in the style of the project, in the place of the video: its background, its colors and fonts, the
 * accent shape of the engine and the signature. It reads the request as it is typed.
 */
export function Poster({ look, text, kicker, className }: { look?: Look; text?: string; kicker?: string; className?: string }) {
  const l = look ?? DEFAULT_LOOK;
  const pal = lookColors(l);
  const center = l.align === "center";
  const words = nb(firstWords(text || "")) || "Ta vidéo apparaîtra ici";
  const long = words.length > 34;
  return (
    <div className={cn("absolute inset-0 overflow-hidden [container-type:inline-size]", className)} style={{ background: pal.bg }} aria-hidden>
      {/* Two accent halos, like the engine's decor. */}
      <div className="absolute rounded-full opacity-[0.16] blur-[2px]" style={{ width: px(900), height: px(900), left: px(-260), top: px(-220), background: `radial-gradient(circle, ${pal.mark}, transparent 62%)` }} />
      <div className="absolute rounded-full opacity-[0.1]" style={{ width: px(900), height: px(900), right: px(-380), bottom: px(120), background: `radial-gradient(circle, ${pal.mark}, transparent 62%)` }} />
      {l.grid && <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: `linear-gradient(${pal.ink} 1px, transparent 1px), linear-gradient(90deg, ${pal.ink} 1px, transparent 1px)`, backgroundSize: `${px(64)} ${px(64)}` }} />}
      <div className={cn("absolute flex flex-col", center ? "items-center text-center" : "items-start text-left")} style={{ left: px(90), right: px(90), top: px(720) }}>
        {/* The engine's resting shape: a round accent dot above the text. */}
        <span className="block rounded-full" style={{ width: px(30), height: px(30), background: pal.mark, marginBottom: px(46) }} />
        {kicker && (
          <span className="block uppercase" style={{ fontFamily: BODY_FONT[l.font], color: pal.sub, fontSize: px(34), letterSpacing: "0.08em", marginBottom: px(22), fontWeight: 600 }}>
            {kicker}
          </span>
        )}
        <span className="block text-balance" style={{ ...DISPLAY_FONT[l.font], color: pal.ink, fontSize: px(long ? 86 : 112) }}>
          {words}
        </span>
      </div>
      {l.handle && (
        <span className={cn("absolute", center ? "inset-x-0 text-center" : "")} style={{ left: center ? 0 : px(90), bottom: px(400), fontFamily: BODY_FONT[l.font], color: pal.sub, fontSize: px(34), fontWeight: 500 }}>
          {l.handle}
        </span>
      )}
    </div>
  );
}

/** The storyboard sprite: one tile (180 × 320) per beat, side by side. */
const tileStyle = (url: string, n: number, i: number): React.CSSProperties => ({
  backgroundImage: `url("${url}")`,
  backgroundSize: `${n * 100}% 100%`,
  backgroundPosition: `${n > 1 ? (i / (n - 1)) * 100 : 0}% 0`,
  backgroundRepeat: "no-repeat",
});

/**
 * The storyboard in the frame: the tile of the beat under the render head (cross-fade), and along the bottom the row
 * of small tiles with the render filling it. Before the render: the first tile, a little faded.
 */
export function Storyboard({ url, n, current, fill, className }: { url: string; n: number; current: number; fill?: number; className?: string }) {
  const tiles = useMemo(() => Array.from({ length: n }, (_, i) => i), [n]);
  const before = fill === undefined;
  return (
    <div className={cn("absolute inset-0 bg-black", className)}>
      {tiles.map((i) => (
        <div key={i} className="absolute inset-0 transition-opacity duration-200 ease-out" style={{ ...tileStyle(url, n, i), opacity: i === current ? (before ? 0.7 : 1) : 0 }} />
      ))}
      <div className="absolute inset-x-2.5 bottom-2.5">
        <div className="relative flex gap-[3px] overflow-hidden rounded-md bg-black/35 p-[3px] backdrop-blur-sm">
          {tiles.map((i) => (
            <div
              key={i}
              className={cn("rise aspect-[9/16] min-w-0 flex-1 rounded-[3px] transition-opacity duration-200", i === current && !before ? "opacity-100 ring-1 ring-white/90" : "opacity-60")}
              style={{ ...tileStyle(url, n, i), animationDelay: `${i * 40}ms` }}
            />
          ))}
          {!before && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] origin-left bg-accent transition-transform duration-300" style={{ transform: `scaleX(${Math.min(1, Math.max(0, fill))})` }} />}
        </div>
      </div>
    </div>
  );
}

/** The tile count of a board image read without its record (a failed job keeps the image, not `run.board`). */
export function useBoardTiles(url: string | undefined) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!url) return;
    const img = new Image();
    img.onload = () => setN(img.naturalHeight ? Math.max(1, Math.round(img.naturalWidth / ((img.naturalHeight * 9) / 16))) : 0);
    img.onerror = () => setN(0);
    img.src = url;
    return () => {
      img.onload = img.onerror = null;
    };
  }, [url]);
  return n;
}

/* ---------- Rail cards ---------- */

/** Before the first request: what will happen, in four lines. */
export function IdleCard({ estimate }: { estimate?: string }) {
  const steps = [
    { Icon: Sparkles, text: "Claude écrit la vidéo" },
    { Icon: Film, text: "Vérification et premières images" },
    { Icon: Laptop, text: "Rendu sur ton Mac" },
    { Icon: Check, text: "Tu la regardes ici" },
  ];
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-3.5", ENTER)}>
      <p className="text-[13.5px] font-semibold">Ce qui va se passer</p>
      <ol className="mt-2.5 flex flex-col gap-2">
        {steps.map(({ Icon, text }, i) => (
          <li key={text} className="flex items-center gap-2.5 text-[12.5px] text-ink-2">
            <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-ink/5 font-mono text-[11px] text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1">{text}</span>
            <Icon className="size-3.5 shrink-0 text-ink-3" />
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        {nb(`Un seul plan continu, dans le style du projet : le texte reste entier, le décor ne se fige jamais.${estimate ? ` Compte ${estimate}.` : ""}`)}
      </p>
    </section>
  );
}

/** Text that shows 3 lines, then all of it on « Plus ». */
export function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160 || text.split("\n").length > 3;
  return (
    <div>
      <p className={cn("text-[12px] leading-relaxed whitespace-pre-line text-ink-2", !open && "line-clamp-3")}>{text}</p>
      {long && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press mt-0.5 text-[12px] font-medium text-accent">
          {open ? "Moins" : "Plus"}
        </button>
      )}
    </div>
  );
}

/** The video is there: what it is, and the four things to do with it. */
export function ResultCard({
  job,
  version,
  duration,
  onSend,
  onSchedule,
  onRegenerate,
  busy,
  notesLast,
}: {
  job: MontageJob;
  version: MontageVersion;
  duration?: number;
  onSend: () => void;
  onSchedule: () => void;
  onRegenerate: () => void;
  busy?: "send" | "schedule" | "regen" | null;
  /** Under a failure banner the rail is short: the four actions come before the notes, so they stay in view. */
  notesLast?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const video = version.reel?.video;
  const notes = version.notes ? (
    <div className="rounded-lg bg-surface-2/70 px-2.5 py-2">
      <p className="mb-0.5 text-[11.5px] font-medium text-ink">À savoir</p>
      <Clamp text={version.notes} />
    </div>
  ) : null;
  return (
    <section className={cn("@container flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5", ENTER)}>
      <div>
        <p className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          <Check className="size-4 text-ok" /> Ta vidéo est prête
        </p>
        {video?.title && <p className="mt-1.5 font-display text-[19px] leading-[1.15] text-balance">{nb(video.title)}</p>}
        <p className="tabular mt-1 text-[12px] text-ink-3">
          {duration ? `${Math.round(duration)} s · ` : ""}version {version.n}
        </p>
      </div>
      {!notesLast && notes}
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={onSend} disabled={!!busy}>
          {busy === "send" ? <Loader2 className={cn("size-4", SPIN)} /> : <Library className="size-4" />}
          Envoyer dans la bibliothèque
        </Button>
        <div className="grid grid-cols-2 gap-2">
          {/* In the narrow rail of a large screen the two labels need the whole width: their icons come back when it allows. */}
          <Button onClick={onSchedule} disabled={!!busy} className="px-2">
            {busy === "schedule" ? <Loader2 className={cn("size-4 shrink-0", SPIN)} /> : <CalendarPlus className="hidden size-4 shrink-0 @min-[270px]:block" />}
            Programmer
          </Button>
          <Link href={`/videos/montage/${job.id}`} className="press inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 text-[13.5px] font-medium text-ink shadow-card hover:bg-surface-2">
            <PenLine className="hidden size-4 shrink-0 @min-[270px]:block" /> Retoucher
          </Link>
        </div>
        {confirm ? (
          <div className={cn("rounded-lg border border-line-strong bg-surface-2/60 p-2.5", ENTER)}>
            <p className="text-[12px] leading-relaxed text-ink-2">{nb("Une nouvelle version sera faite ; celle-ci reste dans Retoucher.")}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => (setConfirm(false), onRegenerate())} disabled={!!busy}>
                <RotateCcw className="size-3.5" /> Régénérer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirm(true)} disabled={!!busy}>
            {busy === "regen" ? <Loader2 className={cn("size-4", SPIN)} /> : <RotateCcw className="size-4" />}
            Régénérer
          </Button>
        )}
      </div>
      {notesLast && notes}
    </section>
  );
}

const FAILED_TITLE: Record<ReelAsk | "unknown", string> = {
  regen: "La nouvelle version a échoué",
  retouch: "La dernière retouche a échoué",
  edit: "Le nouvel aperçu a échoué",
  unknown: "La dernière demande a échoué",
};

/**
 * The last request failed: the last good video stays, the cause above it, and the way to try again that fits what was
 * asked. A regeneration is tried again here; a retouch or edits by hand go back to the editing screen. When nobody
 * knows what was asked (another device), both ways are offered, the regeneration with its confirmation.
 */
export function FailedBanner({ error, ask, jobId, onRegenerate, busy }: { error: string; ask?: ReelAsk; jobId: string; onRegenerate: () => void; busy?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  // Two lines of the cause, the rest on « Détails »: the video's actions stay in view under the banner.
  const [more, setMore] = useState(false);
  const cause = nb(error.trim() || "Le Mac n'a pas dit pourquoi.");
  const long = cause.length > 90 || cause.includes("\n");
  const edit = (
    <Link href={`/videos/montage/${jobId}`} className="press inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink shadow-card hover:bg-surface-2">
      <PenLine className="size-3.5" /> {ask === "retouch" ? "Reprendre la retouche" : "Ouvrir la retouche"}
    </Link>
  );
  return (
    // Not a live region: the Studio's status line (announceText) reads its title out once.
    <section className={cn("rounded-xl border border-danger/35 bg-danger/8 p-3", ENTER)}>
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-danger">
        <AlertTriangle className="size-3.5 shrink-0" /> {FAILED_TITLE[ask ?? "unknown"]}
      </p>
      {ask === "edit" && <p className="mt-1 text-[12px] leading-relaxed font-medium text-ink">{nb("Tes modifications à la main n'ont pas été gardées : refais-les dans la retouche.")}</p>}
      <p className={cn("mt-1 text-[12px] leading-relaxed whitespace-pre-line text-ink-2", !more && "line-clamp-2")}>{cause}</p>
      {long && (
        <button onClick={() => setMore((m) => !m)} aria-expanded={more} className="press mt-0.5 text-[12px] font-medium text-accent">
          {more ? "Moins de détails" : "Détails"}
        </button>
      )}
      {confirm ? (
        <div className={cn("mt-2 rounded-lg border border-line-strong bg-surface p-2.5", ENTER)}>
          <p className="text-[12px] leading-relaxed text-ink-2">{nb("Claude repart de ta demande avec une autre idée ; la vidéo affichée reste dans Retoucher.")}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => (setConfirm(false), onRegenerate())} disabled={busy}>
              <RotateCcw className="size-3.5" /> Régénérer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {ask === "regen" ? (
            <Button size="sm" onClick={onRegenerate} disabled={busy}>
              <RotateCcw className="size-3.5" /> Réessayer
            </Button>
          ) : (
            edit
          )}
          {!ask && (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} disabled={busy}>
              <RotateCcw className="size-3.5" /> Régénérer
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** "14:02": the time of a read, in this browser's clock. */
const hourText = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * The site stopped answering: the screen shows the last good read and says how old it is (the bar and the remaining
 * time stand still meanwhile). It goes away at the first answer.
 */
export function StaleNote({ at }: { at?: number }) {
  return (
    <p role="status" className={cn("flex items-start gap-2 rounded-lg border border-line bg-surface-2/70 px-2.5 py-2 text-[12px] leading-relaxed text-ink-2", ENTER)}>
      <CloudOff className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
      <span className="min-w-0">{nb(at ? `Le site ne répond pas : l'état affiché date de ${hourText(at)}. Nouvel essai automatique.` : "Le site ne répond pas. Nouvel essai dans quelques secondes.")}</span>
    </p>
  );
}

/** The video went to the library: schedule it, see it there, or start another. */
export function LibraryCard({ title, onSchedule, onNew }: { title?: string; onSchedule: () => void; onNew: () => void }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5", ENTER)}>
      <div>
        <p className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          <Check className="size-4 text-ok" /> Dans ta bibliothèque
        </p>
        {title && <p className="mt-1.5 font-display text-[19px] leading-[1.15] text-balance">{nb(title)}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={onSchedule}>
          <CalendarPlus className="size-4" /> Programmer
        </Button>
        <Link href="/videos" className="press inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] font-medium text-ink shadow-card hover:bg-surface-2">
          <Library className="size-4" /> Voir la bibliothèque
        </Link>
        <Button variant="ghost" onClick={onNew}>
          <Sparkles className="size-4" /> Nouvelle vidéo
        </Button>
      </div>
    </section>
  );
}

/** The first generation failed: the cause in plain words, try again, or change the request. */
export function ErrorCard({ error, onRetry, onEdit, busy }: { error?: string; onRetry: () => void; onEdit: () => void; busy?: boolean }) {
  const [more, setMore] = useState(false);
  const cause = nb((error || "Le Mac n'a pas dit pourquoi.").trim());
  const short = cause.length > 300 ? `${cause.slice(0, 300).trimEnd()}…` : cause;
  return (
    // Not a live region: the Studio's status line (announceText) reads its title out once.
    <section className={cn("flex flex-col gap-3 rounded-xl border border-danger/35 bg-danger/8 p-3.5", ENTER)}>
      <div>
        <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-danger">
          <AlertTriangle className="size-4" /> La vidéo n&apos;a pas pu être générée.
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{more ? cause : short}</p>
        {cause.length > 300 && (
          <button onClick={() => setMore((m) => !m)} className="press mt-1 text-[12px] font-medium text-accent">
            {more ? "Moins de détails" : "Détails"}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={onRetry} disabled={busy}>
          {busy ? <Loader2 className={cn("size-4", SPIN)} /> : <RotateCcw className="size-4" />}
          Réessayer
        </Button>
        <Button onClick={onEdit} disabled={busy}>
          <PenLine className="size-4" /> Modifier la demande
        </Button>
      </div>
    </section>
  );
}
