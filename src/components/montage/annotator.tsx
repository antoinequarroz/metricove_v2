"use client";

import { ArrowUpRight, Circle, Pencil, Square, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MontageMark } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { fmtSec } from "./parts";

type Tool = "pen" | "arrow" | "rect" | "circle";
type Stroke = { tool: Tool; color: string; pts: [number, number][] };

const COLORS = ["#ff3b30", "#ffd60a", "#34d399", "#38bdf8", "#ffffff"];
const TOOLS: { value: Tool; label: string; Icon: typeof Pencil }[] = [
  { value: "pen", label: "Crayon", Icon: Pencil },
  { value: "arrow", label: "Flèche", Icon: ArrowUpRight },
  { value: "rect", label: "Cadre", Icon: Square },
  { value: "circle", label: "Cercle", Icon: Circle },
];

/** Draws strokes given in 0..1 coordinates on a canvas of size w × h. */
function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  const lw = Math.max(3, Math.round(Math.min(w, h) / 110));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (!s.pts.length) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = lw;
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = lw;
    const P = s.pts.map(([x, y]) => [x * w, y * h] as const);
    const [a, b] = [P[0], P.at(-1)!];
    ctx.beginPath();
    if (s.tool === "pen") P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    else if (s.tool === "rect") ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    else if (s.tool === "circle") ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
    else {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = lw * 5;
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - head * Math.cos(ang - 0.5), b[1] - head * Math.sin(ang - 0.5));
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - head * Math.cos(ang + 0.5), b[1] - head * Math.sin(ang + 0.5));
    }
    ctx.stroke();
  }
}

/**
 * Wraps the preview. While `active`, the video is paused and you draw on the frame,
 * then write what to change: the frame + drawing becomes a note for Claude.
 */
export function Annotator({
  video,
  active,
  version,
  onAdd,
  onClose,
  children,
}: {
  video: React.RefObject<HTMLVideoElement | null>;
  active: boolean;
  version: number;
  onAdd: (m: MontageMark) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (!active) return;
    const v = video.current;
    v?.pause();
    setAt(v?.currentTime ?? 0);
    setStrokes([]);
    setText("");
  }, [active, video]);

  // Redraw whenever the strokes or the size change.
  useEffect(() => {
    const c = canvas.current;
    const b = box.current;
    if (!active || !c || !b) return;
    const draw = () => {
      const r = b.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      paint(ctx, strokes, c.width, c.height);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(b);
    return () => ro.disconnect();
  }, [active, strokes]);

  const point = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = point(e);
    setStrokes((s) => [...s, { tool, color, pts: [p] }]);
  };
  const moveP = (e: React.PointerEvent) => {
    if (!e.buttons) return;
    const p = point(e);
    setStrokes((s) => {
      const last = s.at(-1);
      if (!last) return s;
      const pts = last.tool === "pen" ? [...last.pts, p] : [last.pts[0], p];
      return [...s.slice(0, -1), { ...last, pts }];
    });
  };

  /** The frame under the drawing, as a JPEG at most 720 px tall. */
  const snapshot = () => {
    const v = video.current;
    const r = box.current!.getBoundingClientRect();
    const ratio = r.width / r.height;
    const h = Math.min(720, v?.videoHeight || 720);
    const w = Math.round(h * ratio);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    try {
      if (v && v.videoWidth) {
        // object-contain: fit the frame inside the box
        const s = Math.min(w / v.videoWidth, h / v.videoHeight);
        const dw = v.videoWidth * s;
        const dh = v.videoHeight * s;
        ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    } catch {
      /* frame not readable: the drawing alone still helps */
    }
    paint(ctx, strokes, w, h);
    return c.toDataURL("image/jpeg", 0.82);
  };

  const add = () => {
    onAdd({ id: crypto.randomUUID().slice(0, 8), version, t: Math.round(at * 100) / 100, text: text.trim(), image: strokes.length ? snapshot() : undefined });
    onClose();
  };

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="relative">
        {children}
        {active && (
          <canvas
            ref={canvas}
            onPointerDown={down}
            onPointerMove={moveP}
            className="absolute inset-0 z-10 size-full cursor-crosshair touch-none rounded-2xl ring-2 ring-accent"
          />
        )}
      </div>
      {active && (
        <div className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-surface p-3 shadow-card">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tabular mr-1 font-mono text-[12px] text-ink-3">à {fmtSec(at)}</span>
            {TOOLS.map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={() => setTool(value)}
                aria-label={label}
                title={label}
                className={cn("press grid size-7 place-items-center rounded-md border", tool === value ? "border-accent bg-accent-soft" : "border-line-strong bg-surface")}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-line" />
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Couleur ${c}`}
                className={cn("size-5 rounded-full border border-line-strong", color === c && "ring-2 ring-accent ring-offset-1 ring-offset-surface")}
                style={{ background: c }}
              />
            ))}
            <button onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} aria-label="Annuler le dernier trait" className="press ml-auto grid size-7 place-items-center rounded-md text-ink-2 hover:bg-surface-2 disabled:opacity-40">
              <Undo2 className="size-3.5" />
            </button>
            <button onClick={onClose} aria-label="Fermer sans ajouter" className="press grid size-7 place-items-center rounded-md text-ink-2 hover:bg-surface-2">
              <X className="size-3.5" />
            </button>
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Qu'est-ce qu'il faut changer ici ? Par ex. « sous-titre plus haut, il cache ma bouche »"
            className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent/60"
          />
          <div className="flex justify-end">
            <Button size="sm" variant="primary" onClick={add} disabled={!text.trim() && !strokes.length}>
              Ajouter la note
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
