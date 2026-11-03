"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Account, AppState, Media, Network, Post, Project } from "./types";

export type CalendarView = "month" | "week" | "list";

type ComposerState = { open: boolean; postId?: string; date?: string; mediaId?: string };

type State = {
  loaded: boolean;
  accounts: Account[];
  projects: Project[];
  /** Project the app is narrowed to, or "all". */
  activeProject: string;
  media: Media[];
  posts: Post[];
  publisher: AppState["publisher"];
  integrations: AppState["integrations"];
  view: CalendarView;
  cursor: string;
  hiddenAccounts: string[];
  networkFilter: Network | "all";
  composer: ComposerState;
  commandOpen: boolean;

  load: () => Promise<void>;
  setView: (v: CalendarView) => void;
  setCursor: (d: Date) => void;
  toggleAccount: (id: string) => void;
  setNetworkFilter: (n: Network | "all") => void;
  openComposer: (c?: Omit<ComposerState, "open">) => void;
  closeComposer: () => void;
  setCommandOpen: (o: boolean) => void;
  savePost: (post: Post) => Promise<Post>;
  deletePost: (id: string) => Promise<void>;
  movePost: (id: string, dayISO: string) => Promise<Post>;
  retryPost: (id: string) => Promise<void>;
  syncAccounts: () => Promise<{ count: number; warnings: string[] }>;
  addAccount: (a: { network: Network; name: string; handle: string }) => Promise<Account>;
  removeAccount: (id: string) => Promise<void>;
  setActiveProject: (id: string) => void;
  createProject: (p: { name: string; accountIds: string[] }) => Promise<Project>;
  updateProject: (id: string, p: Partial<Omit<Project, "id">>) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  uploadMedia: (file: File, onProgress?: (pct: number) => void) => Promise<Media>;
  deleteMedia: (id: string) => Promise<void>;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Session expirée");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data as T;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      loaded: false,
      accounts: [],
      projects: [],
      activeProject: "all",
      media: [],
      posts: [],
      publisher: { name: "demo", label: "Mode démo", ready: true },
      integrations: { hermes: false, inbox: false },
      view: "month",
      cursor: new Date().toISOString(),
      hiddenAccounts: [],
      networkFilter: "all",
      composer: { open: false },
      commandOpen: false,

      load: async () => {
        const s = await api<AppState>("/api/state");
        // Forget a project that was deleted elsewhere.
        const active = get().activeProject;
        set({ ...s, loaded: true, activeProject: s.projects.some((p) => p.id === active) ? active : "all" });
      },
      setView: (view) => set({ view }),
      setCursor: (d) => set({ cursor: d.toISOString() }),
      toggleAccount: (id) =>
        set((s) => ({
          hiddenAccounts: s.hiddenAccounts.includes(id) ? s.hiddenAccounts.filter((a) => a !== id) : [...s.hiddenAccounts, id],
        })),
      setNetworkFilter: (networkFilter) => set({ networkFilter }),
      openComposer: (c = {}) => set({ composer: { open: true, ...c }, commandOpen: false }),
      closeComposer: () => set((s) => ({ composer: { ...s.composer, open: false } })),
      setCommandOpen: (commandOpen) => set({ commandOpen }),

      savePost: async (post) => {
        const saved = await api<Post>("/api/posts", { method: "POST", body: JSON.stringify(post) });
        set((s) => ({ posts: s.posts.some((p) => p.id === saved.id) ? s.posts.map((p) => (p.id === saved.id ? saved : p)) : [...s.posts, saved] }));
        // The server may publish right away when the date is past.
        if (new Date(saved.scheduledAt) <= new Date()) setTimeout(() => get().load(), 1500);
        return saved;
      },
      deletePost: async (id) => {
        const before = get().posts;
        set({ posts: before.filter((p) => p.id !== id) });
        try {
          await api(`/api/posts/${id}`, { method: "DELETE" });
        } catch (e) {
          set({ posts: before });
          throw e;
        }
      },
      movePost: async (id, dayISO) => {
        const before = get().posts;
        const post = before.find((p) => p.id === id);
        if (!post) throw new Error("Post introuvable");
        const from = new Date(post.scheduledAt);
        const to = new Date(dayISO);
        to.setHours(from.getHours(), from.getMinutes(), 0, 0);
        const next = { ...post, scheduledAt: to.toISOString() };
        set({ posts: before.map((p) => (p.id === id ? next : p)) });
        try {
          return await api<Post>(`/api/posts/${id}`, { method: "PATCH", body: JSON.stringify({ scheduledAt: next.scheduledAt }) });
        } catch (e) {
          set({ posts: before });
          throw e;
        }
      },
      retryPost: async (id) => {
        await api(`/api/posts/${id}/retry`, { method: "POST" });
        set((s) => ({ posts: s.posts.map((p) => (p.id === id ? { ...p, status: "publishing" } : p)) }));
        setTimeout(() => get().load(), 2500);
      },
      uploadMedia: (file, onProgress) =>
        // XHR rather than fetch, to report upload progress.
        new Promise<Media>((resolve, reject) => {
          const form = new FormData();
          form.append("file", file);
          form.append("source", "upload");
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/media");
          xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
          xhr.onerror = () => reject(new Error("Connexion perdue pendant l'envoi"));
          xhr.onload = () => {
            let data: { media?: Media; error?: string } = {};
            try {
              data = JSON.parse(xhr.responseText);
            } catch {}
            if (xhr.status === 401) window.location.href = "/login";
            if (xhr.status >= 400 || !data.media) return reject(new Error(data.error ?? `Erreur ${xhr.status}`));
            set((s) => ({ media: [data.media!, ...s.media] }));
            resolve(data.media);
          };
          xhr.send(form);
        }),
      deleteMedia: async (id) => {
        await api(`/api/media/${id}`, { method: "DELETE" });
        set((s) => ({ media: s.media.filter((m) => m.id !== id) }));
      },
      addAccount: async (input) => {
        const { account } = await api<{ account: Account }>("/api/accounts", { method: "POST", body: JSON.stringify(input) });
        set((s) => ({ accounts: [...s.accounts, account] }));
        return account;
      },
      removeAccount: async (id) => {
        await api(`/api/accounts/${id}`, { method: "DELETE" });
        set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }));
      },
      setActiveProject: (activeProject) => set({ activeProject }),
      createProject: async (input) => {
        const { project } = await api<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify(input) });
        set((s) => ({ projects: [...s.projects, project] }));
        return project;
      },
      updateProject: async (id, input) => {
        const { project } = await api<{ project: Project }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) });
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? project : p)) }));
        return project;
      },
      deleteProject: async (id) => {
        await api(`/api/projects/${id}`, { method: "DELETE" });
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id), activeProject: s.activeProject === id ? "all" : s.activeProject }));
      },
      syncAccounts: async () => {
        const r = await api<{ count: number; warnings?: string[] }>("/api/accounts/sync", { method: "POST" });
        await get().load();
        return { count: r.count, warnings: r.warnings ?? [] };
      },
    }),
    {
      name: "metricove-ui",
      version: 2,
      skipHydration: true,
      // Only view preferences live in the browser. Data comes from the server.
      partialize: (s) => ({ view: s.view, hiddenAccounts: s.hiddenAccounts, activeProject: s.activeProject }),
    },
  ),
);

/** Accounts of the active project, or all accounts. */
export function useProjectAccounts() {
  const accounts = useStore((s) => s.accounts);
  const projects = useStore((s) => s.projects);
  const active = useStore((s) => s.activeProject);
  const project = projects.find((p) => p.id === active);
  return project ? accounts.filter((a) => project.accountIds.includes(a.id)) : accounts;
}

/** Posts after the project and sidebar filters are applied. */
export function useVisiblePosts() {
  const posts = useStore((s) => s.posts);
  const accounts = useStore((s) => s.accounts);
  const hidden = useStore((s) => s.hiddenAccounts);
  const filter = useStore((s) => s.networkFilter);
  const scope = useProjectAccounts();
  return posts.filter((p) => {
    const accs = p.accountIds.filter((id) => !hidden.includes(id) && scope.some((a) => a.id === id));
    if (accs.length === 0) return false;
    if (filter === "all") return true;
    return accs.some((id) => accounts.find((a) => a.id === id)?.network === filter);
  });
}
