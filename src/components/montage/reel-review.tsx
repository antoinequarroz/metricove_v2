"use client";

import { ArrowDown, ArrowLeft, ArrowUp, CalendarPlus, Check, Columns2, Eye, EyeOff, Loader2, MessageSquareText, Music, PenLine, Play, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { reelTimeline, type MontageJob, type MontageMark, type ReelPlan, type ReelScene } from "@/lib/montage";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { Annotator } from "./annotator";
import { Segmented } from "./controls";
import { inputClass, Toggle } from "./look-parts";
import { fmtSec, JobStatus, Progress, WorkerBanner } from "./parts";
import { ReelTimeline } from "./reel-timeline";
import { Compare, Preview, VersionChip } from "./review-page";
import { useTimelineKeys, useUndo } from "./timeline-kit";
import { montageApi, type WorkerStatus } from "./use-montage";

/** Oldest Mac program that knows the editing screen of a reel (versions, requests on a passage, edits by hand). */
const REVIEW_WORKER = [0, 9, 0];
const atLeast = (version: string | undefined, min: number[]) => {
  const v = (version ?? "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i];
  return true;
};

const MIN_SCENE = 1.5;
const MAX_SCENE = 15;
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const sameScenes = (a: ReelPlan, b: ReelPlan) => JSON.stringify([a.scenes, a.music, a.volume, a.pace]) === JSON.stringify([b.scenes, b.music, b.volume, b.pace]);

type Tab = "claude" | "scenes" | "sound";

/** The editing screen of an animated reel: the video, its timeline, drawings, requests to Claude on a passage, edits by hand, versions. */
export function ReelReview({ job, worker, refresh }: { job: MontageJob; worker: WorkerStatus; refresh: () => Promise<void> }) {
  const versions = useMemo(() => job.versions.filter((v) => v.reel), [job.versions]);
  const latest = versions.at(-1);
  const [shown, setShown] = useState<number | undefined>(latest?.n);
  const version = versions.find((v) => v.n === shown) ?? latest;
  const [draft, setDraft] = useState<ReelPlan | undefined>(version?.reel);
  // Only edits made by hand count: the Mac also rewrites a version (the lengths on screen) when its preview is ready.
  const [touched, setTouched] = useState(false);
  const dirty = touched && !!draft && !!version?.reel && !sameScenes(draft, version.reel);
  const history = useUndo<ReelPlan>(draft, (plan) => {
    setTouched(true);
    setDraft(plan);
  });
  const edit = (next: ReelPlan | undefined | ((d: ReelPlan | undefined) => ReelPlan | undefined)) => {
    history.record(draft);
    setTouched(true);
    setDraft(next);
  };
  const follow = (plan: ReelPlan | undefined) => {
    history.reset();
    setTouched(false);
    setDraft(plan);
  };
  /** The scene chosen on the timeline (Delete takes it out, the Scenes tab shows it). */
  const [selected, setSelected] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [marks, setMarks] = useState<MontageMark[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [tab, setTab] = useState<Tab>("claude");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const openComposer = useStore((s) => s.openComposer);
  const composerOpen = useStore((s) => s.composer.open);
  const zoomRef = useRef<((dir: 1 | -1 | 0) => void) | null>(null);
  // Once validated the previews are gone: the video on show is the one in the library.
  const final = useStore((s) => (job.status === "done" && job.mediaId ? s.media.find((m) => m.id === job.mediaId) : undefined));
  const working = job.action !== null;
  const old = !!worker.version && !atLeast(worker.version, REVIEW_WORKER);

  // A new version arrived: show it, unless edits by hand are waiting (then as soon as they are applied or dropped).
  const followed = useRef(latest?.n);
  useEffect(() => {
    if (latest && !dirty && followed.current !== latest.n) {
      followed.current = latest.n;
      setShown(latest.n);
      follow(latest.reel);
      setRange(null);
      setMarks([]);
      setCompareWith(null);
    }
  }, [latest?.n, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  // Another video on screen: its clock starts again.
  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [version?.n, version?.preview, compareWith]);
  // A request that failed comes back in the box, to be reworded.
  useEffect(() => {
    if (job.error && job.feedback && job.status === "review") setFeedback((f) => f || job.feedback || "");
  }, [job.error]); // eslint-disable-line react-hooks/exhaustive-deps
  // The video takes the height left between the header and the timeline, whatever banners are on show.
  const stage = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setRoom(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // The Mac wrote the lengths on screen into the version on show: take them, unless edits are waiting.
  useEffect(() => {
    if (version?.reel && !dirty) follow(version.reel);
  }, [version?.reel]); // eslint-disable-line react-hooks/exhaustive-deps

  // The video keeps the clock: the playhead follows it frame by frame while it plays.
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

  const pick = (n: number) => {
    if (dirty && !confirm("Tes modifications non appliquées seront perdues. Continuer ?")) return;
    setShown(n);
    if (compareWith === n) setCompareWith(versions.find((v) => v.n !== n && v.preview)?.n ?? null);
    follow(versions.find((v) => v.n === n)?.reel);
    setRange(null);
    setMarks([]);
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

  const seek = (t: number) => {
    setTime(t);
    if (player.current) player.current.currentTime = t;
  };
  const toggle = () => {
    const v = player.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const revise = async () => {
    if (!version) return;
    const what = range ? `Demande envoyée à Claude pour le passage ${fmtT(range[0])} – ${fmtT(range[1])}` : marks.length ? `Demande et ${marks.length} note${marks.length > 1 ? "s" : ""} envoyées à Claude` : "Demande envoyée à Claude";
    if (await call({ revise: feedback, marks: marks.filter((m) => m.version === version.n), range: range ?? undefined, from: version.n }, what)) {
      setFeedback("");
      setMarks([]);
      setRange(null);
    }
  };
  const apply = async () => {
    if (!draft || !version) return;
    if (await call({ reel: draft, from: version.n }, "Modifications envoyées au Mac pour un nouvel aperçu")) {
      // The new version is the latest one: follow it as soon as the list brings it.
      follow(undefined);
      setShown(undefined);
      setMarks([]);
    }
  };
  const approve = async () => {
    if (!version) return;
    if (await call({ approve: version.n }, "Reel validé : il est dans ta bibliothèque")) useStore.getState().load().catch(() => {});
  };

  const editScene = (id: string, patch: Partial<ReelScene>) => edit((d) => (d ? { ...d, scenes: d.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : d));
  const moveScene = (id: string, by: number) =>
    edit((d) => {
      if (!d) return d;
      const i = d.scenes.findIndex((s) => s.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= d.scenes.length) return d;
      const scenes = [...d.scenes];
      [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
      return { ...d, scenes };
    });

  /** Moves a scene to place `index` among the scenes that play; the scenes taken out keep their slot. */
  const reorder = (id: string, index: number) =>
    edit((d) => {
      if (!d) return d;
      const kept = d.scenes.filter((s) => !s.cut);
      const me = kept.find((s) => s.id === id);
      if (!me) return d;
      const order = kept.filter((s) => s.id !== id);
      order.splice(Math.min(Math.max(0, index), order.length), 0, me);
      let k = 0;
      return { ...d, scenes: d.scenes.map((s) => (s.cut ? s : order[k++])) };
    });

  // The video on screen is the version as the Mac rendered it; with edits waiting, the timeline shows what they will give.
  const placed = useMemo(() => (draft ? reelTimeline(draft, !dirty) : []), [draft, dirty]);
  const total = placed.at(-1)?.end ?? 0;
  const current = placed.find((p) => time >= p.start && time < p.end) ?? placed.at(-1);
  const canAsk = job.status === "review" && !!version?.preview && !dirty && !working;
  const canDraw = canAsk && compareWith === null;
  const keptCount = draft ? draft.scenes.filter((s) => !s.cut).length : 0;
  /** Ends the scene under the playhead at the playhead (S). */
  const trimHere = () => {
    if (dirty || !current) return;
    const seconds = Math.round((time - current.start) * 10) / 10;
    if (seconds < MIN_SCENE || current.end - time < 0.2) return void toast.message("Place la tête de lecture dans une scène, au moins 1,5 s après son début");
    editScene(current.scene.id, { seconds: Math.min(MAX_SCENE, seconds) });
    setSelected(current.scene.id);
    setTab("scenes");
  };
  /** Takes the chosen scene out of the reel (Delete). */
  const cutSelected = () => {
    if (!selected || keptCount < 2) return;
    editScene(selected, { cut: true });
    setSelected(null);
  };
  useTimelineKeys({
    enabled: job.status !== "done" && compareWith === null && !(drawing && canDraw) && !composerOpen && !!draft,
    canPlay: !dirty && !!version?.preview,
    video: () => player.current,
    total,
    onSeek: seek,
    onSplit: trimHere,
    onDelete: selected ? cutSelected : undefined,
    onUndo: history.undo,
    onRedo: history.redo,
    onZoom: (dir) => zoomRef.current?.(dir),
  });
  const sentMarks = (job.marks ?? []).filter((m) => m.version === version?.n);
  const allMarks = [...sentMarks, ...marks.filter((m) => m.version === version?.n)];

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 pt-4 pb-3 max-md:px-4">
        <Link href="/videos/studio/anime" aria-label="Retour au Studio" className="press grid size-8 place-items-center rounded-lg border border-line-strong bg-surface text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-ink-3">Reel animé · montage</p>
          <h1 className="truncate font-display text-[24px] leading-[1.1]">{job.title.replace(/^Reel animé : /, "")}</h1>
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
            <Button variant="primary" onClick={approve} disabled={busy || dirty || working || !version.preview} title={dirty ? "Applique ou annule d'abord tes modifications" : "Envoie cette version dans ta bibliothèque"}>
              <Check className="size-4" />
              Valider la version {version.n}
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col max-lg:overflow-y-auto">
        <div className="flex flex-col gap-2 px-6 pt-3 empty:hidden max-md:px-4">
          {(job.status === "queued" || working) && (
            <div className="rounded-xl border border-line bg-surface px-4 py-2.5">
              <div className="mb-1.5 flex items-center gap-2 text-[13px]">
                <Loader2 className="size-4 animate-spin text-accent" />
                <span className="font-medium">{job.status === "queued" ? "En attente du Mac" : (job.step ?? "Le Mac travaille…")}</span>
                {job.progress !== undefined && <span className="tabular ml-auto font-mono text-[12px] text-ink-3">{Math.round(job.progress * 100)}%</span>}
              </div>
              <Progress value={job.progress} />
              {job.status === "queued" && versions.some((v) => v.preview) && (
                <button onClick={() => call({ withdraw: true }, "Demande annulée")} disabled={busy} className="press mt-1.5 text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-40">
                  Annuler cette demande
                </button>
              )}
            </div>
          )}
          {job.status === "queued" && !worker.online && <WorkerBanner worker={worker} />}
          {old && job.status !== "done" && (
            <p className="rounded-xl border border-line bg-surface p-3 text-[12.5px] text-warn">{"Le programme de ton Mac est trop ancien pour cet écran de montage (version 0.9.0) : mets-le à jour avant de demander une retouche."}</p>
          )}
          {job.status === "failed" && (
            <div className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/8 px-4 py-2.5 text-[13px]">
              <span className="flex-1">
                <span className="font-medium text-danger">{version ? "La retouche a échoué." : "Le reel n'a pas pu être généré."}</span> {job.error}
              </span>
              {!version && (
                <Button size="sm" onClick={() => call({ revise: "" }, "Nouvel essai demandé")} disabled={busy}>
                  <RotateCcw className="size-3.5" /> Réessayer
                </Button>
              )}
            </div>
          )}
          {job.status === "review" && job.error && !working && (
            <p className="rounded-xl border border-danger/40 bg-danger/8 px-4 py-2.5 text-[13px]">
              <span className="font-medium text-danger">La dernière demande a échoué.</span> {job.error} {"Le reel n'a pas changé : tu peux reformuler ta demande ou valider cette version."}
            </p>
          )}
          {job.status === "done" && (
            <div className="flex items-center gap-3 rounded-xl border border-ok/40 bg-ok/8 px-4 py-2.5 text-[13px]">
              <Check className="size-4 text-ok" />
              <span className="flex-1">Le reel est dans ta bibliothèque. Programme-le sur tes comptes quand tu veux.</span>
              <Link href="/videos" className="font-medium text-accent">
                Voir la bibliothèque
              </Link>
            </div>
          )}
        </div>

        {job.status === "done" ? (
          <div className="flex min-h-0 flex-1 items-start justify-center px-6 py-4 max-md:px-4">
            {final?.url ? (
              <video src={final.url} controls playsInline preload="metadata" className="max-h-full rounded-2xl border border-line bg-black shadow-card lg:max-h-[calc(100dvh-220px)]" style={{ aspectRatio: "9 / 16" }} />
            ) : (
              <p className="text-[13px] text-ink-3">La vidéo validée est dans ta bibliothèque.</p>
            )}
          </div>
        ) : !version || !draft ? (
          <div className="m-6 rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[13px] text-ink-3">
            <Sparkles className="mx-auto mb-2 size-5 text-accent" />
            {job.status === "failed" ? "Aucune version à montrer." : "Ton Mac anime le reel. Il arrive ici dès qu'il est prêt, tu pourras le retoucher avant de le valider."}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 px-6 pt-3 max-md:px-4">
              {versions.map((v) => (
                <VersionChip key={v.n} v={v} on={v.n === version.n} onClick={() => pick(v.n)} />
              ))}
              {versions.length > 1 && (
                <button
                  onClick={() => setCompareWith(compareWith === null ? (versions.find((v) => v.n !== version.n && v.preview)?.n ?? null) : null)}
                  className={cn("press ml-2 inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium", compareWith !== null ? "border-accent bg-accent-soft" : "border-line-strong bg-surface")}
                >
                  <Columns2 className="size-3.5" /> Avant / après
                </button>
              )}
            </div>
            <div ref={stage} className="grid min-h-0 flex-1 gap-4 px-6 py-3 max-md:px-4 lg:grid-cols-[auto_minmax(0,1fr)]">
              {/* ---------- Video: as tall as the window allows, never under the timeline ---------- */}
              <div className="flex min-h-0 flex-col gap-2 lg:w-[var(--w)]" style={{ "--w": `${Math.round(compareWith !== null ? Math.max(300, ((room - 24 - 44) * 9) / 8) : Math.max(150, ((room - 24 - (drawing && canDraw ? 186 : 0)) * 9) / 16))}px` } as React.CSSProperties}>
                {compareWith !== null ? (
                  <Compare job={job} before={compareWith} after={version.n} onBefore={setCompareWith} />
                ) : (
                  <Annotator video={player} active={drawing && canDraw} version={version.n} onAdd={(m) => (setMarks((x) => [...x, m]), setTab("claude"))} onClose={() => setDrawing(false)}>
                    <div onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}>
                      <Preview job={job} v={version} ref={player} onTime={setTime} />
                    </div>
                  </Annotator>
                )}
              </div>

              {/* ---------- Tools ---------- */}
              <div className="scroll-thin flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
                <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl px-1 py-1 backdrop-blur-md">
                  <Segmented
                    label="Outil"
                    value={tab}
                    onChange={setTab}
                    options={[
                      { value: "claude", label: "Demander à Claude" },
                      { value: "scenes", label: "Scènes" },
                      { value: "sound", label: "Musique et rythme" },
                    ]}
                  />
                  {dirty && (
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => follow(version.reel)}>
                        Annuler
                      </Button>
                      <Button size="sm" variant="primary" onClick={apply} disabled={busy || working || old}>
                        <Play className="size-3.5" /> Voir l&apos;aperçu
                      </Button>
                    </div>
                  )}
                </div>
                {dirty && (
                  <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] text-ink-2">
                    Modifications pas encore rendues : la vidéo montre encore la version {version.n}. Clique sur « Voir l&apos;aperçu » pour que le Mac la refasse (une à deux minutes, sans Claude).
                  </p>
                )}
                {version.notes && tab === "claude" && (
                  <div className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">
                    <p className="mb-0.5 flex items-center gap-1.5 font-medium text-ink">
                      <Sparkles className="size-3.5 text-accent" /> {version.by === "claude" ? (version.n === versions[0]?.n ? "À savoir sur cette version" : "Ce que Claude a changé") : "Modifié à la main"}
                    </p>
                    {version.notes}
                  </div>
                )}

                {tab === "claude" && (
                  <div className="rounded-xl border border-line bg-surface p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium">
                      <MessageSquareText className="size-3.5 text-accent" /> Demander une modification à Claude
                    </p>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                      {range ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 font-medium">
                          Passage {fmtT(range[0])} – {fmtT(range[1])}
                          <button onClick={() => setRange(null)} aria-label="Retirer la sélection" className="press text-ink-3 hover:text-ink">
                            <X className="size-3" />
                          </button>
                        </span>
                      ) : (
                        <span className="text-ink-3">Fais glisser sur la timeline pour choisir un passage : Claude ne touchera que lui.</span>
                      )}
                      {current && !range && canAsk && (
                        <button onClick={() => setRange([current.start, current.end])} className="press rounded-full border border-line-strong bg-surface px-2.5 py-0.5 font-medium text-ink-2 hover:text-ink">
                          Prendre la scène {current.index + 1}
                        </button>
                      )}
                      {canDraw && (
                        <button
                          onClick={() => (player.current?.pause(), setDrawing((d) => !d))}
                          className={cn("press ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 font-medium", drawing ? "border-accent bg-accent-soft" : "border-line-strong bg-surface")}
                          title="Mets la vidéo en pause là où il faut changer quelque chose, dessine et explique"
                        >
                          <PenLine className="size-3.5" /> Dessiner sur la vidéo
                        </button>
                      )}
                    </div>
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
                            <span className="min-w-0 flex-1 truncate">{m.text || "Dessin sans texte"}</span>
                            <button onClick={() => setMarks((x) => x.filter((y) => y.id !== m.id))} aria-label="Retirer la note" className="press grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:text-ink">
                              <X className="size-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <textarea
                      aria-label="Demande à Claude"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      rows={3}
                      maxLength={2000}
                      disabled={!canAsk}
                      placeholder={range ? "Que faut-il changer dans ce passage ? Par ex. « ralentis », « change cette animation », « enlève ce texte »" : "Par ex. « la scène des livres est trop rapide », ou choisis un passage sur la timeline"}
                      className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent/60 disabled:opacity-60"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[11.5px] text-ink-3">
                        {dirty ? "Applique ou annule d'abord tes modifications à la main." : range || marks.length ? "Le reste de la vidéo ne bouge pas." : "Sans passage choisi, Claude modifie les scènes dont tu parles."}
                      </span>
                      <Button size="sm" variant="primary" onClick={revise} disabled={busy || !canAsk || old || (!feedback.trim() && !marks.length)}>
                        <Wand2 className="size-3.5" /> Nouvelle version
                      </Button>
                    </div>
                  </div>
                )}

                {tab === "scenes" && (
                  <ol className="flex flex-col gap-2">
                    {draft.scenes.map((s, i) => {
                      const at = placed.find((p) => p.scene.id === s.id);
                      const was = version.reel?.scenes.find((x) => x.id === s.id);
                      const retexted = !!was && (was.title !== s.title || was.body !== s.body);
                      return (
                        <li key={s.id} className={cn("rounded-xl border px-3 py-2.5", s.cut ? "border-dashed border-line bg-transparent" : selected === s.id ? "border-accent bg-surface" : at && current?.scene.id === s.id ? "border-accent/60 bg-surface" : "border-line bg-surface")}>
                          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                            <button onClick={() => editScene(s.id, { cut: !s.cut })} aria-label={s.cut ? "Remettre cette scène" : "Couper cette scène"} title={s.cut ? "Remettre cette scène" : "Couper cette scène"} className="press grid size-6 place-items-center rounded-md text-ink-2 hover:bg-surface-2">
                              {s.cut ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                            </button>
                            {at ? (
                              <button onClick={() => seek(at.start + 0.05)} className="tabular font-mono hover:text-accent">
                                Scène {at.index + 1} · {fmtT(at.start)}
                              </button>
                            ) : (
                              <span className="rounded bg-ink/5 px-1.5 py-px font-medium">Coupée</span>
                            )}
                            {s.custom && <span className="rounded-full bg-accent-soft px-2 py-px font-medium text-ink">{s.custom === "art" ? "Animation sur mesure" : "Fond sur mesure"}</span>}
                            {s.custom && (
                              <button onClick={() => editScene(s.id, { custom: undefined })} className="press underline-offset-2 hover:text-ink hover:underline" title="Revenir à l'animation standard pour cette scène">
                                Remettre en standard
                              </button>
                            )}
                            <span className="ml-auto flex items-center gap-0.5">
                              <button onClick={() => moveScene(s.id, -1)} disabled={i === 0} aria-label="Monter cette scène" className="press grid size-6 place-items-center rounded-md hover:bg-surface-2 disabled:opacity-40">
                                <ArrowUp className="size-3.5" />
                              </button>
                              <button onClick={() => moveScene(s.id, 1)} disabled={i === draft.scenes.length - 1} aria-label="Descendre cette scène" className="press grid size-6 place-items-center rounded-md hover:bg-surface-2 disabled:opacity-40">
                                <ArrowDown className="size-3.5" />
                              </button>
                            </span>
                          </div>
                          <div className={cn("flex flex-col gap-1.5", s.cut && "opacity-50")}>
                            <input aria-label={`Gros texte de la scène ${i + 1}`} value={s.title} onChange={(e) => editScene(s.id, { title: e.target.value })} maxLength={120} disabled={s.cut} placeholder="Gros texte" className={cn(inputClass, "h-8 font-medium")} />
                            <textarea aria-label={`Petit texte de la scène ${i + 1}`} value={s.body} onChange={(e) => editScene(s.id, { body: e.target.value })} maxLength={240} rows={2} disabled={s.cut} placeholder="Petit texte" className={cn(inputClass, "resize-y py-1.5 leading-snug")} />
                            <label className="flex items-center gap-2 text-[12px] text-ink-2">
                              <span className="w-12 shrink-0">Durée</span>
                              <input
                                type="range"
                                min={MIN_SCENE}
                                max={MAX_SCENE}
                                step={0.1}
                                disabled={s.cut}
                                value={s.seconds ?? (at ? at.end - at.start : 3)}
                                onChange={(e) => editScene(s.id, { seconds: Number(e.target.value) })}
                                aria-label={`Durée de la scène ${i + 1}`}
                                className="min-w-0 flex-1 accent-[var(--accent)]"
                              />
                              <span className="tabular w-11 text-right font-mono text-[11.5px]">{(s.seconds ?? (at ? at.end - at.start : 0)).toFixed(1)} s</span>
                              {s.seconds !== undefined && (
                                <button onClick={() => editScene(s.id, { seconds: undefined })} className="press text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" title="Laisser le Mac calculer la durée d'après le texte">
                                  Auto
                                </button>
                              )}
                            </label>
                            {retexted && was?.custom === "art" && s.custom === "art" && (
                              <p className="text-[11.5px] text-warn">{"Cette scène a une animation sur mesure : en changeant son texte à la main, elle repasse en animation standard. Pour garder l'animation, demande le changement de texte à Claude."}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {tab === "sound" && (
                  <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 text-[13px]">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      <Music className="size-3.5 text-accent" /> Musique
                    </p>
                    <Toggle label="Mettre une musique de ton dossier sous le reel" checked={draft.music} onChange={(music) => edit({ ...draft, music })} />
                    <label className="flex items-center gap-2 text-[12px] text-ink-2">
                      <span className="w-14 shrink-0">Volume</span>
                      <input type="range" min={0} max={1} step={0.05} value={draft.volume ?? 0.7} disabled={!draft.music} onChange={(e) => edit({ ...draft, volume: Number(e.target.value) })} aria-label="Volume de la musique" className="min-w-0 flex-1 accent-[var(--accent)]" />
                      <span className="tabular w-10 text-right font-mono text-[11.5px]">{Math.round((draft.volume ?? 0.7) * 100)} %</span>
                    </label>
                    <p className="text-[12px] text-ink-3">{"Le Mac prend un morceau du dossier Musique de Metricove. S'il est vide, le reel sort sans son."}</p>
                    <label className="flex items-center gap-2 border-t border-line pt-3 text-[12px] text-ink-2">
                      <span className="w-14 shrink-0">Rythme</span>
                      <select aria-label="Rythme" value={draft.pace} onChange={(e) => edit({ ...draft, pace: e.target.value as ReelPlan["pace"] })} className={cn(inputClass, "h-8")}>
                        <option value="calm">Calme</option>
                        <option value="normal">Normal</option>
                        <option value="fast">Rapide</option>
                      </select>
                    </label>
                    <p className="text-[12px] text-ink-3">Le rythme change la durée de toutes les scènes, sauf celles dont tu as réglé la durée toi-même.</p>
                  </div>
                )}
              </div>
            </div>

            {/* ---------- Timeline ---------- */}
{/* Drawing happens on one frame, and its tools take the room of the timeline on a small screen. */}
            {!(drawing && canDraw && compareWith === null) && (
              <ReelTimeline
                src={version.preview ? `/api/montage/jobs/${job.id}/versions/${version.n}/preview` : undefined}
                placed={placed}
                total={total}
                time={dirty ? -1 : time}
                playing={playing}
                onToggle={toggle}
                onSeek={seek}
                range={dirty ? null : range}
                onRange={canAsk ? (r) => (setRange(r), r && setTab("claude")) : undefined}
                marks={allMarks}
                selected={selected}
                onSelect={setSelected}
                onResize={(id, seconds) => (editScene(id, { seconds }), setSelected(id), setTab("scenes"))}
                onReorder={reorder}
                onTrimHere={trimHere}
                onCut={cutSelected}
                undo={history}
                zoomRef={zoomRef}
                stale={dirty}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
