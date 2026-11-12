"use client";

import { ArrowLeft, CalendarPlus, Check, Columns2, Eye, EyeOff, Loader2, MessageSquareText, PenLine, Play, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { edlDuration, splitAt, timeline, type CaptionStyle, type Edl, type MontageJob, type MontageMark, type MontageVersion, type Rush } from "@/lib/montage";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { Annotator } from "./annotator";
import { ReelReview } from "./reel-review";
import { CaptionsEditor } from "./captions-editor";
import { Segmented } from "./controls";
import { fmtSec, JobStatus, Progress, WorkerBanner } from "./parts";
import { SettingsPanel } from "./settings-panel";
import { Timeline, type Selection } from "./timeline";
import { useTimelineKeys, useUndo } from "./timeline-kit";
import { montageApi, useMontage } from "./use-montage";

const ASPECT: Record<Edl["format"], string> = { "9:16": "9 / 16", "4:5": "4 / 5", "1:1": "1 / 1", "16:9": "16 / 9" };

export function ReviewPage({ id }: { id: string }) {
  const { data, refresh } = useMontage();
  const job = data?.jobs.find((j) => j.id === id);

  if (!data) return <div className="flex-1" />;
  if (!job)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[15px] font-medium">Montage introuvable</p>
        <Link href="/videos/montage" className="text-[13px] font-medium text-accent">
          Retour aux montages
        </Link>
      </div>
    );
  // An animated reel has its own editing screen: the same player, drawings and versions, over a timeline of scenes.
  if (job.kind === "motion") return <ReelReview job={job} worker={data.worker} refresh={refresh} />;
  return <Review job={job} worker={data.worker} rushes={data.rushes} refresh={refresh} />;
}

type Tab = "text" | "captions" | "settings";

function Review({
  job,
  worker,
  rushes,
  refresh,
}: {
  job: MontageJob;
  worker: Parameters<typeof WorkerBanner>[0]["worker"];
  rushes: Rush[];
  refresh: () => Promise<void>;
}) {
  const latest = job.versions.at(-1);
  const [shown, setShown] = useState<number | undefined>(latest?.n);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const version = job.versions.find((v) => v.n === shown) ?? latest;
  const [draft, setDraft] = useState<Edl | undefined>(version?.edl);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const player = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [tab, setTab] = useState<Tab>("captions");
  const [selection, setSelection] = useState<Selection>(null);
  const [drawing, setDrawing] = useState(false);
  const [marks, setMarks] = useState<MontageMark[]>([]);
  const openComposer = useStore((s) => s.openComposer);
  const working = job.action !== null;

  // A new version arrived: show it, unless the user is editing.
  useEffect(() => {
    if (!dirty && latest) {
      history.reset();
      setShown(latest.n);
      setDraft(latest.edl);
    }
  }, [latest?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (n: number) => {
    if (dirty && !confirm("Tes modifications non appliquées seront perdues. Continuer ?")) return;
    const v = job.versions.find((x) => x.n === n);
    setShown(n);
    setDraft(v?.edl);
    setDirty(false);
    history.reset();
  };

  const history = useUndo<Edl>(draft, (edl) => {
    setDraft(edl);
    // Back at the version on show: nothing is left to apply.
    setDirty(JSON.stringify(edl) !== JSON.stringify(version?.edl));
    setSelection(null);
  });
  const edit = (fn: (e: Edl) => Edl) => {
    history.record(draft);
    setDraft((d) => (d ? fn(structuredClone(d)) : d));
    setDirty(true);
  };
  /** `key` names a panel of sliders: its changes in a row make one step to undo. */
  const setEdl = (next: Edl, key?: string) => {
    history.record(draft, key);
    setDraft(next);
    setDirty(true);
  };
  const [playing, setPlaying] = useState(false);
  const composerOpen = useStore((s) => s.composer.open);
  const zoomRef = useRef<((dir: 1 | -1 | 0) => void) | null>(null);
  // While it plays, the playhead follows the video frame by frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (player.current) setTime(player.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  /** Removes what is selected on the timeline: a shot, a zoom or a B-roll shot. */
  const removeSelection = () => {
    if (!draft || !selection || selection.kind === "title") return;
    const next = structuredClone(draft);
    if (selection.kind === "seg") {
      const s = next.segments.find((x) => x.id === selection.id);
      if (!s || next.segments.filter((x) => x.kept).length < 2) return;
      s.kept = false;
    } else if (selection.kind === "zoom") {
      if (!next.zooms?.[selection.i]) return;
      next.zooms.splice(selection.i, 1);
    } else {
      if (!next.broll?.[selection.i]) return;
      next.broll.splice(selection.i, 1);
    }
    setEdl(next);
    setSelection(null);
  };
  const splitHere = () => {
    const next = draft && splitAt(draft, time);
    if (next) setEdl(next);
  };

  const call = async (body: object, ok: string) => {
    setBusy(true);
    try {
      await montageApi(`/api/montage/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(ok);
      await refresh();
      return true;
    } catch (e) {
      toast.error("Action impossible", { description: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!draft || !(await call({ edl: draft }, "Modifications envoyées au Mac pour un nouvel aperçu"))) return;
    setDirty(false);
    history.reset();
  };
  const revise = async () => {
    if (await call({ revise: feedback, marks }, marks.length ? `Demande et ${marks.length} note${marks.length > 1 ? "s" : ""} envoyées à Claude` : "Demande envoyée à Claude")) {
      setFeedback("");
      setMarks([]);
    }
  };
  const saveStyle = async (style: CaptionStyle) => {
    if (!job.projectId) return;
    try {
      await montageApi(`/api/montage/styles/${job.projectId}`, { method: "PUT", body: JSON.stringify(style) });
      toast.success("Style enregistré pour ce projet");
    } catch (e) {
      toast.error("Style non enregistré", { description: (e as Error).message });
    }
  };
  const approve = () => version && call({ approve: version.n }, "Version validée : le Mac fait le rendu final");

  const segs = useMemo(() => (draft ? timeline(draft) : []), [draft]);
  const seek = (t: number) => {
    setTime(t);
    if (!player.current) return;
    player.current.currentTime = t;
  };
  const sentMarks = (job.marks ?? []).filter((m) => m.version === version?.n);
  const canDraw = job.status === "review" && !!version?.preview && compareWith === null;
  /** Puts a note at the playhead (M): a place in the video and a few words for Claude, without drawing. */
  const addNote = () => {
    if (!version || !canDraw) return;
    if (marks.length >= 8) return void toast.message("8 notes au plus par demande");
    player.current?.pause();
    setMarks((x) => [...x, { id: crypto.randomUUID(), version: version.n, t: Math.round((player.current?.currentTime ?? time) * 100) / 100, text: "" }]);
  };
  useTimelineKeys({
    enabled: !!draft && compareWith === null && !(drawing && canDraw) && !composerOpen,
    canPlay: !!version?.preview,
    video: () => player.current,
    total: draft ? edlDuration(draft) : 0,
    onSeek: seek,
    onSplit: splitHere,
    onMark: addNote,
    onDelete: selection && selection.kind !== "title" ? removeSelection : undefined,
    onUndo: history.undo,
    onRedo: history.redo,
    onZoom: (dir) => zoomRef.current?.(dir),
  });
  // Another video on screen: nothing plays yet.
  useEffect(() => setPlaying(false), [version?.n, version?.preview, compareWith]);

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 pt-5 pb-4 max-md:px-4">
        <Link href="/videos/montage" aria-label="Retour aux montages" className="press grid size-8 place-items-center rounded-lg border border-line-strong bg-surface text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-ink-3">Montage IA · {job.brief.format}</p>
          <h1 className="truncate font-display text-[28px] leading-[1.1]">{job.title}</h1>
        </div>
        <JobStatus job={job} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {job.status === "done" && job.mediaId && (
            <Button variant="primary" onClick={() => openComposer({ mediaId: job.mediaId })}>
              <CalendarPlus className="size-4" />
              Programmer
            </Button>
          )}
          {job.status === "review" && version && (
            <Button variant="primary" onClick={approve} disabled={busy || dirty || !version.preview}>
              <Check className="size-4" />
              Valider la version {version.n}
            </Button>
          )}
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          {(job.status === "queued" || working) && (
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-[13px]">
                <Loader2 className="size-4 animate-spin text-accent" />
                <span className="font-medium">{job.status === "queued" ? "En attente du Mac" : (job.step ?? "Le Mac travaille…")}</span>
                {job.progress !== undefined && <span className="tabular ml-auto font-mono text-[12px] text-ink-3">{Math.round(job.progress * 100)}%</span>}
              </div>
              <Progress value={job.progress} />
            </div>
          )}
          {job.status === "queued" && !worker?.online && <WorkerBanner worker={worker} />}
          {job.status === "failed" && (
            <div className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/8 px-4 py-3 text-[13px]">
              <span className="flex-1">
                <span className="font-medium text-danger">Le montage a échoué.</span> {job.error}
              </span>
              <Button size="sm" onClick={() => call({ revise: job.feedback ?? "" }, "Nouvel essai demandé")}>
                <RotateCcw className="size-3.5" /> Réessayer
              </Button>
            </div>
          )}
          {job.status === "done" && (
            <div className="flex items-center gap-3 rounded-xl border border-ok/40 bg-ok/8 px-4 py-3 text-[13px]">
              <Check className="size-4 text-ok" />
              <span className="flex-1">La vidéo finale est dans ta bibliothèque. Programme-la sur tes comptes quand tu veux.</span>
              <Link href="/videos" className="font-medium text-accent">
                Voir la bibliothèque
              </Link>
            </div>
          )}

          {!version ? (
            job.status !== "failed" && (
              <div className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[13px] text-ink-3">
                <Sparkles className="mx-auto mb-2 size-5 text-accent" />
                Claude prépare une première proposition : transcription, choix des passages, sous-titres et recadrage.
              </div>
            )
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
              {/* ---------- Video ---------- */}
              <div className="flex flex-col gap-3 lg:sticky lg:top-0 lg:self-start">
                <div className="flex flex-wrap items-center gap-1.5">
                  {job.versions.map((v) => (
                    <VersionChip key={v.n} v={v} on={v.n === version.n} onClick={() => pick(v.n)} />
                  ))}
                  {canDraw && (
                    <button
                      onClick={() => setDrawing((d) => !d)}
                      className={cn("press inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium", drawing ? "border-accent bg-accent-soft" : "border-line-strong bg-surface")}
                      title="Mets la vidéo en pause là où il faut changer quelque chose, dessine et explique"
                    >
                      <PenLine className="size-3.5" /> Dessiner une note
                    </button>
                  )}
                  {job.versions.length > 1 && (
                    <button
                      onClick={() => setCompareWith(compareWith === null ? (job.versions.find((v) => v.n !== version.n && v.preview)?.n ?? null) : null)}
                      className={cn("press ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium", compareWith !== null ? "border-accent bg-accent-soft" : "border-line-strong bg-surface")}
                    >
                      <Columns2 className="size-3.5" /> Avant / après
                    </button>
                  )}
                </div>
                {compareWith !== null ? (
                  <Compare job={job} before={compareWith} after={version.n} onBefore={setCompareWith} />
                ) : (
                  <Annotator video={player} active={drawing && canDraw} version={version.n} onAdd={(m) => setMarks((x) => [...x, m])} onClose={() => setDrawing(false)}>
                    <div onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}>
                      <Preview job={job} v={version} ref={player} onTime={setTime} />
                    </div>
                  </Annotator>
                )}
                {version.notes && (
                  <div className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                    <p className="mb-0.5 flex items-center gap-1.5 font-medium text-ink">
                      <Sparkles className="size-3.5 text-accent" /> {version.by === "claude" ? "Ce que Claude a fait" : "Modifié à la main"}
                    </p>
                    {version.notes}
                  </div>
                )}
                {job.status === "review" && (
                  <div className="rounded-xl border border-line bg-surface p-3">
                    <label htmlFor="feedback" className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
                      <MessageSquareText className="size-3.5 text-accent" /> Demander une autre version à Claude
                    </label>
                    {marks.length > 0 && (
                      <ul className="mb-2 flex flex-col gap-1.5">
                        {marks.map((m) => (
                          <li key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 p-1.5 text-[12.5px]">
                            {m.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.image} alt="" className="h-12 w-auto shrink-0 rounded-md" />
                            ) : (
                              <span className="grid h-12 w-8 shrink-0 place-items-center rounded-md bg-ink/5 text-ink-3">
                                <PenLine className="size-3.5" />
                              </span>
                            )}
                            <button onClick={() => seek(m.t)} className="tabular shrink-0 font-mono text-[11px] text-ink-3 hover:text-accent">
                              {fmtSec(m.t)}
                            </button>
                            <input
                              value={m.text}
                              onChange={(e) => setMarks((x) => x.map((y) => (y.id === m.id ? { ...y, text: e.target.value } : y)))}
                              autoFocus={!m.text && !m.image}
                              maxLength={1000}
                              placeholder={m.image ? "Dessin sans texte" : "Ta note à cet endroit"}
                              aria-label={`Note à ${fmtSec(m.t)}`}
                              className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 outline-none hover:border-line-strong focus:border-accent/60 focus:bg-surface"
                            />
                            <button onClick={() => setMarks((x) => x.filter((y) => y.id !== m.id))} aria-label="Retirer la note" className="press grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:text-ink">
                              <X className="size-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <textarea
                      id="feedback"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      rows={2}
                      placeholder={marks.length ? "Un mot de plus pour Claude (facultatif)" : "Par ex. « plus court, garde la prise 2 », ou dessine une note sur la vidéo"}
                      className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent/60"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button size="sm" onClick={revise} disabled={busy || (!feedback.trim() && !marks.length)}>
                        <Wand2 className="size-3.5" /> Nouvelle version
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* ---------- Editing panels ---------- */}
              {draft && (
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                      label="Outil"
                      value={tab}
                      onChange={setTab}
                      options={[
                        { value: "captions", label: "Sous-titres" },
                        { value: "text", label: "Transcription" },
                        { value: "settings", label: "Réglages" },
                      ]}
                    />
                    <span className="tabular text-[12px] text-ink-3">
                      {segs.length}/{draft.segments.length} passages · {fmtSec(edlDuration(draft))}
                    </span>
                    {dirty && (
                      <div className="ml-auto flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => pick(version.n)}>
                          Annuler
                        </Button>
                        <Button size="sm" variant="primary" onClick={apply} disabled={busy || working}>
                          <Play className="size-3.5" /> Voir l&apos;aperçu
                        </Button>
                      </div>
                    )}
                  </div>
                  {dirty && <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] text-ink-2">Modifications pas encore rendues : la vidéo montre encore la version {version.n}. Clique sur « Voir l&apos;aperçu » pour que le Mac la refasse.</p>}

                  {tab === "captions" && <CaptionsEditor edl={draft} fallback={job.style} onChange={(e) => setEdl(e, "captions")} onSeek={seek} time={time} onSaveStyle={job.projectId ? saveStyle : undefined} />}
                  {tab === "settings" && <SettingsPanel edl={draft} onChange={(e) => setEdl(e, "settings")} tracks={worker?.tracks} />}
                  {tab === "text" && (
                  <>
                  <p className="text-[12px] text-ink-3">
                    Clique sur l&apos;œil pour couper ou remettre un passage. Clique sur un mot pour corriger le sous-titre : son timing ne bouge pas.
                  </p>
                  <ol className="flex flex-col gap-1.5">
                    {draft.segments.map((s, i) => {
                      const placed = segs.find((x) => x.id === s.id);
                      return (
                        <li
                          key={s.id}
                          className={cn(
                            "group flex gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-150",
                            s.kept ? "border-line bg-surface" : "border-dashed border-line bg-transparent",
                          )}
                        >
                          <button
                            onClick={() => edit((e) => ((e.segments[i].kept = !e.segments[i].kept), e))}
                            aria-label={s.kept ? "Couper ce passage" : "Remettre ce passage"}
                            title={s.kept ? "Couper ce passage" : "Remettre ce passage"}
                            className={cn("press mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", s.kept ? "text-ink-2 hover:bg-surface-2" : "text-ink-3 hover:bg-surface-2")}
                          >
                            {s.kept ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="mb-0.5 flex items-center gap-2 text-[11px] text-ink-3">
                              {placed ? (
                                <button onClick={() => seek(placed.start)} className="tabular font-mono hover:text-accent">
                                  {fmtSec(placed.start)}
                                </button>
                              ) : (
                                <span className="rounded bg-ink/5 px-1.5 py-px font-medium">Coupé{s.reason ? ` · ${s.reason}` : ""}</span>
                              )}
                              <span className="tabular font-mono">{(s.out - s.in).toFixed(1)} s</span>
                            </div>
                            <p className={cn("text-[13.5px] leading-relaxed", !s.kept && "text-ink-3 line-through decoration-ink-3/60")}>
                              {s.words?.length
                                ? s.words.map((w, wi) => (
                                    <Word
                                      key={wi}
                                      value={w.w}
                                      disabled={!s.kept}
                                      onChange={(t) =>
                                        edit((e) => {
                                          e.segments[i].words![wi].w = t;
                                          e.segments[i].text = e.segments[i].words!.map((x) => x.w).join(" ");
                                          return e;
                                        })
                                      }
                                    />
                                  ))
                                : s.text}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  </>
                  )}
                </div>
              )}
            </div>
          )}

          {version && draft && (
            <Timeline
              edl={draft}
              onChange={setEdl}
              time={time}
              onSeek={seek}
              marks={[...sentMarks, ...marks.filter((m) => m.version === version.n)]}
              rushes={rushes}
              selection={selection}
              onSelect={setSelection}
              src={version.preview ? `/api/montage/jobs/${job.id}/versions/${version.n}/preview` : undefined}
              stale={dirty}
              playing={playing}
              undo={history}
              zoomRef={zoomRef}
              onRemove={removeSelection}
              onMark={canDraw ? addNote : undefined}
            />
          )}
        </div>
      </div>
    </>
  );
}

export function VersionChip({ v, on, onClick }: { v: MontageVersion; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn("press inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium", on ? "border-accent bg-accent-soft text-ink" : "border-line-strong bg-surface text-ink-2")}
      title={v.by === "claude" ? "Proposée par Claude" : "Modifiée à la main"}
    >
      {v.by === "claude" ? <Sparkles className="size-3 text-accent" /> : null}V{v.n}
      {!v.preview && <Loader2 className="size-3 animate-spin text-ink-3" />}
    </button>
  );
}

export const Preview = ({ job, v, ref, onTime }: { job: MontageJob; v: MontageVersion; ref?: React.Ref<HTMLVideoElement>; onTime?: (t: number) => void }) => (
  <div className="overflow-hidden rounded-2xl border border-line bg-black shadow-card" style={{ aspectRatio: ASPECT[v.edl.format] }}>
    {v.preview ? (
      <video ref={ref} key={`${job.id}-${v.n}`} src={`/api/montage/jobs/${job.id}/versions/${v.n}/preview`} controls
        playsInline
        onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)}
        onSeeked={(e) => onTime?.(e.currentTarget.currentTime)}
        className="size-full object-contain"
      />
    ) : (
      <div className="flex size-full flex-col items-center justify-center gap-2 text-[12.5px] text-white/60">
        <Loader2 className="size-5 animate-spin" />
        Aperçu en préparation sur le Mac
      </div>
    )}
  </div>
);

export function Compare({ job, before, after, onBefore }: { job: MontageJob; before: number; after: number; onBefore: (n: number) => void }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const vb = job.versions.find((v) => v.n === before);
  const va = job.versions.find((v) => v.n === after);
  const both = () => {
    for (const v of [a.current, b.current]) {
      if (!v) continue;
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <select value={before} onChange={(e) => onBefore(Number(e.target.value))} aria-label="Version de comparaison" className="mb-1 h-7 w-full rounded-md border border-line-strong bg-surface px-2 text-[12px]">
            {job.versions
              .filter((v) => v.n !== after)
              .map((v) => (
                <option key={v.n} value={v.n}>
                  Avant · V{v.n}
                </option>
              ))}
          </select>
          {vb && <Preview job={job} v={vb} ref={a} />}
        </div>
        <div>
          <p className="mb-1 flex h-7 items-center text-[12px] font-medium">Après · V{after}</p>
          {va && <Preview job={job} v={va} ref={b} />}
        </div>
      </div>
      <Button size="sm" onClick={both}>
        <Play className="size-3.5" /> Lire les deux
      </Button>
    </div>
  );
}

function Word({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (editing)
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (text.trim() && text !== value) onChange(text.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(value);
            setEditing(false);
          }
        }}
        aria-label="Corriger le mot"
        className="mx-0.5 rounded border border-accent bg-accent-soft px-1 text-[13.5px] outline-none"
        style={{ width: `${Math.max(3, text.length + 1)}ch` }}
      />
    );
  return (
    <>
      <button disabled={disabled} onClick={() => setEditing(true)} className="rounded px-px enabled:hover:bg-accent-soft enabled:hover:text-ink">
        {value}
      </button>{" "}
    </>
  );
}
