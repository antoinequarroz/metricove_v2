"use client";

import { Minus, Plus, Scissors, Trash2, ZoomIn } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { edlDuration, reorderKept, splitAt, timeline, type Edl, type MontageMark, type Rush } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { fmtSec } from "./parts";

export type Selection = { kind: "seg"; id: string } | { kind: "zoom"; i: number } | { kind: "title" } | null;

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
}: {
  edl: Edl;
  onChange: (next: Edl) => void;
  time: number;
  onSeek: (t: number) => void;
  marks: MontageMark[];
  rushes: Rush[];
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const [pps, setPps] = useState(48);
  const [moving, setMoving] = useState<{ id: string; dx: number } | null>(null);
  const placed = useMemo(() => timeline(edl), [edl]);
  const dur = edlDuration(edl);
  const width = (dur + (edl.endCard ? END_CARD : 0) + 1.5) * pps;
  const scroller = useRef<HTMLDivElement>(null);

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
    onSelect({ kind: "seg", id });
    drag(e, (dx) => {
      const next = structuredClone(base);
      const s = next.segments.find((x) => x.id === id)!;
      const d = dx / pps;
      if (edge === "in") s.in = clamp(s0.in + d, 0, s0.out - 0.2);
      else s.out = clamp(s0.out + d, s0.in + 0.2, rushDur(id) ?? rushDur(s0.rush) ?? s0.out + 30);
      onChange(next);
    });
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
  const moveZoom = (e: React.PointerEvent, i: number, mode: "move" | "start" | "end") => {
    const base = edl;
    const z0 = base.zooms![i];
    onSelect({ kind: "zoom", i });
    drag(e, (dx) => {
      const next = structuredClone(base);
      const z = next.zooms![i];
      const d = dx / pps;
      if (mode === "move") z.at = clamp(z0.at + d, 0, Math.max(0, dur - z0.dur));
      else if (mode === "start") {
        const at = clamp(z0.at + d, 0, z0.at + z0.dur - 0.3);
        z.dur = z0.dur + (z0.at - at);
        z.at = at;
      } else z.dur = clamp(z0.dur + d, 0.3, dur - z0.at);
      onChange(next);
    });
  };
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
      next.title!.until = clamp(base.title!.until + dx / pps, 0.5, Math.min(10, dur));
      onChange(next);
    });
  };

  const split = () => {
    const next = splitAt(edl, time);
    if (next) onChange(next);
  };

  const ticks = useMemo(() => {
    const step = pps >= 60 ? 1 : pps >= 25 ? 2 : 5;
    const out = [];
    for (let t = 0; t <= dur + END_CARD; t += step) out.push(t);
    return out;
  }, [dur, pps]);

  const selSeg = selection?.kind === "seg" ? edl.segments.find((s) => s.id === selection.id) : undefined;
  const selZoom = selection?.kind === "zoom" ? zooms[selection.i] : undefined;

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold">Timeline</h2>
        <span className="tabular font-mono text-[12px] text-ink-3">
          {fmtSec(time)} / {fmtSec(dur)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={split} disabled={!placed.some((s) => time > s.start + 0.15 && time < s.end - 0.15)} title="Coupe le plan sous le curseur en deux">
            <Scissors className="size-3.5" /> Couper au curseur
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPps((p) => Math.max(10, p / 1.4))} aria-label="Dézoomer la timeline">
            <Minus className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPps((p) => Math.min(240, p * 1.4))} aria-label="Zoomer la timeline">
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      <div ref={scroller} className="scroll-thin relative overflow-x-auto select-none">
        <div style={{ width: width + LABEL_W }} className="relative">
          {/* Ruler: click or drag to move the playhead */}
          <div className="flex h-6 border-b border-line">
            <div className="sticky left-0 z-20 shrink-0 bg-surface" style={{ width: LABEL_W }} />
            <div
              className="relative flex-1 cursor-pointer"
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
                    {s.text}
                  </span>
                  <Handle side="left" onPointerDown={(e) => trim(e, s.id, "in")} label="Raccourcir le début" />
                  <Handle side="right" onPointerDown={(e) => trim(e, s.id, "out")} label="Raccourcir la fin" />
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
                    <ZoomIn className="size-3 shrink-0" />×{z.scale.toFixed(2)}
                  </span>
                  <Handle side="left" onPointerDown={(e) => moveZoom(e, i, "start")} label="Début du zoom" />
                  <Handle side="right" onPointerDown={(e) => moveZoom(e, i, "end")} label="Fin du zoom" />
                </div>
              );
            })}
          </Track>

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
                onChange(next);
              }}
            />
            <Nudge
              label="Fin"
              value={selSeg.out}
              onChange={(v) => {
                const next = structuredClone(edl);
                const s = next.segments.find((x) => x.id === selSeg.id)!;
                s.out = clamp(v, s.in + 0.2, rushDur(s.rush) ?? v);
                onChange(next);
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = structuredClone(edl);
                next.segments.find((x) => x.id === selSeg.id)!.kept = false;
                onChange(next);
                onSelect(null);
              }}
            >
              <Trash2 className="size-3.5" /> Retirer le plan
            </Button>
          </>
        ) : selZoom ? (
          <>
            <span className="text-ink-2">
              Zoom à {fmtSec(selZoom.at)} pendant {selZoom.dur.toFixed(1)} s
            </span>
            <label className="flex items-center gap-2">
              Force
              <input
                type="range"
                min={1.02}
                max={1.4}
                step={0.01}
                value={selZoom.scale}
                onChange={(e) => {
                  const next = structuredClone(edl);
                  next.zooms![(selection as { i: number }).i].scale = Number(e.target.value);
                  onChange(next);
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
                onChange(next);
                onSelect(null);
              }}
            >
              <Trash2 className="size-3.5" /> Supprimer le zoom
            </Button>
          </>
        ) : selection?.kind === "title" && edl.title ? (
          <span className="text-ink-2">Accroche affichée pendant {edl.title.until.toFixed(1)} s. Tire le bord droit pour changer la durée, et modifie le texte dans Réglages.</span>
        ) : (
          <span className="text-ink-3">Glisse un plan pour le déplacer, tire ses bords pour le raccourcir. Clique sur la piste Zooms pour en ajouter un.</span>
        )}
      </div>
    </div>
  );
}

function Track({ label, hint, children, onClick }: { label: string; hint?: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <div className={cn(TRACK, "flex")}>
      <div className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-line bg-surface px-2" style={{ width: LABEL_W }}>
        <span className="text-[11px] font-medium text-ink-2">{label}</span>
        {hint && <span className="text-[9.5px] leading-tight text-ink-3">{hint}</span>}
      </div>
      <div className={cn("relative flex-1", onClick && "cursor-copy")} onClick={onClick}>
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
