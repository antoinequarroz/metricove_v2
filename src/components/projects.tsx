"use client";

import { Popover } from "@base-ui-components/react/popover";
import { Check, ChevronsUpDown, FolderPlus, Layers, Pencil, Settings2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { NETWORK_ORDER } from "@/lib/networks";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar, AvatarStack, Button } from "./ui";

/** Square tile with the project's initials, in its own color. */
export function ProjectMark({ project, size = 28 }: { project?: Project; size?: number }) {
  if (!project)
    return (
      <span className="flex shrink-0 items-center justify-center rounded-lg bg-ink text-bg" style={{ width: size, height: size }}>
        <Layers style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
    );
  const initials = project.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(140deg, oklch(0.7 0.15 ${project.hue}), oklch(0.5 0.16 ${project.hue + 40}))`,
      }}
    >
      {initials}
    </span>
  );
}

/** Sidebar switcher: narrows the calendar and the account list to one project. */
export function ProjectSwitcher() {
  const projects = useStore((s) => s.projects);
  const accounts = useStore((s) => s.accounts);
  const active = useStore((s) => s.activeProject);
  const setActive = useStore((s) => s.setActiveProject);
  const [open, setOpen] = useState(false);
  const current = projects.find((p) => p.id === active);

  const pick = (id: string) => {
    setActive(id);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="press mb-2 flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface/70 px-2.5 py-2 text-left shadow-card hover:bg-surface">
        <ProjectMark project={current} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{current?.name ?? "Tous les projets"}</span>
          <span className="block text-[11.5px] text-ink-3">
            {current ? `${current.accountIds.length} compte${current.accountIds.length > 1 ? "s" : ""}` : `${accounts.length} comptes`}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 text-ink-3" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-[60]">
          <Popover.Popup className="popover-popup w-[232px] rounded-xl border border-line-strong bg-surface p-1 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] outline-none">
            <Row on={!current} onClick={() => pick("all")}>
              <ProjectMark size={22} />
              <span className="flex-1 truncate">Tous les projets</span>
            </Row>
            {projects.length > 0 && <div className="my-1 h-px bg-line" />}
            {projects.map((p) => (
              <Row key={p.id} on={p.id === active} onClick={() => pick(p.id)}>
                <ProjectMark project={p} size={22} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[11px] text-ink-3">{p.accountIds.length}</span>
              </Row>
            ))}
            <div className="my-1 h-px bg-line" />
            <Link
              href="/accounts#projets"
              onClick={() => setOpen(false)}
              className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-ink-2 hover:bg-ink/[0.04] hover:text-ink"
            >
              <Settings2 className="size-4 text-ink-3" />
              Gérer les projets
            </Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Row({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-ink/[0.04]", on && "font-medium")}>
      {children}
      <Check className={cn("size-3.5 text-accent", !on && "invisible")} />
    </button>
  );
}

/** Accounts page section: create, rename and fill projects. */
export function ProjectsSection() {
  const projects = useStore((s) => s.projects);
  const accounts = useStore((s) => s.accounts);
  const deleteProject = useStore((s) => s.deleteProject);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const remove = async (p: Project) => {
    if (!confirm(`Supprimer le projet « ${p.name} » ? Les comptes et les posts restent.`)) return;
    try {
      await deleteProject(p.id);
      toast.success("Projet supprimé");
    } catch (e) {
      toast.error("Suppression impossible", { description: (e as Error).message });
    }
  };

  return (
    <section id="projets" className="rise scroll-mt-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Projets</h2>
        <span className="text-[13px] text-ink-3">{projects.length}</span>
        {editing !== "new" && (
          <Button size="sm" className="ml-auto" onClick={() => setEditing("new")}>
            <FolderPlus className="size-3.5" />
            Nouveau projet
          </Button>
        )}
      </div>
      <p className="mb-3 text-[12.5px] text-ink-3">
        Regroupe tes comptes par projet, par exemple X, LinkedIn et Instagram pour l&apos;un, TikTok et Instagram pour l&apos;autre. Un compte peut être dans plusieurs projets.
      </p>
      <div className="flex flex-col gap-2">
        {editing === "new" && <ProjectEditor onDone={() => setEditing(null)} />}
        {projects.length === 0 && editing !== "new" && (
          <button
            onClick={() => setEditing("new")}
            className="flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-4 text-[13px] text-ink-3 hover:border-accent/50 hover:text-ink"
          >
            <FolderPlus className="size-4" /> Créer ton premier projet
          </button>
        )}
        {projects.map((p) =>
          editing === p.id ? (
            <ProjectEditor key={p.id} project={p} onDone={() => setEditing(null)} />
          ) : (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
              <ProjectMark project={p} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{p.name}</div>
                <div className="truncate text-[12px] text-ink-3">
                  {accounts
                    .filter((a) => p.accountIds.includes(a.id))
                    .map((a) => `@${a.handle}`)
                    .join(" · ") || "Aucun compte"}
                </div>
              </div>
              <AvatarStack accounts={accounts.filter((a) => p.accountIds.includes(a.id))} size={24} />
              <button
                onClick={() => setEditing(p.id)}
                aria-label={`Modifier ${p.name}`}
                className="press grid size-8 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={() => remove(p)}
                aria-label={`Supprimer ${p.name}`}
                className="press grid size-8 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function ProjectEditor({ project, onDone }: { project?: Project; onDone: () => void }) {
  const accounts = useStore((s) => s.accounts);
  const createProject = useStore((s) => s.createProject);
  const updateProject = useStore((s) => s.updateProject);
  const [name, setName] = useState(project?.name ?? "");
  const [ids, setIds] = useState<string[]>(project?.accountIds ?? []);
  const [busy, setBusy] = useState(false);
  const sorted = [...accounts].sort((a, b) => NETWORK_ORDER.indexOf(a.network) - NETWORK_ORDER.indexOf(b.network));

  const toggle = (id: string) => setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (project) await updateProject(project.id, { name, accountIds: ids });
      else await createProject({ name, accountIds: ids });
      toast.success(project ? "Projet enregistré" : "Projet créé", { description: name });
      onDone();
    } catch (err) {
      toast.error("Enregistrement impossible", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rise rounded-xl border border-accent/40 bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13.5px] font-semibold">{project ? "Modifier le projet" : "Nouveau projet"}</h3>
        <button type="button" onClick={onDone} aria-label="Fermer" className="press ml-auto grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2">
          <X className="size-4" />
        </button>
      </div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom du projet, par ex. LivreMatch"
        aria-label="Nom du projet"
        maxLength={60}
        className="mb-3 h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
      />
      <p className="mb-2 text-[12px] font-medium text-ink-2">Comptes du projet</p>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((a) => {
          const on = ids.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              aria-pressed={on}
              className={cn(
                "press flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[12.5px]",
                on ? "border-accent bg-accent-soft text-ink" : "border-line-strong bg-surface text-ink-2 hover:text-ink",
              )}
            >
              <Avatar account={a} size={22} dim={!on} />
              <span className="max-w-[160px] truncate">@{a.handle}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {project ? "Enregistrer" : "Créer le projet"}
        </Button>
      </div>
    </form>
  );
}
