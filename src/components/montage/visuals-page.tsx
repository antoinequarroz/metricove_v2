"use client";

import { ArrowDown, ArrowUp, Copy, ImagePlus, Images, Lightbulb, Loader2, Palette, Plus, RotateCcw, Save, Send, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { isImageFile } from "@/lib/image";
import type { MontageJob } from "@/lib/montage";
import { lookOf, sameLook } from "@/lib/profiles";
import { useStore } from "@/lib/store";
import { useProfiles } from "@/lib/use-profiles";
import { cn } from "@/lib/utils";
import {
  appFonts,
  type Deck,
  emptyDeck,
  type Fonts,
  FORMAT_OPTIONS,
  HEIGHTS,
  loadDraft,
  loadFonts,
  MAX_SLIDES,
  newSlide,
  photoFailed,
  renderSlide,
  retryPhoto,
  saveDraft,
  type Slide,
  W,
} from "@/lib/visuals";
import { Segmented } from "../calendar";
import { Button } from "../ui";
import { Field, inputClass, LookControls, SlideCanvas } from "./look-parts";
import { PageHeader, StudioTabs, VideoTabs } from "./parts";
import { montageApi, useMontage } from "./use-montage";

/** Oldest Mac program that knows how to write a whole post. */
const POST_WORKER = [0, 2, 0];
const knowsPosts = (version?: string) => {
  const v = (version ?? "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((v[i] ?? 0) !== POST_WORKER[i]) return (v[i] ?? 0) > POST_WORKER[i];
  return true;
};

export function VisualsPage() {
  const [deck, setDeck] = useState<Deck>(emptyDeck);
  const [current, setCurrent] = useState(0);
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [restored, setRestored] = useState(false);
  const media = useStore((s) => s.media);
  const uploadMedia = useStore((s) => s.uploadMedia);
  const deleteMedia = useStore((s) => s.deleteMedia);
  const openComposer = useStore((s) => s.openComposer);
  const activeProject = useStore((s) => s.activeProject);
  const projects = useStore((s) => s.projects);
  const accounts = useStore((s) => s.accounts);

  // The draft of the last visit, then the fonts (the canvas needs them loaded before it draws).
  useEffect(() => {
    const draft = loadDraft();
    if (draft) setDeck(draft);
    setRestored(true);
    const f = appFonts();
    loadFonts(f).then(() => setFonts(f));
  }, []);
  useEffect(() => {
    if (restored) saveDraft(deck);
  }, [deck, restored]);

  const deckRef = useRef(deck);
  deckRef.current = deck;
  const index = Math.min(current, deck.slides.length - 1);
  const slide = deck.slides[index];
  const patch = (p: Partial<Deck>) => setDeck((d) => ({ ...d, ...p }));
  const patchSlide = (p: Partial<Slide>) => setDeck((d) => ({ ...d, slides: d.slides.map((s, i) => (i === index ? { ...s, ...p } : s)) }));

  const addSlide = () => {
    if (deck.slides.length >= MAX_SLIDES) return;
    setDeck((d) => ({ ...d, slides: [...d.slides.slice(0, index + 1), newSlide(), ...d.slides.slice(index + 1)] }));
    setCurrent(index + 1);
  };
  const duplicate = () => {
    if (deck.slides.length >= MAX_SLIDES) return;
    setDeck((d) => ({ ...d, slides: [...d.slides.slice(0, index + 1), { ...slide, id: crypto.randomUUID() }, ...d.slides.slice(index + 1)] }));
    setCurrent(index + 1);
  };
  const remove = () => {
    if (deck.slides.length <= 1) return;
    setDeck((d) => ({ ...d, slides: d.slides.filter((_, i) => i !== index) }));
    setCurrent(Math.max(0, index - 1));
  };
  const move = (by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= deck.slides.length) return;
    setDeck((d) => {
      const slides = [...d.slides];
      [slides[index], slides[to]] = [slides[to], slides[index]];
      return { ...d, slides };
    });
    setCurrent(to);
  };
  // ---- Style profile of the project ----
  const { profiles, save: saveProfile } = useProfiles();
  const styled = deck.profileId && profiles?.[deck.profileId] ? deck.profileId : undefined;
  const profile = styled ? profiles![styled] : undefined;
  const styledProject = projects.find((p) => p.id === styled);
  const projectIdeas = profile?.refs.ideas ?? [];
  const lookChanged = !!profile && !sameLook(lookOf(deck), profile.look);
  const applyProfile = (id: string) => {
    const p = profiles?.[id];
    setDeck((d) => (p ? { ...d, ...lookOf(p.look), logo: p.look.logo, profileId: id } : { ...d, profileId: undefined }));
  };
  // The active project gives its style once, when it becomes the active one. After that, a profile chosen
  // by hand (or none) stays, across saves, page changes and reloads.
  useEffect(() => {
    if (!restored || !profiles || activeProject === "all" || !profiles[activeProject]) return;
    if (deckRef.current.autoProject === activeProject) return;
    const p = profiles[activeProject];
    setDeck((d) => ({ ...d, ...lookOf(p.look), logo: p.look.logo, profileId: activeProject, autoProject: activeProject }));
  }, [restored, profiles, activeProject]);
  const [savingLook, setSavingLook] = useState(false);
  const keepLook = async () => {
    if (!styled || savingLook) return;
    setSavingLook(true);
    try {
      await saveProfile(styled, { look: { ...lookOf(deck), logo: deck.logo ?? "" } });
      toast.success(`Style de ${styledProject?.name ?? "ce projet"} enregistré`, { description: "Les prochains visuels du projet partiront de ce style." });
    } catch (e) {
      toast.error("Style non enregistré", { description: (e as Error).message });
    } finally {
      setSavingLook(false);
    }
  };

  const reset = () => {
    const base = emptyDeck();
    setDeck({ ...(profile && styled ? { ...base, ...lookOf(profile.look), logo: profile.look.logo, profileId: styled } : base), autoProject: deck.autoProject });
    setCurrent(0);
  };

  // ---- Photo of the slide ----
  const fileInput = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const photos = useMemo(() => media.filter((m) => m.kind === "image" && m.url), [media]);
  const importPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!isImageFile(file)) return toast.error("Choisis une photo", { description: "JPEG, PNG, WebP ou HEIC." });
    // Checked now: a photo this browser cannot read (HEIC outside Safari) would only fail when the post is made.
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      return toast.error("Photo illisible par ce navigateur", { description: "Exporte-la en JPEG ou en PNG (les photos HEIC d'iPhone s'ouvrent dans Safari)." });
    }
    patchSlide({ photo: url, photoY: 0.5 });
  };

  // ---- Post written by Claude ----
  const { data, refresh } = useMontage();
  const [idea, setIdea] = useState("");
  const [count, setCount] = useState(5);
  const [jobId, setJobId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // Posts already taken into the editor: their request is being deleted, the list may still show it for a moment.
  const [taken, setTaken] = useState<string[]>([]);
  const pending = data?.jobs.find((j) => j.id === jobId);
  const workerOld = !!data?.worker.version && !knowsPosts(data.worker.version);
  // Posts Claude finished while the page was closed.
  const ready = (data?.jobs ?? []).filter((j) => j.kind === "post" && j.status === "done" && j.post?.result && j.id !== jobId && !taken.includes(j.id)).slice(0, 4);

  // The deck as it was when Claude was asked: a result must not erase what was written meanwhile.
  const askedDeck = useRef<Deck | null>(null);

  const applyResult = (job: MontageJob) => {
    const r = job.post?.result;
    if (!r) return;
    setDeck((d) => ({ ...d, caption: r.caption, slides: r.slides.slice(0, MAX_SLIDES).map((s) => newSlide(s.title, s.body)) }));
    setCurrent(0);
    setTaken((t) => [...t, job.id]);
    // The request was only a means: remove it from the Mac's list.
    montageApi(`/api/montage/jobs/${job.id}`, { method: "DELETE" }).catch(() => {});
  };

  useEffect(() => {
    if (!pending) return;
    if (pending.status === "done" && pending.post?.result) {
      setJobId(null);
      if (deckRef.current === askedDeck.current) {
        applyResult(pending);
        toast.success("Post écrit par Claude", { description: "Relis les visuels et la description, puis crée le post." });
      } else {
        // Edited while Claude wrote: the result waits in the list, a click takes it.
        toast("Le post de Claude est prêt", { description: "Tu as modifié les visuels entre-temps : clique sur son idée, sous « Écrire le post », pour le reprendre.", duration: 12_000 });
      }
    } else if (pending.status === "failed" || pending.status === "cancelled") {
      toast.error("Claude n'a pas pu écrire le post", { description: pending.error });
      montageApi(`/api/montage/jobs/${pending.id}`, { method: "DELETE" }).catch(() => {});
      setJobId(null);
    }
  }, [pending?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // A request that vanished (deleted from another tab) must not spin forever.
  const seenJob = useRef<string | null>(null);
  useEffect(() => {
    if (!jobId || !data) return;
    if (pending) seenJob.current = jobId;
    else if (seenJob.current === jobId) {
      setJobId(null);
      toast.error("La demande à Claude a été supprimée");
    }
  }, [jobId, data, pending]);

  // Requests left by an earlier visit: one still running gets its spinner back, dead ones are removed.
  useEffect(() => {
    if (!data || jobId || asking) return;
    const posts = data.jobs.filter((j) => j.kind === "post" && !taken.includes(j.id));
    const dead = posts.filter((j) => j.status === "failed" || j.status === "cancelled");
    if (dead.length) {
      setTaken((t) => [...t, ...dead.map((j) => j.id)]);
      for (const j of dead) montageApi(`/api/montage/jobs/${j.id}`, { method: "DELETE" }).catch(() => {});
    }
    const running = posts.find((j) => j.status === "queued" || j.status === "working");
    if (running) {
      askedDeck.current = null;
      setJobId(running.id);
    }
  }, [data, jobId, asking, taken]);

  const askClaude = async () => {
    if (!idea.trim() || jobId || asking) return;
    setAsking(true);
    try {
      const { job } = await montageApi<{ job: MontageJob }>("/api/montage/jobs", {
        method: "POST",
        body: JSON.stringify({ kind: "post", idea, slides: count, projectId: styled ?? (activeProject !== "all" ? activeProject : undefined) }),
      });
      askedDeck.current = deckRef.current;
      setJobId(job.id);
      refresh();
    } catch (e) {
      toast.error("Demande impossible", { description: (e as Error).message });
    } finally {
      setAsking(false);
    }
  };
  const cancelClaude = () => {
    if (jobId) setTaken((t) => [...t, jobId]);
    if (jobId) montageApi(`/api/montage/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
    setJobId(null);
  };

  // ---- Create the post ----
  const [making, setMaking] = useState<{ done: number; total: number } | null>(null);
  const story = deck.format === "9:16";
  const empty = deck.slides.every((s) => !s.title.trim() && !s.body.trim() && !s.photo);
  // The visuals of the last "Créer le post": the same visuals are not sent to Médias twice.
  const lastRender = useRef<{ key: string; ids: string[] } | null>(null);
  const createPost = async () => {
    if (!fonts || making) return;
    for (const s of deck.slides) if (s.photo) retryPhoto(s.photo);
    const total = deck.slides.length;
    const open = (ids: string[]) => openComposer(story ? { mediaId: ids[0], caption: deck.caption, format: "story" } : { mediaIds: ids, caption: deck.caption, format: "feed" });
    // Everything that changes the pixels. The description does not.
    const key = JSON.stringify({ ...deck, caption: "", profileId: undefined, autoProject: undefined });
    const last = lastRender.current;
    if (last?.key === key && last.ids.every((id) => useStore.getState().media.some((m) => m.id === id))) return open(last.ids);
    setMaking({ done: 0, total });
    const name = (deck.slides[0].title.trim() || "Visuel").replace(/\s+/g, " ").slice(0, 60);
    const ids: string[] = [];
    try {
      for (let i = 0; i < total; i++) {
        const blob = await renderSlide(deck, i, fonts);
        const title = total > 1 ? `${name} (${i + 1}/${total})` : name;
        const file = new File([blob], `${name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() || "visuel"}-${i + 1}.jpg`, { type: "image/jpeg" });
        ids.push((await uploadMedia(file, undefined, title)).id);
        setMaking({ done: i + 1, total });
      }
      lastRender.current = { key, ids };
      // A story holds one image: the others wait in the library, one story each.
      open(ids);
      if (story && total > 1) toast("Une story par visuel", { description: `Le premier est dans le post. Les ${total - 1} autres sont dans Médias : fais une story pour chacun.`, duration: 10_000 });
      else toast.success(total > 1 ? `${total} visuels ajoutés à Médias` : "Visuel ajouté à Médias", { description: "Choisis les comptes et la date, puis programme." });
    } catch (e) {
      // Nothing was posted: the visuals already sent are removed, so a new try does not double them.
      const left = (await Promise.allSettled(ids.map((id) => deleteMedia(id)))).filter((r) => r.status === "rejected").length;
      const failed = deck.slides.findIndex((s) => s.photo && photoFailed(s.photo));
      if (failed >= 0) setCurrent(failed);
      toast.error("Création impossible", { description: `${(e as Error).message}${left ? ` (${left} visuel${left > 1 ? "s" : ""} resté${left > 1 ? "s" : ""} dans Médias)` : ""}` });
    } finally {
      setMaking(null);
    }
  };

  const project = styledProject ?? projects.find((p) => p.id === activeProject);
  const suggestedHandle = useMemo(() => {
    const pool = project ? accounts.filter((a) => project.accountIds.includes(a.id)) : accounts;
    const a = pool.find((x) => x.network === "instagram") ?? pool[0];
    return a ? `@${a.handle}` : "";
  }, [project, accounts]);

  return (
    <>
      <PageHeader kicker="Vidéos" title="Studio">
        <VideoTabs />
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <StudioTabs />
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={reset} disabled={!!making} title="Repartir d'un visuel vide">
                <RotateCcw className="size-4" />
                <span className="max-sm:hidden">Recommencer</span>
              </Button>
              <Button variant="primary" onClick={createPost} disabled={!fonts || !!making || empty}>
                {making ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {making ? `Visuel ${Math.min(making.done + 1, making.total)}/${making.total}…` : "Créer le post"}
              </Button>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            {/* ---------- Preview and slides ---------- */}
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-center rounded-2xl border border-line bg-bg-2/60 p-5 max-sm:p-3">
                <div className={cn("w-full", deck.format === "9:16" ? "max-w-[300px]" : deck.format === "1:1" ? "max-w-[460px]" : "max-w-[400px]")}>
                  <SlideCanvas deck={deck} index={index} fonts={fonts} className="rounded-xl shadow-[0_18px_50px_-18px_rgba(0,0,0,0.45)]" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="scroll-thin flex min-w-0 flex-1 gap-2 overflow-x-auto p-1" role="tablist" aria-label="Visuels">
                  {deck.slides.map((s, i) => (
                    <button
                      key={s.id}
                      role="tab"
                      aria-selected={i === index}
                      aria-label={`Visuel ${i + 1}`}
                      onClick={() => setCurrent(i)}
                      className={cn(
                        "press relative w-[68px] shrink-0 overflow-hidden rounded-lg outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-accent/50",
                        i === index ? "shadow-[0_0_0_2px_var(--accent)]" : "shadow-[0_0_0_1px_var(--line-strong)] hover:shadow-[0_0_0_1px_var(--ink-3)]",
                      )}
                    >
                      <SlideCanvas deck={deck} index={i} fonts={fonts} small />
                      <span className="tabular absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[10px] font-medium text-white">{i + 1}</span>
                    </button>
                  ))}
                  {deck.slides.length < MAX_SLIDES && (
                    <button
                      onClick={addSlide}
                      aria-label="Ajouter un visuel"
                      title="Ajouter un visuel"
                      className="press grid w-[68px] shrink-0 place-items-center rounded-lg border border-dashed border-line-strong text-ink-3 hover:border-ink-3 hover:text-ink"
                      style={{ aspectRatio: `${W} / ${HEIGHTS[deck.format]}` }}
                    >
                      <Plus className="size-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-[12.5px] text-ink-3">
                <span className="mr-1">
                  {deck.slides.length > 1 ? `Visuel ${index + 1} sur ${deck.slides.length} · carrousel` : "Un seul visuel · post photo"}
                </span>
                <IconButton label="Reculer ce visuel" onClick={() => move(-1)} disabled={index === 0}>
                  <ArrowUp className="size-3.5 -rotate-90" />
                </IconButton>
                <IconButton label="Avancer ce visuel" onClick={() => move(1)} disabled={index === deck.slides.length - 1}>
                  <ArrowDown className="size-3.5 -rotate-90" />
                </IconButton>
                <IconButton label="Dupliquer ce visuel" onClick={duplicate} disabled={deck.slides.length >= MAX_SLIDES}>
                  <Copy className="size-3.5" />
                </IconButton>
                <IconButton label="Supprimer ce visuel" onClick={remove} disabled={deck.slides.length <= 1} danger>
                  <Trash2 className="size-3.5" />
                </IconButton>
                {story && deck.slides.length > 1 && <span className="ml-auto text-warn">En story, chaque visuel devient une story à part.</span>}
              </div>
            </div>

            {/* ---------- Settings ---------- */}
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="Écrit par Claude" icon={<Sparkles className="size-3.5 text-accent" />}>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={3}
                  maxLength={3000}
                  placeholder="Ton idée, par ex. « 5 erreurs quand on débute avec Claude Code »"
                  aria-label="Idée du post"
                  className={cn(inputClass, "resize-y py-2 leading-snug")}
                />
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    Visuels
                    <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-accent/60">
                      {Array.from({ length: MAX_SLIDES }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  {jobId ? (
                    <Button className="ml-auto" onClick={cancelClaude}>
                      <X className="size-4" />
                      Annuler
                    </Button>
                  ) : (
                    <Button className="ml-auto" onClick={askClaude} disabled={!idea.trim() || asking || workerOld}>
                      <Sparkles className="size-4 text-accent" />
                      Écrire le post
                    </Button>
                  )}
                </div>
                {jobId && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3" aria-live="polite">
                    <Loader2 className="size-3.5 animate-spin" />
                    {pending?.step ?? (data?.worker.online ? "Claude écrit sur ton Mac…" : "En attente de ton Mac (éteint ou en veille)…")}
                  </p>
                )}
                {!jobId && projectIdeas.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11.5px] text-ink-3">Idées de {styledProject?.name ?? "ce projet"}</p>
                    <div className="scroll-thin flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                      {projectIdeas.map((i) => (
                        <button key={i.id} type="button" onClick={() => setIdea(i.text)} title="Reprendre cette idée" className="press max-w-full truncate rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 hover:text-ink">
                          <Lightbulb className="mr-1 inline size-3 text-accent" />
                          {i.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {workerOld && <p className="mt-2 text-[12px] text-warn">Le programme de ton Mac est trop ancien pour écrire un post entier : mets-le à jour (version 0.2.0).</p>}
                {!jobId && ready.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ready.map((j) => (
                      <button
                        key={j.id}
                        onClick={() => applyResult(j)}
                        title="Reprendre ce post écrit par Claude"
                        className="press max-w-full truncate rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 hover:text-ink"
                      >
                        <Sparkles className="mr-1 inline size-3 text-accent" />
                        {j.title.replace(/^Post : /, "")}
                      </button>
                    ))}
                  </div>
                )}
                {deck.slides.some((s) => s.title.trim() && s.title !== "Ton accroche ici") && !jobId && (
                  <p className="mt-2 text-[11.5px] text-ink-3">Le texte de Claude remplace les visuels actuels.</p>
                )}
              </Panel>

              <Panel title={`Texte du visuel ${index + 1}`}>
                <Field label="Gros texte">
                  <textarea aria-label="Gros texte" value={slide.title} onChange={(e) => patchSlide({ title: e.target.value })} rows={2} maxLength={200} className={cn(inputClass, "resize-y py-2 leading-snug")} />
                </Field>
                <Field label="Petit texte">
                  <textarea aria-label="Petit texte" value={slide.body} onChange={(e) => patchSlide({ body: e.target.value })} rows={3} maxLength={600} className={cn(inputClass, "resize-y py-2 leading-snug")} />
                </Field>
              </Panel>

              <Panel title={`Photo du visuel ${index + 1}`}>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic" className="hidden" onChange={(e) => (importPhoto(e.target.files?.[0]), (e.target.value = ""))} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => fileInput.current?.click()}>
                    <ImagePlus className="size-3.5" />
                    Importer
                  </Button>
                  <Button size="sm" onClick={() => setPicking((p) => !p)} disabled={!photos.length} title={photos.length ? undefined : "Aucune photo dans Médias"}>
                    <Images className="size-3.5" />
                    Depuis Médias
                  </Button>
                  {slide.photo && (
                    <Button size="sm" variant="ghost" onClick={() => patchSlide({ photo: undefined })}>
                      <X className="size-3.5" />
                      Retirer
                    </Button>
                  )}
                </div>
                {picking && (
                  <div className="scroll-thin mt-2 grid max-h-44 grid-cols-5 gap-1.5 overflow-y-auto rounded-lg border border-line p-1.5">
                    {photos.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (m.url) retryPhoto(m.url);
                          patchSlide({ photo: m.url, photoY: 0.5 });
                          setPicking(false);
                        }}
                        title={m.title}
                        aria-label={`Utiliser la photo ${m.title}`}
                        className="press aspect-square overflow-hidden rounded-md bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.url} alt="" loading="lazy" className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
                {slide.photo ? (
                  <div className="mt-3 flex flex-col gap-2.5">
                    <Slider label="Cadrage" value={slide.photoY ?? 0.5} min={0} max={1} onChange={(photoY) => patchSlide({ photoY })} />
                    <Slider label="Assombrir" value={slide.dim ?? (slide.title.trim() || slide.body.trim() ? 0.45 : 0)} min={0} max={0.85} onChange={(dim) => patchSlide({ dim })} />
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-ink-3">Sans photo, le visuel prend le fond choisi plus bas. Une photo sans texte donne un post photo simple.</p>
                )}
              </Panel>

              <Panel title="Style de tous les visuels" icon={<Palette className="size-3.5 text-accent" />}>
                {projects.length > 0 && (
                  <Field label="Profil de style">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Profil de style"
                        value={styled ?? ""}
                        onChange={(e) => applyProfile(e.target.value)}
                        disabled={!profiles}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-accent/60"
                      >
                        <option value="">Aucun (style libre)</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {lookChanged && (
                        <>
                          <Button size="sm" className="h-9" onClick={() => applyProfile(styled!)} title="Revenir au style enregistré du projet">
                            <RotateCcw className="size-3.5" />
                            Rétablir
                          </Button>
                          <Button size="sm" className="h-9" onClick={keepLook} disabled={savingLook} title="Faire de ces réglages le style du projet">
                            <Save className="size-3.5" />
                            Enregistrer
                          </Button>
                        </>
                      )}
                    </div>
                    <span className="text-[11.5px] text-ink-3">
                      {styled ? (lookChanged ? "Modifié pour ce post seulement, tant que tu n'enregistres pas." : "Couleurs, texte, signature et ton de Claude viennent du projet.") : "Choisis un projet pour reprendre son style."}{" "}
                      <Link href="/settings#styles" className="font-medium text-accent">
                        Tous les profils
                      </Link>
                    </span>
                  </Field>
                )}
                <Field label="Format">
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented value={deck.format} onChange={(format) => patch({ format })} options={FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))} />
                    <span className="text-[12px] text-ink-3">{FORMAT_OPTIONS.find((f) => f.value === deck.format)?.hint}</span>
                  </div>
                </Field>
                <LookControls look={deck} onChange={patch} suggestedHandle={suggestedHandle} />
              </Panel>

              <Panel title="Description du post">
                <textarea
                  value={deck.caption}
                  onChange={(e) => patch({ caption: e.target.value })}
                  rows={5}
                  maxLength={5000}
                  placeholder="Le texte publié avec les visuels. Tu peux aussi l'écrire plus tard, dans le post."
                  aria-label="Description du post"
                  className={cn(inputClass, "resize-y py-2 leading-snug")}
                />
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold">
        {icon}
        {title}
      </h2>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[12px] font-medium text-ink-2">
      <span className="w-20 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--accent)]" />
    </label>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn("press grid size-7 place-items-center rounded-md text-ink-3 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-35", danger ? "hover:text-danger" : "hover:text-ink")}
    >
      {children}
    </button>
  );
}
