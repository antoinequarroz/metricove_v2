"use client";

import { Keyboard, MapPin, Maximize2, Minus, Pause, PenLine, Play, Plus, Redo2, Scissors, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { reelTimeline, type MontageMark } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { fmtSec } from "./parts";
import { Filmstrip, SHORTCUTS, snap, useFilmstrip, useFollowPlayhead, useTimelineZoom, useWaveform, Waveform } from "./timeline-kit";

export type ReelPlaced = ReturnType<typeof reelTimeline>;

const LABEL = 56;
const MIN_SCENE = 1.5;
const MAX_SCENE = 15;
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const tool = "press inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface px-1.5 text-ink-2 hover:text-ink disabled:opacity-40";

/**
 * The timeline of the whole reel, with tracks: the pictures of the video, the scenes, the sound.
 * Ruler: click or drag to move in the video. Video track: drag to pick a passage for Claude.
 * Scenes: click to choose one, drag it to move it, pull its right edge to change its length.
 */
export function ReelTimeline({
  src,
  placed,
  total,
  time,
  playing,
  onToggle,
  onSeek,
  range,
  onRange,
  marks,
  selected,
  onSelect,
  onResize,
  onReorder,
  onTrimHere,
  onCut,
  onMark,
  undo,
  zoomRef,
  stale,
  hidden,
}: {
  /** The video on screen (its pictures and its sound are drawn in the tracks). */
  src?: string;
  placed: ReelPlaced;
  total: number;
  time: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  range: [number, number] | null;
  onRange?: (r: [number, number] | null) => void;
  marks: MontageMark[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onResize: (id: string, seconds: number) => void;
  /** Moves a scene to place `index` among the scenes that play. */
  onReorder: (id: string, index: number) => void;
  /** Ends the scene under the playhead at the playhead. */
  onTrimHere?: () => void;
  /** Takes the chosen scene out of the reel. */
  onCut?: () => void;
  /** Puts a note for Claude at the playhead. */
  onMark?: () => void;
  undo: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
  /** Lets the keyboard of the screen zoom this timeline (+, −, 0). */
  zoomRef?: React.RefObject<((dir: 1 | -1 | 0) => void) | null>;
  /** Edits wait for a new render: the tracks show what they will give, the video is the old one. */
  stale: boolean;
  /** Kept in place but not shown (while drawing on the video), so the zoom and the scroll are not lost. */
  hidden?: boolean;
}) {
  const { scroller, pps, setZoom, fitted } = useTimelineZoom(total, LABEL, 0, time);
  const strip = useFilmstrip(src);
  const wave = useWaveform(src);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [resize, setResize] = useState<{ id: string; start: number; seconds: number; was: number; off: number; x0: number; pulled: boolean } | null>(null);
  const [moving, setMoving] = useState<{ id: string; dx: number } | null>(null);
  const [help, setHelp] = useState(false);
  if (zoomRef) zoomRef.current = (dir) => setZoom((z) => (dir === 0 ? 1 : dir > 0 ? z * 1.5 : z / 1.5));
  useFollowPlayhead(scroller, time * pps, playing && !stale, LABEL, !!moving || !!resize || !!drag);

  const at = (clientX: number) => {
    const el = scroller.current;
    if (!el) return 0;
    return Math.min(total, Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL) / pps));
  };
  // Edges that pull the pointer: the starts and ends of scenes, and the playhead.
  const edges = useMemo(() => [0, ...placed.map((p) => p.end), ...(time >= 0 ? [time] : [])], [placed, time]);
  const near = (t: number) => snap(t, edges, 8 / pps);

  /* ---- Ruler: move in the video ---- */
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0 || stale) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(at(e.clientX));
  };

  /* ---- Video track: pick a passage ---- */
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || stale) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = at(e.clientX);
    setDrag({ from: t, to: t });
  };
  const move = (e: React.PointerEvent) => {
    if (drag) setDrag({ from: drag.from, to: near(at(e.clientX)) });
  };
  const up = () => {
    if (!drag) return;
    const from = Math.abs(drag.to - drag.from) >= 0.25 ? near(drag.from) : drag.from;
    const [a, b] = [Math.min(from, drag.to), Math.max(from, drag.to)];
    setDrag(null);
    // A short move is a click: go there. A longer one picks the passage.
    if (b - a < 0.25 || !onRange) {
      if (b - a < 0.25) onRange?.(null);
      onSeek(drag.from);
    } else {
      onRange([Math.round(a * 100) / 100, Math.round(b * 100) / 100]);
      onSeek(a);
    }
  };

  /* ---- Scenes: choose, move, resize ---- */
  const hold = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setMoving({ id, dx: 0 });
    (e.currentTarget as HTMLElement).dataset.x0 = String(e.clientX);
  };
  const carry = (e: React.PointerEvent) => {
    if (!moving) return;
    const dx = e.clientX - Number((e.currentTarget as HTMLElement).dataset.x0);
    if (Math.abs(dx) > 4 || moving.dx) setMoving({ id: moving.id, dx });
  };
  const release = (e: React.PointerEvent) => {
    if (!moving) return;
    const { id, dx } = moving;
    setMoving(null);
    const p = placed.find((x) => x.scene.id === id);
    if (!p) return;
    if (!dx) {
      onSelect(id);
      if (!stale) onSeek(Math.min(at(e.clientX), p.end - 0.01));
      return;
    }
    const center = ((p.start + p.end) / 2) * pps + dx;
    const index = placed.filter((x) => x.scene.id !== id && ((x.start + x.end) / 2) * pps < center).length;
    if (index !== p.index) onReorder(id, index);
    onSelect(id);
  };
  const grab = (e: React.PointerEvent, id: string, start: number, seconds: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The handle is a few pixels wide: the edge keeps its distance to the pointer instead of jumping under it.
    setResize({ id, start, seconds, was: seconds, off: start + seconds - at(e.clientX), x0: e.clientX, pulled: false });
  };
  const pull = (e: React.PointerEvent) => {
    if (!resize) return;
    e.stopPropagation();
    if (!resize.pulled && Math.abs(e.clientX - resize.x0) < 3) return;
    setResize({ ...resize, pulled: true, seconds: Math.round(Math.min(MAX_SCENE, Math.max(MIN_SCENE, at(e.clientX) + resize.off - resize.start)) * 10) / 10 });
  };
  const drop = (e: React.PointerEvent) => {
    if (!resize) return;
    e.stopPropagation();
    // A click on the edge without pulling is a click on the scene, not a new length.
    if (!resize.pulled || Math.abs(resize.seconds - resize.was) < 0.1) {
      onSelect(resize.id);
      if (!stale) onSeek(at(e.clientX));
    } else onResize(resize.id, resize.seconds);
    setResize(null);
  };

  const sel = drag && Math.abs(drag.to - drag.from) >= 0.25 ? ([Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)] as const) : range;
  const ticks = useMemo(() => {
    const step = [1, 2, 5, 10, 30].find((s) => s * pps >= 56) ?? 60;
    return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  }, [total, pps]);
  const width = total * pps;
  const under = time >= 0 ? placed.find((p) => time >= p.start && time < p.end) : undefined;
  const chosen = placed.find((p) => p.scene.id === selected);

  return (
    <div className={cn("shrink-0 border-t border-line bg-surface/60 px-6 pt-2 pb-3 max-md:px-4", hidden && "hidden")}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-ink-3">
        <button onClick={onToggle} disabled={stale && !playing} aria-label={playing ? "Pause" : "Lire"} title="Lire ou mettre en pause (Espace)" className={cn(tool, "text-ink")}>
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <span className="tabular mx-1 shrink-0 font-mono text-ink">
          {time >= 0 ? fmtT(time) : "–"} / {fmtT(total)}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {stale
            ? "Durées estimées de tes modifications. La vidéo sera refaite avec « Voir l'aperçu »."
            : sel
              ? `Passage choisi : ${fmtT(sel[0])} – ${fmtT(sel[1])}`
              : "Règle : se placer. Piste Vidéo : faire glisser pour choisir un passage. Scènes : glisser pour déplacer, tirer le bord pour la durée."}
        </span>
        <button onClick={undo.undo} disabled={!undo.canUndo} aria-label="Annuler" title="Annuler (⌘Z)" className={tool}>
          <Undo2 className="size-3.5" />
        </button>
        <button onClick={undo.redo} disabled={!undo.canRedo} aria-label="Rétablir" title="Rétablir (⇧⌘Z)" className={tool}>
          <Redo2 className="size-3.5" />
        </button>
        <button
          onClick={onTrimHere}
          disabled={!onTrimHere || stale || !under || time - under.start < MIN_SCENE || under.end - time < 0.2}
          title="Finir la scène à la tête de lecture : ce qui suit dans cette scène est coupé (S)"
          className={cn(tool, "gap-1.5 px-2 font-medium max-md:hidden")}
        >
          <Scissors className="size-3.5" /> <span className="max-xl:hidden">Couper ici</span>
        </button>
        <button onClick={onCut} disabled={!onCut || !chosen || placed.length < 2} title="Retirer la scène choisie du reel (Suppr)" className={cn(tool, "gap-1.5 px-2 font-medium")}>
          <Trash2 className="size-3.5" /> <span className="max-xl:hidden">Retirer</span>
        </button>
        <button onClick={onMark} disabled={!onMark || stale} title="Poser un repère avec une note pour Claude, à la tête de lecture (M)" className={cn(tool, "gap-1.5 px-2 font-medium")}>
          <MapPin className="size-3.5" /> <span className="max-xl:hidden">Repère</span>
        </button>
        <span className="mx-0.5 h-4 w-px bg-line-strong" />
        <button onClick={() => setZoom((z) => z / 1.5)} disabled={fitted} aria-label="Dézoomer la timeline" title="Dézoomer (−)" className={tool}>
          <Minus className="size-3.5" />
        </button>
        <button onClick={() => setZoom((z) => z * 1.5)} aria-label="Zoomer la timeline" title="Zoomer (+, ou ⌘ + molette)" className={tool}>
          <Plus className="size-3.5" />
        </button>
        <button onClick={() => setZoom(1)} disabled={fitted} aria-label="Voir toute la vidéo" title="Voir toute la vidéo (0)" className={tool}>
          <Maximize2 className="size-3.5" />
        </button>
        <div className="relative">
          <button onClick={() => setHelp((h) => !h)} aria-expanded={help} aria-label="Raccourcis clavier" title="Raccourcis clavier" className={cn(tool, help && "border-accent bg-accent-soft")}>
            <Keyboard className="size-3.5" />
          </button>
          {help && (
            <div className="absolute right-0 bottom-9 z-40 w-[330px] rounded-xl border border-line bg-surface p-3 text-[12px] shadow-card">
              <p className="mb-1.5 font-medium text-ink">Raccourcis clavier</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {SHORTCUTS.map(([k, what]) => (
                  <div key={k} className="contents">
                    <dt className="tabular font-mono text-ink">{k}</dt>
                    <dd className="text-ink-2">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      <div ref={scroller} className="scroll-thin relative overflow-x-auto overflow-y-hidden rounded-lg border border-line bg-surface select-none">
        <div className="relative" style={{ width: width + LABEL }}>
          {/* Ruler */}
          <div className="flex h-5 border-b border-line">
            <div className="sticky left-0 z-30 shrink-0 border-r border-line bg-surface" style={{ width: LABEL }} />
            <div className={cn("relative flex-1 touch-none", !stale && "cursor-pointer")} onPointerDown={scrub} onPointerMove={(e) => e.buttons === 1 && !stale && onSeek(at(e.clientX))}>
              {ticks.map((t) => (
                <span key={t} className="tabular absolute top-0 h-full border-l border-line-strong pl-1 font-mono text-[10px] leading-5 text-ink-3" style={{ left: t * pps }}>
                  {Number.isInteger(t) ? `${t}s` : `${t.toFixed(1)}s`}
                </span>
              ))}
              {marks.map((m) => (
                <button
                  key={m.id}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onSeek(m.t)}
                  title={m.text || "Note dessinée"}
                  aria-label={`Note à ${fmtSec(m.t)}`}
                  className="absolute top-0.5 z-10 grid size-4 -translate-x-1/2 place-items-center rounded-full bg-accent text-white shadow-card"
                  style={{ left: m.t * pps }}
                >
                  <PenLine className="size-2.5" />
                </button>
              ))}
            </div>
          </div>

          {/* Video: pictures of the render; drag to pick a passage */}
          <Row label="Vidéo" h="h-10">
            <div className={cn("absolute inset-0 touch-none", !stale && "cursor-text")} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
              <Filmstrip strip={strip} pps={pps} height={40} dim={stale} />
              {!strip.frames.length && !strip.failed && <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-ink-3">{src ? "Images de la vidéo…" : "Pas encore de vidéo"}</span>}
            </div>
          </Row>

          {/* Scenes */}
          <Row label="Scènes" h="h-11">
            {placed.map((p) => {
              const live = resize?.id === p.scene.id;
              const len = live ? resize.seconds : p.end - p.start;
              const dx = moving?.id === p.scene.id ? moving.dx : 0;
              const on = selected === p.scene.id;
              return (
                <div
                  key={p.scene.id}
                  onPointerDown={(e) => hold(e, p.scene.id)}
                  onPointerMove={carry}
                  onPointerUp={release}
                  onPointerCancel={() => setMoving(null)}
                  className={cn(
                    "absolute top-1 bottom-1 cursor-grab touch-none overflow-hidden rounded-md border px-1.5 py-0.5 active:cursor-grabbing",
                    on ? "z-10 border-accent bg-accent-soft" : under?.scene.id === p.scene.id ? "border-accent/60 bg-surface-2" : "border-line-strong bg-surface-2",
                    (live || dx) && "z-20 shadow-card",
                    dx && "opacity-85",
                  )}
                  style={{ left: p.start * pps, width: Math.max(10, len * pps - 2), transform: dx ? `translateX(${dx}px)` : undefined }}
                  title={`Scène ${p.index + 1} · ${(p.end - p.start).toFixed(1)} s · ${p.scene.title || p.scene.body}`}
                >
                  <p className="pointer-events-none flex items-center gap-1 text-[10px] leading-4 font-medium text-ink-3">
                    <span className="tabular font-mono">{p.index + 1}</span>
                    {p.scene.custom && <Sparkles className="size-2.5 shrink-0 text-accent" />}
                    <span className="tabular ml-auto font-mono">{len.toFixed(1)} s</span>
                  </p>
                  <p className="pointer-events-none truncate text-[11.5px] leading-4 font-medium">{p.scene.title || p.scene.body}</p>
                  <span
                    onPointerDown={(e) => grab(e, p.scene.id, p.start, p.end - p.start)}
                    onPointerMove={pull}
                    onPointerUp={drop}
                    onPointerCancel={() => setResize(null)}
                    aria-hidden
                    title="Tire pour changer la durée de la scène"
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none rounded-r-md bg-accent/0 hover:bg-accent/60"
                  />
                </div>
              );
            })}
          </Row>

          {/* Sound */}
          <Row label="Son" h="h-7" last>
            {wave && !wave.silent ? (
              <div className="absolute inset-0 text-accent/70">
                <Waveform wave={wave} pps={pps} height={28} dim={stale} />
              </div>
            ) : (
              <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-ink-3">{!src ? "" : wave ? (wave.unavailable ? "Son non affiché" : "Sans musique") : "Son de la vidéo…"}</span>
            )}
          </Row>

          {/* Passage and playhead, over every track */}
          {sel && <div className="pointer-events-none absolute top-5 bottom-0 z-20 border-x border-accent bg-accent/15" style={{ left: LABEL + sel[0] * pps, width: (sel[1] - sel[0]) * pps }} />}
          {time >= 0 && (
            <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-accent" style={{ left: LABEL + time * pps }}>
              <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-accent" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, h, last, children }: { label: string; h: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex", h, !last && "border-b border-line")}>
      <div className="sticky left-0 z-30 flex shrink-0 items-center border-r border-line bg-surface px-2 text-[10.5px] font-medium text-ink-2" style={{ width: LABEL }}>
        {label}
      </div>
      <div className="relative flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
