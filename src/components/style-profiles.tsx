"use client";

import { ChevronDown, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type Look, MAX_SKILL, MAX_TONE, PRESETS, presetOf, sameLook, type StyleProfile } from "@/lib/profiles";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { useProfiles } from "@/lib/use-profiles";
import { cn } from "@/lib/utils";
import { appFonts, type Deck, type Fonts, loadFonts, newSlide } from "@/lib/visuals";
import { Field, inputClass, LookControls, SlideCanvas } from "./montage/look-parts";
import { Button } from "./ui";

/** The style profile of each project: the look of its visuals and the voice Claude writes in. */
export function StyleProfiles() {
  const projects = useStore((s) => s.projects);
  const loaded = useStore((s) => s.loaded);
  const { profiles, error, reload, save } = useProfiles();
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
            <ProfileCard project={project} profile={profile} fonts={fonts} open={open === project.id} onToggle={() => setOpen((o) => (o === project.id ? null : project.id))} save={save} />
          </div>
        );
      })}
    </>
  );
}

type Draft = { preset: StyleProfile["preset"]; look: Look; tone: string; skill: string };
const draftOf = (p: StyleProfile): Draft => ({ preset: p.preset, look: p.look, tone: p.tone, skill: p.skill });

function ProfileCard({ project, profile, fonts, open, onToggle, save }: { project: Project; profile: StyleProfile; fonts: Fonts | null; open: boolean; onToggle: () => void; save: ReturnType<typeof useProfiles>["save"] }) {
  const accounts = useStore((s) => s.accounts);
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
  const [busy, setBusy] = useState(false);
  const [starter, setStarter] = useState(profile.preset);
  const dirty = !sameLook(draft.look, profile.look) || draft.tone.trim() !== profile.tone.trim() || draft.skill.trim() !== profile.skill;
  // What the server holds changed (saved from the Studio): follow it, unless something is being edited here.
  const shown = useRef(profile);
  useEffect(() => {
    const before = shown.current;
    shown.current = profile;
    setDraft((d) => (sameLook(d.look, before.look) && d.tone.trim() === before.tone.trim() && d.skill.trim() === before.skill ? draftOf(profile) : d));
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
      const saved = await save(project.id, { preset: draft.preset, look: { ...draft.look, logo: draft.look.logo ?? "" }, tone: draft.tone, skill: draft.skill });
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
    setDraft((d) => ({ preset: p.id, look: { ...p.look, handle: d.look.handle, logo: d.look.logo }, tone: p.tone, skill: d.skill }));
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
