import type { Account, Post, TargetResult } from "@/lib/types";

export type MediaFile = { id: string; title: string; kind: "video" | "image"; path?: string; mime: string; /** Seconds, 0 for a photo. */ duration?: number; /** Cover image on disk, when there is one. */ cover?: string };

export interface Publisher {
  name: "demo" | "postiz" | "treg";
  label: string;
  status(): { ready: boolean; detail?: string };
  /** Pulls the connected accounts from the service. Warnings name the accounts that could not be read. */
  syncAccounts?(): Promise<{ accounts: Account[]; warnings?: string[] }>;
  /**
   * Publishes one post on each of its accounts. Never throws: errors go in the results.
   * `items` holds every media of a carousel, in order (the first is also `media`).
   */
  publish(post: Post, accounts: Account[], media?: MediaFile, items?: MediaFile[]): Promise<Record<string, TargetResult>>;
}
