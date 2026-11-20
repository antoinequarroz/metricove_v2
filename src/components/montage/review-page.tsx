"use client";

import { ArrowLeft, CalendarPlus, Check, Columns2, Crosshair, Laptop, Loader2, PenLine, Play, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { edlDuration, isVideoJob, splitAt, timeline, type CaptionStyle, type Edl, type FreeText, type MontageJob, type MontageVersion, type Rush } from "@/lib/montage";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { Annotator } from "./annotator";
import { ReelReview } from "./reel-review";
import { CaptionsEditor } from "./captions-editor";
import { Segmented } from "./controls";
import { TextGhost, TextPanel } from "./free-texts";
import { fmtSec, JobStatus, Progress, WorkerBanner } from "./parts";
import { useAudioSettings } from "../resources/music-maker";
import { ClaudeSelects } from "./audio-fields";
import { audioFor } from "@/lib/audio-ai";
import { useProfiles } from "@/lib/use-profiles";
import { SettingsPanel } from "./settings-panel";
import { Timeline, type Selection } from "./timeline";
import { useTimelineKeys, useUndo } from "./timeline-kit";
import { TranscriptPanel } from "./transcript-panel";
import { InspectOverlay } from "./inspect-overlay";
import { StyleRules } from "./style-rules";
import { notesAsMarks, ReviewNotesPanel, useReviewNotes, type NoteDraft } from "./review-notes";
import { montageApi, useMontage } from "./use-montage";
import { VideoReview } from "./video-review";

const ASPECT: Record<Edl["format"], string> = { "9:16": "9 / 16", "4:5": "4 / 5", "1:1": "1 / 1", "16:9": "16 / 9" };
const RATIO: Record<Edl["format"], number> = { "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9 };

/** A computer screen (Tailwind lg and up): the editing screen fits the window there instead of scrolling (as on the reel's screen). */
const WIDE = "(min-width: 1024px)";
const useWide = () =>
  useSyncExternalStore(
    (changed) => {
      const q = window.matchMedia(WIDE);
      q.addEventListener("change", changed);
      return () => q.removeEventListener("change", changed);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
/** Below this width (px) the tools' tabs no longer hold on one line with their full names: Claude's tab takes a short one. */
const TABS_FULL = 446;

/** The width of a box, kept up to date (0 until it is measured). */
function useWidth(box: React.RefObject<HTMLElement | null>, ready: boolean) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, ready]);
  return width;
}

/** True while a box scrolls and has more to show below: its bottom edge then fades, a hint that it scrolls. */
function useMoreBelow(box: React.RefObject<HTMLElement | null>, ready: boolean) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return setMore(false);
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [box, ready]);
  return more;
}
const FADE = "linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent)";

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
  // A continuous reel (video plan) has its own editing screen, over a timeline of beats; an older reel keeps its timeline of scenes.
  if (isVideoJob(job)) return <VideoReview job={job} worker={data.worker} refresh={refresh} />;
  // An animated reel has its own editing screen: the same player, drawings and versions, over a timeline of scenes.
  if (job.kind === "motion") return <ReelReview job={job} worker={data.worker} refresh={refresh} />;
  return <Review job={job} worker={data.worker} rushes={data.rushes} refresh={refresh} />;
}

type Tab = "claude" | "text" | "captions" | "texts" | "settings";

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
  const player = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  // Claude's notes and the request for another version have their own tab, first during the review (as on the reel's screen).
  const [tab, setTab] = useState<Tab>(job.status === "review" ? "claude" : "captions");
  const [selection, setSelectionRaw] = useState<Selection>(null);
  /** The free text chosen on the timeline or in the Texts tab (one thing is chosen at a time). */
  const [textSel, setTextSelRaw] = useState<string | null>(null);
  const setSelection = (s: Selection) => (setSelectionRaw(s), s && setTextSelRaw(null));
  const setTextSel = (id: string | null) => (setTextSelRaw(id), id && (setSelectionRaw(null), setTab("texts")));
  const [drawing, setDrawing] = useState(false);
  /** « Inspecter » (V): the elements of the picture are boxes to click. */
  const [inspecting, setInspecting] = useState(false);
  const notes = useReviewNotes(job.id);
  /** The note just added (its field takes the focus). */
  const [newNote, setNewNote] = useState<string | null>(null);
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
  const texts = draft?.texts ?? [];
  const setTexts = (next: FreeText[], key?: string) => draft && setEdl({ ...draft, texts: next }, key);
  const curText = texts.find((t) => t.id === textSel);
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
    if (!draft || !selection || selection.kind === "title" || selection.kind === "cap" || selection.kind === "brange") return;
    const next = structuredClone(draft);
    if (selection.kind === "seg") {
      const s = next.segments.find((x) => x.id === selection.id);
      if (!s || next.segments.filter((x) => x.kept).length < 2) return;
      s.kept = false;
    } else if (selection.kind === "zoom") {
      if (!next.zooms?.[selection.i]) return;
      next.zooms.splice(selection.i, 1);
    } else if (selection.kind === "stage") {
      if (!next.stages?.[selection.i]) return;
      next.stages.splice(selection.i, 1);
    } else if (selection.kind === "sfx") {
      if (!next.sfx?.[selection.i]) return;
      next.sfx.splice(selection.i, 1);
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

  // The Claude model of the next requests (the job's, else the one of Réglages).
  const [model, setModel] = useState(job.model ?? "");
  const [effort, setEffort] = useState(job.effort ?? "");
  // Réglages with the choices of the job's style on top (the defaults shown beside the model and effort).
  const { styles: allStyles } = useProfiles();
  const styleMedia = job.projectId ? (allStyles?.[job.projectId]?.find((x) => x.id === job.styleId) ?? allStyles?.[job.projectId]?.[0])?.media : undefined;
  const audioSettings = audioFor(useAudioSettings(), styleMedia);
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
  /** Claude places B-roll on one passage of the edit on screen (unsaved changes included). */
  const askBroll = async (range: [number, number], note: string) => {
    if (!draft || !(await call({ brollAsk: { range, note }, edl: draft }, "Claude cherche du B-roll pour ce passage"))) return;
    setDirty(false);
    history.reset();
  };
  /** A new version that handles the open review notes (and a few more words). */
  const revise = async (ids: string[], extra: string) => {
    const ok = await call({ revise: extra, notes: ids, model, effort }, ids.length ? `${ids.length} retour${ids.length > 1 ? "s" : ""} envoyé${ids.length > 1 ? "s" : ""} à Claude` : "Demande envoyée à Claude");
    if (ok) void notes.reload();
    return ok;
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
  const canDraw = job.status === "review" && !!version?.preview && compareWith === null;
  /** Puts a note at the playhead (M): a place in the video and a few words for Claude, without drawing. */
  const addNote = async (more: Partial<NoteDraft> = {}) => {
    if (!version || !canDraw) return;
    player.current?.pause();
    setTab("claude");
    const n = await notes.add({ version: version.n, t: Math.round((player.current?.currentTime ?? time) * 100) / 100, ...more });
    if (n) setNewNote(n.id);
  };
  /** A note of another version: that version comes on screen, then the video goes to the moment. */
  const seekNote = (n: number, t: number) => {
    if (n !== version?.n && job.versions.some((v) => v.n === n)) {
      pick(n);
      setTimeout(() => seek(t), 400);
    } else seek(t);
  };
  useTimelineKeys({
    enabled: !!draft && compareWith === null && !(drawing && canDraw) && !composerOpen,
    canPlay: !!version?.preview,
    video: () => player.current,
    total: draft ? edlDuration(draft) : 0,
    onSeek: seek,
    onSplit: splitHere,
    onMark: () => void addNote(),
    onInspect: canDraw ? () => (player.current?.pause(), setInspecting((x) => !x)) : undefined,
    onDelete: curText ? () => (setTexts(texts.filter((t) => t.id !== curText.id)), setTextSelRaw(null)) : selection && selection.kind !== "title" && selection.kind !== "cap" && selection.kind !== "brange" ? removeSelection : undefined,
    onUndo: history.undo,
    onRedo: history.redo,
    onZoom: (dir) => zoomRef.current?.(dir),
  });
  // Another video on screen: nothing plays yet.
  useEffect(() => setPlaying(false), [version?.n, version?.preview, compareWith]);

  /* ---- Layout on a computer screen: the page fits the window, the video takes the height left ---- */
  const ratio = RATIO[version?.edl.format ?? "9:16"];
  // A tall video spans the whole height, beside the tools and the timeline; a wide one sits above the timeline.
  const portrait = ratio < 1;
  const tlBox = useRef<HTMLDivElement>(null);
  const [tlHeight, setTlHeight] = useState(320);
  const hasDraft = !!draft;
  useEffect(() => {
    const el = tlBox.current;
    if (!el || portrait) return;
    const measure = () => setTlHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [portrait, hasDraft]);
  // The versions' height (they wrap when there are many): the drawing tools go under them.
  const versionsRow = useRef<HTMLDivElement>(null);
  const [versionsH, setVersionsH] = useState(28);
  const hasVersion = !!version;
  useEffect(() => {
    const el = versionsRow.current;
    if (!el) return;
    const measure = () => setVersionsH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasVersion]);
  // Heights in container units of the stage (its content box): the room the video has, its own width follows.
  const room = !draft ? `(100cqh - ${versionsH + 12}px)` : portrait ? "100cqh" : `(100cqh - ${tlHeight + 12}px)`;
  // The tools keep at least 28rem beside a tall video (the timeline under them needs it too), 24rem beside a wide one (the
  // timeline is under everything; Claude's tab then takes a short name). Before / after puts two videos side by side,
  // 8 px apart, under their names (32 px) and above "Lire les deux" (36 px).
  const toolsMin = `calc(100cqw - ${portrait ? 29 : 25}rem)`;
  const videoW = compareWith !== null ? `min(calc((${room} - 68px) * ${2 * ratio} + 8px), ${toolsMin})` : `min(calc(${room} * ${ratio}), ${portrait ? 46 : 62}cqw, ${toolsMin})`;
  const drawingHere = drawing && canDraw && compareWith === null;
  /** Claude's tab is there while a new version can be asked, or to read what Claude did. */
  const hasClaude = job.status === "review" || !!version?.notes;
  const view: Tab = tab === "claude" && !hasClaude ? "captions" : tab;
  const wide = useWide();
  /** On a computer the banners sit at the top of the tools, beside the video: they never push the video or the timeline out of the window. */
  const beside = wide && !!version && !!draft;
  const panel = useRef<HTMLDivElement>(null);
  const more = useMoreBelow(panel, !!version && hasDraft);
  // Another tab opens at its top (the banners and the note on changes not yet rendered are there), not where the last one was left.
  useLayoutEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [view]);
  const tools = useRef<HTMLDivElement>(null);
  const toolsW = useWidth(tools, !!version && hasDraft);
  const shortTabs = toolsW > 0 && toolsW < TABS_FULL;

  /* ---- Drawing on a phone: the video gets smaller so that it and the drawing tools fit the screen together ---- */
  const body = useRef<HTMLDivElement>(null);
  const videoCol = useRef<HTMLDivElement>(null);
  const [drawH, setDrawH] = useState(0);
  const sketchSmall = drawingHere && !wide;
  useLayoutEffect(() => {
    const card = videoCol.current?.querySelector<HTMLElement>(":scope > div > div:nth-child(2)");
    if (!sketchSmall || !card) return setDrawH(0);
    const measure = () => setDrawH(card.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    return () => ro.disconnect();
  }, [sketchSmall]);
  /** The versions stay in view above the video while drawing on a phone, unless there are so many that they take several lines. */
  const rowRoom = versionsH <= 40 ? versionsH + 12 : 0;
  // The note's box takes the focus and the page scrolls to it: once the drawing tools are measured, the versions (or the video)
  // go back to the top and the whole video is in view.
  const drawReady = drawH > 0;
  useEffect(() => {
    if (!sketchSmall || !drawReady) return;
    const raf = requestAnimationFrame(() => {
      const b = body.current;
      const top = rowRoom ? versionsRow.current : videoCol.current;
      if (b && top) b.scrollTop += top.getBoundingClientRect().top - b.getBoundingClientRect().top - 12;
    });
    return () => cancelAnimationFrame(raf);
  }, [sketchSmall, drawReady, rowRoom]);

  /** Changes made by hand wait for a new preview: they are applied, or dropped, here. */
  const applyButtons = dirty && version && (
    <>
      <Button size="sm" variant="ghost" onClick={() => pick(version.n)}>
        Annuler
      </Button>
      <Button size="sm" variant="primary" onClick={apply} disabled={busy || working}>
        <Play className="size-3.5" /> Voir l&apos;aperçu
      </Button>
    </>
  );

  /** Status, warnings and errors of the montage. On a computer they are compact (the progress and the Mac's absence share
      one line): they sit at the top of the tools and leave them their room. */
  const banners = (
    <>
      {(job.status === "queued" || working) &&
        (beside ? (
          <StatusLine job={job} worker={worker} />
        ) : (
          <div className="rounded-xl border border-line bg-surface px-4 py-2.5">
            <div className="mb-1.5 flex items-center gap-2 text-[13px]">
              <Loader2 className="size-4 animate-spin text-accent" />
              <span className="font-medium">{job.status === "queued" ? "En attente du Mac" : (job.step ?? "Le Mac travaille…")}</span>
              {job.progress !== undefined && <span className="tabular ml-auto font-mono text-[12px] text-ink-3">{Math.round(job.progress * 100)}%</span>}
            </div>
            <Progress value={job.progress} />
          </div>
        ))}
      {job.status === "queued" && !worker?.online && !beside && <WorkerBanner worker={worker} />}
      {job.status === "failed" && (
        <div className={cn("flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/8 text-[13px]", beside ? "px-3 py-2" : "px-4 py-2.5")}>
          <span className="min-w-0 flex-1 text-pretty">
            <span className="font-medium text-danger">Le montage a échoué.</span> {job.error}
          </span>
          <Button size="sm" onClick={() => call({ revise: job.feedback ?? "", model, effort }, "Nouvel essai demandé")}>
            <RotateCcw className="size-3.5" /> Réessayer
          </Button>
        </div>
      )}
      {job.status === "done" && (
        <div className={cn("flex items-center gap-3 rounded-xl border border-ok/40 bg-ok/8 text-[13px]", beside ? "px-3 py-2" : "px-4 py-2.5")}>
          <Check className="size-4 shrink-0 text-ok" />
          <span className="flex-1">La vidéo finale est dans ta bibliothèque. Programme-la sur tes comptes quand tu veux.</span>
          <Link href="/videos" className="shrink-0 font-medium text-accent">
            Voir la bibliothèque
          </Link>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* On a computer the header keeps one line: a long title is cut, the button to validate stays in place (and the video keeps its height). */}
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 pt-4 pb-3 max-md:px-4 lg:flex-nowrap">
        <Link href="/videos/montage" aria-label="Retour aux montages" className="press grid size-8 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-ink-3">Montage IA · {job.brief.format}</p>
          <h1 className="truncate font-display text-[24px] leading-[1.1]" title={job.title}>
            {job.title}
          </h1>
        </div>
        <span className="flex shrink-0">
          <JobStatus job={job} />
        </span>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
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

      {/* On a computer the page never scrolls: the video, the tools and the timeline share the window, only the tools scroll.
          On a phone the page scrolls, and the video is never taller than what the screen shows under the header. */}
      {/* Positioned: what is placed in it (a title kept for screen readers, a popover) stays inside it and never makes the frame around it scroll. */}
      <div ref={body} className="relative flex min-h-0 flex-1 flex-col max-lg:overflow-y-auto max-lg:[container-type:size]">
        {!beside && <div className="flex flex-col gap-2 px-6 pt-3 empty:hidden max-md:px-4">{banners}</div>}

        {!version ? (
          job.status !== "failed" && (
            <div className="m-6 rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[13px] text-ink-3 max-md:mx-4">
              <Sparkles className="mx-auto mb-2 size-5 text-accent" />
              Claude prépare une première proposition : transcription, choix des passages, sous-titres et recadrage.
            </div>
          )
        ) : (
          /* The stage: its height is the window's, less the header; container units size the video from it. On a computer the
             versions sit at the top of the tools, beside the video (as on the reel's screen): the video starts right under the header. */
          <div
            className={cn("grid gap-x-4 gap-y-3 px-6 py-3 max-md:px-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:[container-type:size]", draft ? "lg:grid-cols-[auto_minmax(0,1fr)]" : "lg:grid-cols-1")}
            style={{ "--versions": `${versionsH}px` } as React.CSSProperties}
          >
            <div ref={versionsRow} className={cn("flex min-w-0 flex-wrap items-center gap-1.5", draft && "lg:col-start-2 lg:row-start-1")}>
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
              {canDraw && draft && (
                <button
                  onClick={() => (player.current?.pause(), setInspecting((x) => !x))}
                  className={cn("press inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium", inspecting ? "border-accent bg-accent-soft" : "border-line-strong bg-surface")}
                  title="Clique un élément de l'image (sous-titre, texte, carte…) pour voir sa place, le commenter ou le modifier (touche V)"
                >
                  <Crosshair className="size-3.5" /> Inspecter
                </button>
              )}
              <div className="ml-auto flex items-center gap-2 empty:hidden">
                {job.versions.length > 1 && (
                  <button
                    onClick={() => setCompareWith(compareWith === null ? (job.versions.find((v) => v.n !== version.n && v.preview)?.n ?? null) : null)}
                    className={cn("press inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium", compareWith !== null ? "border-accent bg-accent-soft" : "border-line-strong bg-surface")}
                  >
                    <Columns2 className="size-3.5" /> Avant / après
                  </button>
                )}
                {/* On a computer, changes are applied from here, under "Valider la version": the tabs keep their line. */}
                {wide && applyButtons}
              </div>
            </div>

            {/* ---------- Video ---------- */}
            <div
              ref={videoCol}
              className={cn(
                "flex min-w-0 flex-col max-lg:mx-auto lg:relative lg:min-h-0 lg:w-[var(--video)]",
                // Two videos side by side are limited by the width: the pair sits in the middle of the height left to it.
                // While drawing on a phone the drawing tools take the whole width, and the video (the first block of the annotator)
                // leaves them room under it: the versions, the video and the note fit the screen together.
                compareWith !== null
                  ? "max-lg:w-full lg:justify-center"
                  : sketchSmall
                    ? "max-lg:w-full max-lg:[&>div>div:first-child]:mx-auto max-lg:[&>div>div:first-child]:w-[min(100%,calc(75dvh*var(--ratio)),max(9rem,calc((100cqh-var(--draw-room))*var(--ratio))))]"
                    : "max-lg:w-[min(100%,calc(75dvh*var(--ratio)),max(12rem,calc((100cqh-4rem)*var(--ratio))))]",
                draft && (portrait ? "lg:col-start-1 lg:row-span-3 lg:row-start-1" : "lg:col-start-1 lg:row-span-2 lg:row-start-1"),
                // While drawing, the drawing tools (the second block of the annotator) take the place of the editing panels,
                // beside the video and under the versions, as wide as them: the video keeps its size and the timeline stays where it is.
                drawingHere && "lg:[&>div>div:nth-child(2)]:absolute lg:[&>div>div:nth-child(2)]:top-[calc(var(--versions)+0.75rem)] lg:[&>div>div:nth-child(2)]:left-[calc(100%+1rem)] lg:[&>div>div:nth-child(2)]:z-30 lg:[&>div>div:nth-child(2)]:w-[calc(100cqw-100%-1rem)]",
              )}
              // The room the phone keeps beside the video while drawing: the stage's top, the versions, the gaps and the drawing tools.
              style={{ "--ratio": ratio, "--video": videoW, "--draw-room": `${12 + rowRoom + 8 + drawH + 12}px` } as React.CSSProperties}
            >
              {compareWith !== null ? (
                <Compare job={job} before={compareWith} after={version.n} onBefore={setCompareWith} />
              ) : (
                <Annotator video={player} active={drawing && canDraw} version={version.n} onAdd={(m) => void notes.add({ version: m.version, t: m.t, text: m.text, image: m.image }).then(() => setTab("claude"))} onClose={() => setDrawing(false)}>
                  <div className="relative" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}>
                    <Preview job={job} v={version} ref={player} onTime={setTime} />
                    {inspecting && canDraw && draft && !drawing && (
                      <InspectOverlay
                        edl={draft}
                        time={time}
                        style={job.style}
                        onClose={() => setInspecting(false)}
                        onComment={(el) => {
                          setInspecting(false);
                          void addNote({ target: { kind: el.kind, label: el.label, x: el.x + el.w / 2, y: el.y + el.h / 2 } });
                        }}
                        onEdit={(el) => {
                          setInspecting(false);
                          if (el.ref?.text) setTextSel(el.ref.text);
                          else if (el.ref?.stage !== undefined) setSelection({ kind: "stage", i: el.ref.stage });
                          else if (el.ref?.broll !== undefined) setSelection({ kind: "broll", i: el.ref.broll });
                          else if (el.kind === "title") setSelection({ kind: "title" });
                          else setTab(el.kind === "caption" ? "captions" : "settings");
                        }}
                      />
                    )}
                    {curText && draft && tab === "texts" && !drawing && (
                      <TextGhost text={curText} aspect={(([w, h]) => w / h)(draft.format.split(":").map(Number))} onMove={(x, y, key) => setTexts(texts.map((t) => (t.id === curText.id ? { ...t, x, y } : t)), key)} />
                    )}
                  </div>
                </Annotator>
              )}
            </div>

            {/* ---------- Editing panels: only they scroll ---------- */}
            {draft && (
              <div ref={tools} className={cn("@container/tools flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-2 lg:min-h-0", drawingHere && "lg:invisible")}>
                <div className="flex flex-wrap items-center gap-2">
                  {/* The tabs never wrap their labels: on a narrow column Claude's tab takes a short name (and on a phone the tabs are
                      tighter), so the five hold on one line; on a very narrow phone they scroll sideways. */}
                  <div className="scroll-thin max-w-full overflow-x-auto whitespace-nowrap max-sm:[&_[role=radio]]:px-[5px]">
                    <Segmented
                      label="Outil"
                      value={view}
                      onChange={setTab}
                      options={[
                        ...(hasClaude ? [{ value: "claude" as const, label: job.status === "review" ? "Retours" : shortTabs ? "Claude" : "Notes de Claude" }] : []),
                        { value: "captions", label: "Sous-titres" },
                        { value: "text", label: "Transcription" },
                        { value: "texts", label: "Textes" },
                        { value: "settings", label: "Réglages" },
                      ]}
                    />
                  </div>
                  {/* On a computer the count never takes a line of its own: it gives way on a narrow column (the timeline shows the length). */}
                  <span className="tabular text-[12px] text-ink-3 lg:@max-[36rem]/tools:hidden">
                    {segs.length}/{draft.segments.length} passages · {fmtSec(edlDuration(draft))}
                  </span>
                  {!wide && applyButtons && <div className="ml-auto flex gap-2">{applyButtons}</div>}
                </div>

                {/* Only this part scrolls; its bottom edge fades while there is more below. */}
                <div ref={panel} className="scroll-thin lg:-mx-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-1 lg:pb-1" style={more ? { maskImage: FADE, WebkitMaskImage: FADE } : undefined}>
                  <div className="flex flex-col gap-3">
                    {beside && <div className="flex flex-col gap-2 empty:hidden">{banners}</div>}
                    {dirty && <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] text-pretty text-ink-2">Pas encore rendu : la vidéo montre encore la version {version.n}. « Voir l&apos;aperçu » la fait refaire par le Mac.</p>}

                    {view === "claude" && version.notes && (
                      <div className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                        <p className="mb-0.5 flex items-center gap-1.5 font-medium text-ink">
                          <Sparkles className="size-3.5 text-accent" /> {version.by === "claude" ? "Ce que Claude a fait" : "Modifié à la main"}
                        </p>
                        {version.notes}
                      </div>
                    )}
                    {view === "claude" && job.status === "review" && (
                      <ReviewNotesPanel
                        jobId={job.id}
                        api={notes}
                        version={version.n}
                        canSend={!working}
                        busy={busy}
                        focus={newNote}
                        onSeek={seekNote}
                        onAdd={canDraw ? () => void addNote() : undefined}
                        onSend={revise}
                      />
                    )}
                    {view === "claude" && job.status === "review" && (
                      <label className="flex min-w-0 items-center gap-2 text-[12px] text-ink-2">
                        <span className="shrink-0">Claude</span>
                        <ClaudeSelects model={model} effort={effort} onModel={setModel} onEffort={setEffort} audio={audioSettings} className="flex-1" />
                      </label>
                    )}
                    {view === "claude" && job.status === "review" && <StyleRules job={job} notes={notes.notes} />}

                    {view === "captions" && <CaptionsEditor edl={draft} fallback={job.style} onChange={(e) => setEdl(e, "captions")} onSeek={seek} time={time} onSaveStyle={job.projectId ? saveStyle : undefined} />}
                    {view === "texts" && <TextPanel texts={texts} selected={textSel} onSelect={setTextSel} onChange={setTexts} time={time} total={edlDuration(draft)} onSeek={dirty ? undefined : seek} workerVersion={worker?.version} />}
                    {view === "settings" && <SettingsPanel edl={draft} onChange={(e) => setEdl(e, "settings")} tracks={worker?.tracks} media={styleMedia} />}
                    {view === "text" && <TranscriptPanel edl={draft} time={time} onSeek={seek} edit={edit} onComment={canDraw ? (t, words) => void addNote({ t, text: `« ${words} » : ` }) : undefined} />}
                  </div>
                </div>
              </div>
            )}

            {/* ---------- Timeline: always in view, under the tools (or under everything for a wide video) ---------- */}
            {draft && (
              <div ref={tlBox} className={cn("min-w-0 lg:row-start-3", portrait ? "lg:col-start-2" : "lg:col-span-2")}>
                <Timeline
                  // Never taller than the stage less the versions and about a third of its height (13rem at least): the tools above keep room
                  // for their tabs and a card or two even with every track shown, the tracks scroll instead.
                  className="lg:max-h-[calc(100cqh-var(--versions)-0.75rem-max(13rem,36cqh))]"
                  edl={draft}
                  onChange={setEdl}
                  time={time}
                  onSeek={seek}
                  marks={notesAsMarks(notes.notes, version.n)}
                  rushes={rushes}
                  selection={selection}
                  onSelect={setSelection}
                  textSel={textSel}
                  onTextSel={setTextSel}
                  workerVersion={worker?.version}
                  captionStyle={job.style}
                  src={version.preview ? `/api/montage/jobs/${job.id}/versions/${version.n}/preview` : undefined}
                  stale={dirty}
                  playing={playing}
                  undo={history}
                  zoomRef={zoomRef}
                  onRemove={removeSelection}
                  onMark={canDraw ? () => void addNote() : undefined}
                  onBrollAsk={working ? undefined : askBroll}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** The progress of the montage on one line, with the Mac's absence when a request waits for it (a computer screen). */
function StatusLine({ job, worker }: { job: MontageJob; worker: Parameters<typeof WorkerBanner>[0]["worker"] }) {
  const away = job.status === "queued" && !worker?.online;
  const seen = worker?.lastSeen && new Date(worker.lastSeen).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px]">
      <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
      <span className="min-w-0 truncate font-medium">{job.status === "queued" ? "En attente du Mac" : (job.step ?? "Le Mac travaille…")}</span>
      {away && (
        <span className="flex min-w-0 shrink-[3] items-center gap-1.5 text-ink-3" title={seen ? `Vu pour la dernière fois ${seen}. Les demandes attendent son retour.` : "Le programme de montage n'a pas encore été lancé sur le Mac. Les demandes attendent son retour."}>
          <Laptop className="size-3.5 shrink-0 text-warn" />
          <span className="truncate">
            Ton Mac n&apos;est pas connecté{seen ? ` · vu ${seen}` : ""}
          </span>
        </span>
      )}
      <span className="ml-auto w-20 shrink-0">
        <Progress value={job.progress} />
      </span>
      {job.progress !== undefined && <span className="tabular shrink-0 font-mono text-[12px] text-ink-3">{Math.round(job.progress * 100)}%</span>}
    </div>
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

