"use client";

import { Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AssetKind } from "@/lib/library";
import { ASSET_WORKER, MAX_ASSET_COUNT, MAX_ASSET_PROMPT, type MontageJob } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { atLeast } from "../brand-reading";
import { inputClass } from "../montage/look-parts";
import { JobStatus, Progress } from "../montage/parts";
import { montageApi, useMontage } from "../montage/use-montage";
import { Button } from "../ui";

const IDEAS: Record<AssetKind, string[]> = {
  illustration: ["un robot sympa, style tech", "une ampoule qui s'allume", "une flèche dessinée à la main", "un écran de code", "une pile de livres", "un cerveau avec des circuits"],
  music: [],
  sfx: ["un whoosh court pour une transition", "un pop léger quand un mot apparaît", "un click de souris", "un thud grave pour un chiffre", "un ding de notification", "une montée (riser) d'une seconde"],
};
const WORKER_MIN = ASSET_WORKER.split(".").map(Number);

/**
 * "Créer avec Claude": a description, how many, the style; the Mac draws the illustrations in the colors of the style
 * (SVG) or makes the sound effects (ElevenLabs when it has a key, else FFmpeg), then puts them in the library.
 */
export function AssetMaker({ kind, styles, styleRef, onDone }: { kind: AssetKind; styles: { ref: string; label: string }[]; styleRef?: string; onDone: () => void }) {
  const { data, refresh } = useMontage();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(kind === "sfx" ? 2 : 3);
  const [style, setStyle] = useState(styleRef ?? styles[0]?.ref ?? "");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (styleRef) setStyle(styleRef);
  }, [styleRef]);
  useEffect(() => {
    if (!style && styles[0]) setStyle(styles[0].ref);
  }, [style, styles]);

  const worker = data?.worker;
  const old = !!worker?.version && !atLeast(worker.version, WORKER_MIN);
  const jobs = (data?.jobs ?? []).filter((j) => j.kind === "asset" && j.asset?.kind === kind).slice(0, 4);
  // A job seen running that is now done: the library is read again.
  const before = useRef(new Map<string, MontageJob["status"]>());
  useEffect(() => {
    for (const j of jobs) {
      const was = before.current.get(j.id);
      if (j.status === "done" && was && was !== "done") {
        onDone();
        toast.success(kind === "sfx" ? "Bruitages ajoutés" : "Illustrations ajoutées", { description: j.asset?.prompt });
      }
      before.current.set(j.id, j.status);
    }
  }, [jobs, kind, onDone]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !prompt.trim()) return;
    setSending(true);
    try {
      const [projectId, styleId] = style.split(":");
      await montageApi("/api/montage/jobs", { method: "POST", body: JSON.stringify({ kind: "asset", assetKind: kind, prompt, count, projectId, styleId }) });
      setPrompt("");
      setOpen(false);
      refresh();
    } catch (err) {
      toast.error("Demande non envoyée", { description: (err as Error).message });
    } finally {
      setSending(false);
    }
  };
  const dismiss = (j: MontageJob) => montageApi(`/api/montage/jobs/${j.id}`, { method: "DELETE" }).then(refresh, (e: Error) => toast.error(e.message));

  return (
    <div className="mb-4 flex flex-col gap-2">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2/50 px-3.5 py-2.5">
          <Sparkles className="size-4 shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">
            {kind === "sfx" ? "Il te manque un son ? Décris-le, ton Mac le fabrique et le range dans le style." : "Il te manque une image ? Décris-la, Claude la dessine aux couleurs du style et la range dedans."}
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Sparkles className="size-3.5" />
            Créer avec Claude
          </Button>
        </div>
      ) : (
        <form onSubmit={send} className="rise flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/30 p-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            <p className="min-w-0 flex-1 text-[13px] font-medium">{kind === "sfx" ? "Nouveaux bruitages" : "Nouvelles illustrations"}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="press grid size-7 place-items-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
          <textarea
            autoFocus
            aria-label="Description"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && send(e)}
            rows={2}
            maxLength={MAX_ASSET_PROMPT}
            placeholder={kind === "sfx" ? "Par ex. « un whoosh court et aérien pour passer d'une idée à l'autre »" : "Par ex. « un robot sympa qui tient un livre, style plat, sans texte »"}
            className={cn(inputClass, "resize-y py-2 leading-snug")}
          />
          <div className="flex flex-wrap gap-1">
            {IDEAS[kind].map((x) => (
              <button key={x} type="button" onClick={() => setPrompt(x)} className="press rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 hover:text-ink">
                {x}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              Combien
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Combien" className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none">
                {Array.from({ length: MAX_ASSET_COUNT }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {styles.length > 0 && (
              <label className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2">
                Style
                <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Style" className="h-9 min-w-0 max-w-64 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none">
                  {styles.map((o) => (
                    <option key={o.ref} value={o.ref}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button type="submit" variant="primary" size="sm" className="ml-auto h-9" disabled={sending || !prompt.trim() || old}>
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Créer
            </Button>
          </div>
          {old && (
            <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-ink-2">
              Le programme du Mac doit d&apos;abord être mis à jour (version {ASSET_WORKER}) : <code className="font-mono text-[11.5px]">git pull</code> puis redémarrer « montage » dans Portly.
            </p>
          )}
          {worker && !worker.online && !old && <p className="text-[12px] text-ink-3">Ton Mac n&apos;est pas connecté : la demande attendra son retour.</p>}
        </form>
      )}
      {jobs.map((j) => (
        <div key={j.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12.5px] shadow-card">
          <JobStatus job={j} />
          <div className="min-w-0 flex-1">
            <p className="truncate">{j.asset?.prompt}</p>
            {j.status === "failed" ? (
              <p className="truncate text-danger">{j.error}</p>
            ) : j.status === "done" ? (
              <p className="text-ink-3">{j.asset?.result?.length ?? 0} ajouté{(j.asset?.result?.length ?? 0) > 1 ? "s" : ""} dans {j.asset?.style ?? "la bibliothèque"}</p>
            ) : (
              <>
                <p className="truncate text-ink-3">{j.step ?? (j.status === "queued" ? "En attente du Mac" : "…")}</p>
                {j.status === "working" && (
                  <div className="mt-1.5">
                    <Progress value={j.progress} />
                  </div>
                )}
              </>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => dismiss(j)} title={j.status === "queued" || j.status === "working" ? "Annuler" : "Retirer de la liste"}>
            {j.status === "queued" || j.status === "working" ? "Annuler" : <X className="size-3.5" />}
          </Button>
        </div>
      ))}
    </div>
  );
}
