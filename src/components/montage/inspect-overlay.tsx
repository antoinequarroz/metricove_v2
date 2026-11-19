"use client";

import { MessageSquarePlus, MousePointerClick, PencilLine, X } from "lucide-react";
import { useMemo, useState } from "react";
import { captionBlocks, DEFAULT_CAPTIONS, edlDuration, STAGE_LABEL, TEXT_SIZE, type CaptionStyle, type Edl, type NoteTargetKind } from "@/lib/montage";
import { cn } from "@/lib/utils";

// « Inspecter » (V) on the face-cam review screen: the elements of the picture at this moment, drawn as boxes over the
// video. A click shows where the element is and how big; it can be commented (a review note aimed at it) or edited.
// The places are those the Mac uses (worker/montage/lib/hf.mjs, stage.mjs); captions placed « auto » follow the face on
// the Mac, here they are shown at the bottom.

export type InspectEl = {
  id: string;
  kind: NoteTargetKind;
  label: string;
  /** Box in 0..1 of the picture. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** What « Modifier » opens: a free text, a key moment, a B-roll shot, the subtitles, the hook. */
  ref?: { text?: string; stage?: number; broll?: number };
  round?: boolean;
};

const SPEECH_TAIL = 0.05;

export function elementsAt(edl: Edl, t: number, style?: CaptionStyle): InspectEl[] {
  const [W, H] = edl.format.split(":").map(Number);
  const portrait = H >= W;
  const out: InspectEl[] = [];
  const speechEnd = edlDuration(edl);
  if (edl.endCard?.text && t >= speechEnd - SPEECH_TAIL) {
    out.push({ id: "end", kind: "end", label: `Carton de fin « ${edl.endCard.text} »`, x: 0, y: 0, w: 1, h: 1 });
    return out;
  }
  const stageI = (edl.stages ?? []).findIndex((s) => t >= s.at && t < s.at + s.dur);
  const stage = stageI >= 0 ? edl.stages![stageI] : undefined;
  (edl.broll ?? []).forEach((b, i) => {
    if (t < b.at || t >= b.at + b.dur) return;
    if (b.mode === "pip") {
      const w = portrait ? 0.4 : 0.32;
      const h = (w * (W / H)) * (portrait ? 1.25 : 0.5625);
      out.push({ id: `broll-${i}`, kind: "broll", label: `B-roll incrusté « ${b.query} »`, x: 1 - w - 0.05, y: portrait ? 0.07 : 0.06, w, h, ref: { broll: i } });
    } else out.push({ id: `broll-${i}`, kind: "broll", label: `B-roll « ${b.query} »`, x: 0, y: 0, w: 1, h: 1, ref: { broll: i } });
  });
  if (stage) {
    const label = `${STAGE_LABEL[stage.kind]} « ${stage.title} »`;
    if (stage.kind === "split") {
      out.push(portrait ? { id: "stage", kind: "stage", label, x: 0, y: 0, w: 1, h: 0.5, ref: { stage: stageI } } : { id: "stage", kind: "stage", label, x: 0, y: 0, w: 0.5, h: 1, ref: { stage: stageI } });
      out.push(portrait ? { id: "face", kind: "face", label: "Visage (moitié basse)", x: 0, y: 0.5, w: 1, h: 0.5 } : { id: "face", kind: "face", label: "Visage (moitié droite)", x: 0.5, y: 0, w: 0.5, h: 1 });
    } else {
      out.push({ id: "stage", kind: "stage", label, x: 0, y: 0, w: 1, h: 1, ref: { stage: stageI } });
      if (stage.kind === "pip") {
        const d = (Math.min(W, H) * 0.36) / W, m = (Math.min(W, H) * 0.06) / W;
        out.push({ id: "face", kind: "face", label: "Visage en pastille", x: 1 - d - m, y: portrait ? 0.07 : m * (W / H), w: d, h: d * (W / H), round: true });
      }
    }
  }
  if (edl.title?.text && t < edl.title.until) out.push({ id: "title", kind: "title", label: `Accroche « ${edl.title.text} »`, x: 0.06, y: 0.15, w: 0.88, h: portrait ? 0.08 : 0.14 });
  const cs = style ?? edl.captions ?? DEFAULT_CAPTIONS;
  if (cs.on !== false) {
    const block = captionBlocks(edl, cs).find((b) => t >= b.start - 0.04 && t < b.end + 0.3);
    if (block) {
      const words = edl.segments[block.seg]?.words?.slice(block.from, block.to + 1).filter((w) => !w.cut).map((w) => w.w).join(" ") ?? "";
      const h = portrait ? 0.14 : 0.18;
      const top = stage?.kind === "split" && portrait ? 0.5 - h / 2 : cs.position === "top" ? (portrait ? 0.12 : 0.07) : cs.position === "middle" ? 0.5 - h / 2 : portrait ? 0.705 : 0.76;
      out.push({ id: "caption", kind: "caption", label: `Sous-titre « ${words.slice(0, 60)}${words.length > 60 ? "…" : ""} »`, x: 0.06, y: top, w: 0.88, h });
    }
  }
  for (const tx of edl.texts ?? []) {
    if (t < tx.start || t >= tx.end) continue;
    const h = Math.min(0.9, (TEXT_SIZE[tx.size] * 1.3 * (tx.text.split("\n").length || 1)) / (1080 * (H / W)));
    const w = Math.min(0.9, (Math.max(...tx.text.split("\n").map((l) => l.length)) * TEXT_SIZE[tx.size] * 0.55) / 1080);
    out.push({ id: `text-${tx.id}`, kind: "text", label: `Texte « ${tx.text.slice(0, 40)} »`, x: Math.max(0, tx.x - w / 2), y: Math.max(0, tx.y - h / 2), w, h, ref: { text: tx.id } });
  }
  return out;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

export function InspectOverlay({
  edl,
  time,
  style,
  onComment,
  onEdit,
  onClose,
}: {
  edl: Edl;
  time: number;
  style?: CaptionStyle;
  onComment: (el: InspectEl) => void;
  onEdit: (el: InspectEl) => void;
  onClose: () => void;
}) {
  const els = useMemo(() => elementsAt(edl, time, style), [edl, time, style]);
  const [picked, setPicked] = useState<string | null>(null);
  const el = els.find((e) => e.id === picked);
  // The smallest boxes on top: a subtitle over a full-screen card stays clickable.
  const sorted = [...els].sort((a, b) => b.w * b.h - a.w * a.h);
  return (
    <div className="absolute inset-0 z-20 cursor-crosshair overflow-hidden rounded-[inherit] bg-ink/10" onClick={(e) => e.target === e.currentTarget && setPicked(null)}>
      {sorted.map((e) => (
        <button
          key={e.id}
          onClick={() => setPicked(e.id)}
          aria-label={e.label}
          title={e.label}
          className={cn(
            "absolute border-2 border-dashed transition-colors",
            e.round ? "rounded-full" : "rounded-md",
            picked === e.id ? "border-accent bg-accent/25" : "border-white/80 bg-white/5 hover:border-accent hover:bg-accent/15",
          )}
          style={{ left: pct(e.x), top: pct(e.y), width: pct(e.w), height: pct(e.h) }}
        />
      ))}
      <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-ink/75 px-2 py-1 text-[11.5px] text-white">
        <MousePointerClick className="size-3.5" /> {els.length ? "Clique un élément" : "Rien à inspecter à ce moment"}
      </div>
      <button onClick={onClose} aria-label="Fermer l'inspecteur" className="press absolute top-2 right-2 grid size-7 place-items-center rounded-md bg-ink/75 text-white">
        <X className="size-3.5" />
      </button>
      {el && (
        <div className="absolute inset-x-2 bottom-2 rounded-lg border border-line bg-surface p-2.5 text-[12px] shadow-card">
          <p className="mb-1 truncate font-medium">{el.label}</p>
          <p className="tabular mb-2 text-ink-3">
            Position {pct(el.x + el.w / 2)} · {pct(el.y + el.h / 2)} — taille {pct(el.w)} × {pct(el.h)} de l&apos;image
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => onComment(el)} className="press inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 font-medium text-white">
              <MessageSquarePlus className="size-3.5" /> Commenter
            </button>
            {el.kind !== "face" && (
              <button onClick={() => onEdit(el)} className="press inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 font-medium">
                <PencilLine className="size-3.5" /> {el.kind === "text" ? "Déplacer ou modifier" : "Modifier"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
