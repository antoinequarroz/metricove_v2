"use client";

import { Clapperboard, Keyboard, MapPin, Maximize2, Minus, Plus, Redo2, Scissors, Trash2, Undo2, ZoomIn, Gauge, Crop, Images, PictureInPicture2, Sparkles, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import { edlDuration, reorderKept, splitAt, SPEEDS, timeline, type CaptionStyle, type Edl, type MontageMark, type Rush } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Segmented } from "./controls";
import { Button } from "../ui";
import { BrollPicker } from "./broll-picker";
import { CaptionBlocks, CaptionInspector, type CaptionPick } from "./caption-track";
import { TextBlocks } from "./free-texts";
import { fmtSec } from "./parts";
import { Filmstrip, SHORTCUTS, snap, useFilmstrip, useFollowPlayhead, useTimelineZoom, useWaveform, Waveform } from "./timeline-kit";

export type Selection = { kind: "seg"; id: string } | { kind: "zoom"; i: number } | { kind: "broll"; i: number } | { kind: "title" } | ({ kind: "cap" } & CaptionPick) | { kind: "brange"; a: number; b: number } | null;

const TRACK = "relative h-11 border-b border-line";
const LABEL_W = 64;
const END_CARD = 2.5;

/** Starts a horizontal drag. `onMove` gets the distance in pixels from the start. */
function drag(e: React.PointerEvent, onMove: (dx: number) => void, onEnd?: (dx: number, moved: boolean) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX;
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (Math.abs(ev.clientX - x0) > 3) moved = true;
    if (moved) onMove(ev.clientX - x0);
  };
  const up = (ev: PointerEvent) => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    onEnd?.(ev.clientX - x0, moved);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Timeline editor: shots (trim, move, split, remove), zooms, on-screen hook, end card and drawn notes.
 * Times on the timeline are output seconds; segment edges are rush seconds.
 */
export function Timeline({
  edl,
  onChange,
  time,
  onSeek,
  marks,
  rushes,
  selection,
  onSelect,
  src,
  stale,
  playing,
  undo,
  zoomRef,
  textSel,
  onTextSel,
  workerVersion,
  captionStyle,
  onRemove,
  onMark,
  onBrollAsk,
}: {
  edl: Edl;
  /** `key` names a control whose changes in a row make one step to undo. */
  onChange: (next: Edl, key?: string) => void;
  time: number;
  onSeek: (t: number) => void;
  marks: MontageMark[];
  rushes: Rush[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** The preview on screen: its pictures and its sound are drawn in the tracks. */
  src?: string;
  /** Edits wait for a new preview: the pictures and the sound are those of the old one. */
  stale?: boolean;
  playing?: boolean;
  undo?: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
  /** Lets the keyboard of the screen zoom this timeline (+, −, 0). */
  zoomRef?: React.RefObject<((dir: 1 | -1 | 0) => void) | null>;
  /** The free text chosen (texts put on the video by hand have their own track). */
  textSel?: string | null;
  onTextSel?: (id: string) => void;
  /** Version of the Mac program: speed and still reframing need 0.12.0. */
  workerVersion?: string;
  /** Style of the subtitles (this version's, else the project's): how the blocks are cut. */
  captionStyle?: CaptionStyle;
  /** Removes what is selected (the Delete key does the same). */
  onRemove?: () => void;
  /** Puts a note for Claude at the playhead (the M key does the same). */
  onMark?: () => void;
  /** Asks Claude for B-roll on a passage of the timeline (seconds), with an optional note. */
  onBrollAsk?: (range: [number, number], note: string) => void;
}) {
  const [moving, setMoving] = useState<{ id: string; dx: number } | null>(null);
  const placed = useMemo(() => timeline(edl), [edl]);
  const dur = edlDuration(edl);
  const tail = (edl.endCard ? END_CARD : 0) + 0.5;
  // While an edge of a shot is pulled the scale stays still: otherwise the whole timeline would slide under the pointer.
  const [held, setHeld] = useState<number | null>(null);
  const [trimming, setTrimming] = useState<string | null>(null);
  const { scroller, pps, setZoom, fitted } = useTimelineZoom(held ?? dur, LABEL_W, tail, time);
  const width = (dur + tail) * pps;
  const strip = useFilmstrip(src);
  const wave = useWaveform(src);
  const [help, setHelp] = useState(false);
  if (zoomRef) zoomRef.current = (dir) => setZoom((z) => (dir === 0 ? 1 : dir > 0 ? z * 1.5 : z / 1.5));
  useFollowPlayhead(scroller, time * pps, !!playing, LABEL_W, !!moving || held !== null);
  // Edges that pull what is dragged: the cuts between shots and the playhead.
  const edges = useMemo(() => [0, ...placed.map((s) => s.end), time], [placed, time]);
  const near = (t: number) => snap(t, edges, 8 / pps);

  const rushDur = (id: string) => rushes.find((r) => r.id === id)?.duration;
  const secAt = (clientX: number) => {
    const el = scroller.current;
    if (!el) return 0;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_W;
    return clamp(x / pps, 0, dur);
  };

  /* ---- Shots ---- */
  const trim = (e: React.PointerEvent, id: string, edge: "in" | "out") => {
    const base = edl;
    const s0 = base.segments.find((s) => s.id === id)!;
    if (e.button !== 0) return;
    onSelect({ kind: "seg", id });
    setHeld(dur);
    setTrimming(id);
    drag(
      e,
      (dx) => {
        const next = structuredClone(base);
        const s = next.segments.find((x) => x.id === id)!;
        // A shot played faster takes less room: one pixel is more seconds of the rush.
        const d = (dx / pps) * (s0.speed ?? 1);
        if (edge === "in") s.in = clamp(s0.in + d, 0, s0.out - 0.2);
        else s.out = clamp(s0.out + d, s0.in + 0.2, rushDur(id) ?? rushDur(s0.rush) ?? s0.out + 30);
        onChange(next);
      },
      () => (setHeld(null), setTrimming(null)),
    );
  };

  const move = (e: React.PointerEvent, id: string) => {
    drag(
      e,
      (dx) => setMoving({ id, dx }),
      (dx, moved) => {
        setMoving(null);
        const p = placed.find((s) => s.id === id)!;
        if (!moved) {
          onSelect({ kind: "seg", id });
          onSeek(p.start);
          return;
        }
        const center = ((p.start + p.end) / 2) * pps + dx;
        const others = placed.filter((s) => s.id !== id);
        const idx = others.filter((s) => ((s.start + s.end) / 2) * pps < center).length;
        const ids = others.map((s) => s.id);
        ids.splice(idx, 0, id);
        if (ids.join() !== placed.map((s) => s.id).join()) onChange(reorderKept(edl, ids));
      },
    );
  };

  /* ---- Zooms ---- */
  const zooms = edl.zooms ?? [];
  /** Moves or resizes a zoom or a B-roll shot (both are timeline spans). */
  const moveSpan = (e: React.PointerEvent, key: "zooms" | "broll", i: number, mode: "move" | "start" | "end") => {
    const base = edl;
    const z0 = base[key]![i];
    onSelect({ kind: key === "zooms" ? "zoom" : "broll", i });
    drag(e, (dx) => {
      const next = structuredClone(base);
      const z = next[key]![i];
      const d = dx / pps;
      if (mode === "move") {
        // The start snaps first, else the end.
        const at = near(z0.at + d);
        const end = near(z0.at + d + z0.dur);
        z.at = clamp(at !== z0.at + d ? at : end - z0.dur, 0, Math.max(0, dur - z0.dur));
      } else if (mode === "start") {
        const at = clamp(near(z0.at + d), 0, z0.at + z0.dur - 0.3);
        z.dur = z0.dur + (z0.at - at);
        z.at = at;
      } else z.dur = clamp(near(z0.at + z0.dur + d) - z0.at, 0.3, dur - z0.at);
      onChange(next);
    });
  };
  const moveZoom = (e: React.PointerEvent, i: number, mode: "move" | "start" | "end") => moveSpan(e, "zooms", i, mode);

  /* ---- B-roll ---- */
  const broll = edl.broll ?? [];
  const addBroll = (at: number, len = 2) => {
    at = clamp(at, 0, Math.max(0, dur - 1));
    const next = structuredClone(edl);
    next.broll = [...(next.broll ?? []), { at, dur: Math.max(0.5, Math.min(len, dur - at)), query: "illustration", mode: "full" as const }].sort((a, b) => a.at - b.at);
    onChange(next);
    onSelect({ kind: "broll", i: next.broll.findIndex((b) => b.at === at) });
  };
  /** On the empty B-roll track: a click adds a shot, a drag picks a passage (to ask Claude or to fill with one shot). */
  const brollDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const t0 = secAt(e.clientX);
    const x0 = e.clientX;
    drag(
      e,
      (dx) => {
        const t1 = clamp(secAt(x0 + dx), 0, dur);
        onSelect({ kind: "brange", a: Math.min(t0, t1), b: Math.max(t0, t1) });
      },
      (_dx, moved) => {
        if (!moved) addBroll(t0);
      },
    );
  };
  const editBroll = (i: number, patch: Partial<NonNullable<Edl["broll"]>[number]>, key?: string) => {
    const next = structuredClone(edl);
    const b = next.broll![i];
    // A new description typed by hand means a new search on the Mac; a shot picked in the list comes with its source.
    if (patch.query !== undefined && patch.source === undefined) Object.assign(b, { source: undefined, ref: undefined, thumb: undefined, url: undefined, from: undefined });
    if (patch.source !== undefined) Object.assign(b, { url: undefined, from: undefined });
    Object.assign(b, patch);
    for (const k of Object.keys(b) as (keyof typeof b)[]) if (b[k] === undefined) delete b[k];
    onChange(next, key);
  };
  const [picking, setPicking] = useState(false);
  const [askNote, setAskNote] = useState("");

  const addZoom = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const at = clamp(secAt(e.clientX), 0, Math.max(0, dur - 1));
    const next = structuredClone(edl);
    next.zooms = [...(next.zooms ?? []), { at, dur: Math.min(1.5, dur - at), scale: 1.12 }].sort((a, b) => a.at - b.at);
    onChange(next);
    onSelect({ kind: "zoom", i: next.zooms.findIndex((z) => z.at === at) });
  };

  /* ---- Hook ---- */
  const resizeTitle = (e: React.PointerEvent) => {
    const base = edl;
    onSelect({ kind: "title" });
    drag(e, (dx) => {
      const next = structuredClone(base);
      next.title!.until = clamp(near(base.title!.until + dx / pps), 0.5, Math.min(10, dur));
      onChange(next);
    });
  };

  const split = () => {
    const next = splitAt(edl, time);
    if (next) onChange(next);
  };

  const ticks = useMemo(() => {
    const step = [1, 2, 5, 10, 30, 60].find((x) => x * pps >= 56) ?? 120;
    const out = [];
    for (let t = 0; t <= dur + tail; t += step) out.push(t);
    return out;
  }, [dur, tail, pps]);

  const wv = (workerVersion ?? "").split(".").map((x) => parseInt(x, 10) || 0);
  /** An older Mac would render the shot at normal speed and the reframing as a moving zoom. */
  const oldMac = !!workerVersion && (wv[0] ?? 0) === 0 && (wv[1] ?? 0) < 12;
  /** An older Mac cuts the subtitles on its own and ignores the block limits set by hand. */
  const oldCaptions = !!workerVersion && (wv[0] ?? 0) === 0 && (wv[1] ?? 0) < 13;
  /** Picking a shot, its sound and its start, and asking Claude for B-roll need the Mac 0.13.0. */
  const oldBroll = oldCaptions;
  const brange = selection?.kind === "brange" ? selection : undefined;
  const selSeg = selection?.kind === "seg" ? edl.segments.find((s) => s.id === selection.id) : undefined;
  const selZoom = selection?.kind === "zoom" ? zooms[selection.i] : undefined;
  const selBroll = selection?.kind === "broll" ? broll[selection.i] : undefined;

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold">Timeline</h2>
        <span className="tabular font-mono text-[12px] text-ink-3">
          {fmtSec(time)} / {fmtSec(dur)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={split} disabled={!placed.some((s) => time > s.start + 0.15 && time < s.end - 0.15)} title="Coupe le plan sous le curseur en deux (S)">
            <Scissors className="size-3.5" /> Couper au curseur
          </Button>
          {onMark && (
            <Button size="sm" variant="ghost" onClick={onMark} title="Poser un repère avec une note pour Claude, à la tête de lecture (M)">
              <MapPin className="size-3.5" /> Repère
            </Button>
          )}
          {onRemove && (
            <Button size="sm" variant="ghost" onClick={onRemove} disabled={!selection || selection.kind === "title"} title="Retirer l'élément choisi (Suppr)">
              <Trash2 className="size-3.5" /> Retirer
            </Button>
          )}
          {undo && (
            <>
              <Button size="sm" variant="ghost" onClick={undo.undo} disabled={!undo.canUndo} aria-label="Annuler" title="Annuler (⌘Z)">
                <Undo2 className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={undo.redo} disabled={!undo.canRedo} aria-label="Rétablir" title="Rétablir (⇧⌘Z)">
                <Redo2 className="size-3.5" />
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => z / 1.5)} disabled={fitted} aria-label="Dézoomer la timeline" title="Dézoomer (−)">
            <Minus className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => z * 1.5)} aria-label="Zoomer la timeline" title="Zoomer (+, ou ⌘ + molette)">
            <Plus className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(1)} disabled={fitted} aria-label="Voir toute la vidéo" title="Voir toute la vidéo (0)">
            <Maximize2 className="size-3.5" />
          </Button>
          <div className="relative">
            <Button size="sm" variant="ghost" onClick={() => setHelp((h) => !h)} aria-expanded={help} aria-label="Raccourcis clavier" title="Raccourcis clavier">
              <Keyboard className="size-3.5" />
            </Button>
            {help && (
              <div className="absolute top-9 right-0 z-40 w-[330px] rounded-xl border border-line bg-surface p-3 text-[12px] shadow-card">
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
      </div>

      <div ref={scroller} className="scroll-thin relative overflow-x-auto select-none">
        <div style={{ width: width + LABEL_W }} className="relative">
          {/* Ruler: click or drag to move the playhead */}
          <div className="flex h-6 border-b border-line">
            <div className="sticky left-0 z-20 shrink-0 bg-surface" style={{ width: LABEL_W }} />
            <div
              className="relative flex-1 cursor-pointer overflow-hidden"
              onPointerDown={(e) => {
                onSeek(secAt(e.clientX));
                drag(e, (dx) => onSeek(secAt(e.clientX + dx)));
              }}
            >
              {ticks.map((t) => (
                <span key={t} className="tabular absolute top-0 h-full border-l border-line pl-1 font-mono text-[10px] leading-6 text-ink-3" style={{ left: t * pps }}>
                  {fmtSec(t)}
                </span>
              ))}
            </div>
          </div>

          {src && (
            <Track label="Vidéo" hint={stale ? "avant retouche" : undefined}>
              <div className="absolute inset-0 cursor-pointer" onPointerDown={(e) => onSeek(secAt(e.clientX))}>
                <Filmstrip strip={strip} pps={pps} height={44} dim={stale} />
                {!strip.frames.length && !strip.failed && <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-ink-3">Images de la vidéo…</span>}
              </div>
            </Track>
          )}

          <Track label="Plans">
            {placed.map((s, k) => {
              const on = selection?.kind === "seg" && selection.id === s.id;
              const dx = moving?.id === s.id ? moving.dx : 0;
              return (
                <div
                  key={s.id}
                  onPointerDown={(e) => move(e, s.id)}
                  className={cn(
                    "group absolute top-1.5 bottom-1.5 cursor-grab overflow-hidden rounded-md border text-[11px] active:cursor-grabbing",
                    on ? "z-10 border-accent bg-accent-soft" : "border-line-strong bg-surface-2",
                    dx && "z-20 opacity-80 shadow-card",
                  )}
                  style={{ left: s.start * pps, width: Math.max(6, (s.end - s.start) * pps - 2), transform: dx ? `translateX(${dx}px)` : undefined }}
                  title={s.text}
                >
                  <span className="pointer-events-none block truncate px-2 leading-8">
                    <span className="mr-1 font-mono text-ink-3">{k + 1}</span>
                    {s.speed && s.speed !== 1 && <span className="mr-1 rounded bg-accent/15 px-1 font-mono text-[10px] text-accent">×{s.speed}</span>}
                    {s.text}
                  </span>
                  {/* On a very short shot the two handles would cover it all: zoom in to trim it. */}
                  {((s.end - s.start) * pps >= 24 || trimming === s.id) && (
                    <>
                      <Handle side="left" onPointerDown={(e) => trim(e, s.id, "in")} label="Raccourcir le début" />
                      <Handle side="right" onPointerDown={(e) => trim(e, s.id, "out")} label="Raccourcir la fin" />
                    </>
                  )}
                </div>
              );
            })}
            {edl.endCard && (
              <div className="absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-md border border-dashed border-line-strong px-2 text-[11px] text-ink-3" style={{ left: dur * pps, width: END_CARD * pps - 2 }}>
                <span className="truncate">Fin · {edl.endCard.text}</span>
              </div>
            )}
          </Track>

          <Track label="Zooms" onClick={addZoom}>
            {zooms.map((z, i) => {
              const on = selection?.kind === "zoom" && selection.i === i;
              return (
                <div
                  key={i}
                  onPointerDown={(e) => moveZoom(e, i, "move")}
                  className={cn("absolute top-2 bottom-2 cursor-grab rounded-md border text-[10.5px]", on ? "z-10 border-accent bg-accent/25" : "border-accent/40 bg-accent/12")}
                  style={{ left: z.at * pps, width: Math.max(8, z.dur * pps) }}
                >
                  <span className="pointer-events-none flex items-center gap-1 truncate px-1.5 leading-6 text-ink-2">
                    {z.hold ? <Crop className="size-3 shrink-0" /> : <ZoomIn className="size-3 shrink-0" />}×{z.scale.toFixed(2)}
                  </span>
                  <Handle side="left" onPointerDown={(e) => moveZoom(e, i, "start")} label="Début du zoom" />
                  <Handle side="right" onPointerDown={(e) => moveZoom(e, i, "end")} label="Fin du zoom" />
                </div>
              );
            })}
          </Track>

          <Track label="B-roll" onPointerDown={brollDown}>
            {brange && (
              <div className="pointer-events-none absolute top-1 bottom-1 z-10 rounded-md border border-dashed border-accent bg-accent/10" style={{ left: brange.a * pps, width: Math.max(2, (brange.b - brange.a) * pps) }} />
            )}
            {broll.map((b, i) => {
              const on = selection?.kind === "broll" && selection.i === i;
              return (
                <div
                  key={i}
                  onPointerDown={(e) => moveSpan(e, "broll", i, "move")}
                  className={cn("absolute top-1.5 bottom-1.5 cursor-grab overflow-hidden rounded-md border text-[10.5px]", on ? "z-10 border-ok bg-ok/25" : "border-ok/40 bg-ok/12")}
                  style={{ left: b.at * pps, width: Math.max(8, b.dur * pps) }}
                  title={b.query}
                >
                  <span className="pointer-events-none flex h-full items-center gap-1 truncate px-1 text-ink-2">
                    {b.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.thumb} alt="" className="h-full max-h-7 w-auto shrink-0 rounded-sm" />
                    ) : (
                      <Clapperboard className="size-3 shrink-0" />
                    )}
                    <span className="truncate">{b.query}</span>
                  </span>
                  <span className="pointer-events-none absolute top-0.5 right-2 flex items-center gap-0.5 rounded bg-surface/85 px-0.5 text-ink-2">
                    {b.mode === "pip" ? <PictureInPicture2 className="size-3" aria-label="Incrusté" /> : <Maximize2 className="size-3" aria-label="Plein écran" />}
                    {!!b.sound && <Volume2 className="size-3" aria-label="Avec son" />}
                  </span>
                  <Handle side="left" onPointerDown={(e) => moveSpan(e, "broll", i, "start")} label="Début du plan" />
                  <Handle side="right" onPointerDown={(e) => moveSpan(e, "broll", i, "end")} label="Fin du plan" />
                </div>
              );
            })}
          </Track>

          {(edl.captions ?? captionStyle)?.on !== false && edl.segments.some((s) => s.words?.length) && (
            <Track label="Sous-titres">
              <CaptionBlocks
                edl={edl}
                style={edl.captions ?? captionStyle}
                pps={pps}
                pick={selection?.kind === "cap" ? selection : null}
                onPick={(p) => onSelect(p ? { kind: "cap", ...p } : null)}
                onChange={onChange}
                onSeek={onSeek}
              />
            </Track>
          )}

          <Track label="Texte">
            {edl.title && (
              <div
                onPointerDown={() => onSelect({ kind: "title" })}
                className={cn("absolute top-2 bottom-2 overflow-hidden rounded-md border text-[11px]", selection?.kind === "title" ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2")}
                style={{ left: 0, width: Math.max(8, Math.min(edl.title.until, dur) * pps) }}
              >
                <span className="pointer-events-none block truncate px-2 leading-6">Accroche · {edl.title.text}</span>
                <Handle side="right" onPointerDown={resizeTitle} label="Durée de l'accroche" />
              </div>
            )}
          </Track>

          {!!edl.texts?.length && onTextSel && (
            <Track label="Textes">
              <TextBlocks texts={edl.texts} pps={pps} total={dur} selected={textSel ?? null} onSelect={onTextSel} onChange={(texts, key) => onChange({ ...edl, texts }, key)} near={near} />
            </Track>
          )}

          {src && (
            <Track label="Son" hint={stale ? "avant retouche" : undefined}>
              {wave && !wave.silent ? (
                <div className="absolute inset-0 text-accent/70">
                  <Waveform wave={wave} pps={pps} height={43} dim={stale} />
                </div>
              ) : (
                <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-ink-3">{wave ? (wave.unavailable ? "Son non affiché" : "Sans son") : "Son de la vidéo…"}</span>
              )}
            </Track>
          )}

          {marks.length > 0 && (
            <Track label="Notes">
              {marks.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onSeek(m.t)}
                  title={m.text || "Dessin"}
                  className="absolute top-2 flex h-7 max-w-40 items-center gap-1 truncate rounded-r-full border border-l-2 border-warn/50 border-l-warn bg-warn/12 px-2 text-[11px] text-ink-2"
                  style={{ left: m.t * pps }}
                >
                  <span className="truncate">{m.text || "Dessin"}</span>
                </button>
              ))}
            </Track>
          )}

          {/* Playhead */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-accent" style={{ left: LABEL_W + time * pps }}>
            <span className="absolute -top-0.5 -left-1 size-2 rotate-45 bg-accent" />
          </div>
        </div>
      </div>

      {/* Inspector */}
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-[12px]">
        {selSeg ? (
          <>
            <span className="min-w-0 flex-1 truncate text-ink-2">« {selSeg.text || "…"} »</span>
            <Nudge
              label="Début"
              value={selSeg.in}
              onChange={(v) => {
                const next = structuredClone(edl);
                const s = next.segments.find((x) => x.id === selSeg.id)!;
                s.in = clamp(v, 0, s.out - 0.2);
                onChange(next, "inspector");
              }}
            />
            <Nudge
              label="Fin"
              value={selSeg.out}
              onChange={(v) => {
                const next = structuredClone(edl);
                const s = next.segments.find((x) => x.id === selSeg.id)!;
                s.out = clamp(v, s.in + 0.2, rushDur(s.rush) ?? v);
                onChange(next, "inspector");
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = structuredClone(edl);
                next.segments.find((x) => x.id === selSeg.id)!.kept = false;
                onChange(next, "inspector");
                onSelect(null);
              }}
            >
              <Trash2 className="size-3.5" /> Retirer le plan
            </Button>
            <label className={cn("flex items-center gap-1.5", oldMac && "opacity-50")} title={oldMac ? "Mets à jour le programme du Mac (version 0.12.0) pour changer la vitesse" : "Vitesse de lecture de ce plan. Pour un passage seulement : coupe-le d'abord avec S."}>
              <Gauge className="size-3.5 text-ink-3" />
              Vitesse
              <select
                aria-label="Vitesse du plan"
                disabled={oldMac}
                value={selSeg.speed ?? 1}
                onChange={(e) => {
                  const next = structuredClone(edl);
                  const s = next.segments.find((x) => x.id === selSeg.id)!;
                  const v = Number(e.target.value);
                  if (v === 1) delete s.speed;
                  else s.speed = v;
                  onChange(next);
                }}
                className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12px]"
              >
                {SPEEDS.map((v) => (
                  <option key={v} value={v}>
                    {v === 1 ? "Normale" : `×${String(v).replace(".", ",")}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : selZoom ? (
          <>
            <span className="text-ink-2">
              {selZoom.hold ? "Recadrage" : "Zoom"} à {fmtSec(selZoom.at)} pendant {selZoom.dur.toFixed(1)} s
            </span>
            <label className={cn("flex items-center gap-1.5", oldMac && "opacity-50")} title={oldMac ? "Mets à jour le programme du Mac (version 0.12.0) pour le plan serré fixe" : "Plan serré fixe : l'image reste agrandie tout le passage, sans mouvement"}>
              <input
                type="checkbox"
                disabled={oldMac && !selZoom.hold}
                checked={!!selZoom.hold}
                onChange={(e) => {
                  const next = structuredClone(edl);
                  const z = next.zooms![(selection as { i: number }).i];
                  if (e.target.checked) z.hold = true;
                  else {
                    delete z.hold;
                    z.scale = Math.min(1.4, z.scale);
                  }
                  onChange(next);
                }}
                className="size-4 accent-[var(--accent)]"
              />
              Plan serré fixe
            </label>
            <label className="flex items-center gap-2">
              Force
              <input
                type="range"
                min={1.02}
                max={selZoom.hold ? 2 : 1.4}
                step={0.01}
                value={selZoom.scale}
                onChange={(e) => {
                  const next = structuredClone(edl);
                  next.zooms![(selection as { i: number }).i].scale = Number(e.target.value);
                  onChange(next, "inspector");
                }}
                className="w-28 accent-[var(--accent)]"
              />
              <span className="tabular font-mono text-ink-3">×{selZoom.scale.toFixed(2)}</span>
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                const next = structuredClone(edl);
                next.zooms!.splice((selection as { i: number }).i, 1);
                onChange(next, "inspector");
                onSelect(null);
              }}
            >
              <Trash2 className="size-3.5" /> Supprimer le zoom
            </Button>
          </>
        ) : selection?.kind === "cap" ? (
          <>
            <CaptionInspector edl={edl} style={edl.captions ?? captionStyle} pick={selection} onPick={(p) => onSelect(p ? { kind: "cap", ...p } : null)} onChange={onChange} />
            {oldCaptions && <span className="text-[12px] text-warn">Mets à jour le programme du Mac (version 0.13.0) pour que les coupes et fusions de blocs passent dans la vidéo.</span>}
          </>
        ) : selBroll ? (
          <>
            {selBroll.thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selBroll.thumb} alt="" className="h-9 w-auto rounded" />
            )}
            <label className="flex min-w-48 flex-1 items-center gap-2">
              <span className="text-ink-3">Montrer</span>
              <input
                key={`${(selection as { i: number }).i}-${selBroll.query}`}
                defaultValue={selBroll.query}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== selBroll.query && editBroll((selection as { i: number }).i, { query: e.target.value.trim() })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="Par ex. pile de livres sur une table"
                className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent/60"
              />
            </label>
            <Button size="sm" onClick={() => setPicking(true)} disabled={oldBroll} title={oldBroll ? "Mets à jour le programme du Mac (version 0.13.0) pour choisir le plan" : "Choisir dans ton dossier du Mac, la bibliothèque ou Pexels"}>
              <Images className="size-3.5" /> {selBroll.source ? "Changer le plan" : "Choisir le plan"}
            </Button>
            <span className="text-ink-3">{selBroll.source === "mine" ? "Ton plan" : selBroll.source === "pexels" ? "Pexels" : selBroll.source === "library" ? "Bibliothèque" : "Le Mac cherchera"}</span>
            <BrollPicker
              open={picking}
              onOpenChange={setPicking}
              format={edl.format}
              query={selBroll.query}
              onPick={(p) => editBroll((selection as { i: number }).i, { ...p, query: p.query || selBroll.query })}
            />
            <label className={cn("flex items-center gap-1.5", oldBroll && "opacity-50")} title="Son du plan, sous ta voix">
              <Volume2 className="size-3.5 text-ink-3" />
              <select
                value={String(selBroll.sound ?? 0)}
                disabled={oldBroll}
                onChange={(e) => editBroll((selection as { i: number }).i, { sound: Number(e.target.value) || undefined })}
                className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12.5px] outline-none"
                aria-label="Son du plan"
              >
                <option value="0">Muet</option>
                <option value="0.2">Discret</option>
                <option value="0.5">Moyen</option>
                <option value="1">Fort</option>
              </select>
            </label>
            {selBroll.source && (
              <label className={cn("flex items-center gap-1.5", oldBroll && "opacity-50")} title="Seconde du plan où il commence (pour en montrer un autre moment)">
                <span className="text-ink-3">Début du plan</span>
                <input
                  type="number"
                  min={0}
                  max={600}
                  step={0.5}
                  disabled={oldBroll}
                  value={selBroll.from ?? 0}
                  onChange={(e) => editBroll((selection as { i: number }).i, { from: Math.max(0, Number(e.target.value) || 0) || undefined }, "broll-from")}
                  className="h-7 w-16 rounded-md border border-line-strong bg-surface px-1.5 text-[12.5px] outline-none"
                  aria-label="Début dans le plan (secondes)"
                />
                <span className="text-ink-3">s</span>
              </label>
            )}
            <Segmented
              label="Affichage"
              value={selBroll.mode}
              onChange={(mode) => editBroll((selection as { i: number }).i, { mode })}
              options={[
                { value: "full", label: "Plein écran" },
                { value: "pip", label: "Incrusté" },
              ]}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = structuredClone(edl);
                next.broll!.splice((selection as { i: number }).i, 1);
                onChange(next, "inspector");
                onSelect(null);
              }}
            >
              <Trash2 className="size-3.5" /> Retirer
            </Button>
          </>
        ) : brange ? (
          <>
            <span className="tabular font-mono text-ink-3">
              Passage {fmtSec(brange.a)} → {fmtSec(brange.b)}
            </span>
            {onBrollAsk && (
              <>
                <input
                  value={askNote}
                  onChange={(e) => setAskNote(e.target.value)}
                  maxLength={500}
                  placeholder="Consigne pour Claude (facultatif), par ex. des livres, pas de personnes"
                  aria-label="Consigne pour Claude"
                  className="h-7 min-w-48 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent/60"
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={oldBroll || brange.b - brange.a < 0.8}
                  title={oldBroll ? "Mets à jour le programme du Mac (version 0.13.0)" : brange.b - brange.a < 0.8 ? "Choisis un passage d'au moins une seconde" : "Claude place 1 à 3 plans dans ce passage, le reste ne bouge pas"}
                  onClick={() => {
                    onBrollAsk([brange.a, brange.b], askNote.trim());
                    setAskNote("");
                    onSelect(null);
                  }}
                >
                  <Sparkles className="size-3.5" /> Claude, propose du B-roll ici
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" disabled={brange.b - brange.a < 0.5} onClick={() => addBroll(brange.a, brange.b - brange.a)}>
              <Plus className="size-3.5" /> Un plan sur tout le passage
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
              Annuler
            </Button>
          </>
        ) : selection?.kind === "title" && edl.title ? (
          <span className="text-ink-2">Accroche affichée pendant {edl.title.until.toFixed(1)} s. Tire le bord droit pour changer la durée, et modifie le texte dans Réglages.</span>
        ) : (
          <span className="text-ink-3">Glisse un plan pour le déplacer, tire ses bords pour le raccourcir. Clique sur la piste Zooms ou B-roll pour en ajouter un. Glisse sur la piste B-roll pour choisir un passage et demander du B-roll à Claude.</span>
        )}
      </div>
    </div>
  );
}

function Track({ label, hint, children, onClick, onPointerDown }: { label: string; hint?: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void; onPointerDown?: (e: React.PointerEvent) => void }) {
  return (
    <div className={cn(TRACK, "flex")}>
      <div className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-line bg-surface px-2" style={{ width: LABEL_W }}>
        <span className="text-[11px] font-medium text-ink-2">{label}</span>
        {hint && <span className="text-[9.5px] leading-tight text-ink-3">{hint}</span>}
      </div>
      <div className={cn("relative flex-1", (onClick || onPointerDown) && "cursor-copy")} onClick={onClick} onPointerDown={onPointerDown}>
        {children}
      </div>
    </div>
  );
}

function Handle({ side, onPointerDown, label }: { side: "left" | "right"; onPointerDown: (e: React.PointerEvent) => void; label: string }) {
  return (
    <span
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute top-0 bottom-0 w-2 cursor-ew-resize bg-accent/0 transition-colors hover:bg-accent/60",
        side === "left" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
      )}
    />
  );
}

function Nudge({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-ink-3">{label}</span>
      <button onClick={() => onChange(value - 0.1)} className="press grid size-6 place-items-center rounded-md border border-line-strong" aria-label={`${label} −0,1 s`}>
        <Minus className="size-3" />
      </button>
      <span className="tabular w-12 text-center font-mono">{value.toFixed(2)}</span>
      <button onClick={() => onChange(value + 0.1)} className="press grid size-6 place-items-center rounded-md border border-line-strong" aria-label={`${label} +0,1 s`}>
        <Plus className="size-3" />
      </button>
    </span>
  );
}
