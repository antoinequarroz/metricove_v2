"use client";

import { Clapperboard, FolderOpen, KeyRound, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { inputClass } from "../montage/look-parts";
import { fmtSec } from "../montage/parts";
import { ResourceShell } from "./shell";

type MacShot = { name: string; thumb?: string; dur?: number };

/** Médias → Ressources → B-roll: what the montage can cut in, from the Mac folder, the library and Pexels. */
export function BrollPage() {
  const [mine, setMine] = useState<{ list: MacShot[]; at?: string } | null>(null);
  const [pexels, setPexels] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const media = useStore((s) => s.media);
  const videos = useMemo(() => media.filter((m) => m.kind === "video" && m.url), [media]);

  useEffect(() => {
    fetch("/api/broll")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Erreur ${r.status}`))))
      .then((b: { mine: { list: MacShot[]; at?: string } | MacShot[]; pexels: boolean }) => {
        setMine(Array.isArray(b.mine) ? { list: b.mine } : b.mine);
        setPexels(b.pexels);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const shots = (mine?.list ?? []).filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <ResourceShell intro="Les plans que le montage peut glisser par-dessus ta voix. Ils viennent de trois endroits : le dossier B-roll de ton Mac, les vidéos de la Bibliothèque, et Pexels. Dans l'écran de montage, la piste B-roll les propose tous.">
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <Source Icon={FolderOpen} title="Dossier du Mac" text={mine ? `${mine.list.length} plan${mine.list.length > 1 ? "s" : ""} dans ~/Movies/Metricove/broll` : error ? `Illisible : ${error}` : "Lecture…"} />
        <Source Icon={Clapperboard} title="Bibliothèque" text={`${videos.length} vidéo${videos.length > 1 ? "s" : ""} utilisable${videos.length > 1 ? "s" : ""}`} href="/videos" />
        <Source Icon={KeyRound} title="Pexels" text={pexels === null ? "…" : pexels ? "Recherche activée" : "Ajoute une clé dans Réglages pour chercher des plans"} href={pexels ? undefined : "/settings"} warn={pexels === false} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-semibold">Dossier du Mac</h2>
        <label className="relative ml-auto min-w-0 max-sm:w-full">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un plan" aria-label="Chercher un plan" className={cn(inputClass, "h-9 w-64 pl-8 max-sm:w-full")} />
        </label>
      </div>
      {mine && !mine.list.length ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-ink-3">
          Le dossier B-roll du Mac est vide. Dépose des vidéos dans ~/Movies/Metricove/broll : le Mac les envoie ici avec une vignette.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {shots.map((s) => (
            <div key={s.name} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              <div className="relative aspect-video bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s.thumb && <img src={s.thumb} alt="" className="size-full object-cover" />}
                {s.dur ? <span className="absolute right-1.5 bottom-1.5 rounded bg-black/65 px-1 text-[10.5px] tabular-nums text-white">{fmtSec(s.dur)}</span> : null}
              </div>
              <p className="truncate px-2.5 py-2 text-[12px]" title={s.name}>
                {s.name.replace(/\.[^.]+$/, "")}
              </p>
            </div>
          ))}
        </div>
      )}
    </ResourceShell>
  );
}

function Source({ Icon, title, text, href, warn }: { Icon: typeof FolderOpen; title: string; text: string; href?: string; warn?: boolean }) {
  const body = (
    <>
      <Icon className={cn("size-4 shrink-0", warn ? "text-warn" : "text-accent")} />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[12px] text-ink-3">{text}</span>
      </span>
    </>
  );
  const cls = "flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-card";
  return href ? (
    <Link href={href} className={cn(cls, "press hover:border-ink-3/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
