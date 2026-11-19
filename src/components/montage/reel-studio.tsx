"use client";

import { Popover } from "@base-ui-components/react/popover";
import { AlertTriangle, ChevronDown, Clapperboard, Lightbulb, Loader2, Newspaper, RotateCcw, Save, SlidersHorizontal, Volume2, VolumeX, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { isVideoJob, MAX_DIRECTION, REEL_VIDEO, reelSettle, type MontageJob, type MontageVersion, type ReelSource } from "@/lib/montage";
import { lookOf, PRESETS, sameLook, type Look } from "@/lib/profiles";
import { useStore } from "@/lib/store";
import { useProfiles } from "@/lib/use-profiles";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { Switch } from "./controls";
import { captureFrame, putCover } from "./cover-capture";
import { inputClass, LookControls } from "./look-parts";
import { JobStatus, MediaHeader, StudioTabs } from "./parts";
import { DISPLAY_FONT, ENTER, ErrorCard, FailedBanner, IdleCard, LibraryCard, lookColors, MacPill, MacStatus, nb, Poster, ResultCard, RunningCard, StaleNote, Storyboard, useBoardTiles, WaitingCard } from "./reel-progress";
import { montageApi, useMontage, type WorkerStatus } from "./use-montage";
import { aboutText, askOf, askOfJob, forgetAsk, isLive, macState, reelView, rememberAsk, renderHead, runBeats, useReelJob, useServerClock, videoEstimate, videoVersions, type ReelView } from "./use-reel-job";

/* ---------- The draft (kept in this browser) ---------- */

type Pace = "calm" | "normal" | "fast";
type Draft = {
  request: string;
  source: ReelSource;
  /** 15 | 30 | 45 | 60, or null for Auto. */
  seconds: number | null;
  /** null: Claude chooses. */
  pace: Pace | null;
  music: boolean;
  /** A file of the Mac's music folder, "" = the Mac picks. */
  track: string;
  direction: string;
};
/** What the Studio keeps between visits: the draft (and the look adjusted for it), and the video it follows. */
type Stored = { draft: Draft & { look?: Look; logo?: boolean; profileId?: string; autoProject?: string }; jobId?: string | null };

const KEY = "metricove-reel-video-v1";
const DAY = 24 * 3600_000;
const EMPTY: Draft = { request: "", source: "idea", seconds: null, pace: null, music: true, track: "", direction: "" };
const STARTER_LOOK: Look = PRESETS[0].look;
/** The old editor of reels made of scenes, kept for a Mac that cannot make videos yet. */
const LEGACY = "/videos/studio/anime?editeur=scenes";

const SOURCES: { value: ReelSource; label: string; hint: string }[] = [
  { value: "idea", label: "Une idée", hint: nb("Ex. : 3 erreurs qui font décrocher sur un reel, avec un chiffre choc au début. Finir par « Abonne-toi ».") },
  { value: "script", label: "Un script", hint: nb("Colle ton texte : Claude le découpe en temps forts sans le réécrire.") },
  { value: "post", label: "Un post", hint: nb("Colle un post publié : Claude en fait une vidéo à regarder.") },
];
const LENGTHS = [
  { value: "auto", label: "Auto" },
  { value: "15", label: "15\u00a0s" },
  { value: "30", label: "30\u00a0s" },
  { value: "45", label: "45\u00a0s" },
  { value: "60", label: "60\u00a0s" },
];
const PACES = [
  { value: "auto", label: "Auto" },
  { value: "calm", label: "Calme" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Vif" },
];
const FONT_NAME: Record<Look["font"], string> = { serif: "Élégant", sans: "Net", grotesque: "Grotesque" };

function readStored(): Stored | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
    return raw && typeof raw === "object" && raw.draft && typeof raw.draft === "object" ? raw : null;
  } catch {
    return null;
  }
}
function writeStored(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}
/** A draft read back from this browser: only values that make sense. */
function cleanDraft(d: Partial<Draft> | undefined): Draft {
  const pick = <T,>(v: unknown, among: readonly T[], or: T) => (among.includes(v as T) ? (v as T) : or);
  return {
    request: typeof d?.request === "string" ? d.request.slice(0, REEL_VIDEO.request) : "",
    source: pick(d?.source, ["idea", "script", "post"] as const, "idea"),
    seconds: pick(d?.seconds, [15, 30, 45, 60, null] as const, null),
    pace: pick(d?.pace, ["calm", "normal", "fast", null] as const, null),
    music: d?.music !== false,
    track: typeof d?.track === "string" ? d.track.slice(0, 200) : "",
    direction: typeof d?.direction === "string" ? d.direction.slice(0, MAX_DIRECTION) : "",
  };
}

const isMacKeyboard = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Seconds where a beat is settled in a rendered version: its tile and the cover are taken there. */
function coverTime(v?: MontageVersion) {
  const first = v?.reel?.video?.beats.find((b) => !b.cut && Number.isFinite(b.start) && Number.isFinite(b.end));
  return first ? reelSettle({ start: first.start!, end: first.end! }) : 1.2;
}
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---------- The screen ---------- */

/**
 * The Studio's animated reel: Antoine writes a request (an idea, a script or a post), keeps the project's style, picks
 * a length, and the Mac makes ONE continuous video. The screen then follows the real progress (phase, percent,
 * remaining time, storyboard) and plays the video in place, with its four actions. It never deletes nor leaves on its
 * own: a video with versions stays in « Mes vidéos » and in Montage IA.
 */
export function ReelStudio() {
  const router = useRouter();
  // The address as the router knows it now (after Back too), never the value the server rendered the page with.
  const reel = useSearchParams().get("reel") || undefined;
  const { data, error: listError, at: listAt, refresh: refreshList } = useMontage();
  const openComposer = useStore((s) => s.openComposer);
  const activeProject = useStore((s) => s.activeProject);
  const projects = useStore((s) => s.projects);
  const accounts = useStore((s) => s.accounts);
  const posts = useStore((s) => s.posts);

  // ---- Draft and look, kept in this browser ----
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [look, setLook] = useState<Look>(STARTER_LOOK);
  const [profileId, setProfileId] = useState<string | undefined>();
  const [autoProject, setAutoProject] = useState<string | undefined>();
  const [restored, setRestored] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  /** The video to follow is decided (from the address, this browser or the list): until then the one kept here stays kept. */
  const [settled, setSettled] = useState(false);
  const storedJob = useRef<string | null>(null);
  const logoOn = useRef(true);
  useEffect(() => {
    const s = readStored();
    if (s) {
      setDraft(cleanDraft(s.draft));
      if (s.draft.look && typeof s.draft.look === "object") setLook({ ...STARTER_LOOK, ...lookOf({ ...STARTER_LOOK, ...s.draft.look }), logo: undefined });
      setProfileId(typeof s.draft.profileId === "string" ? s.draft.profileId : undefined);
      setAutoProject(typeof s.draft.autoProject === "string" ? s.draft.autoProject : undefined);
      logoOn.current = s.draft.logo !== false;
      storedJob.current = typeof s.jobId === "string" ? s.jobId : null;
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    const { logo, ...plain } = look;
    writeStored({ draft: { ...draft, look: plain, logo: !!logo, profileId, autoProject }, jobId: settled ? jobId : storedJob.current });
  }, [restored, draft, look, profileId, autoProject, jobId, settled]);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  /** The draft as it is now, for actions that finish after a wait (the field may change meanwhile). */
  const draftNow = useRef(draft);
  draftNow.current = draft;

  // ---- Style profile of the project (same rules as the other Studio pages) ----
  const { profiles, save: saveProfile } = useProfiles();
  const styled = profileId && profiles?.[profileId] ? profileId : undefined;
  const profile = styled ? profiles![styled] : undefined;
  const styledProject = projects.find((p) => p.id === styled);
  const ideas = profile?.refs.ideas ?? [];
  const lookChanged = !!profile && !sameLook(look, profile.look);
  const applyProfile = (id: string) => {
    const p = profiles?.[id];
    if (p) {
      setLook({ ...lookOf(p.look), logo: p.look.logo || undefined });
      setProfileId(id);
    } else setProfileId(undefined);
  };
  // The logo is never kept in this browser: it comes back from the profile (the Mac gets that one anyway).
  const logoBack = useRef(false);
  useEffect(() => {
    if (!restored || !profiles || logoBack.current) return;
    logoBack.current = true;
    const p = styled ? profiles[styled] : undefined;
    if (p?.look.logo && logoOn.current) setLook((l) => ({ ...l, logo: p.look.logo }));
  }, [restored, profiles, styled]);
  // The active project gives its style once, when it becomes the active one; a profile picked by hand stays.
  useEffect(() => {
    if (!restored || !profiles || activeProject === "all" || !profiles[activeProject] || autoProject === activeProject) return;
    const p = profiles[activeProject];
    setLook({ ...lookOf(p.look), logo: p.look.logo || undefined });
    setProfileId(activeProject);
    setAutoProject(activeProject);
  }, [restored, profiles, activeProject, autoProject]);
  const [savingLook, setSavingLook] = useState(false);
  const keepLook = async () => {
    if (!styled || savingLook) return;
    setSavingLook(true);
    try {
      await saveProfile(styled, { look: { ...lookOf(look), logo: look.logo ?? "" } });
      toast.success(`Style de ${styledProject?.name ?? "ce projet"} enregistré`, { description: "Les prochaines vidéos du projet partiront de ce style." });
    } catch (e) {
      toast.error("Style non enregistré", { description: nb((e as Error).message) });
    } finally {
      setSavingLook(false);
    }
  };
  const project = styledProject ?? projects.find((p) => p.id === activeProject);
  const suggestedHandle = useMemo(() => {
    const pool = project ? accounts.filter((a) => project.accountIds.includes(a.id)) : accounts;
    const a = pool.find((x) => x.network === "instagram") ?? pool[0];
    return a ? `@${a.handle}` : "";
  }, [project, accounts]);

  // ---- The video followed here: in the address (?reel=) and in this browser ----
  const [seed, setSeed] = useState<MontageJob | undefined>();
  const arrived = useRef(false);
  /**
   * Follows a video (or none). The address is changed through the router, so that its history entry holds this video:
   * Back from another screen comes back to it, not to the one the page was opened with.
   */
  const follow = useCallback(
    (id: string | null, first?: MontageJob) => {
      arrived.current = true;
      setSettled(true);
      setJobId(id);
      setSeed(first);
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("reel", id);
      else url.searchParams.delete("reel");
      if (url.search !== window.location.search) router.replace(url.pathname + url.search, { scroll: false });
    },
    [router],
  );
  // On arrival: the address first (right away, the job is read on its own), then the video kept here (unless done for
  // more than a day), then the latest video still running or waiting to be looked at; those two need the list. Otherwise,
  // nothing: the screen is at rest.
  useEffect(() => {
    if (arrived.current || !restored) return;
    if (reel) return follow(reel);
    if (!data) return;
    const now = data.now ?? Date.now();
    const recent = (j: MontageJob) => isLive(j) || now - Date.parse(j.updatedAt) < DAY;
    const kept = storedJob.current ? data.jobs.find((j) => j.id === storedJob.current) : undefined;
    if (kept && isVideoJob(kept) && kept.status !== "cancelled" && recent(kept)) return follow(kept.id);
    const latest = data.jobs
      .filter((j) => isVideoJob(j) && (isLive(j) || (j.status === "review" && !j.approved && now - Date.parse(j.updatedAt) < DAY)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    follow(latest?.id ?? null);
  }, [restored, data, reel, follow]);

  const live = useReelJob(jobId);
  const listed = jobId ? data?.jobs.find((j) => j.id === jobId) : undefined;
  const job = live.job ?? listed ?? (seed?.id === jobId ? seed : undefined);
  const worker: WorkerStatus | undefined = (jobId && live.worker) || data?.worker;
  // The site stopped answering: what shows is the last good read. Its clock stands still there, so the bar and the
  // remaining time do not move on without news.
  const readError = jobId ? live.error : listError;
  const readAt = jobId ? (live.at ?? listAt) : listAt;
  // What was asked last of this video, read only when a request failed (this browser's memory, see rememberAsk).
  // A job that is not a video (opened by its address) is sent to its own editing screen below: nothing shows here.
  const view: ReelView = jobId && job && isVideoJob(job) ? reelView(job, worker, job.error ? askOf(job.id) : undefined) : { kind: "idle" };
  const clock = useServerClock(live.skew, view.kind === "running" || view.kind === "queued");
  const now = readError && readAt ? Math.min(clock, readAt + live.skew) : clock;
  const mac = data || live.worker ? macState(worker, jobId, now) : undefined;
  const ahead = listed?.ahead;
  // Deleted elsewhere (or by us): stop following, quietly when we did it. A video never seen in this tab (an old or
  // wrong link) is said to be not found: nobody knows here whether it was deleted.
  const selfDeleted = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (job?.id) seen.current.add(job.id);
  }, [job?.id]);
  // The video this browser followed last was loaded here before (another visit, then Back for instance).
  useEffect(() => {
    if (restored && storedJob.current) seen.current.add(storedJob.current);
  }, [restored]);
  useEffect(() => {
    if (!live.gone || !jobId) return;
    if (selfDeleted.current === jobId) {
      // Deleted here: nothing to say.
    } else if (seen.current.has(jobId)) toast("Cette vidéo n'existe plus", { description: "Elle a été supprimée depuis un autre écran." });
    else toast("Cette vidéo est introuvable", { description: nb("Le lien est peut-être ancien : retrouve tes vidéos dans « Mes vidéos » ou dans Montage IA.") });
    follow(null);
  }, [live.gone, jobId, follow]);
  // A reel of scenes (or another job) opened here by its address: its own editing screen shows it.
  const sentAway = useRef<string | null>(null);
  useEffect(() => {
    if (!job || job.id !== jobId || isVideoJob(job) || sentAway.current === job.id) return;
    sentAway.current = job.id;
    router.replace(`/videos/montage/${job.id}`);
  }, [job, jobId, router]);
  // What the Mac is asked to do, kept as soon as it is seen (also when asked from another screen or device), and
  // forgotten once it went well.
  useEffect(() => {
    if (!job) return;
    const a = askOfJob(job);
    if (a) rememberAsk(job.id, a);
    else if (job.action === null && !job.error) forgetAsk(job.id);
  }, [job]);
  const refreshJob = live.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshJob(), refreshList()]);
  }, [refreshJob, refreshList]);

  // ---- Actions ----
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<"send" | "schedule" | "regen" | "retry" | "cancel" | null>(null);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const railMore = useMoreBelow(railRef);
  const request = draft.request.trim();
  const tooShort = request.length < REEL_VIDEO.minRequest;
  const running = view.kind === "queued" || view.kind === "running";

  const generate = async () => {
    if (tooShort || creating || running) return;
    setCreating(true);
    try {
      const { job: created } = await montageApi<{ job: MontageJob }>("/api/montage/jobs", {
        method: "POST",
        body: JSON.stringify({
          kind: "motion",
          mode: "video",
          request,
          source: draft.source,
          seconds: draft.seconds ?? undefined,
          pace: draft.pace ?? undefined,
          direction: draft.direction.trim() || undefined,
          music: draft.music,
          track: draft.music && draft.track ? draft.track : undefined,
          // Whether a logo shows; the image itself is the one of the project's profile, which the Mac gets.
          logo: !!look.logo,
          look: { ...lookOf(look), logo: undefined },
          projectId: styled ?? (activeProject !== "all" ? activeProject : undefined),
        }),
      }, { timeoutMs: 20_000 });
      follow(created.id, created);
      refreshList();
      // On a phone the screen is under the request: brought into view.
      if (!window.matchMedia("(min-width: 1280px)").matches) screenRef.current?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    } catch (e) {
      toast.error("Demande impossible", { description: nb((e as Error).message) });
    } finally {
      setCreating(false);
    }
  };

  const call = async (body: object, timeoutMs = 20_000) => {
    if (!job) return null;
    return montageApi<{ job: MontageJob; media?: { id: string } }>(`/api/montage/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify(body) }, { timeoutMs });
  };
  const hasVideo = !!job && videoVersions(job).some((v) => v.preview);
  /**
   * The request of a deleted job comes back into the field (with its length, pace, music and direction), once the
   * server has deleted it: the job may come from the address, another device or an older draft. The draft that was in
   * the field (as it is now) can be taken back from the toast. A deletion that fails leaves the field as it was.
   */
  const takeBack = (j: MontageJob) => {
    const m = j.motion;
    if (!m?.request) return null;
    const before = draftNow.current;
    setDraft(cleanDraft({ request: m.request, source: m.source, seconds: m.seconds ?? null, pace: m.pace ?? null, direction: m.direction ?? "", music: m.music, track: m.track ?? "" }));
    return before.request.trim() && before.request.trim() !== m.request.trim() ? before : null;
  };
  const draftBack = (before: Draft | null) => (before ? { action: { label: "Reprendre mon brouillon", onClick: () => setDraft(before) } } : {});
  /** Before any version: the request is deleted (its text comes back in the field). After: back to the last good version. */
  const cancel = async () => {
    if (!job || busy) return;
    if (view.kind === "running" && !confirm(nb(hasVideo ? "Arrêter cette nouvelle version ? La vidéo d'avant reste." : "Arrêter la vidéo en cours ? Le Mac abandonne ce qu'il a commencé."))) return;
    setBusy("cancel");
    try {
      if (hasVideo) {
        await call({ stop: true });
        toast.success("Génération arrêtée", { description: "La vidéo d'avant est de nouveau là." });
      } else {
        selfDeleted.current = job.id;
        await montageApi(`/api/montage/jobs/${job.id}`, { method: "DELETE" }, { timeoutMs: 20_000 });
        const before = takeBack(job);
        follow(null);
        toast.success("Vidéo annulée", { description: "Ta demande est revenue dans le champ.", ...draftBack(before) });
      }
      await refresh();
    } catch (e) {
      toast.error("Action impossible", { description: nb((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };
  const retry = async () => {
    if (!job || busy) return;
    setBusy("retry");
    try {
      await call({ revise: "" });
      toast.success("Nouvel essai demandé au Mac");
      await refresh();
    } catch (e) {
      toast.error("Nouvel essai impossible", { description: nb((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };
  const editRequest = async () => {
    if (!job || busy) return;
    setBusy("retry");
    try {
      selfDeleted.current = job.id;
      await montageApi(`/api/montage/jobs/${job.id}`, { method: "DELETE" }, { timeoutMs: 20_000 });
      const before = takeBack(job);
      follow(null);
      refreshList();
      toast(nb("Ta demande est revenue dans le champ : modifie-la puis relance."), draftBack(before));
      requestAnimationFrame(() => requestRef.current?.focus());
    } catch (e) {
      toast.error("Action impossible", { description: nb((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };
  const regenerate = async () => {
    if (!job || busy) return;
    setBusy("regen");
    try {
      rememberAsk(job.id, "regen");
      await call({ regenerate: true });
      toast.success("Nouvelle version demandée", { description: "Claude part de ta demande avec une autre idée visuelle. Celle-ci reste dans Retoucher." });
      await refresh();
    } catch (e) {
      toast.error("Régénération impossible", { description: nb((e as Error).message) });
    } finally {
      setBusy(null);
    }
  };
  /**
   * Sends the version to the library (its preview becomes the video), with a cover taken where beat 1 is settled.
   * `library`: wait until the library knows the new video (the composer looks it up there). `cover`: whether the cover
   * was saved (the picture could not be taken, or the server refused it: the video goes without).
   */
  const approve = async (v: MontageVersion, library = false): Promise<{ mediaId: string | null; cover: boolean }> => {
    if (!job) return { mediaId: null, cover: false };
    // Taken before: once validated, the previews are gone.
    const shot = await captureFrame(`/api/montage/jobs/${job.id}/versions/${v.n}/preview`, coverTime(v)).catch(() => null);
    // Copying the video into the library takes a while: a longer wait than the other calls.
    const r = await call({ approve: v.n }, 60_000);
    const mediaId = r?.job.mediaId ?? r?.media?.id ?? null;
    const cover = !!mediaId && !!shot && (await putCover(mediaId, shot));
    const loaded = useStore.getState().load().catch(() => {});
    if (library) await loaded;
    await refresh();
    return { mediaId, cover };
  };
  const send = async () => {
    if (view.kind !== "ready" || busy) return;
    setBusy("send");
    try {
      const { mediaId, cover } = await approve(view.version);
      if (mediaId) toast.success("Vidéo envoyée dans ta bibliothèque", { description: nb(cover ? "Avec sa couverture. Programme-la quand tu veux." : "Sans couverture : choisis-la dans la bibliothèque. Programme-la quand tu veux.") });
    } catch (e) {
      toast.error("Envoi impossible", { description: nb((e as Error).message) });
      // A validation that timed out may have gone through: the screen shows what is true.
      refresh();
    } finally {
      setBusy(null);
    }
  };
  const captionOf = (j: MontageJob) => (j.versions.find((v) => v.n === j.approved) ?? videoVersions(j).at(-1))?.reel?.video?.caption;
  const schedule = async () => {
    if (!job || busy) return;
    if (view.kind === "library") return openComposer({ mediaId: view.mediaId, caption: captionOf(job) });
    if (view.kind !== "ready") return;
    setBusy("schedule");
    try {
      const { mediaId, cover } = await approve(view.version, true);
      if (mediaId) {
        if (!cover) toast.warning("Vidéo sans couverture", { description: "Tu pourras la choisir dans la bibliothèque." });
        openComposer({ mediaId, caption: view.version.reel?.video?.caption });
      }
    } catch (e) {
      toast.error("Programmation impossible", { description: nb((e as Error).message) });
      refresh();
    } finally {
      setBusy(null);
    }
  };
  const newVideo = () => follow(null);

  // ---- The frame ----
  const versionShown = view.kind === "ready" ? view.version : undefined;
  const src = view.kind === "ready" ? `/api/montage/jobs/${view.job.id}/versions/${view.version.n}/preview` : view.kind === "library" ? `/api/media/${view.mediaId}/file` : undefined;
  const markVersion = view.kind === "library" ? view.job.versions.find((x) => x.n === view.job.approved) : versionShown;
  const marks = useMemo(
    () => (markVersion?.reel?.video?.beats ?? []).filter((b) => !b.cut && Number.isFinite(b.start)).map((b) => ({ id: b.id, title: b.title, start: b.start! })),
    [markVersion],
  );
  const player = useRef<HTMLVideoElement>(null);
  const seek = (t: number) => {
    const v = player.current;
    if (!v) return;
    v.currentTime = t + 0.02;
    v.play().catch(() => {});
  };

  const myVideos = useMemo(
    () => (data?.jobs ?? []).filter((j) => j.kind === "motion" && (isLive(j) || j.status === "review" || j.status === "failed")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [data?.jobs],
  );
  const pickVideo = (j: MontageJob) => (isVideoJob(j) ? follow(j.id) : router.push(`/videos/montage/${j.id}`));

  const kbd = isMacKeyboard() ? "⌘↵" : "Ctrl ↵";
  const macWaiting = mac && (mac.kind === "offline" || mac.kind === "old" || mac.kind === "never" || (mac.kind === "silent" && !mac.mine));
  const hint = running
    ? null
    : tooShort
      ? `Écris ta demande (${REEL_VIDEO.minRequest} caractères au moins).`
      : macWaiting
        ? "Elle démarrera dès que le Mac est prêt."
        : null;

  return (
    <>
      <MediaHeader />
      {/* On a large screen the page fits the window: only the request scrolls inside, and the rail. */}
      <div data-reel-body className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden">
        <div className="mx-auto w-full max-w-[1680px] xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <StudioTabs />
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {mac ? <MacPill mac={mac} className={cn("min-w-0 transition-opacity duration-200", readError && "opacity-55")} /> : <span className="h-8 w-28 shrink rounded-lg border border-line bg-surface/60" />}
              <MyVideos jobs={myVideos} current={jobId} onPick={pickVideo} />
            </div>
          </div>

          <div className="[--rail:240px] xl:min-h-0 xl:flex-1 xl:[container-type:size] 2xl:[--rail:280px]">
            <div className="flex flex-col gap-5 xl:grid xl:h-full xl:grid-cols-[minmax(380px,1fr)_auto] xl:grid-rows-[minmax(0,1fr)]">
              {/* ---------- The request ---------- */}
              <section
                className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface [container-type:inline-size] xl:min-h-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    generate();
                  }
                }}
              >
                <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 xl:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="reel-request" className="text-[14px] font-semibold">
                      Ta demande
                    </label>
                    <Seg label="Ce que tu donnes à Claude" value={draft.source} onChange={(source) => patch({ source })} options={SOURCES} className="ml-auto" />
                  </div>
                  <div className="flex min-h-[132px] flex-1 flex-col xl:min-h-[112px]">
                    <textarea
                      id="reel-request"
                      ref={requestRef}
                      aria-label="Demande"
                      value={draft.request}
                      onChange={(e) => patch({ request: e.target.value })}
                      maxLength={REEL_VIDEO.request}
                      placeholder={SOURCES.find((s) => s.value === draft.source)?.hint}
                      className={cn(inputClass, "min-h-[132px] flex-1 resize-none py-2.5 text-[14px] leading-relaxed xl:min-h-[112px]")}
                    />
                    {/* Under the field, never over its text. */}
                    {draft.request.length > 3000 && (
                      <span aria-live="polite" className={cn("tabular mt-1 self-end font-mono text-[11px]", draft.request.length >= REEL_VIDEO.request ? "text-danger" : "text-ink-3")}>
                        {draft.request.length}/{REEL_VIDEO.request}
                      </span>
                    )}
                  </div>
                  <StartFrom ideas={ideas} projectName={styledProject?.name} posts={posts} onIdea={(text) => patch({ request: text, source: "idea" })} onPost={(text) => patch({ request: text, source: "post" })} />

                  {/* Settings: two columns once the card is wide enough. */}
                  <div className="grid gap-4 @min-[520px]:grid-cols-2">
                    <Setting label="Durée" hint={draft.seconds ? `Environ ${draft.seconds}\u00a0s` : "Claude choisit entre 15 et 60\u00a0s"}>
                      <Seg label="Durée" value={draft.seconds ? String(draft.seconds) : "auto"} onChange={(v) => patch({ seconds: v === "auto" ? null : Number(v) })} options={LENGTHS} />
                    </Setting>
                    <Setting label="Rythme" hint={draft.pace ? undefined : "Claude choisit"}>
                      <Seg label="Rythme" value={draft.pace ?? "auto"} onChange={(v) => patch({ pace: v === "auto" ? null : (v as Pace) })} options={PACES} />
                    </Setting>
                    <Setting label="Musique" className="@min-[520px]:col-span-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
                          <Switch on={draft.music} onChange={(music) => patch({ music })} label="Musique de ton dossier" />
                          Musique de ton dossier
                        </span>
                        <select
                          aria-label="Morceau"
                          value={draft.track}
                          disabled={!draft.music}
                          onChange={(e) => patch({ track: e.target.value })}
                          className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent/60 disabled:opacity-50"
                        >
                          <option value="">Au choix</option>
                          {[...new Set([...(worker?.tracks ?? []), ...(draft.track ? [draft.track] : [])])].map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    </Setting>
                  </div>

                  <StyleRow
                    look={look}
                    onLook={(p) => setLook((l) => ({ ...l, ...p }))}
                    profiles={projects.map((p) => ({ id: p.id, name: p.name }))}
                    profileId={styled}
                    loading={!profiles}
                    onProfile={applyProfile}
                    changed={lookChanged}
                    onReset={() => styled && applyProfile(styled)}
                    onKeep={keepLook}
                    saving={savingLook}
                    suggestedHandle={suggestedHandle}
                  />

                  <Direction value={draft.direction} onChange={(direction) => patch({ direction })} />
                </div>

                {/* ---------- What happens if you click now ---------- */}
                <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3 xl:px-5">
                  {mac && <MacStatus mac={mac} worker={worker} target={draft.seconds ?? undefined} legacy={LEGACY} />}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-3">
                      {running ? (
                        <>
                          <span>Une vidéo à la fois.</span>
                          <Button size="sm" variant="ghost" onClick={cancel} disabled={!!busy}>
                            <X className="size-3.5" /> Annuler
                          </Button>
                        </>
                      ) : hint ? (
                        <span className={cn(tooShort && draft.request.length > 0 && "text-ink-2")}>{hint}</span>
                      ) : (
                        <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-px font-mono text-[11px] text-ink-3">{kbd}</kbd>
                      )}
                    </div>
                    <Button variant="primary" onClick={generate} disabled={tooShort || creating || running} title={`Générer la vidéo (${kbd})`}>
                      {creating ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Clapperboard className="size-4" />}
                      Générer la vidéo
                    </Button>
                  </div>
                </div>
              </section>

              {/* ---------- The screen: the frame and its rail ---------- */}
              {/* Below xl the page scrolls in one column: a video followed here comes first, the request after it. */}
              <div ref={screenRef} className={cn("flex min-w-0 scroll-mt-4 flex-col gap-4 sm:flex-row sm:items-start xl:h-full xl:min-h-0", view.kind !== "idle" && "max-xl:order-first")}>
                <div className="flex w-[300px] max-w-full shrink-0 flex-col gap-2 max-sm:self-center xl:w-[min(calc((100cqh-40px)*9/16),calc(100cqw-380px-36px-var(--rail)))]">
                  <Frame view={view} look={view.kind !== "idle" && job?.motion?.look ? { ...STARTER_LOOK, ...lookOf({ ...STARTER_LOOK, ...job.motion.look }), logo: undefined } : look} request={draft.request} src={src} player={player} now={now} />
                  <Marks marks={marks} view={view} onSeek={seek} />
                </div>
                {/* When the rail holds more than its height, its bottom fades: it scrolls. */}
                <div
                  ref={railRef}
                  className={cn("scroll-thin flex min-w-0 flex-1 flex-col gap-3 sm:max-xl:max-w-[360px] xl:h-full xl:w-(--rail) xl:flex-none xl:overflow-y-auto", railMore && "[mask-image:linear-gradient(to_bottom,black_calc(100%-36px),transparent)]")}
                >
                  {readError && <StaleNote at={readAt} />}
                  <Rail
                    key={`${view.kind}:${jobId ?? ""}`}
                    view={view}
                    now={now}
                    mac={mac}
                    worker={worker}
                    ahead={ahead}
                    busy={busy}
                    estimate={mac?.kind === "ready" || mac?.kind === "busy" ? aboutText(videoEstimate(worker, draft.seconds ?? undefined)) : undefined}
                    onCancel={cancel}
                    onRetry={retry}
                    onEdit={editRequest}
                    onSend={send}
                    onSchedule={schedule}
                    onRegenerate={regenerate}
                    onNew={newVideo}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Whether a box that scrolls holds more below what shows (its content, its size or its scroll changed). */
function useMoreBelow(ref: React.RefObject<HTMLElement | null>) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "aria-expanded"] });
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [ref]);
  return more;
}

/* ---------- The frame ---------- */

/**
 * The 9:16 frame, the same box in every state (no jump): the poster, then the storyboard while the Mac renders, then
 * the video. Layers cross-fade (200 ms); the video appears once.
 */
function Frame({ view, look, request, src, player, now }: { view: ReelView; look: Look; request: string; src?: string; player: React.RefObject<HTMLVideoElement | null>; now: number }) {
  const job = "job" in view ? view.job : undefined;
  const board = job?.run?.board;
  const failedBoard = useBoardTiles(view.kind === "failed" ? `/api/montage/jobs/${view.job.id}/board` : undefined);
  const beats = job ? runBeats(job) : [];
  const phase = job?.run?.phase;
  // The tile under the render head; the last one once rendered; the first one, faded, before.
  let current = 0;
  let fill: number | undefined;
  if (board && job) {
    const head = renderHead(job);
    if (phase === "render") fill = job.run?.frames?.[1] ? job.run.frames[0] / job.run.frames[1] : 0;
    if (phase === "finish" || phase === "upload") {
      fill = 1;
      current = board.n - 1;
    } else if (head !== undefined) {
      const b = beats.find((x) => head >= x.start && head < x.end) ?? beats.at(-1);
      const i = board.frames.findIndex((f) => f.id === b?.id);
      current = i >= 0 ? i : Math.max(0, board.frames.filter((f) => f.t <= head).length - 1);
    }
  }
  const [muted, setMuted] = useState(true);
  // Plays by itself, muted, the first time a video shows here; after that it waits for a click.
  const played = useRef(new Set<string>());
  useEffect(() => {
    setMuted(true);
    if (!src || played.current.has(src)) return;
    played.current.add(src);
    const v = player.current;
    if (v) {
      v.muted = true;
      v.play().catch(() => {});
    }
  }, [src, player]);
  const showBoard = (view.kind === "running" || view.kind === "queued") && !!board && !!job;
  const dim = view.kind === "failed" || (view.kind === "running" && view.silent);
  void now;

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-line bg-black shadow-[0_18px_50px_-22px_rgba(0,0,0,0.45)]" aria-label="Aperçu de la vidéo" role="region">
      {/* Poster: at rest, while waiting (faded), until the first images. */}
      <div className={cn("absolute inset-0 transition-opacity duration-200", src || showBoard || (view.kind === "failed" && failedBoard) ? "opacity-0" : view.kind === "queued" ? "opacity-60" : "opacity-100")}>
        <Poster look={look} text={view.kind === "idle" ? request : beats[0]?.title || (job ? job.title.replace(/^Reel animé : /, "") : request)} kicker={beats.length && view.kind === "running" ? "Temps fort 1" : undefined} />
      </div>
      {showBoard && <Storyboard url={`/api/montage/jobs/${job!.id}/board?v=${board!.v}`} n={board!.n} current={Math.min(current, board!.n - 1)} fill={fill} className={cn(ENTER, "duration-200")} />}
      {view.kind === "failed" && failedBoard > 0 && <Storyboard url={`/api/montage/jobs/${view.job.id}/board`} n={failedBoard} current={failedBoard - 1} fill={1} className={cn(ENTER, "duration-200")} />}
      {src && (
        <div key={src} className="absolute inset-0 transition-[opacity,transform] duration-220 ease-[cubic-bezier(.23,1,.32,1)] starting:scale-[0.985] starting:opacity-0 motion-reduce:starting:scale-100">
          <video ref={player} src={src} muted={muted} playsInline controls preload="metadata" onVolumeChange={(e) => setMuted(e.currentTarget.muted)} className="size-full bg-black object-contain" />
          <button
            onClick={() => {
              const v = player.current;
              if (!v) return;
              v.muted = !v.muted;
              setMuted(v.muted);
              if (!v.muted && v.paused) v.play().catch(() => {});
            }}
            aria-label={muted ? "Activer le son" : "Couper le son"}
            title={muted ? "Activer le son" : "Couper le son"}
            className="press absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/60"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
        </div>
      )}
      {dim && <div className="pointer-events-none absolute inset-0 bg-black/45 transition-opacity duration-200 starting:opacity-0" />}
      {view.kind === "failed" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid size-11 place-items-center rounded-full bg-black/40 text-white/85 backdrop-blur-sm">
            <AlertTriangle className="size-5" />
          </span>
        </div>
      )}
    </div>
  );
}

/** Under the frame: the beats of the video, a click goes there. Kept as a line in every state, so the frame never moves. */
function Marks({ marks, view, onSeek }: { marks: { id: string; title: string; start: number }[]; view: ReelView; onSeek: (t: number) => void }) {
  const playable = (view.kind === "ready" || view.kind === "library") && marks.length > 0;
  return (
    <div
      className={cn(
        "scroll-thin flex h-8 min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // More marks than room: the line fades out on the right, it scrolls sideways.
        playable && marks.length > 2 && "[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] pr-6",
      )}
      role={playable ? "list" : undefined}
      aria-label={playable ? "Repères de la vidéo" : undefined}
    >
      {playable ? (
        marks.map((m, i) => (
          <span key={m.id} role="listitem" className="flex shrink-0 items-center">
            {i > 0 && <span className="px-0.5 text-ink-3/60">·</span>}
            <button onClick={() => onSeek(m.start)} className="press rounded-md px-1.5 py-1 text-[12px] text-ink-2 hover:bg-ink/5 hover:text-ink" title={`Aller à ${fmtClock(m.start)}`}>
              <span className="tabular mr-1 font-mono text-[11px] text-ink-3">{fmtClock(m.start)}</span>
              {m.title}
            </button>
          </span>
        ))
      ) : (
        <span className="w-full truncate text-center text-[11.5px] text-ink-3">{view.kind === "idle" ? "9:16 · un seul plan continu" : view.kind === "running" && view.job.run?.board ? "Une image par temps fort" : ""}</span>
      )}
    </div>
  );
}

/* ---------- The rail ---------- */

function Rail({
  view,
  now,
  mac,
  worker,
  ahead,
  busy,
  estimate,
  onCancel,
  onRetry,
  onEdit,
  onSend,
  onSchedule,
  onRegenerate,
  onNew,
}: {
  view: ReelView;
  now: number;
  mac?: ReturnType<typeof macState>;
  worker?: WorkerStatus;
  ahead?: number;
  busy: "send" | "schedule" | "regen" | "retry" | "cancel" | null;
  estimate?: string;
  onCancel: () => void;
  onRetry: () => void;
  onEdit: () => void;
  onSend: () => void;
  onSchedule: () => void;
  onRegenerate: () => void;
  onNew: () => void;
}) {
  switch (view.kind) {
    case "idle":
      return <IdleCard estimate={estimate} />;
    case "queued": {
      const hasVideo = videoVersions(view.job).some((v) => v.preview);
      return <WaitingCard mac={mac ?? { kind: "never" }} ahead={ahead} onCancel={onCancel} cancelLabel={hasVideo ? "Annuler la nouvelle version" : "Annuler"} busy={busy === "cancel"} />;
    }
    case "running": {
      const hasVideo = videoVersions(view.job).some((v) => v.preview);
      return <RunningCard job={view.job} now={now} silent={view.silent} worker={worker} onCancel={onCancel} cancelLabel={hasVideo ? "Arrêter" : "Annuler"} busy={busy === "cancel"} />;
    }
    case "ready": {
      const duration = view.version.reel?.duration;
      return (
        <>
          {view.failed && <FailedBanner error={view.failed} ask={view.ask} jobId={view.job.id} onRegenerate={onRegenerate} busy={!!busy} />}
          <ResultCard job={view.job} version={view.version} duration={duration} onSend={onSend} onSchedule={onSchedule} onRegenerate={onRegenerate} busy={busy === "send" || busy === "schedule" || busy === "regen" ? busy : null} notesLast={!!view.failed} />
        </>
      );
    }
    case "library": {
      const v = view.job.versions.find((x) => x.n === view.job.approved);
      return <LibraryCard title={v?.reel?.video?.title ?? view.job.title.replace(/^Reel animé : /, "")} onSchedule={onSchedule} onNew={onNew} />;
    }
    case "failed":
      return <ErrorCard error={view.job.error} onRetry={onRetry} onEdit={onEdit} busy={busy === "retry"} />;
  }
}

/* ---------- Parts of the request ---------- */

/** One choice among a few (radio group), 28 px high. */
function Seg<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex w-fit max-w-full rounded-lg border border-line bg-bg-2/70 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn("h-7 shrink-0 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150", o.value === value ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Setting({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}
    </div>
  );
}

/** A line that scrolls sideways: the project's ideas, and a published post to start from. */
function StartFrom({ ideas, projectName, posts, onIdea, onPost }: { ideas: { id: string; text: string }[]; projectName?: string; posts: { id: string; caption: string; status: string; scheduledAt: string }[]; onIdea: (t: string) => void; onPost: (t: string) => void }) {
  const published = useMemo(() => posts.filter((p) => p.status === "published" && p.caption.trim()).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).slice(0, 10), [posts]);
  const [open, setOpen] = useState(false);
  if (!ideas.length && !published.length) return null;
  const chip = "press inline-flex h-7 max-w-[240px] shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 text-[12px] text-ink-2 hover:text-ink";
  return (
    <div className="scroll-thin -mx-1 flex shrink-0 items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
      {published.length > 0 && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger className={cn(chip, "data-[popup-open]:border-accent/60")}>
            <Newspaper className="size-3.5 shrink-0 text-accent" />
            Partir d&apos;un post publié
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={6} align="start" className="z-[60]">
              <Popover.Popup className="popover-popup scroll-thin max-h-[min(420px,70vh)] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] outline-none">
                <p className="px-2 pt-1 pb-1.5 text-[11.5px] font-medium text-ink-3">Tes 10 derniers posts publiés</p>
                {published.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onPost(p.caption.slice(0, REEL_VIDEO.request));
                      setOpen(false);
                    }}
                    className="press block w-full rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.04]"
                  >
                    <span className="line-clamp-2 text-[12.5px] text-ink">{p.caption}</span>
                    <span className="text-[11px] text-ink-3">{new Date(p.scheduledAt).toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}</span>
                  </button>
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
      {ideas.length > 0 && <span className="shrink-0 pl-1 text-[11.5px] text-ink-3">Idées de {projectName ?? "ce projet"}</span>}
      {ideas.map((i) => (
        <button key={i.id} type="button" onClick={() => onIdea(i.text)} title={i.text} className={chip}>
          <Lightbulb className="size-3 shrink-0 text-accent" />
          <span className="truncate">{i.text}</span>
        </button>
      ))}
    </div>
  );
}

/** The project's style: its profile, a glimpse of it, and the look adjusted for this video only. */
function StyleRow({
  look,
  onLook,
  profiles,
  profileId,
  loading,
  onProfile,
  changed,
  onReset,
  onKeep,
  saving,
  suggestedHandle,
}: {
  look: Look;
  onLook: (p: Partial<Look>) => void;
  profiles: { id: string; name: string }[];
  profileId?: string;
  loading: boolean;
  onProfile: (id: string) => void;
  changed: boolean;
  onReset: () => void;
  onKeep: () => void;
  saving: boolean;
  suggestedHandle: string;
}) {
  const pal = lookColors(look);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">Style</span>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-surface pr-1 pl-2 focus-within:border-accent/60">
          {/* What the video will look like: its background, its accent, its font. */}
          <span className="flex shrink-0 items-center" aria-hidden>
            <span className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)]" style={{ background: pal.bg }} />
            <span className="-ml-1.5 size-4 rounded-full shadow-[0_0_0_2px_var(--surface)]" style={{ background: look.accent }} />
          </span>
          <select aria-label="Profil de style" value={profileId ?? ""} onChange={(e) => onProfile(e.target.value)} disabled={loading} className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none">
            <option value="">{profiles.length ? "Aucun projet (style libre)" : "Style libre"}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="shrink-0 rounded bg-ink/5 px-1.5 text-[12px] text-ink-2" style={{ ...DISPLAY_FONT[look.font], lineHeight: "20px" }}>
            {FONT_NAME[look.font]}
          </span>
        </div>
        <Popover.Root>
          <Popover.Trigger className="press inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink shadow-card hover:bg-surface-2 data-[popup-open]:border-accent/60">
            <SlidersHorizontal className="size-3.5" /> Ajuster
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={8} align="end" className="z-[60]">
              <Popover.Popup className="popover-popup scroll-thin flex max-h-[min(560px,80vh)] w-[min(360px,calc(100vw-32px))] flex-col gap-3 overflow-y-auto rounded-xl border border-line-strong bg-surface p-3.5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] outline-none">
                <LookControls look={look} onChange={onLook} suggestedHandle={suggestedHandle} />
                <p className="text-[11.5px] text-ink-3">Numéros de page et étiquette ne servent pas dans une vidéo.</p>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        {changed && (
          <div className="flex gap-2">
            <Button size="sm" className="h-9" onClick={onReset} title="Revenir au style enregistré du projet">
              <RotateCcw className="size-3.5" /> Rétablir
            </Button>
            <Button size="sm" className="h-9" onClick={onKeep} disabled={saving} title="Faire de ces réglages le style du projet">
              <Save className="size-3.5" /> Enregistrer
            </Button>
          </div>
        )}
      </div>
      <span className="text-[11.5px] text-ink-3">{changed ? "Modifié pour cette vidéo seulement, tant que tu n'enregistres pas." : "Couleurs, polices, ton et skill de Claude viennent du projet."}</span>
    </div>
  );
}

/** « Mise en scène », folded until needed (open when it holds something). */
function Direction({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const shown = open || !!value.trim();
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen((o) => !(o || !!value.trim()))} aria-expanded={shown} className="press flex items-center gap-1.5 self-start text-[12px] font-medium text-ink-2 hover:text-ink">
        <ChevronDown className={cn("size-3.5 transition-transform duration-150", !shown && "-rotate-90")} />
        Mise en scène (facultatif)
      </button>
      {shown && (
        <textarea
          aria-label="Mise en scène"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={MAX_DIRECTION}
          placeholder={nb("Par ex. : un seul trait orange qui relie toutes les idées, rythme rapide.")}
          className={cn(inputClass, ENTER, "resize-y py-2 leading-snug")}
        />
      )}
    </div>
  );
}

/** The reels in progress, to look at, or failed: a click follows a video here, or opens an old reel's editing screen. */
function MyVideos({ jobs, current, onPick }: { jobs: MontageJob[]; current: string | null; onPick: (j: MontageJob) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger disabled={!jobs.length} className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink shadow-card hover:bg-surface-2 disabled:opacity-50 data-[popup-open]:border-accent/60">
        <Clapperboard className="size-3.5 text-accent" />
        Mes vidéos
        <span className="tabular rounded-full bg-ink/6 px-1.5 text-[11px] text-ink-2">{jobs.length}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-[60]">
          <Popover.Popup className="popover-popup scroll-thin max-h-[min(440px,70vh)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] outline-none">
            {jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => {
                  onPick(j);
                  setOpen(false);
                }}
                className={cn("press flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-ink/[0.04]", j.id === current && "bg-accent-soft")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{j.title.replace(/^Reel animé : /, "")}</span>
                  <span className="text-[11px] text-ink-3">
                    {isVideoJob(j) ? "Vidéo" : "Reel à scènes"} · {new Date(j.updatedAt).toLocaleDateString("fr-CH", { day: "numeric", month: "short" })}
                  </span>
                </span>
                <JobStatus job={j} />
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
