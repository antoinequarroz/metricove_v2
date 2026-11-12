"use client";

import { Plus, Trash2, Type } from "lucide-react";
import { useRef } from "react";
import { MAX_TEXTS, TEXT_SIZE, type FreeText } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Segmented } from "./controls";
import { inputClass } from "./look-parts";
import { fmtSec } from "./parts";

const MIN = 0.5;
const round = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A new text at `time`, three seconds long, in the middle of the picture. */
export function newText(time: number, total: number): FreeText {
  const start = round(clamp(time, 0, Math.max(0, total - MIN)));
  return { id: `t-${crypto.randomUUID().slice(0, 8)}`, text: "Ton texte", start, end: round(Math.min(Math.max(total, start + MIN), start + 3)), x: 0.5, y: 0.5, size: "m", style: "plain" };
}

/**
 * The texts as blocks of a timeline track (the parent is the positioned row). Drag a block to move it in time,
 * pull an edge to change when it shows or leaves. `near` pulls a time to the edges around it (snapping).
 */
export function TextBlocks({ texts, pps, total, selected, onSelect, onChange, near, className }: { texts: FreeText[]; pps: number; total: number; selected: string | null; onSelect: (id: string) => void; onChange: (next: FreeText[], key?: string) => void; near?: (t: number) => number; className?: string }) {
  const live = useRef(texts);
  live.current = texts;
  const grab = (e: React.PointerEvent, t0: FreeText, part: "move" | "start" | "end") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(t0.id);
    const x0 = e.clientX;
    const pull = near ?? ((t: number) => t);
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / pps;
      if (Math.abs(ev.clientX - x0) < 3) return;
      let { start, end } = t0;
      if (part === "start") start = clamp(pull(t0.start + d), 0, t0.end - MIN);
      else if (part === "end") end = clamp(pull(t0.end + d), t0.start + MIN, Math.max(total, t0.start + MIN));
      else {
        const len = t0.end - t0.start;
        start = clamp(pull(t0.start + d), 0, Math.max(0, total - len));
        end = start + len;
      }
      // One drag is one step to undo: every move carries the same key.
      onChange(live.current.map((t) => (t.id === t0.id ? { ...t, start: round(start), end: round(end) } : t)), `text-drag:${t0.id}:${part}:${x0}`);
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
      {texts.map((t) => {
        const on = selected === t.id;
        const handle = "absolute inset-y-0 w-2 cursor-ew-resize touch-none bg-accent/0 hover:bg-accent/60";
        return (
          <div
            key={t.id}
            onPointerDown={(e) => grab(e, t, "move")}
            title={`${t.text} · ${fmtSec(t.start)} – ${fmtSec(t.end)}`}
            data-text-block={t.id}
            className={cn("absolute cursor-grab touch-none overflow-hidden rounded-md border text-[11px] active:cursor-grabbing", on ? "z-10 border-accent bg-accent-soft" : "border-line-strong bg-surface-2", className ?? "top-1.5 bottom-1.5")}
            style={{ left: t.start * pps, width: Math.max(10, (t.end - t.start) * pps - 2) }}
          >
            <span className="pointer-events-none flex h-full items-center gap-1 truncate px-2">
              <Type className="size-3 shrink-0 text-ink-3" />
              <span className="truncate">{t.text}</span>
            </span>
            {(t.end - t.start) * pps >= 24 && (
              <>
                <span aria-hidden onPointerDown={(e) => grab(e, t, "start")} className={cn(handle, "left-0 rounded-l-md")} />
                <span aria-hidden onPointerDown={(e) => grab(e, t, "end")} className={cn(handle, "right-0 rounded-r-md")} />
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

/** The list of the texts and the settings of the chosen one. */
export function TextPanel({ texts, selected, onSelect, onChange, time, total, onSeek, disabled, workerVersion }: { texts: FreeText[]; selected: string | null; onSelect: (id: string | null) => void; onChange: (next: FreeText[], key?: string) => void; time: number; total: number; onSeek?: (t: number) => void; disabled?: boolean; /** Version of the Mac program: texts need 0.11.0. */ workerVersion?: string }) {
  const cur = texts.find((t) => t.id === selected);
  const patch = (p: Partial<FreeText>, key?: string) => cur && onChange(texts.map((t) => (t.id === cur.id ? { ...t, ...p } : t)), key && `${key}:${cur.id}`);
  const add = () => {
    const t = newText(Math.max(0, time), total);
    onChange([...texts, t]);
    onSelect(t.id);
  };
  const v = (workerVersion ?? "").split(".").map((x) => parseInt(x, 10) || 0);
  const old = !!workerVersion && (v[0] ?? 0) === 0 && (v[1] ?? 0) < 11;
  const row = "flex items-center gap-2 text-[12px] text-ink-2";
  const slider = (label: string, key: "x" | "y" | "start" | "end", min: number, max: number, step: number, show: string) =>
    cur && (
      <label className={row}>
        <span className="w-24 shrink-0">{label}</span>
        <input type="range" min={min} max={max} step={step} value={cur[key]} onChange={(e) => patch({ [key]: Number(e.target.value) }, key)} aria-label={label} className="min-w-0 flex-1 accent-[var(--accent)]" />
        <span className="tabular w-12 text-right font-mono text-[11.5px]">{show}</span>
      </label>
    );
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 text-[13px]", disabled && "pointer-events-none opacity-60")}>
      <div className="flex items-center gap-2">
        <p className="flex flex-1 items-center gap-1.5 text-[12.5px] font-medium">
          <Type className="size-3.5 text-accent" /> Textes sur la vidéo
        </p>
        <button onClick={add} disabled={texts.length >= MAX_TEXTS || total <= 0} className="press inline-flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] font-medium disabled:opacity-40" title="Ajoute un texte à l'endroit où tu es dans la vidéo">
          <Plus className="size-3.5" /> Ajouter un texte
        </button>
      </div>
      {old && <p className="text-[12px] text-warn">Le programme de ton Mac est trop ancien pour les textes (version 0.11.0) : mets-le à jour, sinon ils ne seront pas dessinés.</p>}
      {!texts.length && <p className="text-[12px] text-ink-3">Aucun texte pour le moment. Place-toi dans la vidéo, puis clique sur « Ajouter un texte » : il apparaît à cet endroit pendant 3 secondes, et tu le règles ici.</p>}
      {texts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {[...texts]
            .sort((a, b) => a.start - b.start)
            .map((t) => (
              <li key={t.id}>
                <button onClick={() => (onSelect(t.id), onSeek?.(t.start + 0.3))} className={cn("press inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-lg border px-2 text-[12px]", t.id === selected ? "border-accent bg-accent-soft font-medium" : "border-line-strong bg-surface")}>
                  <span className="tabular shrink-0 font-mono text-[11px] text-ink-3">{fmtSec(t.start)}</span>
                  <span className="truncate">{t.text}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
      {cur && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <textarea aria-label="Texte" value={cur.text} onChange={(e) => patch({ text: e.target.value.slice(0, 200) }, "text")} rows={2} maxLength={200} placeholder="Ton texte" className={cn(inputClass, "resize-y py-1.5 leading-snug")} />
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Taille"
              value={cur.size}
              onChange={(size) => patch({ size })}
              options={[
                { value: "s", label: "Petit" },
                { value: "m", label: "Moyen" },
                { value: "l", label: "Grand" },
                { value: "xl", label: "Très grand" },
              ]}
            />
            <Segmented
              label="Style"
              value={cur.style}
              onChange={(style) => patch({ style })}
              options={[
                { value: "plain", label: "Simple" },
                { value: "band", label: "Bandeau" },
              ]}
            />
            <button onClick={() => (onChange(texts.filter((t) => t.id !== cur.id)), onSelect(null))} className="press ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink-2 hover:text-danger" title="Retirer ce texte (Suppr)">
              <Trash2 className="size-3.5" /> Retirer
            </button>
          </div>
          {slider("Début", "start", 0, Math.max(0, round(cur.end - MIN)), 0.1, fmtSec(cur.start))}
          {slider("Fin", "end", round(cur.start + MIN), Math.max(total, cur.end), 0.1, fmtSec(cur.end))}
          {slider("Gauche / droite", "x", 0, 1, 0.01, `${Math.round(cur.x * 100)} %`)}
          {slider("Haut / bas", "y", 0, 1, 0.01, `${Math.round(cur.y * 100)} %`)}
          <p className="text-[11.5px] text-ink-3">Tu peux aussi faire glisser le texte directement sur la vidéo, et son bloc sur la timeline.</p>
        </div>
      )}
    </div>
  );
}

/**
 * The chosen text shown over the video, where it will be: drag it to place it. The parent is the box of the video
 * (positioned, same size as the picture).
 */
export function TextGhost({ text, onMove, aspect = 9 / 16, accent }: { text: FreeText; /** Colour of the band (the colour of the project). */ accent?: string; onMove: (x: number, y: number, key: string) => void; /** Width over height of the picture. */ aspect?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const grab = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const key = `text-move:${text.id}:${e.clientX}:${e.clientY}`;
    const [dx, dy] = [e.clientX - (r.left + text.x * r.width), e.clientY - (r.top + text.y * r.height)];
    const move = (ev: PointerEvent) => onMove(Math.round(clamp((ev.clientX - dx - r.left) / r.width, 0, 1) * 1000) / 1000, Math.round(clamp((ev.clientY - dy - r.top) / r.height, 0, 1) * 1000) / 1000, key);
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
    <div ref={box} className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl [container-type:inline-size]">
      <div className="absolute flex w-full -translate-x-1/2 -translate-y-1/2 justify-center" style={{ left: `${text.x * 100}%`, top: `${text.y * 100}%` }}>
        <span
          onPointerDown={grab}
          title="Fais glisser pour placer le texte"
          className={cn(
            "pointer-events-auto max-w-[90%] cursor-move touch-none rounded-[0.18em] text-center leading-[1.12] font-extrabold whitespace-pre-line outline-2 outline-offset-4 outline-accent outline-dashed select-none",
            text.style === "band" ? "bg-accent px-[0.5em] py-[0.22em] text-white" : "text-white [text-shadow:0_0_3px_rgba(0,0,0,0.7),0_2px_12px_rgba(0,0,0,0.6)]",
          )}
          style={{ fontSize: `${(TEXT_SIZE[text.size] / 1080) * Math.min(1, 1 / aspect) * 100}cqw`, ...(text.style === "band" && accent ? { background: accent } : {}) }}
        >
          {text.text}
        </span>
      </div>
    </div>
  );
}
