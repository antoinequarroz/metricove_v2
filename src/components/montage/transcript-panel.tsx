"use client";

import { Eye, EyeOff, MessageSquarePlus, Scissors, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { timeline, toTimeline, type Edl } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { fmtSec } from "./parts";

type Pick = { seg: string; a: number; b: number };

/**
 * The transcript of the edit: a click on a word goes to that moment, Maj + clic picks a run of words (to cut, put back or
 * comment), a double-click corrects the word (its timing does not move). The eye cuts or puts back a whole passage.
 */
export function TranscriptPanel({
  edl,
  time,
  onSeek,
  edit,
  onComment,
}: {
  edl: Edl;
  time: number;
  onSeek: (t: number) => void;
  edit: (fn: (e: Edl) => Edl) => void;
  /** A review note on the words picked (timeline second, the words). */
  onComment?: (t: number, words: string) => void;
}) {
  const placed = timeline(edl);
  const [pick, setPick] = useState<Pick | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** The last word clicked: Maj + clic picks from it. */
  const [anchor, setAnchor] = useState<{ seg: string; i: number } | null>(null);
  useEffect(() => setPick((p) => (p && edl.segments.some((s) => s.id === p.seg) ? p : null)), [edl]);

  const at = (segId: string, wi: number) => {
    const p = placed.find((x) => x.id === segId);
    const w = p?.words?.[wi];
    return p && w ? toTimeline(p, w.t0) : undefined;
  };
  // The word being said: highlighted while the video plays.
  let live = "";
  for (const p of placed) {
    if (time < p.start || time >= p.end) continue;
    p.words?.forEach((w, i) => {
      if (!w.cut && toTimeline(p, w.t0) <= time + 0.02) live = `${p.id}:${i}`;
    });
  }

  const picked = pick ? edl.segments.find((s) => s.id === pick.seg) : undefined;
  const pickedWords = picked?.words?.slice(pick!.a, pick!.b + 1) ?? [];
  const allCut = pickedWords.length > 0 && pickedWords.every((w) => w.cut);
  const setCut = (cut: boolean) => {
    if (!pick) return;
    edit((e) => {
      const s = e.segments.find((x) => x.id === pick.seg);
      // A passage is never emptied by the words cut: then the eye cuts the whole passage.
      const ws = s?.words;
      if (!ws) return e;
      for (let i = pick.a; i <= pick.b; i++) {
        if (cut) ws[i].cut = true;
        else delete ws[i].cut;
      }
      if (ws.every((w) => w.cut)) for (let i = pick.a; i <= pick.b; i++) delete ws[i].cut;
      return e;
    });
    setPick(null);
  };

  return (
    <>
      <p className="text-[12px] text-pretty text-ink-3">
        Clique sur un mot pour aller à ce moment, Maj + clic pour choisir plusieurs mots (les couper ou les commenter), double-clic pour corriger un mot. L&apos;œil coupe ou remet tout le passage.
      </p>
      {pick && pickedWords.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-surface px-2.5 py-1.5 text-[12px] shadow-card">
          <span className="min-w-0 flex-1 truncate text-ink-2">
            {pickedWords.length} mot{pickedWords.length > 1 ? "s" : ""} : « {pickedWords.map((w) => w.w).join(" ")} »
          </span>
          {allCut ? (
            <Button size="sm" variant="ghost" onClick={() => setCut(false)}>
              <Undo2 className="size-3.5" /> Remettre
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setCut(true)}>
              <Scissors className="size-3.5" /> Couper
            </Button>
          )}
          {onComment && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const t = at(pick.seg, pick.a);
                if (t !== undefined) onComment(t, pickedWords.map((w) => w.w).join(" "));
                setPick(null);
              }}
            >
              <MessageSquarePlus className="size-3.5" /> Commenter
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPick(null)}>
            Annuler
          </Button>
        </div>
      )}
      <ol className="flex flex-col gap-1.5">
        {edl.segments.map((s, i) => {
          const p = placed.find((x) => x.id === s.id);
          return (
            <li key={s.id} className={cn("group flex gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-150", s.kept ? "border-line bg-surface" : "border-dashed border-line bg-transparent")}>
              <button
                onClick={() => edit((e) => ((e.segments[i].kept = !e.segments[i].kept), e))}
                aria-label={s.kept ? "Couper ce passage" : "Remettre ce passage"}
                title={s.kept ? "Couper ce passage" : "Remettre ce passage"}
                className={cn("press mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", s.kept ? "text-ink-2 hover:bg-surface-2" : "text-ink-3 hover:bg-surface-2")}
              >
                {s.kept ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2 text-[11px] text-ink-3">
                  {p ? (
                    <button onClick={() => onSeek(p.start)} className="tabular font-mono hover:text-accent">
                      {fmtSec(p.start)}
                    </button>
                  ) : (
                    <span className="rounded bg-ink/5 px-1.5 py-px font-medium">Coupé{s.reason ? ` · ${s.reason}` : ""}</span>
                  )}
                  <span className="tabular font-mono">{((s.out - s.in) / (s.speed ?? 1)).toFixed(1)} s</span>
                </div>
                <p className={cn("text-[13.5px] leading-relaxed", !s.kept && "text-ink-3 line-through decoration-ink-3/60")}>
                  {s.words?.length
                    ? s.words.map((w, wi) => {
                        const id = `${s.id}:${wi}`;
                        const on = pick?.seg === s.id && wi >= pick.a && wi <= pick.b;
                        if (editing === id)
                          return (
                            <WordInput
                              key={wi}
                              value={w.w}
                              onDone={(t) => {
                                setEditing(null);
                                if (t && t !== w.w)
                                  edit((e) => {
                                    e.segments[i].words![wi].w = t;
                                    e.segments[i].text = e.segments[i].words!.map((x) => x.w).join(" ");
                                    return e;
                                  });
                              }}
                            />
                          );
                        return (
                          <span key={wi}>
                            <button
                              disabled={!s.kept}
                              onClick={(e) => {
                                if (e.shiftKey) {
                                  const from = anchor?.seg === s.id ? anchor.i : wi;
                                  setPick({ seg: s.id, a: Math.min(from, wi), b: Math.max(from, wi) });
                                  if (anchor?.seg !== s.id) setAnchor({ seg: s.id, i: wi });
                                  return;
                                }
                                setPick(null);
                                setAnchor({ seg: s.id, i: wi });
                                const t = at(s.id, wi);
                                if (t !== undefined) onSeek(t);
                              }}
                              onDoubleClick={() => setEditing(id)}
                              title={w.cut ? "Mot coupé" : undefined}
                              className={cn(
                                "rounded px-px enabled:hover:bg-accent-soft enabled:hover:text-ink",
                                w.cut && "text-ink-3 line-through decoration-ink-3/70",
                                live === id && !on && "bg-accent/20 text-ink",
                                on && "bg-accent text-white enabled:hover:bg-accent enabled:hover:text-white",
                              )}
                            >
                              {w.w}
                            </button>{" "}
                          </span>
                        );
                      })
                    : s.text}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function WordInput({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onDone(value);
      }}
      aria-label="Corriger le mot"
      className="mx-0.5 rounded border border-accent bg-accent-soft px-1 text-[13.5px] outline-none"
      style={{ width: `${Math.max(3, text.length + 1)}ch` }}
    />
  );
}
