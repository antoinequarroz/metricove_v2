"use client";

import { AudioLines, LayoutPanelTop, PictureInPicture2, Play, RectangleHorizontal, Trash2 } from "lucide-react";
import { useRef } from "react";
import { ANIM_LABEL, BUILTIN_SFX, STAGE_ANIMS, STAGE_KINDS, STAGE_LABEL, type Edl, type Sfx, type Stage, type StageAnim, type StageKind } from "@/lib/montage";
import { fileUrl, useLibrary } from "@/lib/use-library";
import { cn } from "@/lib/utils";
import { Segmented } from "./controls";
import { Button } from "../ui";
import { fmtSec } from "./parts";

// Key moments (the layout changes for one idea) and sound effects, in the face-cam timeline. Worker 0.17.0 renders them.

const KIND_ICON: Record<StageKind, typeof LayoutPanelTop> = { split: LayoutPanelTop, card: RectangleHorizontal, pip: PictureInPicture2 };
const BUILTIN_LABEL: Record<string, string> = { whoosh: "Whoosh", swoosh: "Swoosh", pop: "Pop", click: "Clic", ding: "Ding", impact: "Impact", riser: "Montée", thud: "Coup sourd" };

export function StageBlocks({
  stages,
  pps,
  selected,
  onPointerDown,
  Handle,
}: {
  stages: Stage[];
  pps: number;
  selected: number | null;
  onPointerDown: (e: React.PointerEvent, i: number, mode: "move" | "start" | "end") => void;
  Handle: (p: { side: "left" | "right"; onPointerDown: (e: React.PointerEvent) => void; label: string }) => React.ReactNode;
}) {
  return stages.map((s, i) => {
    const Icon = KIND_ICON[s.kind];
    const on = selected === i;
    return (
      <div
        key={i}
        onPointerDown={(e) => onPointerDown(e, i, "move")}
        className={cn("absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md border text-[10.5px]", on ? "z-10 border-accent bg-accent/25" : "border-accent/40 bg-accent/10")}
        style={{ left: s.at * pps, width: Math.max(8, s.dur * pps) }}
        title={`${STAGE_LABEL[s.kind]} · ${s.title}`}
      >
        <span className="pointer-events-none flex h-full items-center gap-1 truncate px-1.5 text-ink-2">
          <Icon className="size-3 shrink-0" aria-label={STAGE_LABEL[s.kind]} />
          <span className="truncate">{s.title}</span>
        </span>
        {Handle({ side: "left", onPointerDown: (e) => onPointerDown(e, i, "start"), label: "Début du temps fort" })}
        {Handle({ side: "right", onPointerDown: (e) => onPointerDown(e, i, "end"), label: "Fin du temps fort" })}
      </div>
    );
  });
}

export function SfxBlocks({ sfx, pps, selected, onPointerDown }: { sfx: Sfx[]; pps: number; selected: number | null; onPointerDown: (e: React.PointerEvent, i: number) => void }) {
  return sfx.map((x, i) => (
    <div
      key={i}
      onPointerDown={(e) => onPointerDown(e, i)}
      className={cn(
        "absolute top-1 bottom-1 flex cursor-grab items-center gap-1 overflow-hidden rounded-md border px-1 text-[10.5px] text-ink-2",
        selected === i ? "z-10 border-warn bg-warn/25" : "border-warn/40 bg-warn/12",
      )}
      style={{ left: x.at * pps, maxWidth: 140 }}
      title={`${x.name} à ${fmtSec(x.at)}`}
    >
      <AudioLines className="pointer-events-none size-3 shrink-0" />
      <span className="pointer-events-none truncate">{x.name}</span>
    </div>
  ));
}

/** The chosen key moment: kind, texts, illustration, animation. */
export function StageInspector({ edl, i, onChange, onDone, oldMac }: { edl: Edl; i: number; onChange: (next: Edl, key?: string) => void; onDone: () => void; oldMac: boolean }) {
  const s = edl.stages![i];
  const { items } = useLibrary();
  const illustrations = (items ?? []).filter((x) => x.kind === "illustration");
  const edit = (patch: Partial<Stage>, key?: string) => {
    const next = structuredClone(edl);
    const t = next.stages![i];
    Object.assign(t, patch);
    for (const k of Object.keys(t) as (keyof Stage)[]) if (t[k] === undefined || t[k] === "") delete t[k];
    onChange(next, key);
  };
  const pick = illustrations.find((x) => x.id === s.illustration);
  return (
    <>
      <Segmented<StageKind> label="Mise en page" value={s.kind} onChange={(kind) => edit({ kind })} options={STAGE_KINDS.map((k) => ({ value: k, label: STAGE_LABEL[k] }))} />
      <input
        key={`t-${i}-${s.title}`}
        defaultValue={s.title}
        maxLength={80}
        aria-label="Titre de la carte"
        placeholder="Titre de la carte"
        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.title && edit({ title: e.target.value.trim() })}
        className="h-7 min-w-40 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] font-semibold outline-none focus:border-accent/60"
      />
      <input
        key={`b-${i}-${s.body ?? ""}`}
        defaultValue={s.body ?? ""}
        maxLength={140}
        aria-label="Texte sous le titre"
        placeholder="Texte sous le titre (facultatif)"
        onBlur={(e) => e.target.value.trim() !== (s.body ?? "") && edit({ body: e.target.value.trim() || undefined })}
        className="h-7 min-w-40 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent/60"
      />
      <label className="flex items-center gap-1.5">
        {pick && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(pick)} alt="" className="checker size-7 rounded object-contain" />
        )}
        <select
          aria-label="Illustration"
          value={s.illustration ?? ""}
          onChange={(e) => edit({ illustration: e.target.value || undefined })}
          className="h-7 max-w-48 rounded-md border border-line-strong bg-surface px-1.5 text-[12px]"
        >
          <option value="">Sans illustration</option>
          {s.illustration && !pick && <option value={s.illustration}>Illustration retirée</option>}
          {illustrations.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        Animation
        <select
          aria-label="Animation d'entrée"
          value={s.anim ?? ""}
          onChange={(e) => edit({ anim: (e.target.value || undefined) as StageAnim | undefined })}
          className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12px]"
        >
          <option value="">Auto (change à chaque carte)</option>
          {STAGE_ANIMS.map((a) => (
            <option key={a} value={a}>
              {ANIM_LABEL[a]}
            </option>
          ))}
        </select>
      </label>
      {oldMac && <span className="text-[12px] text-warn">Mets à jour le programme du Mac (version 0.17.0) pour voir les temps forts dans la vidéo.</span>}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        onClick={() => {
          const next = structuredClone(edl);
          next.stages!.splice(i, 1);
          onChange(next, "inspector");
          onDone();
        }}
      >
        <Trash2 className="size-3.5" /> Retirer
      </Button>
    </>
  );
}

/** The chosen sound effect: which sound, how loud. A library sound can be heard here. */
export function SfxInspector({ edl, i, onChange, onDone, oldMac }: { edl: Edl; i: number; onChange: (next: Edl, key?: string) => void; onDone: () => void; oldMac: boolean }) {
  const x = edl.sfx![i];
  const { items } = useLibrary();
  const sounds = (items ?? []).filter((y) => y.kind === "sfx");
  const audio = useRef<HTMLAudioElement | null>(null);
  const edit = (patch: Partial<Sfx>, key?: string) => {
    const next = structuredClone(edl);
    Object.assign(next.sfx![i], patch);
    onChange(next, key);
  };
  const lib = sounds.find((y) => y.id === x.sound);
  return (
    <>
      <span className="tabular font-mono text-ink-3">{fmtSec(x.at)}</span>
      <select
        aria-label="Bruitage"
        value={x.sound}
        onChange={(e) => {
          const v = e.target.value;
          const y = sounds.find((z) => z.id === v);
          edit({ sound: v, name: y ? y.name : BUILTIN_LABEL[v.replace(/^builtin:/, "")] ?? v });
        }}
        className="h-7 max-w-56 rounded-md border border-line-strong bg-surface px-1.5 text-[12px]"
      >
        {!lib && !x.sound.startsWith("builtin:") && <option value={x.sound}>{x.name} (retiré)</option>}
        {!!sounds.length && (
          <optgroup label="Bibliothèque">
            {sounds.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Faits par le Mac">
          {BUILTIN_SFX.map((b) => (
            <option key={b} value={`builtin:${b}`}>
              {BUILTIN_LABEL[b] ?? b}
            </option>
          ))}
        </optgroup>
      </select>
      {lib && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            audio.current?.pause();
            audio.current = new Audio(fileUrl(lib));
            audio.current.volume = Math.min(1, x.volume ?? 0.6);
            void audio.current.play().catch(() => {});
          }}
        >
          <Play className="size-3.5" /> Écouter
        </Button>
      )}
      <label className="flex items-center gap-2">
        Volume
        <input
          type="range"
          min={0.05}
          max={1.5}
          step={0.05}
          value={x.volume ?? 0.6}
          onChange={(e) => edit({ volume: Number(e.target.value) }, "sfx-volume")}
          className="w-24 accent-[var(--accent)]"
          aria-label="Volume du bruitage"
        />
      </label>
      {oldMac && <span className="text-[12px] text-warn">Mets à jour le programme du Mac (version 0.17.0) pour entendre les bruitages dans la vidéo.</span>}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        onClick={() => {
          const next = structuredClone(edl);
          next.sfx!.splice(i, 1);
          onChange(next, "inspector");
          onDone();
        }}
      >
        <Trash2 className="size-3.5" /> Retirer
      </Button>
    </>
  );
}
