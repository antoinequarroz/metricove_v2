import type { Account, Post, TargetResult } from "@/lib/types";

export type MediaFile = { id: string; title: string; path?: string; mime: string };

export interface Publisher {
  name: "demo" | "postiz" | "treg";
  label: string;
  status(): { ready: boolean; detail?: string };
  /** Pulls the connected accounts from the service. */
  syncAccounts?(): Promise<Account[]>;
  /** Publishes one post on each of its accounts. Never throws: errors go in the results. */
  publish(post: Post, accounts: Account[], media?: MediaFile): Promise<Record<string, TargetResult>>;
}
