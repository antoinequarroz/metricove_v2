import "server-only";
import path from "node:path";
import { claimDuePosts, DATA_DIR, getMediaRow, listAccounts, releaseStuckPosts, savePost } from "./db";
import { scanInbox } from "./media";
import { refreshStatsIfStale } from "./stats";
import { getPublisher } from "./publishers";
import type { MediaFile } from "./publishers/types";
import { mimeOfFile } from "@/lib/formats";
import type { Post } from "@/lib/types";

const g = globalThis as unknown as { __metricoveTimer?: NodeJS.Timeout; __metricoveBusy?: boolean; __metricoveAgain?: boolean };

/** Publishes every post whose time has come. Safe to call often. */
export async function tick() {
  // A tick asked while another runs is not lost: it runs right after.
  if (g.__metricoveBusy) {
    g.__metricoveAgain = true;
    return;
  }
  g.__metricoveBusy = true;
  try {
    releaseStuckPosts();
    scanInbox();
    do {
      g.__metricoveAgain = false;
      for (const post of claimDuePosts()) await publishOne(post);
    } while (g.__metricoveAgain);
    refreshStatsIfStale();
  } catch (e) {
    console.error("[scheduler]", e);
  } finally {
    g.__metricoveBusy = false;
  }
}

async function publishOne(post: Post) {
  const publisher = getPublisher();
  const accounts = listAccounts().filter((a) => post.accountIds.includes(a.id));
  const fileOf = (id: string): MediaFile | undefined => {
    const row = getMediaRow(id);
    return row
      ? {
          id: row.id,
          title: row.file ?? row.title,
          kind: row.kind === "image" ? "image" : "video",
          duration: row.duration,
          path: row.file ? path.join(DATA_DIR, "media", row.file) : undefined,
          mime: mimeOfFile(row.file) ?? "video/mp4",
          cover: row.cover ? path.join(DATA_DIR, "media", row.cover) : undefined,
        }
      : undefined;
  };
  const media = post.mediaId ? fileOf(post.mediaId) : undefined;
  // A carousel: every media in order. A missing one stops the publication rather than posting fewer.
  const items = post.mediaIds && post.mediaIds.length > 1 ? post.mediaIds.map(fileOf) : undefined;
  if (items?.some((f) => !f?.path)) {
    savePost({ ...post, status: "failed", error: "Une photo ou une vidéo du carrousel a été supprimée de la bibliothèque." });
    return;
  }

  // Only accounts not already published, so a retry never posts twice.
  const pending = accounts.filter((a) => post.results?.[a.id]?.status !== "published");
  const results = { ...post.results, ...(await publisher.publish(post, pending, media, items as MediaFile[] | undefined)) };
  const failed = Object.entries(results).filter(([, r]) => r.status === "failed");

  savePost({
    ...post,
    results,
    status: failed.length ? "failed" : "published",
    error: failed.length ? failed.map(([id, r]) => `${accounts.find((a) => a.id === id)?.handle ?? id} : ${r.error}`).join("\n") : undefined,
  });
  console.log(`[scheduler] post ${post.id} → ${failed.length ? "échec" : "publié"} via ${publisher.name}`);
}

export function startScheduler(intervalMs = 15_000) {
  if (g.__metricoveTimer) return;
  g.__metricoveTimer = setInterval(tick, intervalMs);
  setTimeout(tick, 2_000);
  console.log(`[scheduler] démarré (${getPublisher().label}, toutes les ${intervalMs / 1000}s)`);
}
