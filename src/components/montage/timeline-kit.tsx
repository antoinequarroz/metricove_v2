"use client";

import { useEffect, useRef, useState } from "react";

/* Shared by the two editing timelines (face-camera montage and animated reel):
   pictures of the video along the track, the shape of its sound, keyboard shortcuts, undo, snapping. */

export type Strip = { frames: { t: number; url: string }[]; duration: number; aspect: number };
const NO_STRIP: Strip = { frames: [], duration: 0, aspect: 9 / 16 };

/**
 * Small pictures of a video along its length, taken in the browser from the video itself
 * (a second, hidden player jumps from place to place). About one picture per second, `max` at most.
 */
export function useFilmstrip(src: string | undefined, max = 72, height = 44): Strip {
  const [strip, setStrip] = useState<Strip>(NO_STRIP);
  useEffect(() => {
    setStrip(NO_STRIP);
    if (!src) return;
    let off = false;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const canvas = document.createElement("canvas");
    const frames: Strip["frames"] = [];
    const start = () => {
      const duration = v.duration;
      if (off || !Number.isFinite(duration) || duration <= 0 || !v.videoWidth) return;
      const aspect = v.videoWidth / v.videoHeight;
      canvas.height = height * 2;
      canvas.width = Math.round(height * 2 * aspect);
      const g = canvas.getContext("2d");
      const n = Math.max(2, Math.min(max, Math.ceil(duration)));
      const grab = (i: number) => {
        if (off || !g) return;
        if (i >= n) {
          setStrip({ frames: [...frames], duration, aspect });
          v.removeAttribute("src");
          v.load();
          return;
        }
        const t = Math.min(Math.max(0, duration - 0.05), ((i + 0.5) * duration) / n);
        v.addEventListener(
          "seeked",
          () => {
            if (off) return;
            try {
              g.drawImage(v, 0, 0, canvas.width, canvas.height);
              frames.push({ t, url: canvas.toDataURL("image/jpeg", 0.6) });
            } catch {
              // A frame the browser refuses to read: the strip only misses one picture.
            }
            if (i % 6 === 5) setStrip({ frames: [...frames], duration, aspect });
            grab(i + 1);
          },
          { once: true },
        );
        v.currentTime = t;
      };
      grab(0);
    };
    v.addEventListener("loadeddata", start, { once: true });
    v.src = src;
    return () => {
      off = true;
      v.removeAttribute("src");
      v.load();
    };
  }, [src, max, height]);
  return strip;
}

/** The pictures laid along a track: `pps` pixels per second, each tile shows the picture nearest to its middle. */
export function Filmstrip({ strip, pps, height, dim }: { strip: Strip; pps: number; height: number; dim?: boolean }) {
  if (!strip.frames.length || !(pps > 0)) return null;
  const tile = Math.max(12, height * strip.aspect);
  const count = Math.min(400, Math.ceil((strip.duration * pps) / tile));
  const near = (t: number) => strip.frames.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  return (
    <div className={dim ? "pointer-events-none absolute inset-0 overflow-hidden opacity-35" : "pointer-events-none absolute inset-0 overflow-hidden"} style={{ width: strip.duration * pps }} aria-hidden>
      {Array.from({ length: count }, (_, k) => (
        <span key={k} className="absolute inset-y-0 bg-black bg-cover bg-center" style={{ left: k * tile, width: tile + 0.5, backgroundImage: `url(${near(((k + 0.5) * tile) / pps).url})` }} />
      ))}
    </div>
  );
}

export type Wave = { peaks: Float32Array; rate: number; duration: number; silent: boolean };

/** The shape of the sound of a video (loudest point of every 20 ms), decoded in the browser. Null until known or when too heavy. */
export function useWaveform(src: string | undefined): Wave | null {
  const [wave, setWave] = useState<Wave | null>(null);
  useEffect(() => {
    setWave(null);
    if (!src || typeof OfflineAudioContext === "undefined") return;
    const stop = new AbortController();
    (async () => {
      const r = await fetch(src, { signal: stop.signal });
      // A long video in full quality would fill the memory of the tab for a drawing.
      if (!r.ok || Number(r.headers.get("content-length") ?? 0) > 120_000_000) return;
      const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await r.arrayBuffer());
      const data = audio.getChannelData(0);
      const rate = 50;
      const per = Math.max(1, Math.floor(audio.sampleRate / rate));
      const peaks = new Float32Array(Math.ceil(data.length / per));
      let top = 0;
      for (let i = 0; i < peaks.length; i++) {
        let m = 0;
        for (let j = i * per, end = Math.min(data.length, j + per); j < end; j += 4) m = Math.max(m, Math.abs(data[j]));
        peaks[i] = m;
        if (m > top) top = m;
      }
      if (top > 0.002) for (let i = 0; i < peaks.length; i++) peaks[i] /= top;
      if (!stop.signal.aborted) setWave({ peaks, rate, duration: audio.duration, silent: top <= 0.002 });
    })().catch(() => {});
    return () => stop.abort();
  }, [src]);
  return wave;
}

/** The sound drawn along a track, in the colour of the text around it. */
export function Waveform({ wave, pps, height, dim }: { wave: Wave; pps: number; height: number; dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, wave.duration * pps);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    // A canvas has a size limit: past it the drawing is stretched, which a sound shape stands well.
    const w = Math.min(4096, Math.round(width));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * ratio;
    c.height = height * ratio;
    g.scale(ratio, ratio);
    g.clearRect(0, 0, w, height);
    g.fillStyle = getComputedStyle(c).color;
    const mid = height / 2;
    for (let x = 0; x < w; x++) {
      const a = Math.floor((x / w) * wave.peaks.length);
      const b = Math.max(a + 1, Math.floor(((x + 1) / w) * wave.peaks.length));
      let m = 0;
      for (let i = a; i < b && i < wave.peaks.length; i++) m = Math.max(m, wave.peaks[i]);
      const h = Math.max(1, m * (height - 4));
      g.fillRect(x, mid - h / 2, 1, h);
    }
  }, [wave, width, height]);
  return <canvas ref={ref} aria-hidden className={dim ? "pointer-events-none absolute top-0 left-0 opacity-35" : "pointer-events-none absolute top-0 left-0"} style={{ width, height }} />;
}

/** The nearest of `points` when it is within `tol`, else the value itself. */
export function snap(t: number, points: number[], tol: number) {
  let best = t;
  let gap = tol;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d <= gap) {
      gap = d;
      best = p;
    }
  }
  return best;
}

/**
 * Undo and redo over one edited value. `record(previous)` before each change; changes that follow each other
 * within half a second (a drag) count as one step.
 */
export function useUndo<T>(current: T | undefined, restore: (value: T) => void) {
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const last = useRef(0);
  const [, bump] = useState(0);
  const record = (previous: T | undefined) => {
    if (previous === undefined) return;
    const now = performance.now();
    if (now - last.current > 500) {
      past.current.push(previous);
      if (past.current.length > 80) past.current.shift();
    }
    last.current = now;
    future.current = [];
    bump((n) => n + 1);
  };
  const step = (from: T[], to: T[]) => {
    const value = from.pop();
    if (value === undefined || current === undefined) return;
    to.push(current);
    last.current = 0;
    restore(value);
    bump((n) => n + 1);
  };
  return {
    record,
    undo: () => step(past.current, future.current),
    redo: () => step(future.current, past.current),
    reset: () => {
      past.current = [];
      future.current = [];
      last.current = 0;
      bump((n) => n + 1);
    },
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

export type TimelineKeys = {
  /** False while another tool has the keyboard (drawing, comparison, an open window). */
  enabled: boolean;
  /** False when the video on screen no longer matches the timeline (edits not rendered yet). */
  canPlay: boolean;
  video: () => HTMLVideoElement | null | undefined;
  total: number;
  onSeek: (t: number) => void;
  onSplit?: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onZoom?: (dir: 1 | -1 | 0) => void;
};

/** What the shortcuts are, for the help shown beside a timeline. */
export const SHORTCUTS: [string, string][] = [
  ["Espace", "lire ou mettre en pause"],
  ["← →", "une image en arrière ou en avant (avec Maj : une seconde)"],
  ["J · K · L", "reculer de 2 s · pause · lire (L encore : plus vite)"],
  ["S", "couper à la tête de lecture"],
  ["Suppr", "retirer l'élément choisi"],
  ["⌘Z · ⇧⌘Z", "annuler · rétablir"],
  ["+ · − · 0", "zoomer · dézoomer · tout voir"],
  ["⌘ + molette", "zoomer sur la timeline"],
];

/** The keyboard of an editing screen. Never takes a key typed in a field, nor Space on a focused button. */
export function useTimelineKeys(keys: TimelineKeys) {
  const live = useRef(keys);
  live.current = keys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = live.current;
      const target = e.target as HTMLElement | null;
      if (!k.enabled || e.defaultPrevented || e.altKey) return;
      if (target?.closest?.("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const v = k.video();
      const done = () => e.preventDefault();
      if (mod) {
        if (key === "z") {
          done();
          if (e.shiftKey) k.onRedo?.();
          else k.onUndo?.();
        } else if (key === "y") {
          done();
          k.onRedo?.();
        }
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        if (k.onDelete) {
          done();
          k.onDelete();
        }
        return;
      }
      if (key === "s" && k.onSplit) return void (done(), k.onSplit());
      if (key === "+" || key === "=") return void (done(), k.onZoom?.(1));
      if (key === "-") return void (done(), k.onZoom?.(-1));
      if (key === "0") return void (done(), k.onZoom?.(0));
      if (!k.canPlay || !v) return;
      const now = v.currentTime;
      const go = (t: number) => k.onSeek(Math.min(Math.max(0, t), Math.max(0, k.total - 0.01)));
      if (key === " ") {
        // Space on a focused button presses that button, as everywhere else.
        if (target?.closest?.("button, a, [role=tab], [role=button]")) return;
        done();
        if (v.paused) {
          v.playbackRate = 1;
          v.play().catch(() => {});
        } else v.pause();
      } else if (key === "k") {
        done();
        v.pause();
      } else if (key === "l") {
        done();
        if (v.paused) {
          v.playbackRate = 1;
          v.play().catch(() => {});
        } else v.playbackRate = v.playbackRate >= 2 ? 1 : v.playbackRate * 2;
      } else if (key === "j") {
        done();
        go(now - 2);
      } else if (key === "ArrowLeft" || key === "ArrowRight") {
        done();
        v.pause();
        go(now + (key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30));
      } else if (key === "Home") {
        done();
        go(0);
      } else if (key === "End") {
        done();
        go(k.total);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * The zoom of a timeline: 1 shows the whole video in the width at hand. Returns the pixels per second, the zoom
 * setter, and a ref for the scrolling box (⌘ or Ctrl + wheel zooms around the pointer).
 */
export function useTimelineZoom(total: number, label: number, pad = 0) {
  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoomRaw] = useState(1);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = total > 0 && room > label + 40 ? (room - label - 2) / (total + pad) : 40;
  const pps = fit * zoom;
  const max = Math.max(1, 400 / fit);
  const setZoom = (next: number | ((z: number) => number)) => setZoomRaw((z) => Math.min(max, Math.max(1, typeof next === "function" ? next(z) : next)));
  const state = useRef({ pps, fit, max, label });
  state.current = { pps, fit, max, label };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = state.current;
      const x = e.clientX - el.getBoundingClientRect().left - s.label;
      const at = (el.scrollLeft + x) / s.pps;
      setZoomRaw((z) => {
        const next = Math.min(s.max, Math.max(1, z * Math.exp(-e.deltaY * 0.0045)));
        // The second under the pointer stays under the pointer.
        requestAnimationFrame(() => (el.scrollLeft = at * s.fit * next - x));
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return { scroller, pps, zoom, setZoom, fitted: zoom <= 1.001 };
}

/** While the video plays, the timeline scrolls so that the playhead stays in view. */
export function useFollowPlayhead(scroller: React.RefObject<HTMLDivElement | null>, x: number, playing: boolean, label: number) {
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const left = el.scrollLeft;
    const view = el.clientWidth - label;
    if (x < left + 8 || x > left + view - 24) el.scrollLeft = Math.max(0, x - view * 0.15);
  }, [scroller, x, playing, label]);
}
