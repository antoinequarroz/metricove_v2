"use client";

import { Check, ChevronRight, Clapperboard, Film, Scissors, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FORMATS, type MontageFormat, type MontageJob, type Rush } from "@/lib/montage";
import { useStore } from "@/lib/store";
import { cn, fmt } from "@/lib/utils";
import { Segmented } from "../calendar";
import { Button } from "../ui";
import { fmtSec, fmtSize, JobStatus, PageHeader, Progress, VideoTabs, WorkerBanner } from "./parts";
import { montageApi, useMontage } from "./use-montage";

export function MontagePage() {
  const { data, error, refresh } = useMontage();
  const params = useSearchParams();
  const preset = params.get("rushes")?.split(",").filter(Boolean) ?? [];
  const [creating, setCreating] = useState(preset.length > 0);

  return (
    <>
      <PageHeader kicker="Vidéos" title="Montage IA">
        <VideoTabs />
        {!creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Wand2 className="size-4" />
            Nouveau montage
          </Button>
        )}
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          <WorkerBanner worker={data?.worker} />
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {creating && data && (
            <NewMontage
              rushes={data.rushes}
              preset={preset}
              script={params.get("script") ?? undefined}
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                refresh();
              }}
            />
          )}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold">Montages</h2>
            {data && data.jobs.filter((j) => j.kind === "montage").length === 0 && !creating && (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center hover:border-accent/50"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Scissors className="size-5" />
                </span>
                <span className="text-[14px] font-medium">Ton premier montage</span>
                <span className="max-w-md text-[12.5px] text-ink-3">
                  Choisis tes rushes et dis ce que tu veux. Claude coupe les silences et les ratés, ajoute les sous-titres et recadre. Tu valides avant que quoi que ce soit parte.
                </span>
              </button>
            )}
            <div className="flex flex-col gap-2">
              {data?.jobs
                .filter((j) => j.kind === "montage")
                .map((j, i) => (
                  <JobRow key={j.id} job={j} index={i} onDeleted={refresh} />
                ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function JobRow({ job, index, onDeleted }: { job: MontageJob; index: number; onDeleted: () => void }) {
  const last = job.versions.at(-1);
  const remove = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm(`Supprimer « ${job.title} » ? La vidéo finale reste dans la bibliothèque.`)) return;
    try {
      await montageApi(`/api/montage/jobs/${job.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      toast.error("Suppression impossible", { description: (err as Error).message });
    }
  };
  return (
    <Link
      href={`/videos/montage/${job.id}`}
      className="rise group flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3 shadow-card hover:border-line-strong"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink-2">
        <Film className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium">{job.title}</span>
          <JobStatus job={job} />
        </div>
        <p className="mt-0.5 truncate text-[12px] text-ink-3">
          {job.brief.format} · {job.rushIds.length} rush{job.rushIds.length > 1 ? "es" : ""}
          {last ? ` · version ${last.n}` : ""} · {fmt(job.updatedAt, "d MMM, HH:mm")}
          {job.status === "failed" && job.error ? ` · ${job.error}` : ""}
        </p>
        {(job.status === "working" || job.status === "rendering") && (
          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1">
              <Progress value={job.progress} />
            </div>
            <span className="shrink-0 text-[11.5px] text-ink-3">{job.step}</span>
          </div>
        )}
      </div>
      <button onClick={remove} aria-label={`Supprimer ${job.title}`} className="press grid size-8 place-items-center rounded-md text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-danger">
        <Trash2 className="size-3.5" />
      </button>
      <ChevronRight className="size-4 text-ink-3" />
    </Link>
  );
}

const field =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

function NewMontage({ rushes, preset, script, onCancel, onCreated }: { rushes: Rush[]; preset: string[]; script?: string; onCancel: () => void; onCreated: () => void }) {
  const router = useRouter();
  const projects = useStore((s) => s.projects);
  const activeProject = useStore((s) => s.activeProject);
  const [selected, setSelected] = useState<string[]>(preset);
  const [format, setFormat] = useState<MontageFormat>("9:16");
  const [title, setTitle] = useState("");
  const [seconds, setSeconds] = useState("");
  const [instructions, setInstructions] = useState("");
  const [hook, setHook] = useState("");
  const [cta, setCta] = useState("");
  const [projectId, setProjectId] = useState(activeProject === "all" ? "" : activeProject);
  const [scriptText, setScriptText] = useState(script ?? "");
  const [busy, setBusy] = useState(false);

  // Takes filmed in the Studio arrive selected.
  useEffect(() => setSelected((s) => [...new Set([...s, ...preset])]), [preset.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { job } = await montageApi<{ job: MontageJob }>("/api/montage/jobs", {
        method: "POST",
        body: JSON.stringify({
          kind: "montage",
          title,
          projectId: projectId || undefined,
          rushIds: selected,
          script: scriptText || undefined,
          brief: { format, seconds: Number(seconds) || undefined, instructions, hook, cta },
        }),
      });
      toast.success("Montage demandé", { description: "Ton Mac s'en occupe dès qu'il est connecté." });
      onCreated();
      router.push(`/videos/montage/${job.id}`);
    } catch (err) {
      toast.error("Impossible de lancer le montage", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rise rounded-2xl border border-accent/40 bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Wand2 className="size-4 text-accent" />
        <h2 className="text-[14px] font-semibold">Nouveau montage</h2>
      </div>

      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-[12px] font-medium text-ink-2">1. Rushes</p>
        <span className="text-[11.5px] text-ink-3">{selected.length} choisi{selected.length > 1 ? "s" : ""}</span>
        <Link href="/videos/studio" className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-accent">
          <Clapperboard className="size-3.5" /> Me filmer
        </Link>
      </div>
      {rushes.length === 0 ? (
        <p className="mb-5 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[12.5px] text-ink-3">
          Aucun rush pour l&apos;instant. Mets tes vidéos dans le dossier des rushes de ton Mac, ou filme-toi dans le Studio.
        </p>
      ) : (
        <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5">
          {rushes.map((r) => {
            const on = selected.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                aria-pressed={on}
                className={cn("press group relative overflow-hidden rounded-xl border text-left", on ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-strong")}
              >
                <div className="relative aspect-video bg-ink/80">
                  {r.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumb} alt="" className="size-full object-cover" />
                  ) : (
                    <Film className="absolute inset-0 m-auto size-5 text-white/40" />
                  )}
                  {r.duration !== undefined && (
                    <span className="tabular absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1 font-mono text-[10.5px] text-white">{fmtSec(r.duration)}</span>
                  )}
                  <span className={cn("absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-md border", on ? "border-accent bg-accent text-white" : "border-white/60 bg-black/30")}>
                    {on && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  {r.origin === "upload" && <span className="absolute top-1.5 left-1.5 rounded bg-accent px-1 text-[10px] font-medium text-white">Studio</span>}
                </div>
                <div className="px-2 py-1.5">
                  <p className="truncate text-[12px] font-medium">{r.name}</p>
                  <p className="text-[11px] text-ink-3">{fmtSize(r.size)}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="mb-2 text-[12px] font-medium text-ink-2">2. Ce que tu veux</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented<MontageFormat> value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.label }))} />
        <span className="text-[12px] text-ink-3">{FORMATS.find((f) => f.value === format)?.hint}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_200px]">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre (pour toi)" aria-label="Titre" className={field} maxLength={120} />
        <input value={seconds} onChange={(e) => setSeconds(e.target.value.replace(/\D/g, ""))} placeholder="Durée (s)" aria-label="Durée visée en secondes" inputMode="numeric" className={field} />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projet" className={field}>
          <option value="">Sans projet</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Consigne, par ex. « Reel dynamique de 45 s, garde les meilleurs passages, coupe les hésitations »"
        aria-label="Consigne"
        rows={3}
        className={cn(field, "mt-3 h-auto resize-y py-2 leading-relaxed")}
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Accroche à l'écran (optionnel)" aria-label="Accroche" className={field} maxLength={300} />
        <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Carton de fin, par ex. « Abonne-toi » (optionnel)" aria-label="Appel à l'action" className={field} maxLength={300} />
      </div>
      {scriptText && (
        <details className="mt-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-[12.5px]">
          <summary className="cursor-pointer font-medium">Texte du prompteur (aide Claude à choisir les bonnes prises)</summary>
          <textarea value={scriptText} onChange={(e) => setScriptText(e.target.value)} rows={5} className={cn(field, "mt-2 h-auto py-2")} aria-label="Texte du prompteur" />
        </details>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" disabled={busy || selected.length === 0}>
          <Wand2 className="size-4" />
          Lancer le montage
        </Button>
      </div>
    </form>
  );
}
