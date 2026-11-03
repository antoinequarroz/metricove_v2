"use client";

import { CalendarPlus, FolderSync, Sparkles } from "lucide-react";
import { useState } from "react";
import { Segmented } from "./calendar";
import { useStore } from "@/lib/store";
import { cn, duration, fmt } from "@/lib/utils";
import { Button, MediaThumb, SourceTag } from "./ui";

type Filter = "all" | "new" | "used";

export function VideosPage() {
  const media = useStore((s) => s.media);
  const posts = useStore((s) => s.posts);
  const openComposer = useStore((s) => s.openComposer);
  const [filter, setFilter] = useState<Filter>("all");

  const usedBy = (id: string) => posts.filter((p) => p.mediaId === id);
  const list = media.filter((m) => (filter === "all" ? true : filter === "new" ? usedBy(m.id).length === 0 : usedBy(m.id).length > 0));

  return (
    <>
      <header className="flex flex-wrap items-end gap-4 border-b border-line px-6 pt-5 pb-4 max-md:px-4">
        <div>
          <p className="text-[12px] font-medium text-ink-3">Bibliothèque</p>
          <h1 className="font-display text-[34px] leading-[1.05]">Vidéos</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Toutes" },
              { value: "new", label: "À programmer" },
              { value: "used", label: "Programmées" },
            ]}
          />
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <FolderSync className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-medium">Import automatique depuis Claude Code</p>
            <p className="text-ink-3">Chaque vidéo déposée dans le dossier de sortie apparaîtra ici en brouillon. Le branchement arrive à l&apos;étape 3.</p>
          </div>
          <Button size="sm" disabled>
            Configurer
          </Button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
          {list.map((m, i) => {
            const uses = usedBy(m.id);
            return (
              <article key={m.id} className="rise group flex flex-col" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="relative">
                  <MediaThumb media={m} className="aspect-[9/14] w-full shadow-card" />
                  <SourceTag source={m.source} onMedia className="absolute top-2 left-2" />
                  {uses.length === 0 && (
                    <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-px text-[10.5px] font-medium text-white">
                      <Sparkles className="size-3" /> Nouveau
                    </span>
                  )}
                  <div className="absolute inset-x-2 bottom-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button size="sm" variant="primary" className="w-full" onClick={() => openComposer({ mediaId: m.id })}>
                      <CalendarPlus className="size-3.5" />
                      Programmer
                    </Button>
                  </div>
                </div>
                <h3 className="mt-2.5 line-clamp-1 text-[13.5px] font-medium">{m.title}</h3>
                <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                  <span className="tabular font-mono">{duration(m.duration)}</span>·<span>{m.aspect}</span>·<span>{fmt(m.createdAt, "d MMM")}</span>
                </p>
                <p className={cn("mt-1 text-[12px]", uses.length ? "text-ink-2" : "text-accent")}>
                  {uses.length ? `Utilisée dans ${uses.length} post${uses.length > 1 ? "s" : ""}` : "Pas encore programmée"}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
