"use client";

import { ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { MontageJob } from "@/lib/montage";
import { useStore } from "@/lib/store";
import type { Media } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

async function call<T>(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data as T;
}

/**
 * The image shown on the profile grid for a video (Instagram "cover").
 * Claude makes it on the Mac in the project's style, or Antoine imports one.
 */
export function CoverControl({ media, accountIds, tone = "light" }: { media: Media; accountIds?: string[]; tone?: "light" | "dark" }) {
  const load = useStore((s) => s.load);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dark = tone === "dark";
  const ghost = dark ? "text-white/70 hover:bg-white/10 hover:text-white" : undefined;

  const upload = async (file: File) => {
    if (!/^image\/(jpeg|png)$/.test(file.type)) return toast.error("Formats acceptés : JPEG ou PNG");
    setBusy("Envoi…");
    try {
      await call(`/api/media/${media.id}/cover`, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      await load();
      toast.success("Couverture enregistrée");
    } catch (e) {
      toast.error("Couverture refusée", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    setBusy("Claude prépare…");
    let jobId: string | undefined;
    try {
      const { worker } = await call<{ worker: { online: boolean } }>("/api/montage");
      if (!worker.online) throw new Error("Ton Mac est éteint ou en veille : allume-le, puis réessaie.");
      const { job } = await call<{ job: MontageJob }>("/api/montage/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "cover", mediaId: media.id, accountIds }),
      });
      jobId = job.id;
      const until = Date.now() + 5 * 60_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2500));
        const { job: j } = await call<{ job: MontageJob }>(`/api/montage/jobs/${job.id}`);
        if (j.step) setBusy(j.step);
        if (j.status === "failed") throw new Error(j.error ?? "Le Mac n'a pas pu faire la couverture");
        if (j.status === "done") {
          await load();
          toast.success("Couverture prête", { description: "Elle partira avec la vidéo sur Instagram." });
          return;
        }
      }
      throw new Error("Le Mac met trop de temps à répondre");
    } catch (e) {
      toast.error("Pas de couverture", { description: (e as Error).message });
    } finally {
      if (jobId) fetch(`/api/montage/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("…");
    try {
      await call(`/api/media/${media.id}/cover`, { method: "DELETE" });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "relative aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-md",
          dark ? "bg-white/10 ring-1 ring-white/15" : "bg-surface-2 ring-1 ring-line",
          busy && "animate-pulse",
        )}
      >
        {media.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.cover} alt="Couverture" className="size-full object-cover" />
        ) : (
          <span className={cn("absolute inset-0 flex items-center justify-center px-1 text-center text-[9.5px] leading-tight", dark ? "text-white/50" : "text-ink-3")}>
            1re image
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[12.5px] font-medium", dark ? "text-white" : "text-ink")}>Couverture du feed</p>
        <p className={cn("truncate text-[11.5px]", dark ? "text-white/55" : "text-ink-3")}>
          {busy ?? (media.cover ? "Envoyée à Instagram avec la vidéo" : "Sans couverture, Instagram prend la 1re image")}
        </p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button size="sm" variant={media.cover ? "ghost" : "primary"} className={media.cover ? ghost : undefined} type="button" disabled={!!busy} onClick={generate} title="Claude fait la couverture dans le style du projet">
        <Sparkles className="size-3.5" />
        {media.cover ? "Refaire" : "Générer"}
      </Button>
      <Button size="sm" variant="ghost" className={ghost} type="button" disabled={!!busy} onClick={() => input.current?.click()} aria-label="Importer une image" title="Importer une image">
        <ImagePlus className="size-3.5" />
      </Button>
      {media.cover && (
        <Button size="sm" variant="ghost" className={ghost} type="button" disabled={!!busy} onClick={remove} aria-label="Retirer la couverture" title="Retirer">
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
