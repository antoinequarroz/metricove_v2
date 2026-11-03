"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { seedAccounts, seedMedia, seedPosts } from "./seed";
import type { Account, Media, Network, Post } from "./types";

export type CalendarView = "month" | "week" | "list";

type ComposerState = { open: boolean; postId?: string; date?: string; mediaId?: string };

type State = {
  accounts: Account[];
  media: Media[];
  posts: Post[];
  view: CalendarView;
  cursor: string;
  hiddenAccounts: string[];
  networkFilter: Network | "all";
  composer: ComposerState;
  commandOpen: boolean;

  setView: (v: CalendarView) => void;
  setCursor: (d: Date) => void;
  toggleAccount: (id: string) => void;
  setNetworkFilter: (n: Network | "all") => void;
  openComposer: (c?: Omit<ComposerState, "open">) => void;
  closeComposer: () => void;
  setCommandOpen: (o: boolean) => void;
  savePost: (post: Post) => void;
  deletePost: (id: string) => void;
  movePost: (id: string, dayISO: string) => void;
  resetDemo: () => void;
};

export const useStore = create<State>()(
  persist(
    (set) => ({
      accounts: seedAccounts,
      media: seedMedia(),
      posts: seedPosts(),
      view: "month",
      cursor: new Date().toISOString(),
      hiddenAccounts: [],
      networkFilter: "all",
      composer: { open: false },
      commandOpen: false,

      setView: (view) => set({ view }),
      setCursor: (d) => set({ cursor: d.toISOString() }),
      toggleAccount: (id) =>
        set((s) => ({
          hiddenAccounts: s.hiddenAccounts.includes(id)
            ? s.hiddenAccounts.filter((a) => a !== id)
            : [...s.hiddenAccounts, id],
        })),
      setNetworkFilter: (networkFilter) => set({ networkFilter }),
      openComposer: (c = {}) => set({ composer: { open: true, ...c }, commandOpen: false }),
      closeComposer: () => set((s) => ({ composer: { ...s.composer, open: false } })),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      savePost: (post) =>
        set((s) => {
          const exists = s.posts.some((p) => p.id === post.id);
          return { posts: exists ? s.posts.map((p) => (p.id === post.id ? post : p)) : [...s.posts, post] };
        }),
      deletePost: (id) => set((s) => ({ posts: s.posts.filter((p) => p.id !== id) })),
      movePost: (id, dayISO) =>
        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== id) return p;
            const from = new Date(p.scheduledAt);
            const to = new Date(dayISO);
            to.setHours(from.getHours(), from.getMinutes(), 0, 0);
            return { ...p, scheduledAt: to.toISOString() };
          }),
        })),
      resetDemo: () =>
        set({ accounts: seedAccounts, media: seedMedia(), posts: seedPosts(), hiddenAccounts: [], networkFilter: "all" }),
    }),
    {
      name: "metricove-demo",
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ posts: s.posts, media: s.media, view: s.view, hiddenAccounts: s.hiddenAccounts }),
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
