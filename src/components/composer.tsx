"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { Popover } from "@base-ui-components/react/popover";
import { addDays, setHours, startOfDay } from "date-fns";
import { Bot, CalendarClock, Film, ImagePlus, Sparkles, Trash2, X, Hash, Smile } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MontageJob } from "@/lib/montage";
import { outcomeOf, readableError, summary, waitsInTikTok } from "@/lib/publish-result";
import { NETWORK_ORDER, NETWORKS, NetworkBadge } from "@/lib/networks";
import { useStore } from "@/lib/store";
import { ProjectMark } from "./projects";
import type { Network, Post, YouTubeOptions } from "@/lib/types";
import { cn, duration, fmt, uid } from "@/lib/utils";
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
  const [mediaId, setMediaId] = useState<string | undefined>(existing?.mediaId ?? presetMedia);
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
  const m = media.find((x) => x.id === mediaId);
  const when = new Date(`${day}T${time}`);
  const networks = [...new Set(selectedAccounts.map((a) => a.network))] as Network[];
  const tooLong = networks.filter((n) => caption.length > NETWORKS[n].limit);
  const hasYoutube = networks.includes("youtube");
  const videoOnly = networks.filter((n) => n === "instagram" || n === "tiktok" || n === "youtube").map((n) => NETWORKS[n].label);
  const needsMedia = videoOnly.length > 0 && !m;
  const shortProblem =
    hasYoutube && yt.format === "short" && m ? (m.aspect !== "9:16" ? "Un Short doit être une vidéo verticale (9:16)." : m.duration > 180 ? "Un Short dure 3 minutes maximum." : "") : "";

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (status: Post["status"], now = false) => {
    if (selected.length === 0) return toast.error("Choisissez au moins un compte");
    if (status === "scheduled") {
      if (!caption.trim() && !m) return toast.error("Ajoutez un texte ou une vidéo");
      if (tooLong.length) return toast.error(`Texte trop long pour ${tooLong.map((n) => NETWORKS[n].label).join(", ")}`);
      if (needsMedia) return toast.error(`${videoOnly.join(", ")} : ajoutez une vidéo`);
      if (hasYoutube && yt.title.trim().length < 2) return toast.error("Ajoutez un titre pour YouTube");
      if (shortProblem) return toast.error(shortProblem);
      if (!now && when < new Date()) return toast.error("Choisissez une date dans le futur");
    }
    if (isNaN(when.getTime())) return toast.error("Date invalide");
    // The same video already waits in the TikTok app: sending it again only makes a duplicate (or a 404).
    if (status === "scheduled" && m && networks.includes("tiktok")) {
      const day = Date.now() - 24 * 3600_000;
      const waiting = posts.some(
        (p) =>
          p.mediaId === m.id &&
          Object.entries(p.results ?? {}).some(
            // On this same post, accounts already sent are skipped by the server.
            ([, r]) => r.externalId?.startsWith("inbox:") && new Date(r.at).getTime() > day && p.id !== existing?.id,
          ),
      );
      if (waiting && !confirm("Cette vidéo attend déjà dans ton app TikTok. La renvoyer crée un doublon, et TikTok peut la refuser. Continuer quand même ?")) return;
    }
    setBusy(true);
    try {
      const saved = await savePost({
        id: existing?.id ?? uid(),
        accountIds: selected,
        caption,
        mediaId: m?.id,
        scheduledAt: (now ? new Date() : when).toISOString(),
        status,
        origin: existing?.origin ?? (m?.source === "claude-code" ? "claude-code" : "manual"),
        youtube: hasYoutube ? { ...yt, title: yt.title.trim() } : undefined,
      });
      close();
      const n = selectedAccounts.length;
      if (status === "scheduled" && now) followPublish(saved.id);
      else
        toast.success(status === "draft" ? "Brouillon enregistré" : "Post programmé", {
          description: status === "draft" ? undefined : `${fmt(when, "EEEE d MMMM 'à' HH:mm")} sur ${n} compte${n > 1 ? "s" : ""}.`,
        });
    } catch (e) {
      toast.error("Enregistrement impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const hermesOn = useStore((s) => s.integrations.hermes);
  const [thinking, setThinking] = useState<string | null>(null);

  const applySuggestion = (text: string, youtubeTitle?: string) => {
    setCaption(text);
    if (youtubeTitle && hasYoutube && !yt.title.trim()) setYt((y) => ({ ...y, title: youtubeTitle }));
  };

  /** Hermes on the VPS, used only when the Mac is off. */
  const suggestWithHermes = async () => {
    const res = await fetch("/api/hermes/caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ networks, draft: caption, mediaId: m?.id }),
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
        body: JSON.stringify({ kind: "caption", accountIds: selected, draft: caption, mediaId: m?.id }),
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
        <Dialog.Title className="text-[15px] font-semibold">{existing ? "Modifier le post" : "Nouveau post"}</Dialog.Title>
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

            <section>
              <div className="mb-2 flex items-center">
                <Label className="mb-0">Texte</Label>
                <button
                  type="button"
                  onClick={suggest}
                  disabled={!!thinking || locked}
                  title={caption.trim() ? "Claude se sert de ton texte comme consigne" : "Claude écoute la vidéo et écrit la description"}
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
                  placeholder="Qu'avez-vous à partager ?"
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
                    {networks.map((n) => {
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

            <section>
              <Label>Vidéo</Label>
              {m ? (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-2.5">
                  <MediaThumb media={m} showMeta={false} playable className="h-16 w-12 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{m.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                      <SourceTag source={m.source} />
                      <span className="tabular font-mono">{duration(m.duration)}</span>
                      <span>{m.aspect}</span>
                    </div>
                  </div>
                  <MediaPicker onPick={setMediaId}>
                    <span className="text-[12.5px]">Changer</span>
                  </MediaPicker>
                  <Button size="sm" variant="ghost" onClick={() => setMediaId(undefined)} aria-label="Retirer la vidéo">
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <MediaPicker onPick={setMediaId} block>
                  <ImagePlus className="size-5 text-ink-3" />
                  <span className="text-[13px] text-ink-2">Choisir une vidéo de la bibliothèque</span>
                  <span className="text-[12px] text-ink-3">Les vidéos générées par Claude Code arrivent ici automatiquement</span>
                </MediaPicker>
              )}
            </section>

            {hasYoutube && (
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

            {(needsMedia || tooLong.length > 0) && !locked && (
              <div className="rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-ink">
                {needsMedia && <p>{videoOnly.join(", ")} ne publie{videoOnly.length > 1 ? "nt" : ""} pas de texte seul : ajoutez une vidéo.</p>}
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
                <PostPreview account={previewAccount} caption={caption} media={m} date={isNaN(when.getTime()) ? new Date() : when} youtube={yt} />
                <p className="mt-3 text-center text-[11.5px] text-ink-3">
                  Aperçu {NETWORKS[previewAccount.network].label} · @{previewAccount.handle}
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

function MediaPicker({ children, onPick, block }: { children: React.ReactNode; onPick: (id: string) => void; block?: boolean }) {
  const media = useStore((s) => s.media);
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          "press",
          block
            ? "flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong bg-surface-2/40 px-4 py-6 hover:border-accent/50 hover:bg-accent-soft/40"
            : "inline-flex h-7 items-center rounded-lg border border-line-strong bg-surface px-2.5 hover:bg-surface-2",
        )}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-[60]">
          <Popover.Popup className="popover-popup w-[420px] rounded-xl border border-line-strong bg-surface p-2 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] outline-none">
            <div className="flex items-center gap-2 px-1.5 pt-1 pb-2 text-[12px] font-medium text-ink-2">
              <Film className="size-3.5" />
              Bibliothèque vidéo
            </div>
            <div className="scroll-thin grid max-h-[320px] grid-cols-4 gap-2 overflow-y-auto p-1">
              {media.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    onPick(v.id);
                    setOpen(false);
                  }}
                  className="press group text-left"
                >
                  <MediaThumb media={v} className="aspect-[9/14] w-full ring-accent group-hover:ring-2" />
                  <span className="mt-1 line-clamp-2 block text-[11px] leading-tight text-ink-2">{v.title}</span>
                </button>
              ))}
            </div>
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
  const toastId = toast.loading(retry ? "Nouvelle tentative…" : "Publication en cours…", { description: "Envoi de la vidéo aux réseaux, ça peut prendre une minute.", duration: Infinity });
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
