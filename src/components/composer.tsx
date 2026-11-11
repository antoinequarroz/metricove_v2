"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { Popover } from "@base-ui-components/react/popover";
import { addDays, setHours, startOfDay } from "date-fns";
import { Bot, CalendarClock, ChevronLeft, ChevronRight, Crop, ImagePlus, Images, Plus, Sparkles, Trash2, Upload, X, Hash, Smile } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { MontageJob } from "@/lib/montage";
import { CAROUSEL_MAX, fitsInstagramFeed, IG_PHOTO_RATIO, instagramRefusesFile, postMediaIds, postProblems, ratioOf, STORY_NETWORKS } from "@/lib/formats";
import { cropImageToRatio, isImageFile, MEDIA_ACCEPT, VIDEO_FILE } from "@/lib/image";
import { outcomeOf, readableError, summary, waitsInTikTok } from "@/lib/publish-result";
import { NETWORK_ORDER, NETWORKS, NetworkBadge } from "@/lib/networks";
import { useStore } from "@/lib/store";
import { ProjectMark } from "./projects";
import type { Media, Network, Post, PostFormat, YouTubeOptions } from "@/lib/types";
import { cn, duration, fmt, uid } from "@/lib/utils";
import { CoverControl } from "./cover";
import { PostPreview } from "./previews";
import { Segmented } from "./calendar";
import { Avatar, Button, MediaThumb, SourceTag, StatusPill } from "./ui";

export function Composer() {
  const composer = useStore((s) => s.composer);
  const close = useStore((s) => s.closeComposer);
  // Remount the form each time it opens, so state starts fresh.
  const key = `${composer.postId ?? "new"}-${composer.date ?? ""}-${composer.mediaId ?? ""}`;

  return (
    <Dialog.Root open={composer.open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-40 bg-[rgba(15,14,12,0.38)] backdrop-blur-[3px]" />
        <Dialog.Popup className="dialog-popup fixed top-1/2 left-1/2 z-50 flex h-[min(760px,calc(100dvh-32px))] w-[min(1120px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] outline-none">
          <ComposerForm key={key} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ComposerForm() {
  const { postId, date, mediaId: presetMedia } = useStore((s) => s.composer);
  const posts = useStore((s) => s.posts);
  const accounts = useStore((s) => s.accounts);
  const projects = useStore((s) => s.projects);
  const activeProject = useStore((s) => s.activeProject);
  const media = useStore((s) => s.media);
  const savePost = useStore((s) => s.savePost);
  const deletePost = useStore((s) => s.deletePost);
  const close = useStore((s) => s.closeComposer);
  const existing = posts.find((p) => p.id === postId);
  const retryPost = useStore((s) => s.retryPost);
  const locked = existing?.status === "published" || existing?.status === "publishing";
  const [busy, setBusy] = useState(false);

  const initialDate = useMemo(() => {
    if (existing) return new Date(existing.scheduledAt);
    if (date) {
      const d = new Date(date);
      if (d.getHours() === 0) d.setHours(18, 0, 0, 0);
      return d;
    }
    return setHours(startOfDay(addDays(new Date(), 1)), 18);
  }, [existing, date]);

  const projectAccounts = (id: string) => {
    const p = projects.find((x) => x.id === id);
    return p ? accounts.filter((a) => a.connected && p.accountIds.includes(a.id)).map((a) => a.id) : [];
  };
  // A new post starts with the accounts of the project being viewed.
  const [selected, setSelected] = useState<string[]>(() => {
    if (existing) return existing.accountIds;
    const fromProject = projectAccounts(activeProject);
    return fromProject.length ? fromProject : accounts.filter((a) => a.connected).slice(0, 1).map((a) => a.id);
  });
  const [caption, setCaption] = useState(existing?.caption ?? "");
  // One media for a plain post, several for a carousel, in the order they will show.
  const [mediaIds, setMediaIds] = useState<string[]>(() => (existing ? postMediaIds(existing) : presetMedia ? [presetMedia] : []));
  const setMediaId = (id: string | undefined) => setMediaIds((ids) => (id ? [id, ...ids.slice(1).filter((x) => x !== id)] : ids.slice(1)));
  const [format, setFormat] = useState<PostFormat>(existing?.format ?? "feed");
  const uploadMedia = useStore((s) => s.uploadMedia);
  const [cropping, setCropping] = useState(false);
  const [day, setDay] = useState(fmt(initialDate, "yyyy-MM-dd"));
  const [time, setTime] = useState(fmt(initialDate, "HH:mm"));
  const [previewId, setPreviewId] = useState<string | undefined>(undefined);
  const [yt, setYt] = useState<YouTubeOptions>(() => {
    if (existing?.youtube) return existing.youtube;
    // A vertical video of 3 minutes or less becomes a Short by default.
    const preset = media.find((x) => x.id === (existing?.mediaId ?? presetMedia));
    return { title: "", format: preset && preset.aspect === "9:16" && preset.duration <= 180 ? "short" : "video", privacy: "public" };
  });

  const selectedAccounts = accounts.filter((a) => selected.includes(a.id));
  const previewAccount = selectedAccounts.find((a) => a.id === previewId) ?? selectedAccounts[0];
  const items = mediaIds.map((id) => media.find((x) => x.id === id)).filter((x): x is Media => !!x);
  const m = items[0];
  const carousel = items.length > 1;
  const when = new Date(`${day}T${time}`);
  const networks = [...new Set(selectedAccounts.map((a) => a.network))] as Network[];
  /** Instagram and Facebook are the only ones with stories and photos: the format choice shows with them. */
  const hasSocial = networks.some((n) => STORY_NETWORKS.includes(n));
  // Without one of them selected there is no story to speak of (and no switch to leave it).
  const story = format === "story" && hasSocial;
  // A story shows no text: its length doesn't matter.
  const tooLong = story ? [] : networks.filter((n) => caption.length > NETWORKS[n].limit);
  const hasYoutube = networks.includes("youtube");
  const problems = postProblems({ format: story ? "story" : "feed", items, networks });
  // What Instagram would refuse about a photo, and that one click can fix.
  const misfit = (x: Media) => x.kind === "image" && !story && networks.includes("instagram") && !fitsInstagramFeed(x);
  const notJpeg = (x: Media) => networks.includes("instagram") && instagramRefusesFile(x);
  const photoMisfit = !!m && !carousel && misfit(m);
  const photoNotJpeg = !!m && !carousel && notJpeg(m);
  /** In a carousel: the photos Instagram would refuse as they are. */
  const toFix = carousel && !story ? items.filter((x) => misfit(x) || notJpeg(x)) : [];
  // Those already show next to the photo, with their fix.
  const otherProblems = problems.filter((p) => !/^Instagram (refuse cette photo|refuse une photo du carrousel|n'accepte que les photos JPEG)/.test(p));
  const shortProblem =
    hasYoutube && !story && yt.format === "short" && m && m.kind === "video" ? (m.aspect !== "9:16" ? "Un Short doit être une vidéo verticale (9:16)." : m.duration > 180 ? "Un Short dure 3 minutes maximum." : "") : "";

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (status: Post["status"], now = false) => {
    if (selected.length === 0) return toast.error("Choisissez au moins un compte");
    if (status === "scheduled") {
      if (!caption.trim() && !m) return toast.error(story ? "Ajoutez une photo ou une vidéo pour la story" : "Ajoutez un texte, une photo ou une vidéo");
      if (problems.length) return toast.error(problems[0]);
      if (tooLong.length) return toast.error(`Texte trop long pour ${tooLong.map((n) => NETWORKS[n].label).join(", ")}`);
      if (hasYoutube && !story && yt.title.trim().length < 2) return toast.error("Ajoutez un titre pour YouTube");
      if (shortProblem) return toast.error(shortProblem);
      if (!now && when < new Date()) return toast.error("Choisissez une date dans le futur");
    }
    if (isNaN(when.getTime())) return toast.error("Date invalide");
    // The same video already waits in the TikTok app: sending it again only makes a duplicate (or a 404).
    if (status === "scheduled") {
      // On this same post, accounts already sent are skipped by the server.
      if (inboxElsewhere && !confirm("Cette vidéo attend déjà dans ton app TikTok. La renvoyer crée un doublon, et TikTok peut la refuser. Continuer quand même ?")) return;
    }
    setBusy(true);
    try {
      const saved = await savePost({
        id: existing?.id ?? uid(),
        accountIds: selected,
        caption,
        mediaId: m?.id,
        // Always sent, so that going back to a single media ends the carousel on the server too.
        mediaIds: items.map((x) => x.id),
        format: story ? "story" : "feed",
        scheduledAt: (now ? new Date() : when).toISOString(),
        status,
        origin: existing?.origin ?? (m?.source === "claude-code" ? "claude-code" : "manual"),
        youtube: hasYoutube && !story ? { ...yt, title: yt.title.trim() } : undefined,
      });
      close();
      const n = selectedAccounts.length;
      if (status === "scheduled" && now) followPublish(saved.id);
      else
        toast.success(status === "draft" ? "Brouillon enregistré" : story ? "Story programmée" : carousel ? "Carrousel programmé" : "Post programmé", {
          description: status === "draft" ? undefined : `${fmt(when, "EEEE d MMMM 'à' HH:mm")} sur ${n} compte${n > 1 ? "s" : ""}.`,
        });
    } catch (e) {
      toast.error("Enregistrement impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // The same video already sent to the TikTok app by another post in the last 24 h.
  const inboxElsewhere =
    !!m &&
    networks.includes("tiktok") &&
    posts.some(
      (p) =>
        p.mediaId === m.id &&
        p.id !== existing?.id &&
        Object.values(p.results ?? {}).some((r) => r.externalId?.startsWith("inbox:") && Date.now() - new Date(r.at).getTime() < 24 * 3600_000),
    );

  /** Cuts the middle of a photo so Instagram's feed accepts it, as a new photo in the library that takes its place. */
  const fixPhoto = async (x: Media) => {
    if (!x.url) throw new Error("Fichier introuvable");
    const cut = misfit(x);
    // Only cut when the feed needs it. Otherwise the photo is just saved again as a JPEG.
    const ratio = !cut ? ratioOf(x) : ratioOf(x) < IG_PHOTO_RATIO.min ? IG_PHOTO_RATIO.min : IG_PHOTO_RATIO.max;
    const file = await cropImageToRatio(x.url, ratio, x.title);
    const fixed = await uploadMedia(file, undefined, (cut ? `${x.title} (${ratio < 1 ? "4:5" : "1,91:1"})` : x.title).slice(0, 200));
    // Same place in the order. Nothing happens if the person removed the photo meanwhile.
    setMediaIds((ids) => ids.map((id) => (id === x.id ? fixed.id : id)));
  };

  const cropForInstagram = async () => {
    const list = carousel ? toFix : m ? [m] : [];
    if (!list.length) return;
    const cut = list.some(misfit);
    setCropping(true);
    try {
      for (const x of list) await fixPhoto(x);
      const n = list.length;
      toast.success(n > 1 ? `${n} photos ${cut ? "recadrées" : "converties en JPEG"}` : cut ? "Photo recadrée" : "Photo convertie en JPEG", {
        description: n > 1 ? "Les originales restent dans la bibliothèque." : "L'originale reste dans la bibliothèque.",
      });
    } catch (e) {
      toast.error(cut ? "Recadrage impossible" : "Conversion impossible", { description: (e as Error).message });
    } finally {
      setCropping(false);
    }
  };

  const addMedia = (id: string) => {
    if (mediaIds.includes(id)) return void toast("Ce média est déjà dans le post");
    if (mediaIds.length >= CAROUSEL_MAX) return void toast.error(`Un carrousel prend ${CAROUSEL_MAX} photos ou vidéos au plus`);
    setMediaIds((ids) => (ids.includes(id) || ids.length >= CAROUSEL_MAX ? ids : [...ids, id]));
  };
  const moveMedia = (i: number, by: -1 | 1) =>
    setMediaIds((ids) => {
      const j = i + by;
      if (j < 0 || j >= ids.length) return ids;
      const next = [...ids];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const hermesOn = useStore((s) => s.integrations.hermes);
  const [thinking, setThinking] = useState<string | null>(null);
  // Claude listens to videos. For a photo, it writes from the draft text alone.
  const videoId = items.find((x) => x.kind === "video")?.id;

  const applySuggestion = (text: string, youtubeTitle?: string) => {
    setCaption(text);
    if (youtubeTitle && hasYoutube && !yt.title.trim()) setYt((y) => ({ ...y, title: youtubeTitle }));
  };

  /** Hermes on the VPS, used only when the Mac is off. */
  const suggestWithHermes = async () => {
    const res = await fetch("/api/hermes/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ networks, draft: caption, mediaId: videoId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
    applySuggestion(data.caption, data.youtubeTitle);
    toast("Description proposée par Hermes", { icon: <Bot className="size-4" /> });
  };

  /** Claude on the Mac (Antoine's subscription): listens to the video and writes the description. */
  const suggest = async () => {
    if (!selectedAccounts.length) return toast.error("Choisissez d'abord les comptes");
    setThinking("Claude écrit…");
    const call = async <T,>(url: string, init?: RequestInit) => {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      return data as T;
    };
    let jobId: string | undefined;
    try {
      const { worker } = await call<{ worker: { online: boolean } }>("/api/montage");
      if (!worker.online) {
        if (hermesOn) return await suggestWithHermes();
        throw new Error("Ton Mac est éteint ou en veille : allume-le, puis réessaie.");
      }
      const { job } = await call<{ job: MontageJob }>("/api/montage/jobs", {
        method: "POST",
        body: JSON.stringify({ kind: "caption", accountIds: selected, draft: caption, mediaId: videoId }),
      });
      jobId = job.id;
      const until = Date.now() + 4 * 60_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2000));
        const { job: j } = await call<{ job: MontageJob }>(`/api/montage/jobs/${job.id}`);
        if (j.step) setThinking(j.step);
        if (j.status === "failed") throw new Error(j.error ?? "Le Mac n'a pas pu écrire la description");
        if (j.status === "done" && j.caption?.result) {
          applySuggestion(j.caption.result.caption, j.caption.result.youtubeTitle);
          toast("Description proposée par Claude", { description: "Relis-la et modifie-la si besoin.", icon: <Sparkles className="size-4" /> });
          return;
        }
      }
      throw new Error("Le Mac met trop de temps à répondre");
    } catch (e) {
      toast.error("Pas de description", { description: (e as Error).message });
    } finally {
      // The request was only a means: remove it from the Mac's list.
      if (jobId) fetch(`/api/montage/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
      setThinking(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <Dialog.Title className="text-[15px] font-semibold">{existing ? (story ? "Modifier la story" : carousel ? "Modifier le carrousel" : "Modifier le post") : story ? "Nouvelle story" : carousel ? "Nouveau carrousel" : "Nouveau post"}</Dialog.Title>
        {existing && <StatusPill status={existing.status} inbox={waitsInTikTok(existing)} />}
        <Dialog.Close className="press ml-auto flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink" aria-label="Fermer">
          <X className="size-4" />
        </Dialog.Close>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_420px] max-lg:grid-cols-1">
        {/* Editor */}
        <div className="scroll-thin flex min-h-0 flex-col gap-5 overflow-y-auto p-5">
            {existing && existing.status !== "draft" && Object.keys(existing.results ?? {}).length > 0 && (
              <section className="rounded-xl border border-line bg-surface-2/60 p-3 text-[12.5px]">
                <p className="mb-2 font-medium">Résultat par compte</p>
                <ul className="flex flex-col gap-2">
                  {accounts
                    .filter((a) => existing.accountIds.includes(a.id))
                    .map((a) => {
                      const o = outcomeOf(existing.results?.[a.id], existing);
                      return (
                        <li key={a.id} className="flex items-start gap-2.5">
                          <Avatar account={a} size={22} />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-2">
                              <span className="font-medium">@{a.handle}</span>
                              <span
                                className={cn(
                                  "font-medium",
                                  o.kind === "published" && "text-ok",
                                  o.kind === "inbox" && "text-warn",
                                  o.kind === "failed" && "text-danger",
                                  o.kind === "pending" && "text-ink-3",
                                )}
                              >
                                {o.label}
                              </span>
                            </p>
                            {o.detail && <p className="mt-0.5 text-ink-2">{o.detail}</p>}
                          </div>
                        </li>
                      );
                    })}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.values(existing.results ?? {}).some((r) => r.externalId?.startsWith("inbox:")) && (
                    <Button size="sm" type="button" onClick={() => navigator.clipboard.writeText(existing.caption).then(() => toast.success("Légende copiée"))}>
                      Copier la légende
                    </Button>
                  )}
                  {existing.status === "failed" && (
                    <Button
                      size="sm"
                      type="button"
                      onClick={() =>
                        (!inboxElsewhere ||
                          confirm("Cette vidéo attend déjà dans ton app TikTok (envoyée par un autre post). La renvoyer crée un doublon. Continuer quand même ?")) &&
                        retryPost(existing.id).then(
                          () => {
                            close();
                            followPublish(existing.id, true);
                          },
                          (e: Error) => toast.error(e.message),
                        )
                      }
                    >
                      Relancer les comptes en échec
                    </Button>
                  )}
                </div>
              </section>
            )}
            {existing?.status === "failed" && existing.error && !Object.keys(existing.results ?? {}).length && (
              <div className="rounded-xl border border-danger/25 bg-danger/[0.07] px-3.5 py-3 text-[12.5px]">
                <p className="font-medium text-danger">La publication a échoué</p>
                <p className="mt-1 whitespace-pre-wrap text-ink-2">{readableError(existing.error)}</p>
              </div>
            )}

          <fieldset disabled={locked} className="contents">
            <section>
              <Label>Publier sur</Label>
              {projects.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-[12px] text-ink-3">Projet :</span>
                  {projects.map((p) => {
                    const ids = projectAccounts(p.id);
                    const on = ids.length > 0 && ids.length === selected.length && ids.every((id) => selected.includes(id));
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={!ids.length}
                        onClick={() => setSelected(ids)}
                        title={ids.length ? `Sélectionner les ${ids.length} comptes de ${p.name}` : "Aucun compte connecté dans ce projet"}
                        className={cn(
                          "press flex items-center gap-1.5 rounded-lg border py-1 pr-2.5 pl-1 text-[12.5px] disabled:opacity-40",
                          on ? "border-accent bg-accent-soft text-ink" : "border-line-strong bg-surface text-ink-2 hover:text-ink",
                        )}
                      >
                        <ProjectMark project={p} size={20} />
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {[...accounts].sort((x, y) => NETWORK_ORDER.indexOf(x.network) - NETWORK_ORDER.indexOf(y.network)).map((a) => {
                  const on = selected.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={!a.connected}
                      onClick={() => toggle(a.id)}
                      title={a.connected ? undefined : "Compte à reconnecter"}
                      className={cn(
                        "press flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[12.5px] disabled:opacity-40",
                        on ? "border-accent bg-accent-soft text-ink" : "border-line-strong bg-surface text-ink-2 hover:text-ink",
                      )}
                    >
                      <Avatar account={a} size={22} dim={!on} />
                      <span className="max-w-[140px] truncate">@{a.handle}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {hasSocial && (
              <section>
                <Label>Format</Label>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Segmented<PostFormat>
                    value={story ? "story" : "feed"}
                    onChange={setFormat}
                    options={[
                      { value: "feed", label: "Publication" },
                      { value: "story", label: "Story" },
                    ]}
                  />
                  <p className="text-[12px] text-ink-3">
                    {story
                      ? "Visible 24 heures, en plein écran. Photo ou vidéo de 60 secondes au plus."
                      : carousel
                        ? "Carrousel : les photos et vidéos défilent dans un même post, avec le texte en légende."
                        : m?.kind === "image"
                        ? "Photo dans le fil, avec le texte en légende."
                        : "Reel sur Instagram, vidéo ou texte sur Facebook. Une photo donne un post photo."}
                  </p>
                </div>
              </section>
            )}

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Label className="mb-0">{story ? "Photo ou vidéo" : carousel ? "Carrousel" : "Média"}</Label>
                {carousel && (
                  <span className="tabular font-mono text-[11px] text-ink-3">
                    {items.length}/{CAROUSEL_MAX}
                  </span>
                )}
              </div>
              {m && !carousel ? (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-2.5">
                  <MediaThumb media={m} showMeta={false} playable className="h-16 w-12 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{m.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                      <SourceTag source={m.source} />
                      {m.kind === "image" ? (
                        <span className="tabular font-mono">Photo{m.width && m.height ? ` · ${m.width} × ${m.height}` : ""}</span>
                      ) : (
                        <>
                          <span className="tabular font-mono">{duration(m.duration)}</span>
                          <span>{m.aspect}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {hasSocial && !story && (
                    <MediaPicker onPick={addMedia} title="Ajouter une photo ou une vidéo pour faire un carrousel">
                      <Plus className="mr-1 size-3.5" />
                      <span className="text-[12.5px]">Ajouter</span>
                    </MediaPicker>
                  )}
                  <MediaPicker onPick={setMediaId}>
                    <span className="text-[12.5px]">Changer</span>
                  </MediaPicker>
                  <Button size="sm" variant="ghost" onClick={() => setMediaId(undefined)} aria-label={m.kind === "image" ? "Retirer la photo" : "Retirer la vidéo"}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : null}
              {carousel && (
                <div className="rounded-xl border border-line bg-surface-2/60 p-2.5">
                  <ul className="scroll-thin flex gap-2 overflow-x-auto pb-1">
                    {items.map((x, i) => {
                      const bad = toFix.includes(x) || (networks.includes("facebook") && x.kind === "video" && !story);
                      return (
                        <li key={x.id} className="group/item relative w-[72px] shrink-0">
                          <MediaThumb media={x} showMeta={false} playable className={cn("aspect-[4/5] w-full rounded-md", bad && "ring-2 ring-warn")} />
                          <span className="tabular pointer-events-none absolute top-1 left-1 flex size-[18px] items-center justify-center rounded-full bg-black/65 font-mono text-[10px] font-semibold text-white">
                            {i + 1}
                          </span>
                          {!locked && (
                            <>
                              <button
                                type="button"
                                onClick={() => setMediaIds((ids) => ids.filter((id) => id !== x.id))}
                                aria-label={`Retirer le média ${i + 1}`}
                                className="press absolute top-1 right-1 flex size-[18px] items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/85"
                              >
                                <X className="size-3" />
                              </button>
                              <div className="mt-1 flex items-center justify-between">
                                <button
                                  type="button"
                                  disabled={i === 0}
                                  onClick={() => moveMedia(i, -1)}
                                  aria-label={`Avancer le média ${i + 1}`}
                                  className="press flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink disabled:opacity-30"
                                >
                                  <ChevronLeft className="size-3.5" />
                                </button>
                                <span className="text-[10.5px] text-ink-3">{x.kind === "image" ? "Photo" : duration(x.duration)}</span>
                                <button
                                  type="button"
                                  disabled={i === items.length - 1}
                                  onClick={() => moveMedia(i, 1)}
                                  aria-label={`Reculer le média ${i + 1}`}
                                  className="press flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink disabled:opacity-30"
                                >
                                  <ChevronRight className="size-3.5" />
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                    {items.length < CAROUSEL_MAX && !locked && (
                      <li className="w-[72px] shrink-0">
                        <MediaPicker onPick={addMedia} tile title="Ajouter une photo ou une vidéo">
                          <Plus className="size-4 text-ink-3" />
                        </MediaPicker>
                      </li>
                    )}
                  </ul>
                  <p className="mt-1.5 text-[12px] text-ink-3">
                    {networks.includes("instagram")
                      ? "Instagram affiche tout le carrousel au format du premier média."
                      : "Les photos s'affichent ensemble dans un même post, dans cet ordre."}
                  </p>
                </div>
              )}
              {m && !carousel && m.kind === "video" && !story && networks.includes("instagram") && (
                <div className="mt-2 rounded-xl border border-line bg-surface-2/60 p-2.5">
                  <CoverControl media={m} accountIds={selected} />
                </div>
              )}
              {(photoMisfit || photoNotJpeg) && !locked && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[12.5px]">
                  <p className="min-w-[200px] flex-1">
                    {photoMisfit
                      ? `Cette photo est trop ${ratioOf(m!) < IG_PHOTO_RATIO.min ? "haute" : "large"} pour le fil Instagram (entre 4:5 et 1,91:1).`
                      : "Instagram n'accepte que les photos JPEG."}
                  </p>
                  <Button size="sm" type="button" disabled={cropping} onClick={cropForInstagram}>
                    <Crop className="size-3.5" />
                    {photoMisfit ? (cropping ? "Recadrage…" : `Recadrer en ${ratioOf(m!) < IG_PHOTO_RATIO.min ? "4:5" : "1,91:1"}`) : cropping ? "Conversion…" : "Convertir en JPEG"}
                  </Button>
                </div>
              )}
              {toFix.length > 0 && !locked && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[12.5px]">
                  <p className="min-w-[200px] flex-1">
                    {toFix.some(misfit)
                      ? `${toFix.length > 1 ? `${toFix.length} photos sont` : "Une photo est"} hors format pour Instagram (entre 4:5 et 1,91:1, en JPEG).`
                      : `Instagram n'accepte que les photos JPEG (${toFix.length} à convertir).`}
                  </p>
                  <Button size="sm" type="button" disabled={cropping} onClick={cropForInstagram}>
                    <Crop className="size-3.5" />
                    {toFix.some(misfit) ? (cropping ? "Recadrage…" : toFix.length > 1 ? "Recadrer ces photos" : "Recadrer la photo") : cropping ? "Conversion…" : "Convertir en JPEG"}
                  </Button>
                </div>
              )}
              {!m && (
                <MediaPicker onPick={setMediaId} block>
                  <ImagePlus className="size-5 text-ink-3" />
                  <span className="text-[13px] text-ink-2">Choisir une photo ou une vidéo</span>
                  <span className="text-[12px] text-ink-3">Depuis la bibliothèque, ou importez un fichier</span>
                </MediaPicker>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center">
                <Label className="mb-0">Texte</Label>
                <button
                  type="button"
                  onClick={suggest}
                  disabled={!!thinking || locked}
                  title={caption.trim() ? "Claude se sert de ton texte comme consigne" : videoId ? "Claude écoute la vidéo et écrit la description" : "Claude écrit la description"}
                  className="press ml-auto inline-flex max-w-[60%] items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft disabled:opacity-70"
                >
                  <Sparkles className={cn("size-3.5 shrink-0", thinking && "animate-pulse")} />
                  <span className="truncate">{thinking ?? (caption.trim() ? "Réécrire avec Claude" : "Proposer avec Claude")}</span>
                </button>
              </div>
              <div className="rounded-xl border border-line-strong bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={story ? "Note pour vous (une story n'affiche pas de texte)" : "Qu'avez-vous à partager ?"}
                  rows={7}
                  className="block w-full resize-none bg-transparent px-3.5 py-3 text-[14px] leading-relaxed outline-none placeholder:text-ink-3"
                />
                <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
                  <IconBtn label="Emoji" onClick={() => setCaption((c) => c + " ✨")}>
                    <Smile className="size-4" />
                  </IconBtn>
                  <IconBtn label="Hashtag" onClick={() => setCaption((c) => c + (c.endsWith(" ") || !c ? "#" : " #"))}>
                    <Hash className="size-4" />
                  </IconBtn>
                  <div className="ml-auto flex items-center gap-3 pr-1">
                    {(story ? [] : networks).map((n) => {
                      const left = NETWORKS[n].limit - caption.length;
                      return (
                        <span key={n} className={cn("tabular flex items-center gap-1 font-mono text-[11px]", left < 0 ? "text-danger" : left < 30 ? "text-warn" : "text-ink-3")}>
                          <NetworkBadge network={n} size="xs" />
                          {left}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            {story && caption.trim() && (
              <p className="-mt-3 text-[12px] text-ink-3">Une story n&apos;affiche pas de texte : celui-ci reste une note dans votre calendrier.</p>
            )}

            {hasYoutube && !story && (
              <section className="rise rounded-xl border border-line bg-surface-2/50 p-3.5">
                <div className="mb-3 flex items-center gap-2">
                  <NetworkBadge network="youtube" />
                  <span className="text-[13px] font-medium">YouTube</span>
                  <div className="ml-auto">
                    <Segmented<YouTubeOptions["format"]>
                      value={yt.format}
                      onChange={(format) => setYt((y) => ({ ...y, format }))}
                      options={[
                        { value: "video", label: "Vidéo" },
                        { value: "short", label: "Short" },
                      ]}
                    />
                  </div>
                </div>
                <div className="flex gap-2 max-sm:flex-col">
                  <div className="relative flex-1">
                    <input
                      value={yt.title}
                      maxLength={100}
                      onChange={(e) => setYt((y) => ({ ...y, title: e.target.value }))}
                      placeholder="Titre de la vidéo"
                      className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-12 pl-3 text-[13.5px] outline-none focus:border-accent/60"
                    />
                    <span className="tabular pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[11px] text-ink-3">{100 - yt.title.length}</span>
                  </div>
                  <select
                    value={yt.privacy}
                    onChange={(e) => setYt((y) => ({ ...y, privacy: e.target.value as YouTubeOptions["privacy"] }))}
                    className="h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-accent/60"
                  >
                    <option value="public">Publique</option>
                    <option value="unlisted">Non répertoriée</option>
                    <option value="private">Privée</option>
                  </select>
                </div>
                <p className={cn("mt-2 text-[12px]", shortProblem ? "text-danger" : "text-ink-3")}>
                  {shortProblem ||
                    (yt.format === "short"
                      ? "Vidéo verticale de 3 minutes maximum. Le tag #Shorts est ajouté automatiquement. Le texte sert de description."
                      : "Le texte ci-dessus sert de description.")}
                </p>
              </section>
            )}

            <section>
              <Label>Date de publication</Label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 focus-within:border-accent/60">
                  <CalendarClock className="size-4 text-ink-3" />
                  <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="tabular bg-transparent text-[13.5px] outline-none" />
                </div>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="tabular h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent/60"
                />
                <div className="flex gap-1">
                  {[
                    { label: "Demain 8h", d: setHours(startOfDay(addDays(new Date(), 1)), 8) },
                    { label: "Demain 18h", d: setHours(startOfDay(addDays(new Date(), 1)), 18) },
                  ].map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => {
                        setDay(fmt(q.d, "yyyy-MM-dd"));
                        setTime(fmt(q.d, "HH:mm"));
                      }}
                      className="press h-7 rounded-full border border-line px-2.5 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[12px] text-ink-3 first-letter:uppercase">
                {isNaN(when.getTime()) ? "Date invalide" : fmt(when, "EEEE d MMMM yyyy 'à' HH:mm")} · heure de Zurich
              </p>
            </section>

            {(otherProblems.length > 0 || tooLong.length > 0) && !locked && (
              <div className="flex flex-col gap-1 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-ink">
                {otherProblems.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {tooLong.length > 0 && <p>Le texte dépasse la limite de {tooLong.map((n) => NETWORKS[n].label).join(", ")}.</p>}
              </div>
            )}
          </fieldset>
        </div>

        {/* Preview */}
        <aside className="scroll-thin flex min-h-0 flex-col overflow-y-auto border-l border-line bg-bg-2/60 max-lg:hidden">
          <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-bg-2/90 px-4 py-2.5 backdrop-blur">
            <span className="mr-2 text-[12px] font-medium text-ink-3">Aperçu</span>
            <div className="flex flex-wrap gap-1">
              {selectedAccounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setPreviewId(a.id)}
                  title={`@${a.handle}`}
                  className={cn("press rounded-full p-0.5 ring-2", previewAccount?.id === a.id ? "ring-accent" : "ring-transparent hover:ring-line-strong")}
                >
                  <Avatar account={a} size={24} />
                </button>
              ))}
            </div>
          </div>
          <div className="p-5">
            {previewAccount ? (
              <div key={previewAccount.id} className="rise mx-auto max-w-[360px]">
                <PostPreview account={previewAccount} caption={caption} media={m} items={carousel ? items : undefined} date={isNaN(when.getTime()) ? new Date() : when} youtube={yt} format={story ? "story" : "feed"} />
                <p className="mt-3 text-center text-[11.5px] text-ink-3">
                  Aperçu {story && STORY_NETWORKS.includes(previewAccount.network) ? "story " : ""}
                  {NETWORKS[previewAccount.network].label} · @{previewAccount.handle}
                </p>
              </div>
            ) : (
              <p className="pt-20 text-center text-[13px] text-ink-3">Choisissez un compte pour voir l&apos;aperçu.</p>
            )}
          </div>
        </aside>
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-surface px-5 py-3">
        {existing && !locked && (
          <Button
            variant="ghost"
            className="text-danger hover:bg-danger/10 hover:text-danger"
            onClick={() => {
              close();
              deletePost(existing.id).then(
                () => toast("Post supprimé"),
                (e: Error) => toast.error("Suppression impossible", { description: e.message }),
              );
            }}
          >
            <Trash2 className="size-4" />
            Supprimer
          </Button>
        )}
        <span className="ml-auto" />
        {locked ? (
          <span className="text-[12.5px] text-ink-3">
            {existing?.status === "publishing" ? "Publication en cours…" : "Ce post est publié. Il ne peut plus être modifié."}
          </span>
        ) : (
          <>
            <Button disabled={busy} onClick={() => submit("draft")}>
              Enregistrer en brouillon
            </Button>
            <Button disabled={busy} onClick={() => submit("scheduled", true)}>
              Publier maintenant
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => submit("scheduled")}>
              Programmer
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-2 text-[12px] font-medium text-ink-2", className)}>{children}</div>;
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="press flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink">
      {children}
    </button>
  );
}

type PickerKind = "all" | Media["kind"];

/** The library in a popover: pick a photo or a video, or import one without leaving the editor. */
function MediaPicker({ children, onPick, block, tile, title }: { children: React.ReactNode; onPick: (id: string) => void; block?: boolean; /** A square "+" at the end of a carousel. */ tile?: boolean; title?: string }) {
  const media = useStore((s) => s.media);
  const uploadMedia = useStore((s) => s.uploadMedia);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PickerKind>("all");
  const [sending, setSending] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = media.filter((v) => kind === "all" || v.kind === kind);

  const importFile = async (file: File) => {
    if (!isImageFile(file) && !VIDEO_FILE.test(file.name)) return toast.error("Formats acceptés : mp4, mov, m4v, jpg, png, webp, heic");
    setSending(0);
    try {
      const added = await uploadMedia(file, setSending);
      onPick(added.id);
      setOpen(false);
    } catch (e) {
      toast.error("Envoi impossible", { description: (e as Error).message });
    } finally {
      setSending(null);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        title={title}
        aria-label={tile ? title : undefined}
        className={cn(
          "press",
          block
            ? "flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong bg-surface-2/40 px-4 py-6 hover:border-accent/50 hover:bg-accent-soft/40"
            : tile
              ? "flex aspect-[4/5] w-full items-center justify-center rounded-md border border-dashed border-line-strong bg-surface-2/40 hover:border-accent/50 hover:bg-accent-soft/40"
              : "inline-flex h-7 items-center rounded-lg border border-line-strong bg-surface px-2.5 hover:bg-surface-2",
        )}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-[60]">
          <Popover.Popup className="popover-popup w-[min(440px,calc(100vw-32px))] rounded-xl border border-line-strong bg-surface p-2 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] outline-none">
            <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                <Images className="size-3.5" />
                Bibliothèque
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Segmented<PickerKind>
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "all", label: "Tout" },
                    { value: "video", label: "Vidéos" },
                    { value: "image", label: "Photos" },
                  ]}
                />
                <input
                  ref={input}
                  type="file"
                  accept={MEDIA_ACCEPT}
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) importFile(file);
                  }}
                />
                <Button size="sm" type="button" disabled={sending !== null} onClick={() => input.current?.click()}>
                  <Upload className="size-3.5" />
                  {sending !== null ? <span className="tabular font-mono">{sending}%</span> : "Importer"}
                </Button>
              </div>
            </div>
            {list.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12.5px] text-ink-3">
                {kind === "image" ? "Pas encore de photo : importez-en une." : kind === "video" ? "Pas encore de vidéo." : "La bibliothèque est vide : importez une photo ou une vidéo."}
              </p>
            ) : (
              <div className="scroll-thin grid max-h-[320px] grid-cols-4 gap-2 overflow-y-auto p-1">
                {list.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      onPick(v.id);
                      setOpen(false);
                    }}
                    className="press group text-left"
                  >
                    <MediaThumb media={v} className="aspect-[9/14] w-full ring-accent group-hover:ring-2 group-focus-visible:ring-2" />
                    <span className="mt-1 line-clamp-2 block text-[11px] leading-tight text-ink-2">{v.title}</span>
                  </button>
                ))}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * After "Publier maintenant": a toast that stays until the server says what really happened
 * on each account (published, waiting in the TikTok app, or failed and why).
 */
export function followPublish(id: string, retry = false) {
  const store = useStore.getState;
  const toastId = toast.loading(retry ? "Nouvelle tentative…" : "Publication en cours…", { description: "Envoi aux réseaux, ça peut prendre une minute.", duration: Infinity });
  const until = Date.now() + 6 * 60_000;
  const step = async () => {
    await store().load().catch(() => {});
    const post = store().posts.find((p) => p.id === id);
    if (!post) return toast.dismiss(toastId);
    if (post.status === "published" || post.status === "failed") {
      const s = summary(post, store().accounts);
      const open = { label: "Voir", onClick: () => store().openComposer({ postId: id }) };
      const opts = { id: toastId, description: s.lines.join("\n"), duration: 20_000, action: open, classNames: { description: "whitespace-pre-line" } };
      if (s.failed === s.total) toast.error("La publication a échoué", opts);
      else if (s.failed) toast.warning(`Publié sur ${s.total - s.failed} compte${s.total - s.failed > 1 ? "s" : ""} sur ${s.total}`, opts);
      else if (s.inbox) toast.warning(s.published ? "Publié, et TikTok attend ta validation" : "Envoyé dans ton app TikTok, à finaliser", opts);
      else toast.success("Publié", opts);
      return;
    }
    if (Date.now() > until) return toast("Toujours en cours", { id: toastId, description: "Le statut s'affichera dans le calendrier.", duration: 8000 });
    setTimeout(step, 3000);
  };
  setTimeout(step, 2000);
}
