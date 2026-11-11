import type { Look } from "./profiles";
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

export type EdlWord = {
  t0: number;
  t1: number;
  w: string;
  /** Cut from the video ("euh", stutter). The sentence around it stays. */
  cut?: boolean;
  /** Keyword: shown in the highlight color. */
  hl?: boolean;
  /** Emoji shown next to the subtitle while this word is spoken. */
  emoji?: string;
};

export type CaptionPosition = "auto" | "top" | "middle" | "bottom";
export type CaptionStyle = {
  /** Off: no subtitles burnt in. */
  on: boolean;
  /** "auto": above or below the face, wherever it does not cover it. */
  position: CaptionPosition;
  /** karaoke = the spoken word lights up; pop = word by word; simple = whole line. */
  look: "karaoke" | "pop" | "simple";
  size: "s" | "m" | "l";
  /** Color of keywords and of the spoken word (hex). Empty = project accent. */
  highlight?: string;
  /** Claude may add an emoji now and then. */
  emoji: boolean;
};

export type AudioSettings = {
  /** Background noise removal on the voice. */
  denoise: boolean;
  /** Silences between words: keep, shorten, or remove. */
  silences: "keep" | "tight" | "cut";
  /** Background music that ducks under the voice. `track`: file name in the Mac music folder, empty = Claude picks. */
  music: { on: boolean; track?: string; volume: number; duck: boolean };
};

/** Illustration shot over the speaker (the voice keeps going). Times are timeline seconds. */
export type Broll = {
  at: number;
  dur: number;
  /** What the shot should show, in a few words (used to search). */
  query: string;
  /** Where the shot comes from, once the Mac found it. */
  source?: "mine" | "pexels";
  /** File name in the Mac B-roll folder, or Pexels video id. */
  ref?: string;
  /** Small JPEG data URL of the shot. */
  thumb?: string;
  /** full: replaces the picture; pip: small window, the speaker stays visible. */
  mode: "full" | "pip";
};

/** A precise change request drawn on the video. */
export type MontageMark = {
  id: string;
  /** Version the drawing was made on, and its timeline second. */
  version: number;
  t: number;
  text: string;
  /** JPEG data URL: the frame with the drawing on it. */
  image?: string;
};

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
  /** Other hooks Claude proposed. `title.text` is the one used. */
  hooks?: string[];
  captions?: CaptionStyle;
  audio?: AudioSettings;
  /** More formats to render with the final video (same edit, reframed). */
  exports?: MontageFormat[];
  broll?: Broll[];
  /** Claude adds B-roll where it helps (your shots first, then Pexels). */
  brollAuto?: boolean;
};

export const DEFAULT_CAPTIONS: CaptionStyle = { on: true, position: "auto", look: "karaoke", size: "m", emoji: true };
export const DEFAULT_AUDIO: AudioSettings = { denoise: true, silences: "tight", music: { on: false, volume: 0.15, duck: true } };

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
export type JobAction = null | "propose" | "preview" | "final" | "script" | "caption" | "cover" | "post" | "motion";

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

/** A post asked from Claude in the Studio: the texts of each slide, and the description. */
export type PostRequest = {
  idea: string;
  /** How many slides Claude writes: 1 for a single image, up to 10 for a carousel. */
  slides: number;
  networks: string[];
  accounts: { network: string; handle: string }[];
  project?: string;
  /** The slides are the scenes of an animated reel: shorter texts, written to be watched. */
  reel?: boolean;
  result?: { caption: string; slides: { title: string; body: string }[] };
};

export const MAX_SCENES = 8;

/** kind "motion": an animated reel (9:16, no rush) made of text scenes in the look of the project. */
export type MotionRequest = {
  scenes: { title: string; body: string }[];
  /** The look of the scenes. The logo is not stored here: the Mac gets the project's logo when it takes the job. */
  look: Look;
  /** Show the logo saved in the project's profile (false when the editor shows none). */
  logo?: boolean;
  /** A track of the Mac's music folder under the scenes (none when the folder is empty). */
  music: boolean;
  project?: string;
};

export type MontageJob = {
  id: string;
  kind: "montage" | "script" | "caption" | "cover" | "post" | "motion";
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
  /** kind "post": a whole post written by Claude from an idea (slide texts and the description). */
  post?: PostRequest;
  motion?: MotionRequest;
  /** kind "cover": the video whose feed cover the Mac makes, then PUTs to /api/media/:id/cover. */
  cover?: { mediaId: string; project?: string; instructions?: string };
  rushIds: string[];
  feedback?: string;
  /** Drawings sent with the last request to Claude. */
  marks?: MontageMark[];
  /** Voice of the project (style profile): Claude writes with it. Copied when the job was made; refreshed for edits and covers when the Mac takes the job. */
  voice?: { tone?: string; skill?: string; examples?: string[]; images?: string[] };
  /** Colors and font of the project (style profile) for the video overlays: added when the Mac takes the job. */
  theme?: { accent: string; ink: string; dark?: string; text?: string; font?: string; googleFont?: string; fontStretch?: string };
  /** Subtitle style of the project, copied when the job was made. */
  style?: CaptionStyle;
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

/**
 * Rush spans that do not reach the video: cut words, and the part of the pauses between words
 * that the silence setting removes (tight: pauses over 0.3 s keep 0.15 s; cut: pauses over 0.15 s keep 0.04 s).
 * Same rule as the Mac worker (worker/montage/lib/edl.mjs, minus its ffmpeg silence detection), so the timeline matches the preview.
 */
export function removedSpans(s: EdlSegment, silences: AudioSettings["silences"] = "keep"): [number, number][] {
  const spans: [number, number][] = [];
  const ws = (s.words ?? []).filter((w) => w.t1 > s.in && w.t0 < s.out);
  for (const w of ws) if (w.cut) spans.push([Math.max(w.t0, s.in), Math.min(w.t1, s.out)]);
  const live = ws.filter((w) => !w.cut);
  if (silences !== "keep" && live.length) {
    const keep = silences === "tight" ? 0.15 : 0.04;
    const min = silences === "tight" ? 0.3 : 0.15;
    const gaps: [number, number][] = [];
    let prev = s.in;
    for (const w of live) {
      if (w.t0 > prev) gaps.push([prev, w.t0]);
      prev = Math.max(prev, w.t1);
    }
    if (s.out > prev) gaps.push([prev, s.out]);
    for (const [a, b] of gaps) {
      if (b - a <= min) continue;
      const head = a <= s.in + 1e-3;
      const tail = b >= s.out - 1e-3;
      const ra = head ? a : tail ? a + keep : a + keep / 2;
      const rb = tail ? b : head ? b - keep : b - keep / 2;
      if (rb - ra > 0.02) spans.push([ra, rb]);
    }
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const sp of spans) {
    const last = merged.at(-1);
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else if (sp[1] > sp[0]) merged.push([...sp]);
  }
  return merged;
}

const goneBefore = (gone: [number, number][], r: number) => gone.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, r) - a), 0);

type Placed = EdlSegment & { start: number; end: number; gone: [number, number][] };

/** Segments kept, in order, with their position on the output timeline. */
export function timeline(edl: Edl): Placed[] {
  let t = 0;
  const silences = (edl.audio ?? DEFAULT_AUDIO).silences;
  return edl.segments
    .filter((s) => s.kept)
    .map((s) => {
      const gone = removedSpans(s, silences);
      const start = t;
      t += Math.max(0, s.out - s.in - goneBefore(gone, s.out));
      return { ...s, start, end: t, gone };
    });
}

/** Timeline second of a rush second inside a placed segment. */
export function toTimeline(s: Placed, rushT: number) {
  const r = Math.min(Math.max(rushT, s.in), s.out);
  return s.start + (r - s.in) - goneBefore(s.gone, r);
}

/** Subtitle blocks as the editor shows them: up to ~6 words, split on punctuation and pauses. */
export function captionBlocks(edl: Edl) {
  const out: { seg: number; from: number; to: number; start: number; end: number }[] = [];
  for (const s of timeline(edl)) {
    const seg = edl.segments.findIndex((x) => x.id === s.id);
    const ws = s.words ?? [];
    let from = -1;
    const flush = (to: number) => {
      if (from < 0) return;
      const live = ws.slice(from, to + 1).filter((w) => !w.cut);
      if (live.length) out.push({ seg, from, to, start: toTimeline(s, live[0].t0), end: toTimeline(s, live.at(-1)!.t1) });
      from = -1;
    };
    ws.forEach((w, i) => {
      if (from < 0) from = i;
      const next = ws[i + 1];
      const n = i - from + 1;
      // Never leave one short word alone at the end of a sentence.
      const lastOfTwo = !!next && i + 2 === ws.length && next.w.length <= 4;
      if (!next || (n >= 6 && !lastOfTwo) || /[.?!,;:]$/.test(w.w) || next.t0 - w.t1 > 0.35) flush(i);
    });
  }
  return out;
}

export const edlDuration = (edl: Edl) => timeline(edl).at(-1)?.end ?? 0;

/** Rush second of a timeline second inside a placed segment (inverse of toTimeline). */
export function toRush(s: Placed, t: number) {
  let r = s.in + Math.max(0, t - s.start);
  for (const [a, b] of s.gone) if (a <= r) r += Math.min(b, s.out) - a;
  return Math.min(r, s.out);
}

const joinWords = (ws?: EdlWord[]) => (ws ?? []).map((w) => w.w).join(" ");

/** Splits the kept segment under timeline second `t` in two. Null if `t` is too close to an edge. */
export function splitAt(edl: Edl, t: number): Edl | null {
  const placed = timeline(edl).find((s) => t > s.start + 0.15 && t < s.end - 0.15);
  if (!placed) return null;
  const at = toRush(placed, t);
  const next = structuredClone(edl);
  const i = next.segments.findIndex((s) => s.id === placed.id);
  const s = next.segments[i];
  const wa = s.words?.filter((w) => w.t0 < at);
  const wb = s.words?.filter((w) => w.t0 >= at);
  const a: EdlSegment = { ...s, out: at, words: wa, text: wa?.length ? joinWords(wa) : s.text };
  const b: EdlSegment = { ...s, id: `${s.id}-${Math.random().toString(36).slice(2, 6)}`, in: at, words: wb, text: wb?.length ? joinWords(wb) : "" };
  next.segments.splice(i, 1, a, b);
  return next;
}

/** Puts the kept segments in a new order. Cut segments keep their place in the list. */
export function reorderKept(edl: Edl, ids: string[]): Edl {
  const next = structuredClone(edl);
  const slots = next.segments.map((s, i) => (s.kept ? i : -1)).filter((i) => i >= 0);
  const byId = new Map(next.segments.map((s) => [s.id, s]));
  const segs = [...next.segments];
  ids.forEach((id, k) => (segs[slots[k]] = byId.get(id)!));
  next.segments = segs;
  return next;
}

/** Fillers that can be cut word by word. */
export const FILLER = /^(e+u+h+|h+e+u+h*|h+u+m+|h+m+|bah|ben)[.,!?…]*$/i;
