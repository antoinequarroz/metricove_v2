"use client";

import { Clapperboard, Film, GalleryHorizontalEnd, Laptop, Scissors, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MontageJob } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type WorkerStatus } from "./use-montage";

const TABS = [
  { href: "/videos", label: "Bibliothèque", Icon: Film },
  { href: "/videos/montage", label: "Montage IA", Icon: Scissors },
  { href: "/videos/studio", label: "Studio", Icon: Clapperboard },
];

/** Tabs at the top of the video pages. */
export function VideoTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex rounded-lg border border-line bg-bg-2/70 p-0.5" aria-label="Vidéos">
      {TABS.map(({ href, label, Icon }) => {
        const on = href === "/videos" ? pathname === "/videos" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150",
              on ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon className={cn("size-3.5", on ? "text-accent" : "")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

const STUDIO_TABS = [
  { href: "/videos/studio", label: "Vidéo face caméra", Icon: Video },
  { href: "/videos/studio/visuels", label: "Carrousel et photo", Icon: GalleryHorizontalEnd },
  { href: "/videos/studio/anime", label: "Reel animé", Icon: Sparkles },
];

/** What the Studio makes: a video in front of the camera, visuals (carousel, photo post), or an animated reel. */
export function StudioTabs() {
  const pathname = usePathname();
  return (
    <nav className="scroll-thin flex max-w-full overflow-x-auto rounded-lg border border-line bg-bg-2/70 p-0.5" aria-label="Studio">
      {STUDIO_TABS.map(({ href, label, Icon }) => {
        const on = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150",
              on ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon className={cn("size-4", on ? "text-accent" : "")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-4 border-b border-line px-6 pt-5 pb-4 max-md:px-4">
      <div>
        <p className="text-[12px] font-medium text-ink-3">{kicker}</p>
        <h1 className="font-display text-[34px] leading-[1.05]">{title}</h1>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

const TONE = {
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/12 text-warn",
  danger: "bg-danger/12 text-danger",
  muted: "bg-ink/5 text-ink-3",
};

export function JobStatus({ job }: { job: MontageJob }) {
  const s = STATUS_LABEL[job.status];
  const live = job.status === "working" || job.status === "rendering";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium", TONE[s.tone])}>
      <span className={cn("size-1.5 rounded-full bg-current", live && "animate-pulse")} />
      {s.label}
    </span>
  );
}

export function Progress({ value }: { value?: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-line">
      {value === undefined ? (
        <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
      ) : (
        <div className="h-full origin-left rounded-full bg-accent transition-transform duration-300" style={{ transform: `scaleX(${value})` }} />
      )}
    </div>
  );
}

/** Is the Mac there to do the work? */
export function WorkerBanner({ worker }: { worker?: WorkerStatus }) {
  const online = worker?.online;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-[13px]">
      <span className={cn("flex size-8 items-center justify-center rounded-lg", online ? "bg-ok/12 text-ok" : "bg-warn/12 text-warn")}>
        <Laptop className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{online ? "Ton Mac est connecté" : "Ton Mac n'est pas connecté"}</p>
        <p className="text-ink-3">
          {online
            ? "Il transcrit, monte avec Claude et HyperFrames, puis envoie les aperçus ici."
            : worker?.lastSeen
              ? `Vu pour la dernière fois ${new Date(worker.lastSeen).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" })}. Les demandes attendent son retour.`
              : "Le programme de montage n'a pas encore été lancé sur le Mac. Les demandes attendent son retour."}
        </p>
      </div>
    </div>
  );
}

export const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} Go` : `${Math.max(1, Math.round(b / 1e6))} Mo`);
