"use client";

import { Loader2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MAX_STYLE_REFS, STYLE_WORKER, type MontageJob } from "@/lib/montage";
import { DEFAULT_STYLE, MAX_STYLE_NAME, type StyleProfile } from "@/lib/profiles";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { atLeast } from "../brand-reading";
import { inputClass } from "../montage/look-parts";
import { JobStatus, Progress } from "../montage/parts";
import { montageApi, useMontage } from "../montage/use-montage";
import { Button } from "../ui";

const WORKER_MIN = STYLE_WORKER.split(".").map(Number);

/**
 * « Copier un créateur »: up to 3 reels (links the Mac reads with yt-dlp, or videos of the Médias library). The Mac
 * measures them (shots, sound, words per minute, frames) and Claude writes a new style from them; it appears here.
 */
export function StyleCopier({ project, list, onDone }: { project: Project; list: StyleProfile[]; onDone: (styleId?: string) => void }) {
  const { data, refresh } = useMontage();
  const media = useStore((s) => s.media).filter((m) => m.kind === "video");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [links, setLinks] = useState(["", "", ""]);
  const [picked, setPicked] = useState<string[]>([]);
  const [from, setFrom] = useState(DEFAULT_STYLE);
  const [sending, setSending] = useState(false);
  const old = !!data?.worker?.version && !atLeast(data.worker.version, WORKER_MIN);
  const jobs = (data?.jobs ?? []).filter((j) => j.kind === "style" && j.styleTask?.mode === "copy" && j.projectId === project.id).slice(0, 3);
  const refs = [...links.map((u) => u.trim()).filter(Boolean).map((url) => ({ url })), ...picked.map((mediaId) => ({ mediaId }))];

  // A copy seen running that is now done: the styles are read again and the new one opens.
  const before = useRef(new Map<string, MontageJob["status"]>());
  useEffect(() => {
    for (const j of jobs) {
      const was = before.current.get(j.id);
      if (j.status === "done" && was && was !== "done") {
        onDone(j.styleTask?.result?.styleId);
        toast.success(`Style « ${j.styleTask?.name} » créé`, { description: "Relis ses notes et ses couleurs, puis essaie-le sur un montage." });
      }
      before.current.set(j.id, j.status);
    }
  }, [jobs, onDone]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !refs.length) return;
    setSending(true);
    try {
      await montageApi("/api/montage/jobs", { method: "POST", body: JSON.stringify({ kind: "style", mode: "copy", projectId: project.id, styleId: from, name: name.trim() || "Style copié", refs: refs.slice(0, MAX_STYLE_REFS) }) });
      setOpen(false);
      setLinks(["", "", ""]);
      setPicked([]);
      setName("");
      refresh();
    } catch (err) {
      toast.error("Demande non envoyée", { description: (err as Error).message });
    } finally {
      setSending(false);
    }
  };
  const dismiss = (j: MontageJob) => montageApi(`/api/montage/jobs/${j.id}`, { method: "DELETE" }).then(refresh, (e: Error) => toast.error(e.message));

  return (
    <>
      {!open && (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="Colle jusqu'à 3 reels d'un créateur : Claude en tire un nouveau style">
          <Wand2 className="size-3.5" /> Copier un créateur
        </Button>
      )}
      {(open || jobs.length > 0) && (
        <div className="order-last flex w-full flex-col gap-2">
          {open && (
            <form onSubmit={send} className="rise flex flex-col gap-2 rounded-xl border border-line bg-surface-2/50 p-3">
              <p className="text-[12.5px] text-pretty text-ink-2">
                Colle jusqu&apos;à {MAX_STYLE_REFS} reels du créateur dont tu aimes le montage, ou choisis des vidéos de ta bibliothèque. Ton Mac les mesure (durée des plans, son, débit de parole, images clés) et Claude en tire un nouveau style : sa police, ses couleurs, le dessin et la place des sous-titres, ses notes de montage, et des images clés que Claude regardera en montant.
              </p>
              <div className="flex flex-wrap gap-2">
                <input aria-label="Nom du nouveau style" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_STYLE_NAME} placeholder="Nom, par ex. Façon Hugo" className={cn(inputClass, "h-9 sm:max-w-64")} />
                <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                  couleurs et ton de
                  <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Partir du style" className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-accent/60">
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {links.map((l, i) => (
                <input
                  key={i}
                  type="url"
                  value={l}
                  onChange={(e) => setLinks(links.map((x, k) => (k === i ? e.target.value : x)))}
                  aria-label={`Lien du reel ${i + 1}`}
                  placeholder={`https://www.instagram.com/reel/… (reel ${i + 1})`}
                  className={cn(inputClass, "h-9")}
                />
              ))}
              {media.length > 0 && (
                <details className="text-[12.5px]">
                  <summary className="cursor-pointer text-ink-2">Ou des vidéos de ta bibliothèque{picked.length ? ` (${picked.length})` : ""}</summary>
                  <div className="scroll-thin mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {media.slice(0, 60).map((m) => (
                      <label key={m.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={picked.includes(m.id)}
                          disabled={!picked.includes(m.id) && refs.length >= MAX_STYLE_REFS}
                          onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))}
                          className="size-3.5 accent-[var(--accent)]"
                        />
                        <span className="truncate">{m.title}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              {old && <p className="text-[12px] text-warn">Mets à jour le programme du Mac (version {STYLE_WORKER}) : la demande attendra jusque-là.</p>}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {refs.length > MAX_STYLE_REFS && <span className="text-[12px] text-warn">{MAX_STYLE_REFS} reels au plus : les premiers sont pris.</span>}
                <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" variant="primary" size="sm" className="h-9" disabled={sending || !refs.length}>
                  {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                  Copier ce style
                </Button>
              </div>
            </form>
          )}
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px]">
              <div className="flex items-center gap-2">
                <JobStatus job={j} />
                <span className="min-w-0 flex-1 truncate">{j.title}</span>
                {(j.status === "done" || j.status === "failed" || j.status === "cancelled" || j.status === "queued") && (
                  <button onClick={() => dismiss(j)} aria-label="Retirer" className="press grid size-6 place-items-center rounded-md text-ink-3 hover:text-ink">
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {(j.status === "working" || j.status === "queued") && (
                <>
                  <Progress value={j.progress} />
                  <span className="text-ink-3">{j.step ?? "En attente du Mac…"}</span>
                </>
              )}
              {j.status === "failed" && j.error && <span className="text-pretty text-warn">{j.error}</span>}
              {j.status === "done" && j.styleTask?.result?.summary && (
                <span className="text-pretty text-ink-2">
                  {j.styleTask.result.font && <b className="font-medium text-ink">Police {j.styleTask.result.font}. </b>}
                  {j.styleTask.result.summary}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
