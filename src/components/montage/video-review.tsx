"use client";

import { Popover } from "@base-ui-components/react/popover";
import { ArrowLeft, CalendarPlus, Check, Columns2, Image as ImageIcon, Loader2, MessageSquareText, Music, PenLine, Play, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { READ_PACE, REEL_VIDEO, reelSettle, VIDEO_WORKER, videoTimeline, type FreeText, type MontageJob, type MontageMark, type MontageVersion, type ReelBeat, type ReelMoment, type ReelPlan } from "@/lib/montage";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { atLeast } from "@/lib/worker-version";
import { Button } from "../ui";
import { Annotator } from "./annotator";
import { Segmented } from "./controls";
import { captureFrame, putCover } from "./cover-capture";
import { TextGhost, TextPanel } from "./free-texts";
import { Toggle } from "./look-parts";
import { MusicFields } from "./music-fields";
import { fmtSec, JobStatus, WorkerBanner } from "./parts";
import { Clamp, CompactRun, nb } from "./reel-progress";
import { ReelTimeline } from "./reel-timeline";
import { Compare, Preview, VersionChip } from "./review-page";
import { useTimelineKeys, useUndo } from "./timeline-kit";
import { montageApi, type WorkerStatus } from "./use-montage";
import { aboutText, askOf, askOfJob, forgetAsk, previewEstimate, rememberAsk, useServerClock, useServerSkew, type ReelAsk } from "./use-reel-job";
import { momentFates, shortList, VideoBeats, type MomentFate } from "./video-beats";

const [MIN_BEAT, MAX_BEAT] = REEL_VIDEO.seconds;
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const round1 = (s: number) => Math.round(s * 10) / 10;

/**
 * Whether two plans make the same video, as far as the page can change it: the beats (without the times the Mac
 * wrote), which moments stay bespoke, the rhythm, the music, the free texts and the logo.
 */
export function sameVideo(a: ReelPlan, b: ReelPlan) {
  const key = (p: ReelPlan) =>
    JSON.stringify([
      (p.video?.beats ?? []).map(({ start, end, ...rest }) => (void start, void end, rest)),
      (p.video?.moments ?? []).map((m) => [m.id, m.custom ?? !!m.code]),
      p.pace,
      p.music,
      p.volume ?? 0.7,
      p.track ?? "",
      p.cue ?? {},
      p.texts ?? [],
      !!p.logo,
    ]);
  return key(a) === key(b);
}

type Tab = "claude" | "beats" | "texts" | "sound";

/** A computer screen (Tailwind lg and up): the editing screen fits the window there instead of scrolling. */
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
/** On a computer the tools beside the video keep at least this width (their tabs on one line) and stop at 52rem. */
const TOOLS_MIN = 400;
const TOOLS_MAX = 832;
/** While drawing, the drawing tools take the place of the tools: between these widths. */
const CARD_MIN = 320;
const CARD_MAX = 544;

/** Seconds where the first kept beat is settled in a rendered version: the cover is taken there. */
function coverTime(v?: MontageVersion) {
  const first = v?.reel?.video?.beats.find((b) => !b.cut && Number.isFinite(b.start) && Number.isFinite(b.end));
  return first ? reelSettle({ start: first.start!, end: first.end! }) : 1.2;
}
/** The banner of a request that failed, by what was asked: its title, then what is left to do. */
const FAILED: Record<ReelAsk | "unknown", [string, string]> = {
  edit: ["Le nouvel aperçu a échoué.", "Tes modifications à la main n'ont pas été gardées : refais-les, puis « Voir l'aperçu ». La vidéo n'a pas changé."],
  retouch: ["La dernière retouche a échoué.", "La vidéo n'a pas changé : tu peux reformuler ta demande ou valider cette version."],
  regen: ["La nouvelle version a échoué.", "La vidéo n'a pas changé : tu peux régénérer encore ou valider cette version."],
  unknown: ["La dernière demande a échoué.", "La vidéo n'a pas changé : tu peux reformuler ta demande ou valider cette version."],
};

/** Versions of a continuous reel carry no edit list: the player is told their shape. */
const asVertical = (v: MontageVersion): MontageVersion => ({ ...v, edl: { ...v.edl, format: "9:16" } });

/**
 * The editing screen of a continuous video reel: the video, its timeline of beats, drawings, requests to Claude on a
 * passage, edits by hand (texts, choices, lengths, order, bespoke animations), versions. Same frame as ReelReview.
 */
export function VideoReview({ job, worker, refresh }: { job: MontageJob; worker: WorkerStatus; refresh: () => Promise<void> }) {
  const versions = useMemo(() => job.versions.filter((v) => v.reel?.video), [job.versions]);
  const latest = versions.at(-1);
  const [shown, setShown] = useState<number | undefined>(latest?.n);
  const version = versions.find((v) => v.n === shown) ?? latest;
  const [draft, setDraft] = useState<ReelPlan | undefined>(version?.reel);
  // Only edits made by hand count: the Mac also rewrites a version (the times of the beats) when its preview is ready.
  const [touched, setTouched] = useState(false);
  const dirty = touched && !!draft && !!version?.reel && !sameVideo(draft, version.reel);
  const history = useUndo<ReelPlan>(draft, (plan) => {
    setTouched(true);
    setDraft(plan);
  });
  /** `key` names a slider or a field: its changes in a row make one step to undo. */
  const edit = (next: ReelPlan | undefined | ((d: ReelPlan | undefined) => ReelPlan | undefined), key?: string) => {
    history.record(draft, key);
    setTouched(true);
    setDraft(next);
  };
  const follow = (plan: ReelPlan | undefined) => {
    history.reset();
    setTouched(false);
    setDraft(plan);
  };
  /** The beat chosen on the timeline or in its card (Delete takes it out). */
  const [selected, setSelectedBeat] = useState<string | null>(null);
  /** The text chosen on the timeline or in the Texts tab (one thing is chosen at a time). */
  const [textSel, setTextSelRaw] = useState<string | null>(null);
  const setSelected = (id: string | null) => (setSelectedBeat(id), id && setTextSelRaw(null));
  const setTextSel = (id: string | null) => (setTextSelRaw(id), id && (setSelectedBeat(null), setTab("texts")));
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
  // Remaining times count on the server's clock, as in the Studio.
  const skew = useServerSkew(job.id, working);
  const now = useServerClock(skew, working);
  // A Mac seen without a known version gets no video either (the server's claim needs VIDEO_WORKER or newer).
  const old = !!worker.lastSeen && !atLeast(worker.version, VIDEO_WORKER);
  // What the Mac is asked to do, kept for the Studio (which then offers the right way to try again after a failure).
  useEffect(() => {
    const a = askOfJob(job);
    if (a) rememberAsk(job.id, a);
    else if (job.action === null && !job.error) forgetAsk(job.id);
  }, [job]);

  // A new version arrived: show it, unless edits by hand are waiting (then as soon as they are applied or dropped).
  const followed = useRef(latest?.n);
  useEffect(() => {
    if (latest && !dirty && followed.current !== latest.n) {
      followed.current = latest.n;
      setShown(latest.n);
      follow(latest.reel);
      setRange(null);
      setMarks([]);
      setSelected(null);
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
  // The Mac wrote the times of the beats into the version on show: take them, unless edits are waiting.
  useEffect(() => {
    // The job is read again every few seconds: the same plan again must not empty the steps to undo.
    if (version?.reel && !dirty && JSON.stringify(version.reel) !== JSON.stringify(draft)) follow(version.reel);
  }, [version?.reel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Edits by hand wait for a new render: the video on screen no longer matches the timeline, so it stops.
  useEffect(() => {
    if (dirty) player.current?.pause();
  }, [dirty]);

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
    setSelected(null);
  };

  const call = async (body: object, ok: string, ask?: ReelAsk) => {
    setBusy(true);
    try {
      if (ask) rememberAsk(job.id, ask);
      await montageApi(`/api/montage/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify(body) }, { timeoutMs: 20_000 });
      toast.success(nb(ok));
      await refresh();
      return true;
    } catch (e) {
      toast.error("Action impossible", { description: nb((e as Error).message) });
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
    v.playbackRate = 1;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  /** Notes that say something: one left empty is not sent. */
  const filled = marks.filter((m) => m.text.trim() || m.image);
  const revise = async () => {
    if (!version) return;
    const what = range ? `Demande envoyée à Claude pour le passage ${fmtT(range[0])} – ${fmtT(range[1])}` : filled.length ? `Demande et ${filled.length} note${filled.length > 1 ? "s" : ""} envoyées à Claude` : "Demande envoyée à Claude";
    if (await call({ revise: feedback, marks: filled.filter((m) => m.version === version.n), range: range ?? undefined, from: version.n }, what, "retouch")) {
      setFeedback("");
      setMarks([]);
      setRange(null);
    }
  };
  const apply = async () => {
    if (!draft || !version) return;
    if (await call({ reel: draft, from: version.n }, "Modifications envoyées au Mac pour un nouvel aperçu", "edit")) {
      // The new version is the latest one: follow it as soon as the job brings it.
      follow(undefined);
      setShown(undefined);
      setMarks([]);
    }
  };
  const regenerate = () => call({ regenerate: true }, "Nouvelle version demandée : Claude repart de ta demande", "regen");
  const stop = () => {
    if (!confirm("Arrêter cette génération ? La version d'avant reste.")) return;
    call({ stop: true }, "Génération arrêtée");
  };

  /** The image of the video chosen as cover; left out, the cover is taken where the first beat is settled. */
  const [cover, setCover] = useState<{ url: string; blob: Blob; t: number; version: number } | null>(null);
  const takeCover = () => {
    const v = player.current;
    if (!v || !version || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return void toast.error("Image impossible à prendre");
        setCover((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url: URL.createObjectURL(blob), blob, t: v.currentTime, version: version.n };
        });
        toast.success("Image de couverture choisie", { description: "Elle partira avec la vidéo quand tu la valideras." });
      },
      "image/jpeg",
      0.9,
    );
  };
  const approve = async () => {
    if (!version) return;
    setBusy(true);
    try {
      // Taken before validating: the previews are gone after.
      const blob = cover && cover.version === version.n ? cover.blob : await captureFrame(`/api/montage/jobs/${job.id}/versions/${version.n}/preview`, coverTime(version)).catch(() => null);
      // Copying the video into the library takes a while: a longer wait than the other calls.
      const r = await montageApi<{ job: MontageJob }>(`/api/montage/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ approve: version.n }) }, { timeoutMs: 60_000 });
      const saved = !!blob && !!r.job.mediaId && (await putCover(r.job.mediaId, blob));
      toast.success(nb(`Vidéo validée${saved ? " avec sa couverture" : ""} : elle est dans ta bibliothèque`), saved ? undefined : { description: nb("Sans couverture : choisis-la dans la bibliothèque.") });
      await refresh();
      useStore.getState().load().catch(() => {});
    } catch (e) {
      toast.error("Action impossible", { description: nb((e as Error).message) });
      // A validation that timed out may have gone through: the screen shows what is true.
      refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const video = draft?.video;
  // An edit by hand (order, cuts) that the Mac will not play as written warns at once, wherever it was made (the
  // timeline too): the « Temps forts » tab then says it on the animation.
  const fatesBefore = useRef<Map<string, MomentFate>>(new Map());
  useEffect(() => {
    const fates = video ? momentFates(video) : new Map<string, MomentFate>();
    if (touched && video)
      for (const [id, f] of fates) {
        if (fatesBefore.current.get(id)?.kind === f.kind) continue;
        const brief = video.moments.find((m) => m.id === id)?.brief || "sans description";
        toast.message(nb(`Animation sur mesure « ${brief.length > 60 ? `${brief.slice(0, 60).trimEnd()}…` : brief} »`), { description: nb(f.text) });
      }
    fatesBefore.current = fates;
  }, [video]); // eslint-disable-line react-hooks/exhaustive-deps
  const texts = draft?.texts ?? [];
  const setTexts = (next: FreeText[], key?: string) => edit((d) => (d ? { ...d, texts: next } : d), key);
  const curText = texts.find((t) => t.id === textSel);
  const editVideo = (f: (beats: ReelBeat[], moments: ReelMoment[]) => { beats?: ReelBeat[]; moments?: ReelMoment[] }, key?: string) =>
    edit((d) => {
      if (!d?.video) return d;
      const next = f(d.video.beats, d.video.moments);
      return { ...d, video: { ...d.video, ...next } };
    }, key);
  const editBeat = (id: string, patch: Partial<ReelBeat>, key?: string) => editVideo((beats) => ({ beats: beats.map((b) => (b.id === id ? { ...b, ...patch } : b)) }), key);
  const editMoment = (id: string, patch: Partial<ReelMoment>) => editVideo((_, moments) => ({ moments: moments.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const moveBeat = (id: string, by: number) =>
    editVideo((beats) => {
      const i = beats.findIndex((b) => b.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= beats.length) return {};
      const next = [...beats];
      [next[i], next[j]] = [next[j], next[i]];
      return { beats: next };
    });
  /** Moves a beat to place `index` among the beats that play; the beats taken out keep their slot. */
  const reorder = (id: string, index: number) =>
    editVideo((beats) => {
      const kept = beats.filter((b) => !b.cut);
      const me = kept.find((b) => b.id === id);
      if (!me) return {};
      const order = kept.filter((b) => b.id !== id);
      order.splice(Math.min(Math.max(0, index), order.length), 0, me);
      let k = 0;
      return { beats: beats.map((b) => (b.cut ? b : order[k++])) };
    });
  /** A new rhythm: the beats whose length is not set by hand follow it (their wanted length scales with the reading pace). */
  const setPace = (pace: ReelPlan["pace"]) =>
    edit((d) => {
      if (!d?.video || d.pace === pace) return d;
      const k = READ_PACE[pace] / READ_PACE[d.pace];
      return { ...d, pace, video: { ...d.video, beats: d.video.beats.map((b) => (b.fixed ? b : { ...b, seconds: Math.min(MAX_BEAT, Math.max(MIN_BEAT, round1(b.seconds * k))) })) } };
    });

  // The video on screen is the version as the Mac rendered it; with edits waiting, the timeline shows what they will give.
  const placed = useMemo(() => (draft ? videoTimeline(draft, !dirty) : []), [draft, dirty]);
  const total = !dirty && draft?.duration ? Math.max(draft.duration, placed.at(-1)?.end ?? 0) : (placed.at(-1)?.end ?? 0);
  const current = placed.find((p) => time >= p.start && time < p.end) ?? placed.at(-1);
  const canAsk = job.status === "review" && !!version?.preview && !dirty && !working;
  const canDraw = canAsk && compareWith === null;
  const keptCount = video ? video.beats.filter((b) => !b.cut).length : 0;
  /** A list beat edited down to fewer than 2 points: the Mac would lay it out as a « Pile », so no preview until fixed. */
  const listShort = dirty && !!video?.beats.some(shortList);
  const editing = job.status !== "done" && !!version && !!draft;
  const comparing = compareWith !== null;
  const sketching = drawing && canDraw && !comparing;
  const wide = useWide();

  // On a computer the screen fits the window: the video takes the height left between the header and the timeline.
  const stage = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ room: 0, width: 0, extra: -1 });
  useLayoutEffect(() => {
    const el = stage.current;
    const col = column.current;
    if (!el || !col) return;
    const measure = () => {
      const content = col.firstElementChild as HTMLElement | null;
      const media = col.querySelector<HTMLElement>('[style*="aspect-ratio"]');
      const extra = content && media ? Math.max(0, content.offsetHeight - media.offsetHeight) : -1;
      setFit((f) => (f.room === el.clientHeight && f.width === el.clientWidth && f.extra === extra ? f : { room: el.clientHeight, width: el.clientWidth, extra }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (col.firstElementChild) ro.observe(col.firstElementChild);
    return () => ro.disconnect();
  }, [editing, comparing, sketching]);
  /** The width the video's column and the tools share: the stage less its side padding and the gap between them. */
  const inner = fit.width - 48 - 16;
  const videoHeight = fit.room - 24 - (sketching && wide ? 0 : fit.extra >= 0 ? fit.extra : comparing ? 72 : sketching ? 194 : 0);
  const widest = Math.max(120, inner - (sketching ? CARD_MIN : TOOLS_MIN));
  const videoWidth = Math.round(Math.min(widest, comparing ? Math.max(300, (videoHeight * 9) / 8 + 8) : Math.max(120, (videoHeight * 9) / 16)));
  const cardWidth = Math.max(CARD_MIN, Math.min(CARD_MAX, inner - videoWidth));
  /** The tab bar of the tools gets a surface once the panel scrolls under it. */
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const scrolled = (e: React.UIEvent<HTMLElement>) => {
    const box = e.target;
    const b = bar.current;
    if (!b || !(box instanceof HTMLElement) || !box.contains(b)) return;
    const on = box.scrollTop > 0 && b.getBoundingClientRect().top <= box.getBoundingClientRect().top + 1;
    setStuck((s) => (s === on ? s : on));
  };
  /** Ends the beat under the playhead at the playhead (S): its length is then kept exactly. */
  const trimHere = () => {
    if (dirty || !current) return;
    const seconds = round1(time - current.start);
    if (seconds < MIN_BEAT || current.end - time < 0.2) return void toast.message("Place la tête de lecture dans un temps fort, au moins 1,5 s après son début");
    editBeat(current.scene.id, { seconds: Math.min(MAX_BEAT, seconds), fixed: true });
    setSelected(current.scene.id);
    setTab("beats");
  };
  /** Takes the chosen beat out of the video (Delete), keeping at least two. */
  const cutSelected = () => {
    const beat = video?.beats.find((b) => b.id === selected);
    if (!beat || beat.cut) return;
    if (keptCount <= REEL_VIDEO.keep) return void toast.message("Une vidéo garde au moins deux temps forts");
    editBeat(beat.id, { cut: true });
    setSelected(null);
  };
  /** A click on a beat of the timeline: the playhead goes there and the passage for Claude is that beat. */
  const selectBeat = (id: string | null) => {
    setSelected(id);
    const p = id ? placed.find((x) => x.scene.id === id) : undefined;
    if (p && canAsk) setRange([p.start, p.end]);
  };
  /** Puts a note at the playhead (M): a place in the video and a few words for Claude, without drawing. */
  const addNote = () => {
    if (!version || !canDraw) return;
    if (marks.length >= 8) return void toast.message("8 notes au plus par demande");
    player.current?.pause();
    setMarks((x) => [...x, { id: crypto.randomUUID(), version: version.n, t: Math.round((player.current?.currentTime ?? time) * 100) / 100, text: "" }]);
    setTab("claude");
  };
  useTimelineKeys({
    enabled: job.status !== "done" && compareWith === null && !(drawing && canDraw) && !composerOpen && !!draft,
    canPlay: !dirty && !!version?.preview,
    video: () => player.current,
    total,
    onSeek: seek,
    onSplit: trimHere,
    onMark: addNote,
    onDelete: curText ? () => (setTexts(texts.filter((t) => t.id !== curText.id)), setTextSelRaw(null)) : placed.some((p) => p.scene.id === selected) ? cutSelected : undefined,
    onUndo: history.undo,
    onRedo: history.redo,
    onZoom: (dir) => zoomRef.current?.(dir),
  });
  const sentMarks = (job.marks ?? []).filter((m) => m.version === version?.n);
  const allMarks = [...sentMarks, ...marks.filter((m) => m.version === version?.n)];
  const hasPreview = versions.some((v) => v.preview);
  // What the request that failed was: a retouch keeps its words on the job; otherwise what this browser saw asked.
  const failedAsk: ReelAsk | undefined = job.error ? (job.feedback ? "retouch" : askOf(job.id)) : undefined;
  const caption = (versions.find((v) => v.n === job.approved) ?? latest)?.reel?.video?.caption;

  /** Status, warnings and errors of the video. */
  const banners = (
    <>
      {job.status === "queued" && !worker.online && <WorkerBanner worker={worker} />}
      {old && job.status !== "done" && (
        <p className="rounded-xl border border-line bg-surface p-3 text-[12.5px] text-warn">{nb(`Le programme de ton Mac est trop ancien pour les vidéos (${worker.version ?? "version inconnue"}, il faut ${VIDEO_WORKER}) : mets-le à jour avant de demander une retouche.`)}</p>
      )}
      {job.status === "failed" && (
        <div className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/8 px-4 py-2.5 text-[13px]">
          <span className="flex-1">
            <span className="font-medium text-danger">{version ? "La retouche a échoué." : "La vidéo n'a pas pu être générée."}</span> {nb(job.error ?? "")}
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
          <span className="font-medium text-danger">{FAILED[failedAsk ?? "unknown"][0]}</span> {nb(job.error)} {nb(FAILED[failedAsk ?? "unknown"][1])}
        </p>
      )}
      {job.status === "done" && (
        <div className="flex items-center gap-3 rounded-xl border border-ok/40 bg-ok/8 px-4 py-2.5 text-[13px]">
          <Check className="size-4 text-ok" />
          <span className="flex-1">La vidéo est dans ta bibliothèque. Programme-la sur tes comptes quand tu veux.</span>
          <Link href="/videos" className="font-medium text-accent">
            Voir la bibliothèque
          </Link>
        </div>
      )}
    </>
  );

  /** The versions, the comparison and the cover: above the video on a phone, at the top of the tools on a computer. */
  const versionRow = version ? (
    <div className="flex flex-wrap items-center gap-1.5">
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
      {canDraw && (
        <button onClick={takeCover} title="Prend l'image affichée comme couverture de la vidéo (sinon, l'image où le premier temps fort est en place)" className="press ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] font-medium">
          <ImageIcon className="size-3.5" /> {nb("Couverture : cette image")}
        </button>
      )}
      {cover && cover.version === version.n && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-accent bg-accent-soft pr-1 pl-0.5 text-[12px] font-medium">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover.url} alt="" className="h-6 w-auto rounded-md" />
          <button onClick={() => seek(cover.t)} className="tabular font-mono hover:text-accent" title="Aller à cette image">
            {fmtSec(cover.t)}
          </button>
          <button onClick={() => (URL.revokeObjectURL(cover.url), setCover(null))} aria-label="Retirer la couverture" className="press grid size-5 place-items-center rounded-md text-ink-3 hover:text-ink">
            <X className="size-3" />
          </button>
        </span>
      )}
    </div>
  ) : null;

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 pt-4 pb-3 max-md:px-4">
        <Link href={`/videos/studio/anime?reel=${encodeURIComponent(job.id)}`} aria-label="Retour au Studio" title="Retour au Studio" className="press grid size-8 place-items-center rounded-lg border border-line-strong bg-surface text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-ink-3">Reel animé · vidéo</p>
          <h1 className="truncate font-display text-[24px] leading-[1.1]">{nb(job.title.replace(/^Reel animé : /, ""))}</h1>
        </div>
        {!working && <JobStatus job={job} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {working && <CompactRun job={job} now={now} onStop={hasPreview ? stop : undefined} busy={busy} />}
          {job.status === "done" && job.mediaId && (
            <Button variant="primary" onClick={() => openComposer({ mediaId: job.mediaId, caption })}>
              <CalendarPlus className="size-4" />
              Programmer
            </Button>
          )}
          {job.status === "review" && version && !working && <Regenerate onConfirm={regenerate} disabled={busy || dirty || old} />}
          {job.status === "review" && version && (
            <Button variant="primary" onClick={approve} disabled={busy || dirty || working || !version.preview} title={dirty ? "Applique ou annule d'abord tes modifications" : "Envoie cette version dans ta bibliothèque, avec sa couverture"}>
              {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
              Valider la version {version.n}
            </Button>
          )}
        </div>
      </header>

      <div onScrollCapture={scrolled} className="flex min-h-0 flex-1 flex-col max-lg:overflow-y-auto">
        {/* On a computer the banners go above the tools, beside the video: they never push the video or the timeline out of the window. */}
        {!(wide && editing) && <div className="flex flex-col gap-2 px-6 pt-3 empty:hidden max-md:px-4">{banners}</div>}

        {job.status === "done" ? (
          <div className="flex min-h-0 flex-1 items-start justify-center px-6 py-4 max-md:px-4">
            {final?.url ? (
              <video src={final.url} controls playsInline preload="metadata" className="max-h-full rounded-2xl border border-line bg-black shadow-card" style={{ aspectRatio: "9 / 16" }} />
            ) : (
              <p className="text-[13px] text-ink-3">La vidéo validée est dans ta bibliothèque.</p>
            )}
          </div>
        ) : !version || !draft || !video ? (
          <div className="m-6 rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[13px] text-ink-3">
            <Sparkles className="mx-auto mb-2 size-5 text-accent" />
            {job.status === "failed" ? "Aucune version à montrer." : "Ton Mac fabrique la vidéo. Elle arrive ici dès qu'elle est prête : tu pourras la retoucher avant de la valider."}
            <Link href={`/videos/studio/anime?reel=${encodeURIComponent(job.id)}`} className="mt-3 block font-medium text-accent">
              Suivre la génération dans le Studio
            </Link>
          </div>
        ) : (
          <>
            {!wide && <div className="px-6 pt-3 max-md:px-4">{versionRow}</div>}
            <div
              ref={stage}
              className="grid min-h-0 flex-1 gap-4 px-6 py-3 max-lg:flex-none max-md:px-4 lg:grid-cols-[var(--w)_minmax(0,var(--tools))] lg:justify-center"
              style={{ "--w": `${videoWidth}px`, "--tools": `${TOOLS_MAX}px`, "--card": `${cardWidth}px` } as React.CSSProperties}
            >
              {/* ---------- Video: as tall as the window allows, never under the timeline ---------- */}
              <div
                ref={column}
                className={cn(
                  "flex min-h-0 flex-col gap-2 max-lg:mx-auto max-lg:w-full lg:relative lg:w-[var(--w)]",
                  !comparing && "max-lg:max-w-[max(240px,calc((100dvh-250px)*9/16))]",
                  sketching && "lg:[&>div>div:nth-child(2)]:absolute lg:[&>div>div:nth-child(2)]:top-0 lg:[&>div>div:nth-child(2)]:left-[calc(100%+1rem)] lg:[&>div>div:nth-child(2)]:z-30 lg:[&>div>div:nth-child(2)]:w-[var(--card)]",
                )}
              >
                {comparing ? (
                  <Compare job={{ ...job, versions: job.versions.map(asVertical) }} before={compareWith} after={version.n} onBefore={setCompareWith} />
                ) : (
                  <Annotator video={player} active={sketching} version={version.n} onAdd={(m) => (setMarks((x) => (x.length >= 8 ? (toast.message("8 notes au plus par demande"), x) : [...x, m])), setTab("claude"))} onClose={() => setDrawing(false)}>
                    <div className="relative" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}>
                      <Preview job={job} v={asVertical(version)} ref={player} onTime={setTime} />
                      {curText && tab === "texts" && !drawing && <TextGhost text={curText} accent={draft.look.accent} onMove={(x, y, key) => setTexts(texts.map((t) => (t.id === curText.id ? { ...t, x, y } : t)), key)} />}
                    </div>
                  </Annotator>
                )}
              </div>

              {/* ---------- Tools: only they scroll on a computer ---------- */}
              <div className={cn("scroll-thin flex min-h-0 min-w-0 flex-col gap-3 [container-type:inline-size] lg:overflow-y-auto lg:pr-1", sketching && "lg:invisible")}>
                {wide && <div className="flex flex-col gap-2 empty:hidden">{banners}</div>}
                {wide && versionRow}
                <div ref={bar} className={cn("sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl px-1 py-1 transition-[background-color,box-shadow] duration-150", stuck && "rounded-none bg-surface/95 shadow-[0_1px_0_var(--line)] backdrop-blur-md")}>
                  <div className="scroll-thin max-w-full overflow-x-auto whitespace-nowrap max-sm:[&_[role=radio]]:px-1.5">
                    <Segmented
                      label="Outil"
                      value={tab}
                      onChange={setTab}
                      options={[
                        { value: "claude", label: "Demander à Claude" },
                        { value: "beats", label: "Temps forts" },
                        { value: "texts", label: "Textes" },
                        { value: "sound", label: "Musique et rythme" },
                      ]}
                    />
                  </div>
                  {dirty && (
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => follow(version.reel)}>
                        Annuler
                      </Button>
                      <Button size="sm" variant="primary" onClick={apply} disabled={busy || working || old || listShort} title={listShort ? "Une liste a besoin de 2 points au moins" : undefined}>
                        <Play className="size-3.5" /> Voir l&apos;aperçu
                      </Button>
                    </div>
                  )}
                </div>
                {dirty && (
                  <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] text-ink-2">
                    {listShort
                      ? nb("Une liste a besoin de 2 points au moins : écris-les dans « Temps forts », ou choisis une autre mise en page, avant de voir l'aperçu.")
                      : nb(`Modifications pas encore rendues : la vidéo montre encore la version ${version.n}. Clique sur « Voir l'aperçu » pour que le Mac la refasse (${aboutText(previewEstimate(worker, total))}, sans Claude).`)}
                  </p>
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
                        <span className="text-ink-3">{nb("Clique un temps fort ou fais glisser sur la timeline : Claude ne touchera que ce passage.")}</span>
                      )}
                      {current && !range && canAsk && (
                        <button onClick={() => setRange([current.start, current.end])} className="press rounded-full border border-line-strong bg-surface px-2.5 py-0.5 font-medium text-ink-2 hover:text-ink">
                          Prendre ce temps fort
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
                      aria-label="Demande à Claude"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      rows={3}
                      maxLength={2000}
                      disabled={!canAsk}
                      placeholder={nb(range ? "Que faut-il changer dans ce passage ? Par ex. « plus lent », « une autre image pour ce chiffre », « enlève ce mot »" : "Par ex. « le chiffre passe trop vite », ou choisis un passage sur la timeline")}
                      className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent/60 disabled:opacity-60"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[11.5px] text-ink-3">
                        {dirty ? "Applique ou annule d'abord tes modifications à la main." : range || marks.length ? "Le reste de la vidéo ne bouge pas, sauf les enchaînements autour du passage." : "Sans passage choisi, Claude modifie les temps forts dont tu parles."}
                      </span>
                      <Button size="sm" variant="primary" onClick={revise} disabled={busy || !canAsk || old || (!feedback.trim() && !filled.length)}>
                        <Wand2 className="size-3.5" /> Nouvelle version
                      </Button>
                    </div>
                  </div>
                )}
                {version.notes && tab === "claude" && (
                  <div className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                    <p className="mb-0.5 flex items-center gap-1.5 font-medium text-ink">
                      <Sparkles className="size-3.5 text-accent" /> {version.by === "claude" ? (version.n === versions[0]?.n ? "À savoir sur cette version" : "Ce que Claude a changé") : "Modifié à la main"}
                    </p>
                    {/* Under the request to Claude (the main tool, in view at 1280×720 even after long notes): three lines, the rest on « Plus ». */}
                    <Clamp key={version.n} text={version.notes} />
                  </div>
                )}

                {tab === "beats" && (
                  <VideoBeats
                    video={video}
                    base={version.reel?.video}
                    placed={placed}
                    current={dirty ? undefined : current?.scene.id}
                    selected={selected}
                    disabled={job.status !== "review" || working}
                    onSeek={dirty ? undefined : seek}
                    onSelect={setSelected}
                    onBeat={editBeat}
                    onMove={moveBeat}
                    onMoment={editMoment}
                  />
                )}

                {tab === "texts" && <TextPanel texts={texts} selected={textSel} onSelect={setTextSel} onChange={setTexts} time={dirty ? 0 : time} total={total} onSeek={dirty ? undefined : seek} disabled={job.status !== "review" || working} workerVersion={worker.version} />}

                {tab === "sound" && (
                  <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 text-[13px]">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      <Music className="size-3.5 text-accent" /> Musique
                    </p>
                    <Toggle label="Mettre une musique de ton dossier sous la vidéo" checked={draft.music} onChange={(music) => edit({ ...draft, music })} />
                    <label className="flex items-center gap-2 text-[12px] text-ink-2">
                      <span className="w-14 shrink-0">Volume</span>
                      <input type="range" min={0} max={1} step={0.05} value={draft.volume ?? 0.7} disabled={!draft.music} onChange={(e) => edit({ ...draft, volume: Number(e.target.value) }, "vol")} aria-label="Volume de la musique" className="min-w-0 flex-1 accent-[var(--accent)]" />
                      <span className="tabular w-10 text-right font-mono text-[11.5px]">{nb(`${Math.round((draft.volume ?? 0.7) * 100)} %`)}</span>
                    </label>
                    <MusicFields
                      value={{ track: draft.track, ...draft.cue }}
                      onChange={(patch) => {
                        const { track, ...cue } = patch;
                        edit({ ...draft, ...("track" in patch ? { track } : {}), cue: { ...draft.cue, ...cue } }, "track" in patch ? undefined : `cue:${Object.keys(cue).join()}`);
                      }}
                      tracks={worker.tracks}
                      disabled={!draft.music}
                      auto="Le premier du dossier"
                    />
                    <p className="text-[12px] text-ink-3">{"Les morceaux sont ceux du dossier Musique de ton Mac. S'il est vide, la vidéo sort sans son."}</p>
                    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                      <span className="text-[12px] text-ink-2">Rythme</span>
                      <Segmented
                        label="Rythme"
                        value={draft.pace}
                        onChange={setPace}
                        options={[
                          { value: "calm", label: "Calme" },
                          { value: "normal", label: "Normal" },
                          { value: "fast", label: "Vif" },
                        ]}
                      />
                      <p className="text-[12px] text-ink-3">Le rythme change la durée de tous les temps forts, sauf ceux dont tu as réglé la durée toi-même.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ---------- Timeline ---------- */}
            <ReelTimeline
              rowLabel="Temps forts"
              hidden={sketching}
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
              onSelect={selectBeat}
              texts={texts}
              textSel={textSel}
              onTextSel={setTextSel}
              onTexts={job.status === "review" && !working ? setTexts : undefined}
              onResize={(id, seconds) => (editBeat(id, { seconds: Math.min(MAX_BEAT, Math.max(MIN_BEAT, round1(seconds))), fixed: true }), setSelected(id), setTab("beats"))}
              onReorder={reorder}
              onTrimHere={trimHere}
              onCut={cutSelected}
              onMark={canDraw ? addNote : undefined}
              undo={history}
              zoomRef={zoomRef}
              stale={dirty}
            />
          </>
        )}
      </div>
    </>
  );
}

/** « Régénérer » with its confirmation: a new video from the request, the one on show stays in the versions. */
function Regenerate({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger disabled={disabled} className="press inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink disabled:opacity-50 data-[popup-open]:bg-ink/5">
        <RotateCcw className="size-4" /> Régénérer
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-[60]">
          <Popover.Popup className="popover-popup w-[min(300px,calc(100vw-32px))] rounded-xl border border-line-strong bg-surface p-3 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] outline-none">
            <p className="text-[12.5px] leading-relaxed text-ink-2">{nb("Une nouvelle version sera faite à partir de la demande ; celle-ci reste dans l'historique.")}</p>
            <div className="mt-2.5 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button size="sm" variant="primary" onClick={() => (setOpen(false), onConfirm())}>
                <RotateCcw className="size-3.5" /> Régénérer
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
