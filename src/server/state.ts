import "server-only";
import type { AppState } from "@/lib/types";
import { listAccounts, listMedia, listPosts } from "./db";
import { getPublisher } from "./publishers";

export function getState(): AppState {
  const p = getPublisher();
  return { accounts: listAccounts(), media: listMedia(), posts: listPosts(), publisher: { name: p.name, label: p.label, ...p.status() } };
}
