"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarCheck, CalendarPlus, Check, Clapperboard, Compass, FileText, GalleryHorizontalEnd, Image as ImageIcon, Lightbulb, Minus, Plus, Save, Sparkles, Trash2, Type, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { MontageJob } from "@/lib/montage";
import { NetworkGlyph } from "@/lib/networks";
import { MAX_IDEAS } from "@/lib/profiles";
import { MAX_FOCUS, MAX_PLAN_ITEMS, MAX_STRATEGY, PLAN_DAYS, PLAN_FORMATS, type PlanFormat, type PlanItem, type StrategyResult } from "@/lib/strategy";
import { useStore } from "@/lib/store";
import type { Network, Project } from "@/lib/types";
import { useProfiles } from "@/lib/use-profiles";
import { cn } from "@/lib/utils";
import { JobProgress, OldWorkerNote, SourcePicker, startReading, useProjectJob, workerTooOld } from "./brand-reading";
import { Segmented } from "./calendar";
import { inputClass } from "./montage/look-parts";
import { montageApi } from "./montage/use-montage";
import { Button } from "./ui";

const FORMAT_ICON: Record<PlanFormat, typeof Video> = { carrousel: GalleryHorizontalEnd, photo: ImageIcon, reel: Sparkles, facecam: Video, texte: Type };
const FORMAT_LABEL = Object.fromEntries(PLAN_FORMATS.map((f) => [f.value, f.label])) as Record<PlanFormat, string>;
const localDay = (d: Date) => format(d, "yyyy-MM-dd");

/** The digital strategy of each project, and the posts Claude proposes from it. */
export function StrategyPage() {
  const projects = useStore((s) => s.projects);
  const loaded = useStore((s) => s.loaded);
  const activeProject = useStore((s) => s.activeProject);
  const [picked, setPicked] = useState<string | null>(null);
  const projectId = picked && projects.some((p) => p.id === picked) ? picked : activeProject !== "all" && projects.some((p) => p.id === activeProject) ? activeProject : projects[0]?.id;
  const project = projects.find((p) => p.id === projectId);

  return (
    <>
      <header className="flex flex-wrap items-end gap-4 border-b border-line px-6 py-5 max-md:px-4">
        <div>
          <h1 className="font-display text-[30px] leading-none">Stratégie</h1>
          <p className="mt-1.5 text-[13px] text-ink-3">La stratégie digitale de chaque projet, et les posts que Claude en tire.</p>
        </div>
        {projects.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-2">
            Projet
            <select value={projectId ?? ""} onChange={(e) => setPicked(e.target.value)} aria-label="Projet" className="h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-accent/60">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <div className="mx-auto w-full max-w-[1480px] px-6 py-6 max-md:px-4">
        {!loaded ? (
          <p className="text-[13px] text-ink-3">Chargement…</p>
        ) : !project ? (
          <div className="rise flex flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
            <Compass className="size-5 text-ink-3" />
            <p className="mt-1 text-[14px] font-medium">Aucun projet</p>
            <p className="max-w-sm text-[13px] text-ink-3">Crée d&apos;abord un projet (menu des projets, en haut à gauche) : chaque projet a sa stratégie.</p>
          </div>
        ) : (
          <ProjectStrategy key={project.id} project={project} />
        )}
      </div>
    </>
  );
}

function ProjectStrategy({ project }: { project: Project }) {
  const { profiles, save } = useProfiles();
  const profile = profiles?.[project.id];
  if (!profile) return <p className="text-[13px] text-ink-3">Lecture de la stratégie…</p>;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <StrategyCard project={project} strategy={profile.strategy} source={profile.strategySource} ideas={profile.refs.ideas} tone={profile.tone} save={save} />
      <PlanCard project={project} hasStrategy={!!profile.strategy.trim()} ideas={profile.refs.ideas} save={save} />
    </div>
  );
}

type Save = ReturnType<typeof useProfiles>["save"];

function Card({ title, hint, icon, children, delay = 0, aside }: { title: string; hint: string; icon: React.ReactNode; children: React.ReactNode; delay?: number; aside?: React.ReactNode }) {
  return (
    <section className="rise overflow-hidden rounded-xl border border-line bg-surface shadow-card" style={{ animationDelay: `${delay}ms` }}>
      <header className="flex items-start gap-3 border-b border-line px-4 py-3.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="text-[12.5px] text-ink-3">{hint}</p>
        </div>
        {aside}
      </header>
      <div className="flex flex-col gap-4 px-4 py-4">{children}</div>
    </section>
  );
}

/* ---------- The strategy ---------- */

function StrategyCard({ project, strategy, source, ideas, tone, save }: { project: Project; strategy: string; source?: string; ideas: { id: string; text: string }[]; tone: string; save: Save }) {
  const [text, setText] = useState(strategy);
  const [saving, setSaving] = useState(false);
  const dirty = text.trim() !== strategy.trim();
  // Saved elsewhere (a reading applied): follow, unless something is being typed.
  const [shown, setShown] = useState(strategy);
  if (shown !== strategy) {
    setShown(strategy);
    if (text.trim() === shown.trim()) setText(strategy);
  }
  const reading = useProjectJob(project.id, (j) => j.kind === "brand" && j.brand?.mode === "strategy");
  const [importing, setImporting] = useState(!strategy.trim());
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [sending, setSending] = useState(false);
  const old = workerTooOld(reading.worker);

  const submit = async () => {
    setSaving(true);
    try {
      await save(project.id, { strategy: text, ...(text.trim() ? {} : { strategySource: "" }) });
      toast.success(`Stratégie de ${project.name} enregistrée`, { description: "Claude la suit pour les plans de contenu et chaque texte du projet." });
    } catch (e) {
      toast.error("Stratégie non enregistrée", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const read = async () => {
    if (sending) return;
    setSending(true);
    try {
      await startReading(project.id, "strategy", { files, url, text: pasted });
      setFiles([]);
      setUrl("");
      setPasted("");
      reading.refresh();
    } catch (e) {
      toast.error("Lecture impossible", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const job = reading.job;
  const result = job?.status === "done" ? (job.brand?.result as StrategyResult | undefined) : undefined;
  const failed = job && (job.status === "failed" || job.status === "cancelled") ? job : undefined;

  return (
    <Card
      title="Stratégie digitale"
      hint="Objectifs, public, piliers, rythme. Claude la lit avant chaque plan et chaque texte de ce projet."
      icon={<Compass className="size-4" />}
      aside={
        !importing && !job ? (
          <Button size="sm" onClick={() => setImporting(true)}>
            <FileText className="size-3.5" />
            Importer
          </Button>
        ) : undefined
      }
    >
      {job && reading.running && <JobProgress job={job} worker={reading.worker} onCancel={() => reading.dismiss(job.id)} />}
      {failed && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12.5px]">
          <p className="min-w-0 flex-1">Claude n&apos;a pas pu lire la stratégie{failed.error ? ` : ${failed.error}` : "."}</p>
          <Button size="sm" variant="ghost" onClick={() => reading.dismiss(failed.id)}>
            Fermer
          </Button>
        </div>
      )}
      {result && job && <StrategyReading project={project} job={job} result={result} current={strategy} ideas={ideas} tone={tone} save={save} onDone={() => (reading.dismiss(job.id), setImporting(false))} />}

      {importing && !job && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/40 p-3">
          <p className="text-[12.5px] text-ink-2">Importe ton document de stratégie : Claude le lit sur ton Mac, le range par rubriques (objectifs, public, piliers, rythme…) et en tire des idées. Tu relis avant de l&apos;appliquer.</p>
          <SourcePicker files={files} setFiles={setFiles} url={url} setUrl={setUrl} text={pasted} setText={setPasted} accept=".pdf,.docx,.odt,.rtf,.doc,.pages,.md,.markdown,.txt,.csv,image/png,image/jpeg,image/webp" hint="PDF, Word, OpenDocument, RTF, texte, Markdown ou captures · 4 fichiers, 9 Mo chacun" withUrl={false} onError={(m) => toast.error(m)} />
          {old && <OldWorkerNote />}
          <div className="flex flex-wrap items-center gap-2">
            {strategy.trim() && (
              <Button size="sm" variant="ghost" onClick={() => setImporting(false)}>
                Plus tard
              </Button>
            )}
            <Button variant="primary" className="ml-auto" onClick={read} disabled={sending || old || (!files.length && !pasted.trim())}>
              <Sparkles className="size-4" />
              {sending ? "Envoi…" : "Lire avec Claude"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-ink-2">Stratégie suivie par Claude</span>
          {source && <span className="truncate text-[11.5px] text-ink-3">d&apos;après « {source} »</span>}
          <span className="tabular ml-auto shrink-0 text-[11px] text-ink-3">
            {text.length.toLocaleString("fr-CH")} / {MAX_STRATEGY.toLocaleString("fr-CH")}
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          maxLength={MAX_STRATEGY}
          aria-label="Stratégie digitale"
          placeholder={"OBJECTIFS\n- …\nPUBLIC\n- …\nPILIERS DE CONTENU\n- …\nRYTHME\n- 3 posts par semaine, mardi, jeudi et dimanche à 18 h"}
          className={cn(inputClass, "scroll-thin min-h-48 resize-y py-2.5 text-[13px] leading-relaxed")}
        />
      </div>
      <div className="flex items-center gap-2">
        {dirty && <span className="text-[12px] text-ink-3">Modifications non enregistrées</span>}
        <Button variant="primary" className="ml-auto" onClick={submit} disabled={saving || !dirty}>
          <Save className="size-4" />
          Enregistrer
        </Button>
      </div>
    </Card>
  );
}

/** What Claude read: shown before it replaces anything. */
function StrategyReading({ project, job, result, current, ideas, tone, save, onDone }: { project: Project; job: MontageJob; result: StrategyResult; current: string; ideas: { id: string; text: string }[]; tone: string; save: Save; onDone: () => void }) {
  const fresh = result.ideas.filter((i) => !ideas.some((x) => x.text === i));
  const [kept, setKept] = useState<string[]>(fresh);
  const [withTone, setWithTone] = useState(false);
  const [busy, setBusy] = useState(false);
  const room = MAX_IDEAS - ideas.length;
  const name = job.brand?.files.map((f) => f.name).join(", ") || "texte collé";

  const apply = async (how: "replace" | "append") => {
    setBusy(true);
    try {
      const strategy = how === "append" && current.trim() ? `${current.trim()}\n\n${result.strategy}` : result.strategy;
      const added = kept.slice(0, Math.max(0, room)).map((text) => ({ id: crypto.randomUUID(), text }));
      await save(project.id, {
        strategy,
        strategySource: name,
        ...(added.length ? { refs: { ideas: [...ideas, ...added] } } : {}),
        ...(withTone && result.tone ? { tone: result.tone } : {}),
      });
      toast.success("Stratégie appliquée", { description: added.length ? `${added.length} idée${added.length > 1 ? "s" : ""} ajoutée${added.length > 1 ? "s" : ""} au projet.` : undefined });
      onDone();
    } catch (e) {
      toast.error("Stratégie non appliquée", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rise flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-accent" />
        <p className="min-w-0 flex-1 text-[13px] font-medium">Claude a lu « {name} »</p>
      </div>
      <pre className="scroll-thin max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2.5 font-sans text-[12.5px] leading-relaxed text-ink-2">{result.strategy}</pre>
      {fresh.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-2">Idées tirées de la stratégie (cochées : ajoutées aux idées du projet)</span>
          <div className="flex flex-wrap gap-1.5">
            {fresh.map((i) => {
              const on = kept.includes(i);
              return (
                <button key={i} type="button" onClick={() => setKept((k) => (on ? k.filter((x) => x !== i) : [...k, i]))} aria-pressed={on} className={cn("press flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-left text-[12px]", on ? "border-accent/40 bg-surface text-ink" : "border-line-strong text-ink-3 line-through decoration-ink-3/50")}>
                  {on ? <Check className="size-3 shrink-0 text-accent" /> : <Lightbulb className="size-3 shrink-0" />}
                  <span className="truncate">{i}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {result.tone && result.tone.trim() !== tone.trim() && (
        <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={withTone} onChange={(e) => setWithTone(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
          <span>
            Remplacer aussi le ton de Claude par celui de la stratégie :<span className="mt-0.5 block whitespace-pre-line text-ink-3">{result.tone}</span>
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Ignorer
        </Button>
        {current.trim() && (
          <Button size="sm" className="ml-auto" onClick={() => apply("append")} disabled={busy}>
            Ajouter à la suite
          </Button>
        )}
        <Button size="sm" variant="primary" className={cn(!current.trim() && "ml-auto")} onClick={() => apply("replace")} disabled={busy}>
          <Check className="size-3.5" />
          {current.trim() ? "Remplacer la stratégie" : "Appliquer"}
        </Button>
      </div>
    </div>
  );
}

/* ---------- The content plan ---------- */

const placedKey = (jobId: string) => `metricove-plan-placed-${jobId}`;
const readPlaced = (jobId: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(placedKey(jobId)) ?? "[]");
  } catch {
    return [];
  }
};

function PlanCard({ project, hasStrategy, ideas, save }: { project: Project; hasStrategy: boolean; ideas: { id: string; text: string }[]; save: Save }) {
  const plan = useProjectJob(project.id, (j) => j.kind === "plan");
  const old = workerTooOld(plan.worker);
  const tomorrow = useMemo(() => localDay(new Date(Date.now() + 86_400_000)), []);
  const [from, setFrom] = useState(tomorrow);
  const [days, setDays] = useState<(typeof PLAN_DAYS)[number]>(7);
  const [count, setCount] = useState(4);
  const [formats, setFormats] = useState<PlanFormat[]>(["carrousel", "photo", "reel"]);
  const [focus, setFocus] = useState("");
  const [asking, setAsking] = useState(false);

  const ask = async () => {
    if (asking) return;
    setAsking(true);
    try {
      await montageApi<{ job: MontageJob }>("/api/montage/jobs", { method: "POST", body: JSON.stringify({ kind: "plan", projectId: project.id, from, days, count, formats, focus }) });
      plan.refresh();
    } catch (e) {
      toast.error("Demande impossible", { description: (e as Error).message });
    } finally {
      setAsking(false);
    }
  };

  const job = plan.job;
  const result = job?.status === "done" ? job.plan?.result : undefined;
  const failed = job && (job.status === "failed" || job.status === "cancelled") ? job : undefined;

  return (
    <Card
      title="Proposer du contenu"
      hint="Claude propose des posts pour la période, d'après la stratégie et ce qui est déjà prévu au calendrier."
      icon={<Sparkles className="size-4" />}
      delay={40}
      aside={
        result && job ? (
          <Button size="sm" variant="ghost" onClick={() => plan.dismiss(job.id)} title="Effacer ces propositions">
            <Trash2 className="size-3.5" />
            Effacer
          </Button>
        ) : undefined
      }
    >
      {job && plan.running && <JobProgress job={job} worker={plan.worker} onCancel={() => plan.dismiss(job.id)} />}
      {failed && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12.5px]">
          <p className="min-w-0 flex-1">Claude n&apos;a pas pu préparer le plan{failed.error ? ` : ${failed.error}` : "."}</p>
          <Button size="sm" variant="ghost" onClick={() => plan.dismiss(failed.id)}>
            Fermer
          </Button>
        </div>
      )}
      {result && job ? (
        <PlanResult project={project} job={job} items={result.items} notes={result.notes} ideas={ideas} save={save} />
      ) : (
        !plan.running && (
          <>
            {!hasStrategy && <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-[12.5px] text-ink-2">Ajoute et enregistre d&apos;abord la stratégie du projet : c&apos;est elle que Claude suit.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2">À partir du</span>
                <input type="date" value={from} min={localDay(new Date())} onChange={(e) => setFrom(e.target.value || tomorrow)} className={cn(inputClass, "h-9")} />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-2">Pendant</span>
                <Segmented value={String(days) as "7"} onChange={(v) => setDays(Number(v) as 7)} options={PLAN_DAYS.map((d) => ({ value: String(d) as "7", label: `${d} jours` }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink-2">Nombre de posts</span>
              <div className="flex items-center gap-1">
                <Button size="sm" className="size-8 px-0" onClick={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1} aria-label="Un post de moins">
                  <Minus className="size-3.5" />
                </Button>
                <span className="tabular w-10 text-center text-[15px] font-semibold">{count}</span>
                <Button size="sm" className="size-8 px-0" onClick={() => setCount((c) => Math.min(MAX_PLAN_ITEMS, c + 1))} disabled={count >= MAX_PLAN_ITEMS} aria-label="Un post de plus">
                  <Plus className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink-2">Formats</span>
              <div className="flex flex-wrap gap-1.5">
                {PLAN_FORMATS.map((f) => {
                  const on = formats.includes(f.value);
                  const Icon = FORMAT_ICON[f.value];
                  return (
                    <button
                      key={f.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFormats((all) => (on ? (all.length > 1 ? all.filter((x) => x !== f.value) : all) : [...all, f.value]))}
                      className={cn("press flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-[background-color,border-color,color] duration-150", on ? "border-accent/40 bg-accent-soft text-ink" : "border-line-strong text-ink-3 hover:text-ink")}
                    >
                      <Icon className={cn("size-3.5", on && "text-accent")} />
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink-2">À mettre en avant (facultatif)</span>
              <input value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={MAX_FOCUS} placeholder="Par ex. le lancement du nouveau quiz, une soirée le 29 novembre" className={cn(inputClass, "h-9")} />
            </label>
            {old && <OldWorkerNote />}
            <div className="flex justify-end">
              <Button variant="primary" onClick={ask} disabled={asking || !hasStrategy || old}>
                <Sparkles className="size-4" />
                {asking ? "Envoi…" : "Proposer avec Claude"}
              </Button>
            </div>
          </>
        )
      )}
    </Card>
  );
}

function PlanResult({ project, job, items, notes, ideas, save }: { project: Project; job: MontageJob; items: PlanItem[]; notes: string; ideas: { id: string; text: string }[]; save: Save }) {
  const accounts = useStore((s) => s.accounts);
  const savePost = useStore((s) => s.savePost);
  const openComposer = useStore((s) => s.openComposer);
  const [placed, setPlaced] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setPlaced(readPlaced(job.id)), [job.id]);
  const mark = (ids: string[]) =>
    setPlaced((p) => {
      const next = [...new Set([...p, ...ids])];
      try {
        localStorage.setItem(placedKey(job.id), JSON.stringify(next));
      } catch {}
      return next;
    });

  const pool = accounts.filter((a) => project.accountIds.includes(a.id));
  const targets = (it: PlanItem) => {
    const fit = pool.filter((a) => it.networks.includes(a.network));
    return (fit.length ? fit : pool).map((a) => a.id);
  };
  const place = async (list: PlanItem[]) => {
    const todo = list.filter((it) => !placed.includes(it.id));
    if (!todo.length) return;
    if (!pool.length) return toast.error("Ce projet n'a aucun compte", { description: "Ajoute des comptes au projet pour y mettre des brouillons." });
    setBusy(todo.length > 1 ? "all" : todo[0].id);
    const done: string[] = [];
    try {
      for (const it of todo) {
        await savePost({ id: crypto.randomUUID(), accountIds: targets(it), caption: it.caption, scheduledAt: new Date(`${it.date}T${it.time}:00`).toISOString(), status: "draft", origin: "claude-code" });
        done.push(it.id);
      }
      toast.success(done.length > 1 ? `${done.length} brouillons au calendrier` : "Brouillon au calendrier", { description: "À compléter avec le visuel ou la vidéo, puis à programmer." });
    } catch (e) {
      toast.error("Brouillon non créé", { description: (e as Error).message });
    } finally {
      mark(done);
      setBusy(null);
    }
  };
  const keepIdea = async (it: PlanItem) => {
    if (ideas.some((i) => i.text === it.idea)) return toast("Déjà dans les idées du projet");
    if (ideas.length >= MAX_IDEAS) return toast.error(`${MAX_IDEAS} idées au plus`);
    try {
      await save(project.id, { refs: { ideas: [...ideas, { id: crypto.randomUUID(), text: it.idea }] } });
      toast.success("Idée gardée", { description: "Elle apparaît dans le Studio, sous « Écrit par Claude »." });
    } catch (e) {
      toast.error("Idée non gardée", { description: (e as Error).message });
    }
  };
  const studioLink = (it: PlanItem) => {
    const q = (n?: number) => `?idee=${encodeURIComponent(it.idea)}${n ? `&n=${n}` : ""}`;
    if (it.format === "carrousel") return `/videos/studio/visuels${q(5)}`;
    if (it.format === "photo") return `/videos/studio/visuels${q(1)}`;
    if (it.format === "reel") return `/videos/studio/anime${q(5)}`;
    if (it.format === "facecam") return `/videos/studio${q()}`;
    return undefined;
  };
  const left = items.filter((it) => !placed.includes(it.id));
  const p = job.plan;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <span>
          {items.length} post{items.length > 1 ? "s" : ""}
          {p ? ` · du ${format(new Date(`${p.from}T12:00:00`), "d MMM", { locale: fr })}, ${p.days} jours` : ""}
          {p?.focus ? ` · « ${p.focus} »` : ""}
        </span>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => place(items)} disabled={!left.length || !!busy}>
          <CalendarPlus className="size-3.5" />
          {left.length ? `Tout mettre au calendrier (${left.length})` : "Tout est au calendrier"}
        </Button>
      </div>
      {notes && <p className="rounded-lg bg-surface-2/70 px-3 py-2 text-[12.5px] leading-snug text-ink-2">{notes}</p>}
      <ol className="flex flex-col gap-2">
        {items.map((it, i) => {
          const Icon = FORMAT_ICON[it.format];
          const done = placed.includes(it.id);
          const link = studioLink(it);
          return (
            <li key={it.id} className="rise rounded-xl border border-line bg-surface px-3.5 py-3 shadow-card" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
                <span className="tabular font-medium text-ink-2 first-letter:uppercase">{format(new Date(`${it.date}T${it.time}:00`), "EEE d MMM · HH:mm", { locale: fr })}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2 py-px text-ink-2">
                  <Icon className="size-3" />
                  {FORMAT_LABEL[it.format]}
                </span>
                {it.pillar && <span className="rounded-full border border-line-strong px-2 py-px">{it.pillar}</span>}
                <span className="ml-auto flex items-center gap-1">
                  {it.networks.map((n) => (
                    <NetworkGlyph key={n} network={n as Network} className="size-3.5" />
                  ))}
                </span>
              </div>
              <p className="mt-1.5 text-[14px] font-medium leading-snug">{it.idea}</p>
              {it.why && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{it.why}</p>}
              {it.caption && (
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-[12px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Voir la description proposée</span>
                    <span className="hidden group-open:inline">Masquer la description</span>
                  </summary>
                  <p className="mt-1.5 whitespace-pre-line rounded-lg bg-surface-2/70 px-3 py-2 text-[12.5px] leading-snug text-ink-2">{it.caption}</p>
                </details>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant={done ? "ghost" : "secondary"} onClick={() => place([it])} disabled={done || !!busy}>
                  {done ? <CalendarCheck className="size-3.5 text-ok" /> : <CalendarPlus className="size-3.5" />}
                  {done ? "Au calendrier" : "Brouillon au calendrier"}
                </Button>
                {link ? (
                  <Link href={link} className="press inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink">
                    <Clapperboard className="size-3.5" />
                    Créer dans le Studio
                  </Link>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => openComposer({ caption: it.caption, date: new Date(`${it.date}T${it.time}:00`).toISOString() })}>
                    <Type className="size-3.5" />
                    Écrire le post
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => keepIdea(it)}>
                  <Lightbulb className="size-3.5" />
                  Garder l&apos;idée
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
