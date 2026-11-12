"use client";

import { Merge, Scissors, Star } from "lucide-react";
import { useRef, useState } from "react";
import { captionBlocks, mergeBlocks, moveBlockLimit, retextBlock, splitBlock, timeline, toTimeline, type CaptionBlock, type CaptionStyle, type Edl } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { fmtSec } from "./parts";

const EMOJIS = ["🔥", "💡", "✅", "❌", "👉", "🚀", "😅", "📚", "⚡", "❤️"];

/** A subtitle block chosen on the timeline: its shot and its first word (stable while the text does not change). */
export type CaptionPick = { seg: number; from: number; word?: number };

const wordsOf = (edl: Edl, b: CaptionBlock) => (edl.segments[b.seg].words ?? []).map((w, i) => ({ w, i })).filter((x) => x.i >= b.from && x.i <= b.to && !x.w.cut);
const textOf = (edl: Edl, b: CaptionBlock) => wordsOf(edl, b).map((x) => x.w.w).join(" ");

/**
 * The subtitle blocks on their track (the parent is the positioned track). Click to choose a block, double-click to
 * correct its text, pull the limit between two blocks to move where a sentence stops.
 */
export function CaptionBlocks({
  edl,
  style,
  pps,
  pick,
  onPick,
  onChange,
  onSeek,
}: {
  edl: Edl;
  style?: CaptionStyle;
  pps: number;
  pick: CaptionPick | null;
  onPick: (p: CaptionPick | null) => void;
  onChange: (next: Edl, key?: string) => void;
  onSeek: (t: number) => void;
}) {
  const blocks = captionBlocks(edl, style);
  const [editing, setEditing] = useState<string | null>(null);
  const base = useRef(edl);
  /** Pulls the limit between blocks a and b: the word whose start is nearest the pointer starts block b. */
  const pull = (e: React.PointerEvent, a: CaptionBlock, b: CaptionBlock) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    base.current = edl;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const placed = timeline(edl).find((x) => x.id === edl.segments[a.seg].id);
    if (!placed) return;
    // The words that can start the second block, with their place on the timeline.
    const words = [...wordsOf(edl, a).slice(1), ...wordsOf(edl, b)].map((x) => ({ i: x.i, t: toTimeline(placed, x.w.t0) }));
    if (!words.length) return;
    const key = `cap-limit:${a.seg}:${a.from}:${e.clientX}`;
    let last = b.from;
    const move = (ev: PointerEvent) => {
      const t = (ev.clientX - box.left) / pps;
      const best = words.reduce((p, w) => (Math.abs(w.t - t) < Math.abs(p.t - t) ? w : p), words[0]);
      if (!best || best.i === last) return;
      last = best.i;
      onChange(moveBlockLimit(base.current, a, b, best.i, style), key);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <>
      {blocks.map((b, k) => {
        const id = `${b.seg}:${b.from}`;
        const on = pick?.seg === b.seg && pick.from === b.from;
        const next = blocks[k + 1];
        const text = textOf(edl, b);
        return (
          <div key={id}>
            <div
              data-caption-block={id}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                onPick({ seg: b.seg, from: b.from });
                onSeek(b.start + 0.01);
              }}
              onDoubleClick={() => setEditing(id)}
              title={`${text} · double-clic pour corriger`}
              className={cn("absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border text-[11px]", on ? "z-10 border-accent bg-accent-soft" : "border-line-strong bg-surface-2 hover:border-accent/50")}
              style={{ left: b.start * pps, width: Math.max(6, (b.end - b.start) * pps - 1) }}
            >
              {editing === id ? (
                <input
                  autoFocus
                  defaultValue={text}
                  aria-label="Texte du sous-titre"
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    setEditing(null);
                    if (e.target.value.trim() && e.target.value.trim() !== text) onChange(retextBlock(edl, b, e.target.value, style));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      (e.target as HTMLInputElement).value = text;
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-full w-full bg-surface px-1.5 text-[11.5px] outline-none"
                />
              ) : (
                <span className="pointer-events-none block truncate px-1.5 leading-8">{text}</span>
              )}
            </div>
            {next && next.seg === b.seg && next.start - b.end < 0.6 && Math.min(b.end - b.start, next.end - next.start) * pps >= 10 && (
              <span
                onPointerDown={(e) => pull(e, b, next)}
                title="Tire pour déplacer la fin de la phrase"
                aria-hidden
                className="absolute top-1 bottom-1 z-20 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm bg-accent/0 hover:bg-accent/60"
                style={{ left: ((b.end + next.start) / 2) * pps, width: Math.min(8, ((b.end - b.start) * pps) / 3, ((next.end - next.start) * pps) / 3) }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** What can be done with the chosen subtitle block: correct, split, merge, colour a word, add an emoji. */
export function CaptionInspector({ edl, style, pick, onPick, onChange }: { edl: Edl; style?: CaptionStyle; pick: CaptionPick; onPick: (p: CaptionPick | null) => void; onChange: (next: Edl, key?: string) => void }) {
  const blocks = captionBlocks(edl, style);
  const k = blocks.findIndex((b) => b.seg === pick.seg && b.from === pick.from);
  const b = blocks[k];
  if (!b) return <span className="text-ink-3">Ce sous-titre a changé : choisis-le à nouveau sur la piste.</span>;
  const next = blocks[k + 1]?.seg === b.seg ? blocks[k + 1] : undefined;
  const words = wordsOf(edl, b);
  const word = words.find((x) => x.i === pick.word);
  const editWord = (fn: (w: (typeof words)[number]["w"]) => void) => {
    if (!word) return;
    const out = structuredClone(edl);
    fn(out.segments[b.seg].words![word.i]);
    onChange(out);
  };
  return (
    <>
      <span className="tabular font-mono text-ink-3">{fmtSec(b.start)}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
        {words.map((x) => (
          <button
            key={x.i}
            onClick={() => onPick({ ...pick, word: x.i === pick.word ? undefined : x.i })}
            className={cn("rounded px-1 py-0.5 text-[12.5px]", x.i === pick.word ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-surface-2", x.w.hl && "font-semibold text-accent")}
            title="Choisir ce mot (couleur, emoji, couper le bloc ici)"
          >
            {x.w.w}
            {x.w.emoji && <span className="ml-0.5">{x.w.emoji}</span>}
          </button>
        ))}
      </span>
      {word ? (
        <>
          <Button size="sm" variant={word.w.hl ? "primary" : "secondary"} onClick={() => editWord((w) => (w.hl = !w.hl || undefined))}>
            <Star className="size-3.5" /> En couleur
          </Button>
          <span className="flex items-center gap-0.5">
            {EMOJIS.map((em) => (
              <button key={em} onClick={() => editWord((w) => (w.emoji = w.emoji === em ? undefined : em))} className={cn("press grid size-7 place-items-center rounded-md text-[14px]", word.w.emoji === em ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-surface-2")}>
                {em}
              </button>
            ))}
          </span>
          <Button size="sm" variant="ghost" disabled={word.i === words[0]?.i} onClick={() => (onChange(splitBlock(edl, b.seg, word.i, style)), onPick({ seg: b.seg, from: b.from }))} title="Le sous-titre suivant commence à ce mot">
            <Scissors className="size-3.5" /> Couper ici
          </Button>
        </>
      ) : (
        <span className="text-ink-3">Double-clic sur le bloc pour corriger le texte. Clique sur un mot pour le mettre en couleur ou lui ajouter un emoji.</span>
      )}
      <Button size="sm" variant="ghost" disabled={!next} onClick={() => next && onChange(mergeBlocks(edl, b, next, style))} title="Réunir ce sous-titre et le suivant">
        <Merge className="size-3.5" /> Fusionner avec le suivant
      </Button>
    </>
  );
}
