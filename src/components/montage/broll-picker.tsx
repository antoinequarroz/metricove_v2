"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { Clapperboard, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Broll, MontageFormat } from "@/lib/montage";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { Segmented } from "./controls";
import { fmtSec } from "./parts";

/** What a pick changes on the B-roll shot. */
export type BrollPick = Pick<Broll, "source" | "ref" | "url" | "thumb" | "query">;

type MacShot = { name: string; thumb?: string; dur?: number };
type PexelsHit = { id: string; image: string; dur: number; w: number; h: number; preview?: string; url: string; author?: string };
type Tab = "mine" | "library" | "pexels";

const nameOf = (file: string) => file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
/** A smaller copy of a Pexels picture for the timeline block. */
const smallPexels = (image: string) => {
  try {
    const u = new URL(image);
    u.searchParams.set("w", "240");
    u.searchParams.delete("h");
    u.searchParams.set("fit", "crop");
    return u.toString();
  } catch {
    return image;
  }
};

/**
 * Picks the picture of a B-roll shot: a file of the Mac B-roll folder, a video of the Metricove library, or a Pexels
 * video (search with preview on hover). The Mac fetches the file at the next preview.
 */
export function BrollPicker({ open, onOpenChange, format, query, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; format: MontageFormat; query: string; onPick: (p: BrollPick) => void }) {
  const [tab, setTab] = useState<Tab>("mine");
  const [mine, setMine] = useState<{ list: MacShot[]; at?: string } | null>(null);
  const [pexelsOn, setPexelsOn] = useState<boolean | null>(null);
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState(query === "illustration" ? "" : query);
  const [hits, setHits] = useState<PexelsHit[] | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const media = useStore((s) => s.media);
  const videos = useMemo(() => media.filter((m) => m.kind === "video" && m.url), [media]);

  useEffect(() => {
    if (!open) return;
    setQ(query === "illustration" ? "" : query);
    setFilter("");
    setHits(null);
    setError("");
    fetch("/api/broll")
      .then((r) => r.json())
      .then((j: { mine: { list: MacShot[]; at?: string }; pexels: boolean }) => {
        setMine(j.mine);
        setPexelsOn(j.pexels);
        // Opens where there is something to pick.
        setTab(j.mine.list.length ? "mine" : j.pexels ? "pexels" : "library");
      })
      .catch(() => setMine({ list: [] }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async (p = 1) => {
    if (!q.trim()) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/broll/pexels?${new URLSearchParams({ q: q.trim(), format, page: String(p) })}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Erreur ${r.status}`);
      setHits((h) => (p === 1 ? j.hits : [...(h ?? []), ...j.hits]));
      setMore(j.more);
      setPage(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  // The Pexels tab searches the shot's description right away.
  useEffect(() => {
    if (open && tab === "pexels" && pexelsOn && hits === null && q.trim() && !loading) search(1);
  }, [open, tab, pexelsOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (p: BrollPick) => {
    onPick(p);
    onOpenChange(false);
  };
  const shown = (mine?.list ?? []).filter((m) => !filter.trim() || m.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const shownVideos = videos.filter((m) => !filter.trim() || m.title.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-40 bg-[rgba(15,14,12,0.38)] backdrop-blur-[3px]" />
        <Dialog.Popup className="dialog-popup fixed top-1/2 left-1/2 z-50 flex h-[min(680px,calc(100dvh-32px))] w-[min(920px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] outline-none">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-semibold">Choisir le plan</Dialog.Title>
            <Segmented
              label="Source du plan"
              value={tab}
              onChange={setTab}
              options={[
                { value: "mine", label: `Mes plans${mine?.list.length ? ` (${mine.list.length})` : ""}` },
                { value: "library", label: "Bibliothèque" },
                { value: "pexels", label: "Pexels" },
              ]}
            />
            <Dialog.Close className="ml-auto grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" aria-label="Fermer">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            {tab === "pexels" ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  search(1);
                }}
              >
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Par ex. pile de livres, café, bibliothèque" aria-label="Recherche Pexels" disabled={!pexelsOn} className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent/60" />
                <Button variant="primary" disabled={!pexelsOn || !q.trim() || loading}>
                  <Search className="size-4" /> {loading ? "Recherche…" : "Chercher"}
                </Button>
              </form>
            ) : (
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tab === "mine" ? "Filtrer par nom de fichier" : "Filtrer par titre"} aria-label="Filtrer" className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent/60" />
            )}
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "mine" &&
              (shown.length ? (
                <Grid>
                  {shown.map((m) => (
                    <Card key={m.name} title={m.name} sub={m.dur ? fmtSec(m.dur) : undefined} image={m.thumb} onClick={() => pick({ source: "mine", ref: m.name, thumb: m.thumb, query: nameOf(m.name).slice(0, 80) || "plan" })} />
                  ))}
                </Grid>
              ) : (
                <Empty>
                  {mine?.list.length
                    ? "Aucun plan ne porte ce nom."
                    : "Ton dossier ~/Movies/Metricove/broll est vide (ou le Mac n'a pas encore la version 0.13.0). Mets-y des vidéos avec des noms qui disent ce qu'on voit, par ex. « pile-de-livres.mp4 » : elles apparaissent ici quelques secondes plus tard."}
                </Empty>
              ))}
            {tab === "library" &&
              (shownVideos.length ? (
                <Grid>
                  {shownVideos.map((m) => (
                    <Card
                      key={m.id}
                      title={m.title}
                      sub={fmtSec(m.duration)}
                      image={m.cover}
                      video={m.url}
                      onClick={() => pick({ source: "library", ref: m.id, thumb: m.cover ? `/api/media/${m.id}/cover` : undefined, query: m.title.slice(0, 80) || "vidéo" })}
                    />
                  ))}
                </Grid>
              ) : (
                <Empty>Aucune vidéo dans la bibliothèque.</Empty>
              ))}
            {tab === "pexels" &&
              (pexelsOn === false ? (
                <Empty>
                  Pour chercher sur Pexels, ajoute une clé gratuite dans{" "}
                  <Link href="/settings" className="underline underline-offset-2">
                    Réglages
                  </Link>
                  . Sans clé, décris le plan et le Mac le cherche dans ton dossier.
                </Empty>
              ) : error ? (
                <Empty>{error}</Empty>
              ) : hits?.length ? (
                <>
                  <Grid>
                    {hits.map((h) => (
                      <Card
                        key={h.id}
                        title={h.author ? `Pexels · ${h.author}` : "Pexels"}
                        sub={fmtSec(h.dur)}
                        image={h.image}
                        video={h.preview}
                        onClick={() => pick({ source: "pexels", ref: h.id, url: h.url, thumb: smallPexels(h.image), query: q.trim().slice(0, 80) })}
                      />
                    ))}
                  </Grid>
                  {more && (
                    <div className="mt-4 flex justify-center">
                      <Button onClick={() => search(page + 1)} disabled={loading}>
                        {loading ? "Chargement…" : "Plus de résultats"}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <Empty>{loading ? "Recherche…" : hits ? "Rien trouvé : essaie d'autres mots, en anglais parfois ça marche mieux." : "Écris ce que le plan doit montrer, puis Chercher."}</Empty>
              ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto max-w-md py-12 text-center text-[13px] text-ink-3">{children}</p>;
}

/** One shot to pick: its picture, and its video playing while the pointer is on it. */
function Card({ title, sub, image, video, onClick }: { title: string; sub?: string; image?: string; video?: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (hover) v.play().catch(() => {});
    else v.pause();
  }, [hover]);
  return (
    <button onClick={onClick} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} className="group flex flex-col gap-1.5 text-left" title={title}>
      <span className={cn("relative block aspect-[9/16] w-full overflow-hidden rounded-lg border border-line bg-surface-2 transition-[border-color,box-shadow]", "group-hover:border-accent/60 group-focus-visible:ring-2 group-focus-visible:ring-accent")}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        ) : (
          !video && <Clapperboard className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-ink-3" />
        )}
        {video && (hover || !image) && <video ref={ref} src={video} muted loop playsInline preload={image ? "none" : "metadata"} className="absolute inset-0 size-full object-cover" />}
      </span>
      <span className="truncate text-[12px] text-ink-2">{title}</span>
      {sub && <span className="-mt-1 font-mono text-[11px] text-ink-3">{sub}</span>}
    </button>
  );
}
