"use client";

import { CalendarDays, Clapperboard, Users, BarChart3, Settings, Search, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { NETWORK_ORDER } from "@/lib/networks";
import { useProjectAccounts, useStore } from "@/lib/store";
import type { Account, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar, Kbd } from "./ui";
import { Logo } from "./logo";
import { Composer } from "./composer";
import { CommandMenu } from "./command-menu";
import { ProjectMark, ProjectSwitcher } from "./projects";

const NAV = [
  { href: "/calendar", label: "Calendrier", Icon: CalendarDays },
  { href: "/videos", label: "Vidéos", Icon: Clapperboard, countKey: "videos" as const },
  { href: "/accounts", label: "Comptes", Icon: Users },
  { href: "#", label: "Statistiques", Icon: BarChart3, soon: true },
  { href: "#", label: "Réglages", Icon: Settings, soon: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () =>
      useStore
        .getState()
        .load()
        .then(() => setError(""))
        .catch((e: Error) => setError(e.message));
    Promise.resolve(useStore.persist.rehydrate())
      .then(load)
      .finally(() => setReady(true));
    // Refresh statuses while the tab is visible (published, failed...).
    const id = setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, [contenteditable=true]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStore.getState().setCommandOpen(!useStore.getState().commandOpen);
      } else if (!typing && e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !useStore.getState().composer.open) {
        e.preventDefault();
        useStore.getState().openComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh min-h-0">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col p-2 pl-0 max-md:p-0">
        <MobileBar />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface/70 shadow-card backdrop-blur-xl max-md:rounded-none max-md:border-0">
          {error && !useStore.getState().loaded ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-[15px] font-medium">Impossible de charger les données</p>
              <p className="text-[13px] text-ink-3">{error}</p>
            </div>
          ) : ready ? (
            children
          ) : (
            <div className="flex-1" />
          )}
        </div>
      </main>
      {ready && (
        <>
          <Composer />
          <CommandMenu />
        </>
      )}
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "!rounded-xl !border-line-strong !bg-surface !text-ink !shadow-card !font-sans",
        }}
      />
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const accounts = useProjectAccounts();
  const projects = useStore((s) => s.projects);
  const activeProject = useStore((s) => s.activeProject);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const groups = groupAccounts(accounts, activeProject === "all" ? projects : []);
  const hidden = useStore((s) => s.hiddenAccounts).filter((id) => accounts.some((a) => a.id === id));
  const toggleAccount = useStore((s) => s.toggleAccount);
  const media = useStore((s) => s.media);
  const posts = useStore((s) => s.posts);
  const openComposer = useStore((s) => s.openComposer);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const publisher = useStore((s) => s.publisher);
  const integrations = useStore((s) => s.integrations);
  const unused = media.filter((m) => !posts.some((p) => p.mediaId === m.id)).length;

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-1 px-3 py-3 max-md:hidden">
      <div className="flex items-center gap-2 px-1.5 pb-3">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Metricove</span>
        <span className="ml-auto rounded-md border border-line px-1.5 py-px font-mono text-[10px] text-ink-3">v2</span>
      </div>

      <ProjectSwitcher />

      <div className="mb-2 flex gap-1.5">
        <button
          onClick={() => openComposer()}
          className="press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-medium text-accent-ink shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_6px_16px_-6px_var(--accent)] hover:brightness-[1.06]"
        >
          <Plus className="size-4" strokeWidth={2.4} />
          Nouveau post
          <span className="ml-1 rounded border border-white/30 px-1 font-mono text-[10px] leading-4 text-white/80">N</span>
        </button>
        <button
          onClick={() => setCommandOpen(true)}
          aria-label="Rechercher"
          className="press flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-2 shadow-card hover:text-ink"
        >
          <Search className="size-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-px">
        {NAV.map(({ href, label, Icon, soon, countKey }) => {
          const active = !soon && pathname.startsWith(href);
          return (
            <Link
              key={label}
              href={href}
              aria-disabled={soon}
              className={cn(
                "group flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors duration-150",
                active ? "bg-surface font-medium text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink",
                soon && "pointer-events-none opacity-55",
              )}
            >
              <Icon className={cn("size-4", active ? "text-accent" : "text-ink-3")} strokeWidth={2} />
              {label}
              {soon && <span className="ml-auto text-[10.5px] text-ink-3">Bientôt</span>}
              {countKey && unused > 0 && (
                <span className="tabular ml-auto rounded-full bg-accent-soft px-1.5 text-[11px] font-medium text-accent">{unused}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 flex items-center justify-between px-2 pb-1.5">
        <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Comptes</span>
        <span className="text-[11px] text-ink-3">{accounts.length - hidden.length}/{accounts.length}</span>
      </div>
      <div className="scroll-thin -mx-1 flex min-h-0 flex-col gap-px overflow-y-auto px-1">
        {groups.map((g) => (
          <div key={g.key} className={cn("flex flex-col gap-px", g.project !== undefined && "mb-2")}>
            {g.project !== undefined && (
              <button
                onClick={() => g.project && setActiveProject(g.project.id)}
                disabled={!g.project}
                title={g.project ? `Afficher seulement ${g.project.name}` : undefined}
                className="flex items-center gap-1.5 rounded-md px-2 pt-1 pb-0.5 text-left text-[11.5px] font-medium text-ink-2 enabled:hover:text-ink"
              >
                {g.project ? <ProjectMark project={g.project} size={14} /> : <span className="size-3.5 rounded-[4px] border border-dashed border-line-strong" />}
                <span className="truncate">{g.project?.name ?? "Sans projet"}</span>
                <span className="ml-auto text-[11px] font-normal text-ink-3">{g.accounts.length}</span>
              </button>
            )}
            {g.accounts.map((a) => {
              const off = hidden.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => toggleAccount(a.id)}
                  title={off ? "Afficher dans le calendrier" : "Masquer du calendrier"}
                  className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-ink/[0.04]"
                >
                  <Avatar account={a} size={26} dim={off} />
                  <span className={cn("min-w-0 flex-1 transition-opacity duration-150", off && "opacity-45")}>
                    <span className="block truncate text-[13px] leading-tight">{a.name}</span>
                    <span className="block truncate text-[11.5px] leading-tight text-ink-3">@{a.handle}</span>
                  </span>
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-[5px] border transition-colors duration-150",
                      off ? "border-line-strong" : "border-accent bg-accent text-white",
                    )}
                  >
                    {!off && (
                      <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M2.5 6.2 5 8.5l4.5-5" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-1.5 rounded-xl border border-line bg-surface/60 p-2.5">
        <Integration name={publisher.name === "demo" ? "Publication" : publisher.label} detail={publisher.ready ? (publisher.detail ?? "") : "À configurer"} ok={publisher.ready} warn={publisher.name === "demo"} />
        <Integration name="Hermes · treg" detail={integrations.hermes ? "antoine-vps" : "À configurer"} ok={integrations.hermes} />
        <Integration name="Claude Code" detail={integrations.inbox ? "Dossier surveillé" : "Envoi par API"} ok />
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <span>pour tout trouver</span>
        </div>
      </div>
    </aside>
  );
}

function MobileBar() {
  const pathname = usePathname();
  const openComposer = useStore((s) => s.openComposer);
  return (
    <div className="flex items-center gap-1 border-b border-line px-3 py-2 md:hidden">
      <Logo className="mr-1 size-6" />
      {NAV.filter((n) => !n.soon).map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          aria-label={label}
          className={cn("flex size-9 items-center justify-center rounded-lg", pathname.startsWith(href) ? "bg-surface text-accent shadow-card" : "text-ink-3")}
        >
          <Icon className="size-[18px]" />
        </Link>
      ))}
      <button onClick={() => openComposer()} aria-label="Nouveau post" className="press ml-auto flex size-9 items-center justify-center rounded-lg bg-accent text-accent-ink">
        <Plus className="size-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}

function Integration({ name, detail, ok, warn }: { name: string; detail: string; ok?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[12px]" title={detail}>
      <span className={cn("size-1.5 shrink-0 rounded-full", ok && !warn ? "bg-ok shadow-[0_0_0_3px_color-mix(in_oklab,var(--ok)_18%,transparent)]" : "bg-warn")} />
      <span className="shrink-0 font-medium">{name}</span>
      <span className="ml-auto truncate text-ink-3">{detail}</span>
    </div>
  );
}

const byNetwork = (a: Account, b: Account) => NETWORK_ORDER.indexOf(a.network) - NETWORK_ORDER.indexOf(b.network) || a.handle.localeCompare(b.handle);

/**
 * Sidebar groups: one per project, then the accounts in no project.
 * Without projects (or inside one project), a single group with no title.
 */
function groupAccounts(accounts: Account[], projects: Project[]) {
  const sorted = [...accounts].sort(byNetwork);
  if (!projects.length) return [{ key: "all", project: undefined as Project | null | undefined, accounts: sorted }];
  const groups: { key: string; project: Project | null | undefined; accounts: Account[] }[] = projects
    .map((p) => ({ key: p.id, project: p as Project | null, accounts: sorted.filter((a) => p.accountIds.includes(a.id)) }))
    .filter((g) => g.accounts.length);
  const loose = sorted.filter((a) => !projects.some((p) => p.accountIds.includes(a.id)));
  if (loose.length) groups.push({ key: "none", project: null, accounts: loose });
  return groups;
}
