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
  emoji?: string;  /** A new subtitle block starts at this word (set by hand on the timeline). */
  brk?: boolean;
  /** Stays in the same subtitle block as the word before (set by hand: merged blocks, moved limit). */
  glue?: boolean;
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
  music: { on: boolean; track?: string; volume: number; duck: boolean } & MusicCue;
};

/** Illustration shot over the speaker (the voice keeps going). Times are timeline seconds. */
export type Broll = {
  at: number;
  dur: number;
  /** What the shot should show, in a few words (used to search). */
  query: string;
  /** Where the shot comes from: the Mac B-roll folder, Pexels, or a video of the Metricove library. Absent = the Mac searches. */
  source?: "mine" | "pexels" | "library";
  /** File name in the Mac B-roll folder, Pexels video id, or library media id. */
  ref?: string;
  /** Pexels: link of the video file picked in the page, so the Mac can fetch it without a Pexels key of its own. */
  url?: string;
  /** Second of the clip where the shot starts (absent = its start). */
  from?: number;
  /** Volume of the clip's own sound, under the voice (0 to 1; absent = muted). */
  sound?: number;
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
  /** Playback speed of the shot (0.5 to 2; left out: 1). Its length on the timeline is divided by it. */
  speed?: number;
};

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const speedOf = (s: { speed?: number }) => (s.speed && s.speed >= 0.5 && s.speed <= 2 ? s.speed : 1);

export type Edl = {
  format: MontageFormat;
  segments: EdlSegment[];
  title?: { text: string; until: number } | null;
  endCard?: { text: string } | null;
  /** Zooms in timeline seconds. `hold`: a still, tighter frame for the whole span (a reframing), not a move. */
  zooms?: { at: number; dur: number; scale: number; hold?: boolean }[];
  crop?: "face" | "center";
  /** Other hooks Claude proposed. `title.text` is the one used. */
  hooks?: string[];
  captions?: CaptionStyle;
  audio?: AudioSettings;
  /** More formats to render with the final video (same edit, reframed). */
  exports?: MontageFormat[];
  broll?: Broll[];
  /** Texts put on the video by hand (seconds of the edited video). */
  texts?: FreeText[];
  /** Claude adds B-roll where it helps (your shots first, then Pexels). */
  brollAuto?: boolean;
};

export const DEFAULT_CAPTIONS: CaptionStyle = { on: true, position: "auto", look: "karaoke", size: "m", emoji: true };
/** A text put on the video by hand: when, where (centre of the text, 0 to 1 of the picture), how big. */
export type FreeText = { id: string; text: string; start: number; end: number; x: number; y: number; size: "s" | "m" | "l" | "xl"; style: "plain" | "band" };
export const MAX_TEXTS = 12;
/** Height of the letters for a picture 1080 wide. Same as the Mac (worker/montage/lib/texts.mjs). */
export const TEXT_SIZE = { s: 44, m: 64, l: 92, xl: 128 } as const;
/** Where the music starts in its file, and its fades (seconds). Left out: from the start, short fades. */
export type MusicCue = { start?: number; fadeIn?: number; fadeOut?: number };
export const MUSIC_FADE = { in: 0.5, out: 1.5, maxIn: 5, maxOut: 8, maxStart: 600 };

export const DEFAULT_AUDIO: AudioSettings = { denoise: true, silences: "tight", music: { on: false, volume: 0.15, duck: true } };

/** Animation settings of a reel scene (picked by Claude from a direction, or the standard ones). */
export type ReelFx = {
  enter: "rise" | "type" | "punch" | "slide" | "blur";
  transition: "auto" | "up" | "circle" | "side" | "cut";
  decor: "ring" | "dots" | "bars" | "none";
  accent: string;
  count: boolean;
};
/** Code Claude wrote for a scene. `at`: the place the scene had when a whole scene ("art") was written. */
export type ReelCode = { html: string; css: string; js: string; at?: number };
export type ReelScene = {
  id: string;
  title: string;
  body: string;
  anim?: string;
  /** Seconds on screen chosen in the editing screen; left out, the Mac computes it from the text. */
  seconds?: number;
  /** Taken out of the reel (it stays in the plan, so it can come back). */
  cut?: boolean;
  fx?: ReelFx;
  /** Kept on the server and given to the Mac only: the page gets `custom` instead. */
  layer?: ReelCode;
  art?: ReelCode;
  /** What the page knows of the code: a whole custom scene, or a custom layer behind the text. */
  custom?: "art" | "layer";
  /** Seconds on screen in the rendered video (written by the Mac). */
  dur?: number;
};
/** A version of an animated reel: everything the Mac needs to render it again exactly. */
export type ReelPlan = {
  scenes: ReelScene[];
  look: Look;
  logo?: boolean;
  music: boolean;
  /** Music volume, 0 to 1. */
  volume?: number;
  /** File of the Mac's music folder; left out, the first one. */
  track?: string;
  /** Where the music starts in its file, and its fades. */
  cue?: MusicCue;
  /** Texts put over the reel by hand. */
  texts?: FreeText[];
  pace: "calm" | "normal" | "fast";
  direction?: string;
  /** Length of the rendered video, in seconds. */
  duration?: number;
};

export const REEL_PACE = { calm: 1.25, normal: 1, fast: 0.8 } as const;
/** Seconds a reel scene stays on screen. Same rule as the Mac (worker/montage/lib/motion.mjs). */
export const reelSceneSeconds = (s: { title: string; body: string; anim?: string; seconds?: number }, last: boolean, pace: keyof typeof REEL_PACE = "normal") =>
  s.seconds ? s.seconds : (Math.min(7, Math.max(2.8, 1.9 + 0.058 * (s.title.trim().length + s.body.trim().length))) + (s.anim?.trim() ? 1.5 : 0) + (last ? 1.2 : 0)) * REEL_PACE[pace];

/** The scenes that play, with their place on the timeline. `rendered`: use the lengths the Mac wrote (the video as it is). */
export function reelTimeline(plan: ReelPlan, rendered = false) {
  const kept = plan.scenes.filter((s) => !s.cut);
  let t = 0;
  return kept.map((s, i) => {
    const d = rendered && s.dur ? s.dur : reelSceneSeconds(s, i === kept.length - 1, plan.pace);
    const start = t;
    t += d;
    return { scene: s, index: i, start, end: t };
  });
}

export type MontageVersion = {
  n: number;
  edl: Edl;
  /** kind "motion": the plan of the reel. `edl` is then empty. */
  reel?: ReelPlan;
  notes?: string;
  /** True once the preview video is on the server. */
  preview: boolean;
  by: "claude" | "edit";
  createdAt: string;
};

export type JobStatus = "queued" | "working" | "review" | "rendering" | "done" | "failed" | "cancelled";
export type JobAction = null | "propose" | "preview" | "final" | "script" | "caption" | "cover" | "post" | "motion" | "broll";

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
/** Length of the animation direction of a reel. */
export const MAX_DIRECTION = 1000;

/** kind "motion": an animated reel (9:16, no rush) made of text scenes in the look of the project. */
export type MotionRequest = {
  /** `anim`: a free motion design instruction for the scene; Claude writes that scene's animation (worker 0.7.0). */
  scenes: { title: string; body: string; anim?: string }[];
  /** The look of the scenes. The logo is not stored here: the Mac gets the project's logo when it takes the job. */
  look: Look;
  /** Show the logo saved in the project's profile (false when the editor shows none). */
  logo?: boolean;
  /** A track of the Mac's music folder under the scenes (none when the folder is empty). */
  music: boolean;
  /** What Antoine asks of the animations: Claude picks them per scene and writes HyperFrames layers (worker 0.8.0). */
  direction?: string;
  /** Speed of the whole reel; left out, Claude chooses when there is a direction, else normal. */
  pace?: "calm" | "normal" | "fast";
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
  /** What the Mac has to say about the finished video (a reel that fell back to the standard animations). */
  notes?: string;
  /** kind "cover": the video whose feed cover the Mac makes, then PUTs to /api/media/:id/cover. */
  cover?: { mediaId: string; project?: string; instructions?: string };
  rushIds: string[];
  feedback?: string;
  /** Drawings sent with the last request to Claude. */
  marks?: MontageMark[];
  /** kind "motion": the passage of the video (seconds) the last request is about, and the version it starts from. */
  range?: [number, number];
  base?: number;
  /** Face-cam edit: B-roll asked to Claude for one passage (timeline seconds) of the last version (action "broll", worker 0.13.0). */
  brollAsk?: { range: [number, number]; note?: string };
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
      t += Math.max(0, s.out - s.in - goneBefore(gone, s.out)) / speedOf(s);
      return { ...s, start, end: t, gone };
    });
}

/** Timeline second of a rush second inside a placed segment. */
export function toTimeline(s: Placed, rushT: number) {
  const r = Math.min(Math.max(rushT, s.in), s.out);
  return s.start + (r - s.in - goneBefore(s.gone, r)) / speedOf(s);
}

/** Characters per subtitle line by format, at size M. Same as the Mac (worker config captionsMaxChars). */
export const CAPTION_CHARS: Record<MontageFormat, number> = { "9:16": 18, "4:5": 22, "1:1": 22, "16:9": 38 };
const CAPTION_SIZE = { s: 0.8, m: 1, l: 1.2 } as const;

type LiveWord = { i: number; w: string; s: number; e: number; brk?: boolean; glue?: boolean };
const linesOf = (ws: LiveWord[], maxc: number) => {
  let n = 0;
  let cur: LiveWord[] = [];
  for (const w of ws) {
    if (cur.length && [...cur, w].map((x) => x.w).join(" ").length > maxc) {
      n++;
      cur = [];
    }
    cur.push(w);
  }
  return n + (cur.length ? 1 : 0);
};

/**
 * Subtitle blocks exactly as the Mac cuts them (worker/montage/lib/hf.mjs chunksOf): two lines at most, cut on
 * punctuation, pauses over 0.35 s and shots, plus the limits set by hand (`brk`: a block starts here, `glue`: no cut
 * before this word, up to three lines). Times are timeline seconds; `from` and `to` index the words of the shot.
 */
export function captionBlocks(edl: Edl, style?: CaptionStyle) {
  const maxc = Math.round(CAPTION_CHARS[edl.format] / (CAPTION_SIZE[(style ?? edl.captions ?? DEFAULT_CAPTIONS).size] ?? 1));
  const out: { seg: number; from: number; to: number; start: number; end: number }[] = [];
  for (const s of timeline(edl)) {
    const seg = edl.segments.findIndex((x) => x.id === s.id);
    // Words that are not shown (cut, outside the shot, too short to render) hand their block start to the next word,
    // as the Mac does (worker/montage/lib/edl.mjs outputWords).
    const live: LiveWord[] = [];
    let carry = false;
    (s.words ?? []).forEach((w, i) => {
      const ms = (t: number) => Math.round(toTimeline(s, t) * 1000) / 1000;
      const gone = w.cut || w.t1 <= s.in || w.t0 >= s.out || ms(Math.min(w.t1, s.out)) - ms(Math.max(w.t0, s.in)) < 0.02;
      if (gone) {
        carry ||= !!w.brk;
        return;
      }
      live.push({ i, w: w.w, s: toTimeline(s, w.t0), e: toTimeline(s, w.t1), brk: w.brk || carry || undefined, glue: carry ? undefined : w.glue });
      carry = false;
    });
    const chunks: LiveWord[][] = [];
    let cur: LiveWord[] = [];
    for (const w of live) {
      if (cur.length) {
        const p = cur[cur.length - 1];
        const auto = linesOf([...cur, w], maxc) > 2 || w.s - p.e > 0.35 || (/[.?!,]$/.test(p.w) && cur.map((x) => x.w).join(" ").length >= 8);
        if (w.brk || (w.glue ? linesOf([...cur, w], maxc) > 3 : auto)) {
          chunks.push(cur);
          cur = [];
        }
      }
      cur.push(w);
    }
    if (cur.length) chunks.push(cur);
    // A single word left alone after a short pause joins the block before, unless a limit was set by hand.
    for (let k = 1; k < chunks.length; ) {
      const a = chunks[k - 1];
      const b = chunks[k];
      if (b.length === 1 && !b[0].brk && b[0].s - a[a.length - 1].e < 0.35 && linesOf([...a, ...b], maxc) <= 2) {
        a.push(...chunks.splice(k, 1)[0]);
        continue;
      }
      k++;
    }
    for (const c of chunks) out.push({ seg, from: c[0].i, to: c[c.length - 1].i, start: c[0].s, end: c[c.length - 1].e });
  }
  return out;
}

export const edlDuration = (edl: Edl) => timeline(edl).at(-1)?.end ?? 0;

/** Rush second of a timeline second inside a placed segment (inverse of toTimeline). */
export function toRush(s: Placed, t: number) {
  let r = s.in + Math.max(0, t - s.start) * speedOf(s);
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

/* ---------- Subtitles edited on the timeline ---------- */

export type CaptionBlock = ReturnType<typeof captionBlocks>[number];

const liveIn = (s: EdlSegment, from: number, to: number) => (s.words ?? []).map((w, i) => ({ w, i })).filter((x) => x.i >= from && x.i <= to && !x.w.cut);
const retext = (s: EdlSegment) => (s.text = (s.words ?? []).filter((w) => !w.cut && w.w).map((w) => w.w).join(" "));

/**
 * Pins the blocks of shot `seg` as they are shown now (each block's first word starts a block, the others stay with the
 * previous word), so that a hand change to one block never makes the blocks after it flow again.
 */
function freeze(edl: Edl, seg: number, style?: CaptionStyle) {
  const words = edl.segments[seg]?.words;
  if (!words) return;
  for (const b of captionBlocks(edl, style).filter((x) => x.seg === seg))
    for (const x of liveIn(edl.segments[seg], b.from, b.to)) {
      delete x.w.brk;
      delete x.w.glue;
      if (x.i === b.from) x.w.brk = true;
      else x.w.glue = true;
    }
}

/**
 * New text for a subtitle block. Same number of words: each word keeps its timing, colour and emoji. Otherwise the new
 * words share the time of the block in proportion to their length. Only the subtitles change, never the sound.
 */
export function retextBlock(edl: Edl, b: CaptionBlock, text: string, style?: CaptionStyle): Edl {
  const tokens = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 60);
  const next = structuredClone(edl);
  freeze(next, b.seg, style);
  const s = next.segments[b.seg];
  const live = liveIn(s, b.from, b.to);
  if (!s.words || !live.length || !tokens.length) return edl;
  if (tokens.length === live.length) live.forEach((x, k) => (s.words![x.i].w = tokens[k].slice(0, 80)));
  else {
    // The new words take the speech of the old ones, never the pauses between them: the silences removed from the
    // shot (audio.silences) stay the same, so the sound and the timeline do not move.
    const runs: { t0: number; t1: number }[] = [];
    for (const x of live) {
      const r = runs[runs.length - 1];
      if (r && x.w.t0 - r.t1 <= 0.04) r.t1 = Math.max(r.t1, x.w.t1);
      else runs.push({ t0: x.w.t0, t1: x.w.t1 });
    }
    // Tokens per run: one each, the rest in proportion to the length of the run. A run left without a token keeps
    // its time as an empty word (nothing shows).
    const count = runs.map(() => 0);
    const spare = Math.max(0, tokens.length - runs.length);
    const speech = runs.reduce((n, r) => n + (r.t1 - r.t0), 0) || 1;
    runs.forEach((r, k) => (count[k] = k < tokens.length ? 1 + Math.floor((spare * (r.t1 - r.t0)) / speech) : 0));
    for (let left = tokens.length - count.reduce((n, c) => n + c, 0), k = 0; left > 0; k = (k + 1) % runs.length, left--) count[k]++;
    const words: EdlWord[] = [];
    let next0 = 0;
    const ms = (t: number) => Math.round(t * 1000) / 1000;
    runs.forEach((r, k) => {
      let mine = tokens.slice(next0, next0 + count[k]);
      next0 += count[k];
      // A word needs time to be read (and the Mac drops words under 20 ms): too many for this run share a word.
      const fit = Math.max(1, Math.floor((r.t1 - r.t0) / 0.08));
      if (mine.length > fit) {
        const per = Math.ceil(mine.length / fit);
        mine = Array.from({ length: Math.ceil(mine.length / per) }, (_, j) => mine.slice(j * per, j * per + per).join(" "));
      }
      if (!mine.length) return void words.push({ t0: r.t0, t1: r.t1, w: "", glue: true });
      const total = mine.reduce((n, t) => n + t.length + 1, 0);
      let at = r.t0;
      for (const t of mine) {
        const d = ((r.t1 - r.t0) * (t.length + 1)) / total;
        words.push({ t0: ms(at), t1: ms(at + d), w: t.slice(0, 80), glue: true });
        at += d;
      }
    });
    words[0].t0 = runs[0].t0;
    delete words[0].glue;
    words[0].brk = true;
    const t0 = live[0].w.t0;
    const drop = new Set(live.map((x) => x.i));
    const rest = s.words.filter((_, i) => !drop.has(i));
    rest.splice(rest.filter((w) => w.t0 < t0).length, 0, ...words);
    s.words = rest;
  }
  retext(s);
  return next;
}

/** A new block starts at word `i` of shot `seg`. */
export function splitBlock(edl: Edl, seg: number, i: number, style?: CaptionStyle): Edl {
  const next = structuredClone(edl);
  freeze(next, seg, style);
  const w = next.segments[seg]?.words?.[i];
  if (!w) return edl;
  w.brk = true;
  delete w.glue;
  return next;
}

/** Block `b` and the block right after it (same shot) become one. */
export function mergeBlocks(edl: Edl, a: CaptionBlock, b: CaptionBlock, style?: CaptionStyle): Edl {
  if (a.seg !== b.seg) return edl;
  const next = structuredClone(edl);
  freeze(next, a.seg, style);
  for (const x of liveIn(next.segments[a.seg], a.from + 1, b.to)) {
    delete x.w.brk;
    x.w.glue = true;
  }
  return next;
}

/** Moves the limit between two blocks of the same shot: the second one now starts at word `first`. */
export function moveBlockLimit(edl: Edl, a: CaptionBlock, b: CaptionBlock, first: number, style?: CaptionStyle): Edl {
  if (a.seg !== b.seg || first <= a.from || first > b.to) return edl;
  const next = structuredClone(edl);
  freeze(next, a.seg, style);
  for (const x of liveIn(next.segments[a.seg], a.from + 1, b.to)) {
    delete x.w.brk;
    delete x.w.glue;
    if (x.i === first) x.w.brk = true;
    else x.w.glue = true;
  }
  return next;
}

const takeWords = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );

/** Other takes of what shot `id` says, among the shots left out of the edit: the closest wording first. */
export function otherTakes(edl: Edl, id: string, max = 6) {
  const s = edl.segments.find((x) => x.id === id);
  if (!s) return [];
  const a = takeWords(s.text);
  return edl.segments
    .filter((x) => !x.kept && x.id !== id && x.out - x.in >= 0.3)
    .map((x) => {
      const b = takeWords(x.text);
      const common = [...a].filter((w) => b.has(w)).length;
      return { seg: x, score: a.size + b.size ? common / Math.max(1, Math.min(a.size, b.size)) : 0 };
    })
    .filter((x) => x.score >= 0.4)
    .sort((p, q) => q.score - p.score)
    .slice(0, max)
    .map((x) => x.seg);
}

/** Puts take `other` (a shot left out) in place of shot `id`, which is left out in its turn. Speed goes with the place. */
export function swapTake(edl: Edl, id: string, other: string): Edl {
  const next = structuredClone(edl);
  const cur = next.segments.find((x) => x.id === id);
  const alt = next.segments.find((x) => x.id === other);
  if (!cur || !alt || !cur.kept || alt.kept) return edl;
  next.segments = next.segments.filter((x) => x !== alt);
  next.segments.splice(next.segments.indexOf(cur), 0, alt);
  alt.kept = true;
  delete alt.reason;
  if (cur.speed) alt.speed = cur.speed;
  else delete alt.speed;
  cur.kept = false;
  cur.reason = "autre prise";
  delete cur.speed;
  return next;
}
