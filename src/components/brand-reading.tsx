"use client";

import { FileText, Globe, Image as ImageIcon, Loader2, Paperclip, Type, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { MontageJob } from "@/lib/montage";
import { MAX_SOURCE_BYTES, MAX_SOURCE_TEXT, MAX_SOURCES, type SourceFile } from "@/lib/strategy";
import { cn } from "@/lib/utils";
import { inputClass } from "./montage/look-parts";
import { Progress } from "./montage/parts";
import { montageApi, useMontage, type WorkerStatus } from "./montage/use-montage";
import { Button } from "./ui";

/** First Mac program that reads strategies and chartes and plans content. */
export const BRAND_WORKER = [0, 14, 0];
export const atLeast = (version: string | undefined, min: number[]) => {
  const v = (version ?? "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i];
  return true;
};
/** The Mac is known and too old for these requests. */
export const workerTooOld = (w?: WorkerStatus) => !!w?.version && !atLeast(w.version, BRAND_WORKER);

const ACTIVE = new Set(["queued", "working", "rendering"]);

/**
 * The latest request of one kind for one project (a strategy or charte reading, a content plan), followed
 * through the Mac's list: it survives a reload until it is dismissed.
 */
export function useProjectJob(projectId: string | undefined, match: (j: MontageJob) => boolean) {
  const { data, refresh } = useMontage();
  const [gone, setGone] = useState<string[]>([]);
  const job = useMemo(() => (data?.jobs ?? []).find((j) => j.projectId === projectId && match(j) && !gone.includes(j.id)), [data, projectId, gone]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = useCallback(
    async (id: string) => {
      setGone((g) => [...g, id]);
      await montageApi(`/api/montage/jobs/${id}`, { method: "DELETE" }).catch(() => {});
      refresh();
    },
    [refresh],
  );
  return { job, running: !!job && ACTIVE.has(job.status), worker: data?.worker, refresh, dismiss, loaded: !!data };
}

/** Sends the documents, then asks the Mac to read them. Returns the request. */
export async function startReading(projectId: string, mode: "strategy" | "charte", input: { files: File[]; url: string; text: string }) {
  const sources: SourceFile[] = [];
  for (const file of input.files.slice(0, MAX_SOURCES)) {
    const res = await fetch(`/api/profiles/${projectId}/sources?name=${encodeURIComponent(file.name.slice(0, 120))}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${file.name} : ${body.error ?? `erreur ${res.status}`}`);
    sources.push(body.source);
  }
  const { job } = await montageApi<{ job: MontageJob }>("/api/montage/jobs", {
    method: "POST",
    body: JSON.stringify({ kind: "brand", mode, projectId, sources, url: input.url.trim() || undefined, text: input.text.trim() || undefined }),
  });
  return job;
}

const iconOf = (f: File) => (f.type.startsWith("image/") ? ImageIcon : FileText);
const sizeOf = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1e3))} Ko`);

/** Documents (dropped or picked), a website and a pasted text: what Claude reads. */
export function SourcePicker({
  files,
  setFiles,
  url,
  setUrl,
  text,
  setText,
  accept,
  hint,
  withUrl = true,
  onError,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  url: string;
  setUrl: (v: string) => void;
  text: string;
  setText: (v: string) => void;
  accept: string;
  hint: string;
  withUrl?: boolean;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(!!text);
  const add = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_SOURCES) {
        onError(`${MAX_SOURCES} documents au plus`);
        break;
      }
      if (f.size > MAX_SOURCE_BYTES) {
        onError(`${f.name} : 9 Mo au plus, exporte une version allégée`);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <input ref={input} type="file" multiple accept={accept} className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), add(e.dataTransfer.files))}
        className={cn(
          "press flex flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center transition-[border-color,background-color] duration-150",
          over ? "border-accent bg-accent-soft" : "border-line-strong hover:border-ink-3 hover:bg-ink/[0.02]",
        )}
      >
        <Paperclip className="size-4 text-ink-3" />
        <span className="text-[13px] font-medium">Dépose tes documents ici</span>
        <span className="text-[11.5px] text-ink-3">{hint}</span>
      </button>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((f, i) => {
            const Icon = iconOf(f);
            return (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/50 px-2.5 py-1.5 text-[12.5px]">
                <Icon className="size-3.5 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="tabular shrink-0 text-[11px] text-ink-3">{sizeOf(f.size)}</span>
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Retirer ${f.name}`} className="press grid size-5 shrink-0 place-items-center rounded-md text-ink-3 hover:text-danger">
                  <X className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {withUrl && (
        <label className="flex items-center gap-2">
          <Globe className="size-4 shrink-0 text-ink-3" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Ou l'adresse du site, par ex. livrematch.fr" inputMode="url" spellCheck={false} aria-label="Adresse du site" className={cn(inputClass, "h-9 min-w-0 flex-1")} />
        </label>
      )}
      {pasting ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={MAX_SOURCE_TEXT} placeholder="Colle le texte ici." aria-label="Texte collé" className={cn(inputClass, "resize-y py-2 leading-snug")} />
      ) : (
        <button type="button" onClick={() => setPasting(true)} className="press flex items-center gap-1.5 self-start text-[12.5px] text-ink-2 hover:text-ink">
          <Type className="size-3.5" />
          Coller un texte à la place
        </button>
      )}
    </div>
  );
}

/** Where a request to the Mac stands. */
export function JobProgress({ job, worker, onCancel }: { job: MontageJob; worker?: WorkerStatus; onCancel: () => void }) {
  const waiting = job.status === "queued";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3">
      <div className="flex items-center gap-2 text-[13px]">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
        <span className="min-w-0 flex-1 truncate">{waiting ? (worker?.online ? "Le Mac va s'en occuper…" : "En attente du Mac (il n'est pas connecté)") : (job.step ?? "Claude travaille…")}</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
      <Progress value={waiting ? undefined : job.progress} />
    </div>
  );
}

export function OldWorkerNote() {
  return (
    <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-ink-2">
      Le programme du Mac doit d&apos;abord être mis à jour (version 0.14.0) : <code className="font-mono text-[11.5px]">git pull</code> puis redémarrer « montage » dans Portly.
    </p>
  );
}
