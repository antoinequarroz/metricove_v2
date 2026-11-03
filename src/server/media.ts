import "server-only";
import { addDays, setHours, startOfDay } from "date-fns";
import fs from "node:fs";
import path from "node:path";
import type { Media, MediaSource, Post, YouTubeOptions } from "@/lib/types";
import { DATA_DIR, insertMedia, listAccounts, savePost } from "./db";
import { aspectOf, probeMp4 } from "./mp4";

export const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v"]);

/**
 * Optional info sent with a video: as a JSON file next to it in the inbox
 * (video.mp4 + video.json), or as the "post" field of an upload.
 */
export type VideoMeta = {
  title?: string;
  caption?: string;
  /** Account ids, "@handle", or a network name ("instagram" = all its accounts). */
  accounts?: string[];
  /** ISO date. With accounts, the post is scheduled. Otherwise it is a draft. */
  scheduledAt?: string;
  status?: "draft" | "scheduled";
  youtube?: Partial<YouTubeOptions>;
  source?: MediaSource;
};

const mediaDir = () => path.join(DATA_DIR, "media");

function moveFile(from: string, to: string) {
  try {
    fs.renameSync(from, to);
  } catch {
    // Different disk (Docker volume): copy then delete.
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

function titleFromName(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Vidéo";
}

/** Moves a video into the library and creates its post when the meta asks for one. */
export function ingestVideo(file: string, originalName: string, meta: VideoMeta = {}): { media: Media; post?: Post } {
  const ext = path.extname(originalName).toLowerCase() || ".mp4";
  const id = crypto.randomUUID();
  fs.mkdirSync(mediaDir(), { recursive: true });
  const stored = `${id}${ext}`;
  moveFile(file, path.join(mediaDir(), stored));

  const info = probeMp4(path.join(mediaDir(), stored));
  const hue = Math.floor(Math.random() * 360);
  const media: Media = {
    id,
    title: (meta.title || titleFromName(originalName)).slice(0, 200),
    duration: Math.round(info?.duration ?? 0),
    aspect: aspectOf(info),
    source: meta.source ?? "claude-code",
    createdAt: new Date().toISOString(),
    hues: [hue, (hue + 70) % 360],
    url: `/api/media/${id}/file`,
  };
  insertMedia({ ...media, file: stored });

  const post = meta.caption !== undefined || meta.accounts?.length ? createPost(media, meta) : undefined;
  return { media, post };
}

function resolveAccounts(refs: string[] = []) {
  const accounts = listAccounts().filter((a) => a.connected);
  const ids = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim().toLowerCase();
    for (const a of accounts) {
      if (a.id.toLowerCase() === ref || `@${a.handle.toLowerCase()}` === ref || a.network === ref) ids.add(a.id);
    }
  }
  return [...ids];
}

function createPost(media: Media, meta: VideoMeta): Post {
  const accountIds = resolveAccounts(meta.accounts);
  const all = listAccounts();
  const hasYoutube = accountIds.some((id) => all.find((a) => a.id === id)?.network === "youtube");
  const when = meta.scheduledAt ? new Date(meta.scheduledAt) : null;
  const valid = when && !isNaN(when.getTime());
  const scheduled = (meta.status ?? (valid ? "scheduled" : "draft")) === "scheduled" && valid && accountIds.length > 0;
  const post: Post = {
    id: crypto.randomUUID(),
    accountIds,
    caption: meta.caption ?? "",
    mediaId: media.id,
    scheduledAt: (valid ? when : setHours(startOfDay(addDays(new Date(), 1)), 18)).toISOString(),
    status: scheduled ? "scheduled" : "draft",
    origin: media.source === "hermes" ? "hermes" : "claude-code",
    youtube: meta.youtube
      ? {
          title: (meta.youtube.title || media.title).slice(0, 100),
          format: meta.youtube.format === "short" ? "short" : "video",
          privacy: meta.youtube.privacy ?? "public",
        }
      : hasYoutube
        ? { title: media.title.slice(0, 100), format: media.aspect === "9:16" && media.duration <= 180 ? "short" : "video", privacy: "public" }
        : undefined,
  };
  // A draft with no account still shows up in the calendar under the first account.
  if (!post.accountIds.length) {
    const first = all.find((a) => a.connected);
    if (first) post.accountIds = [first.id];
  }
  if (post.accountIds.length) savePost(post);
  return post;
}

/* ---------- Inbox folder ---------- */

const seen = new Map<string, number>();

/**
 * Imports videos dropped in INBOX_DIR (Claude Code writes its renders there).
 * A file is taken once its size stops changing, so half-written files are left alone.
 */
export function scanInbox() {
  const dir = process.env.INBOX_DIR;
  if (!dir || !fs.existsSync(dir)) return [];
  const imported: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXT.has(ext) || name.startsWith(".")) continue;
    const file = path.join(dir, name);
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (seen.get(file) !== size) {
      seen.set(file, size);
      continue;
    }
    seen.delete(file);

    const sidecar = file.slice(0, -ext.length) + ".json";
    let meta: VideoMeta = {};
    if (fs.existsSync(sidecar)) {
      try {
        meta = JSON.parse(fs.readFileSync(sidecar, "utf8"));
      } catch (e) {
        console.error(`[inbox] JSON illisible pour ${name}:`, (e as Error).message);
      }
    }
    try {
      const { media, post } = ingestVideo(file, name, meta);
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      imported.push(media.id);
      console.log(`[inbox] ${name} importée${post ? ` (post ${post.status})` : ""}`);
    } catch (e) {
      console.error(`[inbox] import de ${name} impossible:`, (e as Error).message);
    }
  }
  return imported;
}
