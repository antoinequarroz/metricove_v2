"use client";

import { Copy, Loader2, Plus, Star, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { styleRef, type LibraryItem } from "@/lib/library";
import { DEFAULT_STYLE, MAX_STYLE_NAME, MAX_STYLES, noteLines, type StyleProfile } from "@/lib/profiles";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { fileUrl, useLibrary } from "@/lib/use-library";
import { useProfiles } from "@/lib/use-profiles";
import { cn } from "@/lib/utils";
import { appFonts, type Fonts, loadFonts, newSlide } from "@/lib/visuals";
import { inputClass, SlideCanvas } from "../montage/look-parts";
import { StyleEditor } from "../style-profiles";
import { Button } from "../ui";
import { ResourceShell } from "./shell";

const FONT_NAME = { serif: "Serif", sans: "Sans", grotesque: "Bricolage Grotesque" } as const;

type Pick = { projectId: string; styleId: string } | null;

/** Médias → Ressources → Styles: the styles of every project as cards, the one picked opens below its project. */
export function StylesBoard() {
  const projects = useStore((s) => s.projects);
  const loaded = useStore((s) => s.loaded);
  const activeProject = useStore((s) => s.activeProject);
  const hooks = useProfiles();
  const { styles, error, reload } = hooks;
  const { items } = useLibrary();
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [picked, setPicked] = useState<Pick>(null);

  useEffect(() => {
    const f = appFonts();
    loadFonts(f).then(() => setFonts(f));
  }, []);
  // A project made in another page since the styles were read.
  const missing = projects.some((p) => styles && !styles[p.id]);
  useEffect(() => {
    if (missing) reload();
  }, [missing, reload]);

  const shown = activeProject === "all" ? projects : projects.filter((p) => p.id === activeProject);
  const total = styles ? shown.reduce((n, p) => n + (styles[p.id]?.length ?? 0), 0) : 0;

  return (
    <ResourceShell
      intro={
        <>
          Un style par défaut par projet, et d&apos;autres pour tes formats (podcast, clips, explications…). Chaque style garde ses couleurs, sa police, le ton de Claude, ses <b className="font-medium text-ink-2">notes</b> (les règles apprises en relisant tes vidéos), ses illustrations et ses bruitages.
          {styles ? ` ${total} style${total > 1 ? "s" : ""}.` : ""}
        </>
      }
    >
      {error && !styles ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-[13px]">
          <span className="size-2 shrink-0 rounded-full bg-warn" />
          <p className="min-w-0 flex-1">Styles illisibles : {error}</p>
          <Button size="sm" onClick={reload}>
            Réessayer
          </Button>
        </div>
      ) : !loaded || !styles ? (
        <p className="text-[13px] text-ink-3">Lecture des styles…</p>
      ) : !projects.length ? (
        <p className="text-[13px] text-ink-3">Crée d&apos;abord un projet (menu des projets, en haut à gauche) : chaque projet a ses styles.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {shown.map((project) => (
            <ProjectStyles
              key={project.id}
              project={project}
              list={styles[project.id] ?? []}
              items={items ?? []}
              fonts={fonts}
              hooks={hooks}
              picked={picked?.projectId === project.id ? picked.styleId : undefined}
              onPick={(styleId) => setPicked((p) => (!styleId || (p?.projectId === project.id && p.styleId === styleId) ? null : { projectId: project.id, styleId }))}
            />
          ))}
        </div>
      )}
    </ResourceShell>
  );
}

function ProjectStyles({
  project,
  list,
  items,
  fonts,
  hooks,
  picked,
  onPick,
}: {
  project: Project;
  list: StyleProfile[];
  items: LibraryItem[];
  fonts: Fonts | null;
  hooks: ReturnType<typeof useProfiles>;
  picked?: string;
  onPick: (styleId: string | undefined) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(DEFAULT_STYLE);
  const [busy, setBusy] = useState(false);
  const open = list.find((s) => s.id === picked);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const made = await hooks.createStyle(project.id, name.trim(), from);
      setAdding(false);
      setName("");
      onPick(made.id);
      toast.success(`Style « ${made.name} » créé`, { description: "Copié de l'autre style : change ce qui doit l'être, puis enregistre." });
    } catch (err) {
      toast.error("Style non créé", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const run = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
    } catch (err) {
      toast.error(what, { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rise">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold">{project.name}</h2>
        <span className="text-[12px] text-ink-3">
          {list.length} style{list.length > 1 ? "s" : ""}
        </span>
        {list.length < MAX_STYLES && !adding && (
          <Button size="sm" className="ml-auto" onClick={() => (setAdding(true), setFrom(picked ?? DEFAULT_STYLE))}>
            <Plus className="size-3.5" />
            Nouveau style
          </Button>
        )}
      </div>
      {adding && (
        <form onSubmit={create} className="rise mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/50 p-2.5">
          <input autoFocus aria-label="Nom du nouveau style" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_STYLE_NAME} placeholder="Nom, par ex. Podcast" className={cn(inputClass, "h-9 w-56 max-sm:w-full")} />
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            copié de
            <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Copié de" className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-accent/60">
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setAdding(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" size="sm" className="h-9" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Créer
            </Button>
          </div>
        </form>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {list.map((s) => (
          <StyleCard key={s.id} project={project} style={s} items={items} fonts={fonts} on={s.id === picked} onClick={() => onPick(s.id)} />
        ))}
      </div>
      {open && (
        <div className="rise mt-3 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
              {open.name}
              {open.id === DEFAULT_STYLE && <span className="ml-2 text-[12px] font-normal text-ink-3">style par défaut de {project.name}</span>}
            </p>
            <button type="button" onClick={() => onPick(undefined)} aria-label="Fermer" className="press grid size-7 place-items-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
          <StyleEditor
            key={`${project.id}:${open.id}`}
            project={project}
            profile={open}
            fonts={fonts}
            hooks={hooks}
            actions={
              <>
                {open.id !== DEFAULT_STYLE && (
                  <Button size="sm" className="h-9" disabled={busy} onClick={() => run("Style non changé", () => hooks.makeDefault(project.id, open.id).then(() => onPick(DEFAULT_STYLE)), `« ${open.name} » est le style par défaut`)}>
                    <Star className="size-3.5" />
                    Par défaut
                  </Button>
                )}
                {list.length < MAX_STYLES && (
                  <Button size="sm" className="h-9" disabled={busy} onClick={() => run("Style non copié", () => hooks.createStyle(project.id, `${open.name} (copie)`.slice(0, MAX_STYLE_NAME), open.id).then((m) => onPick(m.id)), "Copie créée")}>
                    <Copy className="size-3.5" />
                    Dupliquer
                  </Button>
                )}
                {open.id === DEFAULT_STYLE ? (
                  open.saved && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9"
                      disabled={busy}
                      onClick={() => confirm(`Remettre « ${open.name} » au style de départ ? Ses notes, son ton et ses références sont perdus.`) && run("Style non remis", () => hooks.reset(project.id), "Style de départ remis")}
                    >
                      <Undo2 className="size-3.5" />
                      Style de départ
                    </Button>
                  )
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 hover:text-danger"
                    disabled={busy}
                    onClick={() => confirm(`Supprimer le style « ${open.name} » ? Ses illustrations et bruitages restent dans les bibliothèques.`) && run("Style non supprimé", () => hooks.removeStyle(project.id, open.id).then(() => onPick(undefined)), "Style supprimé")}
                  >
                    <Trash2 className="size-3.5" />
                    Supprimer
                  </Button>
                )}
              </>
            }
          />
        </div>
      )}
    </section>
  );
}

/** One style at a glance: colors, font, how many notes, illustrations and sound effects, a few illustrations. */
function StyleCard({ project, style, items, fonts, on, onClick }: { project: Project; style: StyleProfile; items: LibraryItem[]; fonts: Fonts | null; on: boolean; onClick: () => void }) {
  const ref = styleRef(project.id, style.id);
  const mine = items.filter((i) => i.styles.includes(ref));
  const pictures = mine.filter((i) => i.kind === "illustration");
  const sounds = mine.filter((i) => i.kind === "sfx").length;
  const rules = noteLines(style.notes).length;
  const { look } = style;
  const colors = [...new Set([look.accent, ...(look.theme === "custom" ? look.fields.flatMap((f) => [f.bg, f.ink]) : [])].map((c) => c.toLowerCase()))].slice(0, 6);
  const slides = useMemo(() => [newSlide(style.name, ""), newSlide("", "")], [style.name]);
  const blurb = (noteLines(style.notes)[0] ?? style.tone.split("\n")[0] ?? "").trim();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={on}
      className={cn(
        "press flex min-w-0 flex-col gap-2.5 rounded-xl border bg-surface p-3.5 text-left shadow-card outline-none transition-[border-color,box-shadow] duration-150 hover:border-ink-3/40 focus-visible:ring-2 focus-visible:ring-accent/50",
        on ? "border-accent/60 shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[14px] font-semibold">{style.name}</span>
        {style.id === DEFAULT_STYLE && <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-medium text-accent">par défaut</span>}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-3">
        <span className="flex -space-x-1">
          {colors.map((c) => (
            <span key={c} title={c} className="size-3.5 rounded-full shadow-[0_0_0_1.5px_var(--surface),0_0_0_2.5px_var(--line-strong)]" style={{ background: c }} />
          ))}
        </span>
        <span>{FONT_NAME[look.font]}</span>
        <span>
          {rules} note{rules > 1 ? "s" : ""}
        </span>
      </span>
      <span className="text-[11.5px] text-ink-3">
        {pictures.length} illustration{pictures.length > 1 ? "s" : ""} · {sounds} bruitage{sounds > 1 ? "s" : ""}
        {style.skill ? " · skill" : ""}
      </span>
      <span className="line-clamp-2 min-h-[2.5em] text-[12px] leading-snug text-ink-2">{blurb || "Pas encore de notes : ajoute les règles de ce style."}</span>
      <span className="grid grid-cols-4 gap-1.5">
        <span className="aspect-square overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line-strong)]">
          <SlideCanvas deck={{ ...look, format: "1:1", slides, caption: "" }} index={0} fonts={fonts} small />
        </span>
        {[0, 1, 2].map((i) =>
          pictures[i] ? (
            <span key={pictures[i].id} className="grid aspect-square place-items-center overflow-hidden rounded-md bg-surface-2 shadow-[0_0_0_1px_var(--line)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(pictures[i])} alt={pictures[i].name} loading="lazy" className="size-full object-contain p-1" />
            </span>
          ) : (
            <span key={i} className="aspect-square rounded-md border border-dashed border-line" />
          ),
        )}
      </span>
    </button>
  );
}
