/** Shared types for AI video editing. The contract is in docs/MONTAGE.md. */

export type MontageFormat = "9:16" | "4:5" | "1:1" | "16:9";

export type Rush = {
  id: string;
  name: string;
  /** "mac": the file is on the Mac. "upload": it waits on the server for the Mac to fetch it. */
  origin: "mac" | "upload";
  size: number;
  /** Seconds, when known. */
  duration?: number;
  /** Path on the Mac. */
  path?: string;
  /** Small JPEG as a data URL. */
  thumb?: string;
  createdAt: string;
};

export type EdlWord = { t0: number; t1: number; w: string };

export type EdlSegment = {
  id: string;
  rush: string;
  in: number;
  out: number;
  text: string;
  kept: boolean;
  reason?: string;
  words?: EdlWord[];
};

export type Edl = {
  format: MontageFormat;
  segments: EdlSegment[];
  title?: { text: string; until: number } | null;
  endCard?: { text: string } | null;
  zooms?: { at: number; dur: number; scale: number }[];
  crop?: "face" | "center";
};

export type MontageVersion = {
  n: number;
  edl: Edl;
  notes?: string;
  /** True once the preview video is on the server. */
  preview: boolean;
  by: "claude" | "edit";
  createdAt: string;
};

export type JobStatus = "queued" | "working" | "review" | "rendering" | "done" | "failed" | "cancelled";
export type JobAction = null | "propose" | "preview" | "final" | "script" | "caption" | "cover";

/** What the Mac needs to write a post description, and what it wrote. */
export type CaptionRequest = {
  networks: string[];
  accounts: { network: string; handle: string }[];
  project?: string;
  /** What the user already typed: a draft or instructions. */
  draft?: string;
  mediaId?: string;
  youtube: boolean;
  result?: { caption: string; youtubeTitle?: string };
};

export type MontageJob = {
  id: string;
  kind: "montage" | "script" | "caption" | "cover";
  title: string;
  projectId?: string;
  status: JobStatus;
  action: JobAction;
  step?: string;
  progress?: number;
  error?: string;
  brief: { format: MontageFormat; seconds?: number; instructions?: string; hook?: string; cta?: string };
  script?: string;
  caption?: CaptionRequest;
  /** kind "cover": the video whose feed cover the Mac makes, then PUTs to /api/media/:id/cover. */
  cover?: { mediaId: string; project?: string; instructions?: string };
  rushIds: string[];
  feedback?: string;
  versions: MontageVersion[];
  approved?: number;
  mediaId?: string;
  createdAt: string;
  updatedAt: string;
};

export const FORMATS: { value: MontageFormat; label: string; hint: string }[] = [
  { value: "9:16", label: "9:16", hint: "Reel, TikTok, Short" },
  { value: "4:5", label: "4:5", hint: "Feed Instagram, LinkedIn" },
  { value: "1:1", label: "1:1", hint: "Carré" },
  { value: "16:9", label: "16:9", hint: "YouTube" },
];

/** Segments kept, in order, with their position on the output timeline. */
export function timeline(edl: Edl) {
  let t = 0;
  return edl.segments
    .filter((s) => s.kept)
    .map((s) => {
      const start = t;
      t += Math.max(0, s.out - s.in);
      return { ...s, start, end: t };
    });
}

export const edlDuration = (edl: Edl) => timeline(edl).at(-1)?.end ?? 0;
