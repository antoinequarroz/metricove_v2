"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Account, AppState, Media, Network, Post } from "./types";

export type CalendarView = "month" | "week" | "list";

type ComposerState = { open: boolean; postId?: string; date?: string; mediaId?: string };

type State = {
  loaded: boolean;
  accounts: Account[];
  media: Media[];
  posts: Post[];
  publisher: AppState["publisher"];
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
  syncAccounts: () => Promise<number>;
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
      media: [],
      posts: [],
      publisher: { name: "demo", label: "Mode démo", ready: true },
      view: "month",
      cursor: new Date().toISOString(),
      hiddenAccounts: [],
      networkFilter: "all",
      composer: { open: false },
      commandOpen: false,

      load: async () => {
        const s = await api<AppState>("/api/state");
        set({ ...s, loaded: true });
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
      syncAccounts: async () => {
        const { count } = await api<{ count: number }>("/api/accounts/sync", { method: "POST" });
        await get().load();
        return count;
      },
    }),
    {
      name: "metricove-ui",
      version: 2,
      skipHydration: true,
      // Only view preferences live in the browser. Data comes from the server.
      partialize: (s) => ({ view: s.view, hiddenAccounts: s.hiddenAccounts }),
    },
  ),
);

/** Posts after the sidebar filters are applied. */
export function useVisiblePosts() {
  const posts = useStore((s) => s.posts);
  const accounts = useStore((s) => s.accounts);
  const hidden = useStore((s) => s.hiddenAccounts);
  const filter = useStore((s) => s.networkFilter);
  return posts.filter((p) => {
    const accs = p.accountIds.filter((id) => !hidden.includes(id));
    if (accs.length === 0) return false;
    if (filter === "all") return true;
    return accs.some((id) => accounts.find((a) => a.id === id)?.network === filter);
  });
}
