import "server-only";
import { addDays, setHours, startOfDay } from "date-fns";
import fs from "node:fs";
import path from "node:path";
import { postProblems } from "@/lib/formats";
import type { Media, MediaSource, Network, Post, PostFormat, YouTubeOptions } from "@/lib/types";
import { DATA_DIR, insertMedia, listAccounts, savePost } from "./db";
import { IMAGE_EXT, probeImage } from "./image";
import { aspectOf, probeMp4 } from "./mp4";

export const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v"]);
export { IMAGE_EXT };
/** Every file type the library takes. */
export const isMediaFile = (name: string) => VIDEO_EXT.has(path.extname(name).toLowerCase()) || IMAGE_EXT.has(path.extname(name).toLowerCase());
export const MEDIA_FORMATS = "Formats acceptés : mp4, mov, m4v pour les vidéos, jpg et png pour les photos";
/** Instagram refuses photos over 8 MB. */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** A file the library can't take, with a message for the person. */
export class MediaError extends Error {
  constructor(
    message: string,
    public status = 415,
  ) {
    super(message);
  }
}

/**
 * Optional info sent with a video: as a JSON file next to it in the inbox
 * (video.mp4 + video.json), or as the "post" field of an upload.
 */
export type VideoMeta = {
  title?: string;
  caption?: string;
  /** Account ids, "@handle", or a network name ("instagram" = all its accounts). */
  accounts?: string[];
  /** "story" for an Instagram or Facebook story. The feed by default. */
  format?: PostFormat;
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

function titleFromName(name: string, fallback = "Vidéo") {
  const base = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : fallback;
}

/** Moves a video or a photo into the library, by its file type. */
export function ingestMedia(file: string, originalName: string, meta: VideoMeta = {}): { media: Media; post?: Post } {
  return IMAGE_EXT.has(path.extname(originalName).toLowerCase()) ? ingestImage(file, originalName, meta) : ingestVideo(file, originalName, meta);
}

/** Moves a photo into the library and creates its post when the meta asks for one. */
export function ingestImage(file: string, originalName: string, meta: VideoMeta = {}): { media: Media; post?: Post } {
  // The real format, not the name the sender gave.
  const info = probeImage(file);
  if (!info) throw new MediaError("Photo illisible : envoyez un JPEG ou un PNG");
  if (fs.statSync(file).size > IMAGE_MAX_BYTES) throw new MediaError("Photo trop lourde (8 Mo au plus)", 413);
  const id = crypto.randomUUID();
  fs.mkdirSync(mediaDir(), { recursive: true });
  const stored = `${id}${info.type === "png" ? ".png" : ".jpg"}`;
  moveFile(file, path.join(mediaDir(), stored));

  const hue = Math.floor(Math.random() * 360);
  const media: Media = {
    id,
    title: (meta.title || titleFromName(originalName, "Photo")).slice(0, 200),
    kind: "image",
    width: info.width,
    height: info.height,
    duration: 0,
    mime: info.type === "png" ? "image/png" : "image/jpeg",
    aspect: aspectOf({ duration: 0, width: info.width, height: info.height }),
    source: meta.source ?? "claude-code",
    createdAt: new Date().toISOString(),
    hues: [hue, (hue + 70) % 360],
    url: `/api/media/${id}/file`,
  };
  insertMedia({ ...media, file: stored });

  const post = meta.caption !== undefined || meta.accounts?.length ? createPost(media, meta) : undefined;
  return { media, post };
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
    kind: "video",
    width: info?.width || undefined,
    height: info?.height || undefined,
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
  const hasYoutube = media.kind === "video" && accountIds.some((id) => all.find((a) => a.id === id)?.network === "youtube");
  const when = meta.scheduledAt ? new Date(meta.scheduledAt) : null;
  const valid = when && !isNaN(when.getTime());
  const format: PostFormat | undefined = meta.format === "story" ? "story" : undefined;
  const networks = [...new Set(accountIds.map((id) => all.find((a) => a.id === id)?.network).filter((n) => !!n))] as Network[];
  // A post the networks would refuse stays a draft, so it is fixed in the editor instead of failing later.
  const fine = postProblems({ format, media, networks }).length === 0;
  const scheduled = (meta.status ?? (valid ? "scheduled" : "draft")) === "scheduled" && valid && accountIds.length > 0 && fine;
  const post: Post = {
    id: crypto.randomUUID(),
    accountIds,
    caption: meta.caption ?? "",
    mediaId: media.id,
    format,
    scheduledAt: (valid ? when : setHours(startOfDay(addDays(new Date(), 1)), 18)).toISOString(),
    status: scheduled ? "scheduled" : "draft",
    origin: media.source === "hermes" ? "hermes" : "claude-code",
    youtube: meta.youtube && media.kind === "video"
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
 * Imports videos and photos dropped in INBOX_DIR (Claude Code writes its renders there).
 * A file is taken once its size stops changing, so half-written files are left alone.
 */
export function scanInbox() {
  const dir = process.env.INBOX_DIR;
  if (!dir || !fs.existsSync(dir)) return [];
  const imported: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase();
    if (!isMediaFile(name) || name.startsWith(".")) continue;
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

    const base = file.slice(0, -ext.length);
    const sidecar = base + ".json";
    // teaser.mp4 + teaser.jpg + teaser.json: the JSON describes the video, not its picture.
    const sidecarIsForVideo = IMAGE_EXT.has(ext) && [...VIDEO_EXT].some((v) => fs.existsSync(base + v));
    let meta: VideoMeta = {};
    if (!sidecarIsForVideo && fs.existsSync(sidecar)) {
      try {
        meta = JSON.parse(fs.readFileSync(sidecar, "utf8"));
      } catch (e) {
        console.error(`[inbox] JSON illisible pour ${name}:`, (e as Error).message);
      }
    }
    try {
      const { media, post } = ingestMedia(file, name, meta);
      if (!sidecarIsForVideo && fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      imported.push(media.id);
      console.log(`[inbox] ${name} importée${post ? ` (post ${post.status})` : ""}`);
    } catch (e) {
      console.error(`[inbox] import de ${name} impossible:`, (e as Error).message);
      // A file the library refuses (unreadable or too heavy photo) is set aside, not retried forever.
      if (e instanceof MediaError) {
        try {
          fs.renameSync(file, `${file}.refuse`);
        } catch {
          // Read-only folder: it will be tried again.
        }
      }
    }
  }
  return imported;
}
