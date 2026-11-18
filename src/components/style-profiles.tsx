"use client";

import { Check, ChevronDown, Compass, ImagePlus, Lightbulb, Loader2, Palette, Plus, Save, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type Look, MAX_EXAMPLE, MAX_EXAMPLES, MAX_IDEA, MAX_IDEAS, MAX_REF_IMAGES, MAX_SKILL, MAX_TONE, PRESETS, presetOf, sameLook, sameTexts, type StyleProfile } from "@/lib/profiles";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { useProfiles } from "@/lib/use-profiles";
import { cn } from "@/lib/utils";
import { appFonts, type Deck, type Fonts, loadFonts, newSlide } from "@/lib/visuals";
import { Field, inputClass, LookControls, SlideCanvas } from "./montage/look-parts";
import type { CharteResult } from "@/lib/strategy";
import { JobProgress, OldWorkerNote, SourcePicker, startReading, useProjectJob, workerTooOld } from "./brand-reading";
import { Button } from "./ui";

/** The style profile of each project: the look of its visuals and the voice Claude writes in. */
export function StyleProfiles() {
  const projects = useStore((s) => s.projects);
  const loaded = useStore((s) => s.loaded);
  const hooks = useProfiles();
  const { profiles, error, reload } = hooks;
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const f = appFonts();
    loadFonts(f).then(() => setFonts(f));
  }, []);
  // A project made in another page since the profiles were read.
  const missing = projects.some((p) => profiles && !profiles[p.id]);
  useEffect(() => {
    if (missing) reload();
  }, [missing, reload]);

  if (error && !profiles)
    return (
      <div className="flex items-center gap-3 px-4 py-3 text-[13px]">
        <span className="size-2 shrink-0 rounded-full bg-warn" />
        <p className="min-w-0 flex-1">Profils illisibles : {error}</p>
        <Button size="sm" onClick={reload}>
          Réessayer
        </Button>
      </div>
    );
  if (!loaded || !profiles) return <p className="px-4 py-3 text-[13px] text-ink-3">Lecture des profils…</p>;
  if (!projects.length) return <p className="px-4 py-3 text-[13px] text-ink-3">Crée d&apos;abord un projet (menu des projets, en haut à gauche) : chaque projet a son profil de style.</p>;

  return (
    <>
      {projects.map((project, i) => {
        const profile = profiles[project.id];
        if (!profile) return null;
        return (
          <div key={project.id} className={cn(i && "border-t border-line")}>
            <ProfileCard project={project} profile={profile} fonts={fonts} open={open === project.id} onToggle={() => setOpen((o) => (o === project.id ? null : project.id))} hooks={hooks} />
          </div>
        );
      })}
    </>
  );
}

type Texts = { id: string; text: string }[];
type Draft = { preset: StyleProfile["preset"]; look: Look; tone: string; skill: string; examples: Texts; ideas: Texts };
const draftOf = (p: StyleProfile): Draft => ({ preset: p.preset, look: p.look, tone: p.tone, skill: p.skill, examples: p.refs.examples, ideas: p.refs.ideas });
const edited = (d: Draft, p: StyleProfile) => !sameLook(d.look, p.look) || d.tone.trim() !== p.tone.trim() || d.skill.trim() !== p.skill || !sameTexts(d.examples, p.refs.examples) || !sameTexts(d.ideas, p.refs.ideas);

function ProfileCard({ project, profile, fonts, open, onToggle, hooks }: { project: Project; profile: StyleProfile; fonts: Fonts | null; open: boolean; onToggle: () => void; hooks: ReturnType<typeof useProfiles> }) {
  const { save } = hooks;
  const accounts = useStore((s) => s.accounts);
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
  const [busy, setBusy] = useState(false);
  const [starter, setStarter] = useState(profile.preset);
  const dirty = edited(draft, profile);
  // What the server holds changed (saved from the Studio): follow it, unless something is being edited here.
  const shown = useRef(profile);
  useEffect(() => {
    const before = shown.current;
    shown.current = profile;
    setDraft((d) => (edited(d, before) ? d : draftOf(profile)));
  }, [profile]);

  const slides = useMemo(() => [newSlide(project.name, "Voici à quoi ressemblent les visuels de ce projet."), newSlide("Suite", "")], [project.name]);
  const deck: Deck = { ...draft.look, format: "4:5", slides, caption: "" };
  const suggestedHandle = useMemo(() => {
    const pool = accounts.filter((a) => project.accountIds.includes(a.id));
    const a = pool.find((x) => x.network === "instagram") ?? pool[0];
    return a ? `@${a.handle}` : "";
  }, [accounts, project.accountIds]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await save(project.id, { preset: draft.preset, look: { ...draft.look, logo: draft.look.logo ?? "" }, tone: draft.tone, skill: draft.skill, refs: { examples: draft.examples, ideas: draft.ideas } });
      setDraft(draftOf(saved));
      toast.success(`Style de ${project.name} enregistré`, { description: "Les prochains visuels et textes du projet le suivent." });
    } catch (e) {
      toast.error("Style non enregistré", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const useStarter = () => {
    const p = presetOf(starter);
    setDraft((d) => ({ ...d, preset: p.id, look: { ...p.look, handle: d.look.handle, logo: d.look.logo }, tone: p.tone }));
  };

  return (
    <>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-ink/[0.03] focus-visible:bg-ink/[0.04]">
        <span className="w-11 shrink-0 overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line-strong)]">
          <SlideCanvas deck={deck} index={0} fonts={fonts} small />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{project.name}</span>
          <span className="block truncate text-[12px] text-ink-3">
            {profile.saved ? "Style personnalisé" : `Style de départ ${presetOf(profile.preset).label}`}
            {profile.skill ? " · skill relié" : ""}
            {profile.strategy.trim() ? " · stratégie" : ""}
            {dirty ? " · modifications non enregistrées" : ""}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-5 border-t border-line px-4 py-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="max-sm:mx-auto max-sm:w-48">
            <SlideCanvas deck={deck} index={0} fonts={fonts} className="rounded-lg shadow-[0_12px_32px_-14px_rgba(0,0,0,0.4)]" />
            <p className="mt-2 text-center text-[11.5px] text-ink-3">Aperçu d&apos;un visuel</p>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <CharteImport project={project} draft={draft} setDraft={setDraft} fonts={fonts} />
            <LookControls look={draft.look} onChange={(p) => setDraft((d) => ({ ...d, look: { ...d.look, ...p } }))} suggestedHandle={suggestedHandle} />
            <Field label="Ton de Claude (descriptions, posts, textes de prompteur)">
              <textarea
                aria-label="Ton de Claude"
                value={draft.tone}
                onChange={(e) => setDraft((d) => ({ ...d, tone: e.target.value }))}
                rows={5}
                maxLength={MAX_TONE}
                placeholder="Comment Claude doit écrire pour ce projet : à qui il parle, le ton, ce qu'il ne doit jamais dire."
                className={cn(inputClass, "resize-y py-2 leading-snug")}
              />
            </Field>
            <Field label="Skill sur le Mac (facultatif)">
              <input
                aria-label="Dossier du skill"
                value={draft.skill}
                onChange={(e) => setDraft((d) => ({ ...d, skill: e.target.value }))}
                maxLength={MAX_SKILL}
                placeholder="~/.claude/skills/mon-style"
                spellCheck={false}
                className={cn(inputClass, "h-9 font-mono text-[12px]")}
              />
              <span className="text-[11.5px] text-ink-3">Le dossier d&apos;un skill sur ton Mac. Claude lit son fichier SKILL.md avant d&apos;écrire pour ce projet.</span>
            </Field>
            <References project={project} profile={profile} draft={draft} setDraft={setDraft} hooks={hooks} />
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                Repartir de
                <select value={starter} onChange={(e) => setStarter(e.target.value as StyleProfile["preset"])} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-accent/60" aria-label="Style de départ">
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id} title={p.hint}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" className="h-9" onClick={useStarter}>
                Appliquer
              </Button>
              <Button variant="primary" className="ml-auto" onClick={submit} disabled={busy || (!dirty && profile.saved)}>
                <Save className="size-4" />
                Enregistrer
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** What Claude imitates for this project: model posts, inspiration images, and the list of ideas. */
function References({ project, profile, draft, setDraft, hooks }: { project: Project; profile: StyleProfile; draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; hooks: ReturnType<typeof useProfiles> }) {
  const posts = useStore((s) => s.posts);
  const [text, setText] = useState("");
  const [idea, setIdea] = useState("");
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const images = profile.refs.images;

  // Published posts of this project, newest first, not already taken as models.
  const published = useMemo(
    () =>
      posts
        .filter((p) => p.status === "published" && p.caption.trim() && p.accountIds.some((id) => project.accountIds.includes(id)) && !draft.examples.some((e) => e.text === p.caption.trim().slice(0, MAX_EXAMPLE)))
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
        .slice(0, 30),
    [posts, project.accountIds, draft.examples],
  );
  const addExample = (raw: string) => {
    const t = raw.trim().slice(0, MAX_EXAMPLE);
    if (!t || draft.examples.length >= MAX_EXAMPLES || draft.examples.some((e) => e.text === t)) return;
    setDraft((d) => ({ ...d, examples: [...d.examples, { id: crypto.randomUUID(), text: t }] }));
  };
  const addIdea = () => {
    const t = idea.replace(/\s+/g, " ").trim().slice(0, MAX_IDEA);
    if (!t || draft.ideas.length >= MAX_IDEAS) return;
    if (!draft.ideas.some((e) => e.text === t)) setDraft((d) => ({ ...d, ideas: [...d.ideas, { id: crypto.randomUUID(), text: t }] }));
    setIdea("");
  };
  const sendImages = async (files: FileList | null) => {
    if (!files?.length || sending) return;
    setSending(true);
    try {
      let room = MAX_REF_IMAGES - images.length;
      for (const file of Array.from(files)) {
        if (room-- <= 0) {
          toast(`${MAX_REF_IMAGES} images au plus par projet`);
          break;
        }
        await hooks.addImage(project.id, file);
      }
    } catch (e) {
      toast.error("Image non ajoutée", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };
  const dropImage = (id: string) => hooks.removeImage(project.id, id).catch((e: Error) => toast.error("Image non retirée", { description: e.message }));

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div>
        <h3 className="text-[13px] font-semibold">Références</h3>
        <p className="text-[11.5px] text-ink-3">Ce que Claude imite quand il écrit pour ce projet. Il reprend la structure et le ton, sans recopier.</p>
      </div>

      <Field label={`Posts modèles (${draft.examples.length}/${MAX_EXAMPLES})`}>
        {draft.examples.map((e) => (
          <div key={e.id} className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/50 px-3 py-2">
            <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-line text-[12.5px] leading-snug text-ink-2">{e.text}</p>
            <button type="button" onClick={() => setDraft((d) => ({ ...d, examples: d.examples.filter((x) => x.id !== e.id) }))} aria-label="Retirer ce post modèle" title="Retirer" className="press grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:text-danger">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {draft.examples.length < MAX_EXAMPLES && (
          <>
            <textarea aria-label="Texte d'un post modèle" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={MAX_EXAMPLE} placeholder="Colle ici le texte d'un de tes posts qui a bien marché." className={cn(inputClass, "resize-y py-2 leading-snug")} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="button" disabled={!text.trim()} onClick={() => (addExample(text), setText(""))}>
                <Plus className="size-3.5" />
                Ajouter ce texte
              </Button>
              <Button size="sm" type="button" disabled={!published.length} title={published.length ? undefined : "Aucun post publié pour ce projet"} onClick={() => setPicking((p) => !p)}>
                Choisir un post publié
              </Button>
            </div>
            {picking && published.length > 0 && (
              <div className="scroll-thin flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-1.5">
                {published.map((p) => (
                  <button key={p.id} type="button" onClick={() => addExample(p.caption)} className="press rounded-md px-2 py-1.5 text-left hover:bg-ink/[0.04]">
                    <span className="block text-[11px] text-ink-3">{new Date(p.scheduledAt).toLocaleDateString("fr-CH", { dateStyle: "medium" })}</span>
                    <span className="line-clamp-2 text-[12.5px] leading-snug">{p.caption}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Field>

      <Field label={`Images d'inspiration (${images.length}/${MAX_REF_IMAGES})`}>
        <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => (sendImages(e.target.files), (e.target.value = ""))} />
        <div className="flex flex-wrap gap-2">
          {images.map((i) => (
            <span key={i.id} className="group relative size-20 overflow-hidden rounded-lg bg-surface-2 shadow-[0_0_0_1px_var(--line-strong)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/profiles/${project.id}/images/${i.id}`} alt={i.name} title={i.name} loading="lazy" className="size-full object-cover" />
              <button type="button" onClick={() => dropImage(i.id)} aria-label={`Retirer l'image ${i.name}`} title="Retirer" className="press absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/60 text-white">
                <X className="size-3" />
              </button>
            </span>
          ))}
          {images.length < MAX_REF_IMAGES && (
            <button type="button" onClick={() => fileInput.current?.click()} disabled={sending} aria-label="Ajouter des images d'inspiration" className="press grid size-20 place-items-center rounded-lg border border-dashed border-line-strong text-ink-3 hover:border-ink-3 hover:text-ink disabled:opacity-60">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            </button>
          )}
        </div>
        <span className="text-[11.5px] text-ink-3">Captures de carrousels ou de visuels que tu aimes. Claude les regarde avant d&apos;écrire un post, pour reprendre le découpage et le type d&apos;accroche. Enregistrées tout de suite.</span>
      </Field>

      <Field label={`Idées de posts (${draft.ideas.length})`}>
        {draft.ideas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {draft.ideas.map((e) => (
              <span key={e.id} className="flex max-w-full items-center gap-1 rounded-full border border-line-strong bg-surface py-0.5 pr-1 pl-2.5 text-[12px] text-ink-2">
                <Lightbulb className="size-3 shrink-0 text-accent" />
                <span className="truncate">{e.text}</span>
                <button type="button" onClick={() => setDraft((d) => ({ ...d, ideas: d.ideas.filter((x) => x.id !== e.id) }))} aria-label={`Retirer l'idée ${e.text}`} className="press grid size-5 shrink-0 place-items-center rounded-full text-ink-3 hover:text-danger">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input aria-label="Nouvelle idée de post" value={idea} onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addIdea())} maxLength={MAX_IDEA} placeholder="Une idée de post, par ex. « 3 romantasy pour débuter »" className={cn(inputClass, "h-9 min-w-0 flex-1")} />
          <Button size="sm" className="h-9" type="button" disabled={!idea.trim() || draft.ideas.length >= MAX_IDEAS} onClick={addIdea}>
            <Plus className="size-3.5" />
            Ajouter
          </Button>
        </div>
        <span className="text-[11.5px] text-ink-3">Elles apparaissent dans Studio → Carrousel et photo, sous « Écrit par Claude ».</span>
      </Field>
    </div>
  );
}

const FONT_NAME = { serif: "Serif", sans: "Sans", grotesque: "Grotesque" } as const;

/** A charte (PDF, images, the website) read by Claude, turned into a look for this profile. */
function CharteImport({ project, draft, setDraft, fonts }: { project: Project; draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; fonts: Fonts | null }) {
  const reading = useProjectJob(project.id, (j) => j.kind === "brand" && j.brand?.mode === "charte");
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [withTone, setWithTone] = useState(false);
  const old = workerTooOld(reading.worker);
  const job = reading.job;
  const result = job?.status === "done" ? (job.brand?.result as CharteResult | undefined) : undefined;
  const failed = job && (job.status === "failed" || job.status === "cancelled") ? job : undefined;
  const proposed: Look | undefined = result ? { ...draft.look, ...result.look, logo: result.look.logo ?? draft.look.logo } : undefined;
  const slides = useMemo(() => [newSlide(project.name, "Le style tiré de ta charte."), newSlide("Suite", "")], [project.name]);

  const read = async () => {
    if (sending) return;
    setSending(true);
    try {
      await startReading(project.id, "charte", { files, url, text });
      setFiles([]);
      setUrl("");
      setText("");
      setOpen(false);
      reading.refresh();
    } catch (e) {
      toast.error("Lecture impossible", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };
  const apply = () => {
    if (!proposed || !job) return;
    setDraft((d) => ({ ...d, look: proposed, ...(withTone && result?.tone ? { tone: result.tone } : {}) }));
    reading.dismiss(job.id);
    toast.success("Charte appliquée au style", { description: "Vérifie l'aperçu, puis clique sur Enregistrer." });
  };

  if (job && reading.running) return <JobProgress job={job} worker={reading.worker} onCancel={() => reading.dismiss(job.id)} />;
  if (failed)
    return (
      <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[12.5px]">
        <p className="min-w-0 flex-1">Claude n&apos;a pas pu lire la charte{failed.error ? ` : ${failed.error}` : "."}</p>
        <Button size="sm" variant="ghost" onClick={() => reading.dismiss(failed.id)}>
          Fermer
        </Button>
      </div>
    );
  if (result && proposed && job)
    return (
      <div className="rise flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          <p className="min-w-0 flex-1 text-[13px] font-medium">Style tiré de la charte</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <div className="max-sm:mx-auto max-sm:w-32">
            <SlideCanvas deck={{ ...proposed, format: "4:5", slides, caption: "" }} index={0} fonts={fonts} className="rounded-lg shadow-[0_10px_24px_-12px_rgba(0,0,0,0.4)]" />
          </div>
          <div className="flex min-w-0 flex-col gap-2 text-[12.5px]">
            {result.colors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.colors.map((c) => (
                  <span key={c.hex} title={c.name ? `${c.name} ${c.hex}` : c.hex} className="flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pr-2 pl-0.5 text-[11px] text-ink-2">
                    <span className="size-4 rounded-full shadow-[0_0_0_1px_var(--line-strong)]" style={{ background: c.hex }} />
                    {c.name ?? c.hex}
                  </span>
                ))}
              </div>
            )}
            <p className="text-ink-2">
              Police : <span className="font-medium text-ink">{FONT_NAME[proposed.font]}</span>
              {result.fonts.length ? <span className="text-ink-3"> (la charte utilise {result.fonts.join(", ")})</span> : null}
              {result.look.logo ? " · logo récupéré" : ""}
            </p>
            {result.notes && <p className="leading-snug text-ink-3">{result.notes}</p>}
            {result.tone && (
              <label className="flex cursor-pointer items-start gap-2 text-ink-2">
                <input type="checkbox" checked={withTone} onChange={(e) => setWithTone(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                <span>
                  Prendre aussi le ton de la charte :<span className="block whitespace-pre-line text-ink-3">{result.tone}</span>
                </span>
              </label>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => reading.dismiss(job.id)}>
            Ignorer
          </Button>
          <Button size="sm" variant="primary" className="ml-auto" onClick={apply}>
            <Check className="size-3.5" />
            Appliquer au style
          </Button>
        </div>
      </div>
    );
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
        <Palette className="size-4 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">Une charte graphique ? Claude en tire les couleurs, la police et le logo.</p>
        <Button size="sm" onClick={() => setOpen(true)}>
          Importer une charte
        </Button>
        <Link href="/strategy" className="press inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink">
          <Compass className="size-3.5" />
          Stratégie
        </Link>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/40 p-3">
      <p className="text-[12.5px] text-ink-2">Dépose la charte (PDF, captures du brand book, fichier CSS) ou donne l&apos;adresse du site : Claude la lit sur ton Mac et propose le style. Rien ne change avant que tu l&apos;appliques.</p>
      <SourcePicker files={files} setFiles={setFiles} url={url} setUrl={setUrl} text={text} setText={setText} accept=".pdf,.css,.md,.txt,image/png,image/jpeg,image/webp" hint="PDF, images, CSS ou texte · 4 fichiers, 9 Mo chacun" onError={(m) => toast.error(m)} />
      {old && <OldWorkerNote />}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
        <Button size="sm" variant="primary" className="ml-auto" onClick={read} disabled={sending || old || (!files.length && !url.trim() && !text.trim())}>
          <Sparkles className="size-3.5" />
          {sending ? "Envoi…" : "Lire avec Claude"}
        </Button>
      </div>
    </div>
  );
}
