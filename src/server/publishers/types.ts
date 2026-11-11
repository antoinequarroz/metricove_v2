import type { Account, AccountStats, Post, PostStat, TargetResult } from "@/lib/types";

export type MediaFile = { id: string; title: string; kind: "video" | "image"; path?: string; mime: string; /** Seconds, 0 for a photo. */ duration?: number; /** Cover image on disk, when there is one. */ cover?: string };

export interface Publisher {
  name: "demo" | "postiz" | "treg";
  label: string;
  status(): { ready: boolean; detail?: string };
  /** Pulls the connected accounts from the service. Warnings name the accounts that could not be read. */
  syncAccounts?(): Promise<{ accounts: Account[]; warnings?: string[] }>;
  /**
   * Reads followers, views, reach and the latest posts of each account. Never throws for one account:
   * a failure goes in that account's `error`. `paid` allows networks that charge per call (X).
   */
  fetchStats?(accounts: Account[], opts: { paid: boolean }): Promise<{ stats: AccountStats[]; posts: PostStat[]; warnings: string[] }>;
  /** Publishes one post on each of its accounts. Never throws: errors go in the results. */
  publish(post: Post, accounts: Account[], media?: MediaFile): Promise<Record<string, TargetResult>>;
}
