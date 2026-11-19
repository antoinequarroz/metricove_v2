"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Minus, Plus, Sparkles, Undo2 } from "lucide-react";
import { REEL_ACTORS, REEL_BRIDGES, REEL_CAMERAS, REEL_LAYOUTS, REEL_VIDEO, VIDEO_BUDGETS, VIDEO_LIMITS, type ReelActor, type ReelBeat, type ReelBridge, type ReelCamera, type ReelLayout, type ReelMoment, type ReelVideo } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Switch } from "./controls";
import { inputClass } from "./look-parts";
import { fmtLen } from "./parts";
import { nb } from "./reel-progress";

/* ---------- Names shown for the engine's choices ---------- */

export const LAYOUT_LABEL: Record<ReelLayout, string> = { hero: "Héros", stack: "Pile", number: "Chiffre", list: "Liste", cta: "Appel" };
export const BRIDGE_LABEL: Record<ReelBridge, string> = { rise: "Montée", morph: "Métamorphose", carry: "Mot porté", zoom: "Plongée", cut: "Coupe sèche" };
export const ACTOR_LABEL: Record<ReelActor, string> = { rest: "Repos", dot: "Point", underline: "Soulignement", highlight: "Surligné", bar: "Barre", hidden: "Cachée" };
export const CAMERA_LABEL: Record<ReelCamera, string> = { drift: "Dérive", push: "Approche", still: "Fixe" };
const LAYOUT_HINT: Record<ReelLayout, string> = {
  hero: "Une phrase seule, en grand",
  stack: "Une phrase et un sous-texte",
  number: "Un chiffre et ce qu'il veut dire",
  list: "Un titre et 2 à 4 points",
  cta: "L'appel final et son bouton",
};

const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const [MIN_BEAT, MAX_BEAT] = REEL_VIDEO.seconds;

/** Characters a beat holds over the budget of its layout (text, sub-text or any item). */
export function overBudget(b: ReelBeat) {
  const B: { text: number; sub?: number; item?: number } = VIDEO_BUDGETS[b.layout];
  if (b.text.trim().length > B.text) return true;
  if (B.sub && (b.sub ?? "").trim().length > B.sub) return true;
  if (B.item && (b.items ?? []).some((i) => i.trim().length > B.item!)) return true;
  return false;
}

/**
 * A list beat with fewer than 2 points written: the server drops the empty points and the Mac then lays it out as a
 * « Pile ». The editing screen asks for the points before a new preview.
 */
export const shortList = (b: ReelBeat) => !b.cut && b.layout === "list" && (b.items ?? []).filter((i) => i.trim()).length < 2;

/** The moments that are still bespoke (the page only knows `custom`; left out: as the server sent it). */
export const liveMoment = (m: ReelMoment) => m.custom ?? !!m.code;

/** Beats a moment in front of the text covers at most (the Mac's MOMENT.span); behind the text, any number. */
const MOMENT_SPAN = 3;

/**
 * What the Mac will do with a bespoke animation of this plan at the next preview, when it cannot play it as it is
 * (the order or the cuts of the beats changed by hand). Mirrors the Mac's cleanScore (removed when its last beat comes
 * before its first, shortened past 3 beats in front of the text, removed when another one already holds those beats in
 * front or behind) and its stage (skipped when all its beats are taken out). Undefined: it plays as written.
 */
export type MomentFate = { kind: "removed" | "shortened" | "skipped"; text: string };
export function momentFates(video: ReelVideo): Map<string, MomentFate> {
  const fates = new Map<string, MomentFate>();
  const index = (id: string) => video.beats.findIndex((b) => b.id === id);
  const held: { behind: boolean; a: number; z: number }[] = [];
  const spans = video.moments
    .map((m, k) => ({ m, k, a: index(m.from), z: index(m.to) }))
    .filter((x) => liveMoment(x.m))
    .sort((x, y) => x.a - y.a || x.k - y.k);
  for (const { m, a, z: last } of spans) {
    if (a < 0 || last < 0) {
      fates.set(m.id, { kind: "removed", text: "Un de ses temps forts n'existe plus : elle sera retirée au prochain aperçu." });
      continue;
    }
    if (last < a) {
      fates.set(m.id, { kind: "removed", text: "L'ordre des temps forts a changé : elle finit avant de commencer et sera retirée au prochain aperçu." });
      continue;
    }
    const behind = m.zone === "behind";
    const z = behind ? last : Math.min(last, a + MOMENT_SPAN - 1);
    if (held.some((o) => o.behind === behind && o.a <= z && a <= o.z)) {
      fates.set(m.id, { kind: "removed", text: "Une autre animation sur mesure occupe déjà ces temps forts : celle-ci sera retirée au prochain aperçu." });
      continue;
    }
    held.push({ behind, a, z });
    if (video.beats.slice(a, z + 1).every((b) => b.cut)) fates.set(m.id, { kind: "skipped", text: "Tous ses temps forts sont retirés : elle sera sautée au prochain aperçu." });
    else if (z < last) fates.set(m.id, { kind: "shortened", text: `Elle couvre maintenant plus de ${MOMENT_SPAN} temps forts : elle sera raccourcie aux ${MOMENT_SPAN} premiers au prochain aperçu.` });
  }
  return fates;
}

type Placed = { scene: { id: string }; index: number; start: number; end: number };

/**
 * The « Temps forts » tab of the editing screen: one card per beat (texts with the budgets of their layout, the
 * engine's choices, the length), then the bespoke animations. Every change goes through `onBeat` / `onMoment`, so the
 * screen keeps one history to undo.
 */
export function VideoBeats({
  video,
  base,
  placed,
  current,
  selected,
  disabled,
  onSeek,
  onSelect,
  onBeat,
  onMove,
  onMoment,
}: {
  video: ReelVideo;
  /** The video of the version on show: what changed by hand is marked against it. */
  base?: ReelVideo;
  placed: Placed[];
  /** The beat under the playhead. */
  current?: string;
  selected: string | null;
  disabled?: boolean;
  onSeek?: (t: number) => void;
  onSelect: (id: string | null) => void;
  onBeat: (id: string, patch: Partial<ReelBeat>, key?: string) => void;
  onMove: (id: string, by: number) => void;
  onMoment: (id: string, patch: Partial<ReelMoment>) => void;
}) {
  const kept = video.beats.filter((b) => !b.cut).length;
  const firstKept = video.beats.find((b) => !b.cut)?.id;
  const fates = momentFates(video);
  // The badge « sur mesure » shows where the animation will really play at the next preview.
  const playing = video.moments.filter((m) => liveMoment(m) && fates.get(m.id)?.kind !== "removed");
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {video.beats.map((b, i) => (
          <BeatCard
            key={b.id}
            beat={b}
            index={i}
            count={video.beats.length}
            at={placed.find((p) => p.scene.id === b.id)}
            was={base?.beats.find((x) => x.id === b.id)}
            first={b.id === firstKept}
            custom={!b.cut && playing.some((m) => covers(video, m, b.id))}
            on={selected === b.id}
            under={current === b.id}
            canCut={b.cut || kept > REEL_VIDEO.keep}
            disabled={disabled}
            onSeek={onSeek}
            onSelect={onSelect}
            onBeat={onBeat}
            onMove={onMove}
          />
        ))}
      </ol>
      {video.moments.length > 0 && <Moments video={video} fates={fates} disabled={disabled} onMoment={onMoment} onSeek={onSeek} placed={placed} />}
    </div>
  );
}

/** Whether moment `m` plays over beat `id` (from its first beat to its last, in the order of the plan, 3 at most in front). */
function covers(video: ReelVideo, m: ReelMoment, id: string) {
  const a = video.beats.findIndex((b) => b.id === m.from);
  const last = video.beats.findIndex((b) => b.id === m.to);
  const z = m.zone === "behind" ? last : Math.min(last, a + MOMENT_SPAN - 1);
  const i = video.beats.findIndex((b) => b.id === id);
  return a >= 0 && last >= a && i >= a && i <= z;
}

function BeatCard({
  beat: b,
  index: i,
  count,
  at,
  was,
  first,
  custom,
  on,
  under,
  canCut,
  disabled,
  onSeek,
  onSelect,
  onBeat,
  onMove,
}: {
  beat: ReelBeat;
  index: number;
  count: number;
  at?: Placed;
  was?: ReelBeat;
  first: boolean;
  custom: boolean;
  on: boolean;
  under: boolean;
  canCut: boolean;
  disabled?: boolean;
  onSeek?: (t: number) => void;
  onSelect: (id: string | null) => void;
  onBeat: (id: string, patch: Partial<ReelBeat>, key?: string) => void;
  onMove: (id: string, by: number) => void;
}) {
  const B: { text: number; sub?: number; item?: number } = VIDEO_BUDGETS[b.layout];
  const L = VIDEO_LIMITS.beat;
  const set = (patch: Partial<ReelBeat>, key?: string) => onBeat(b.id, patch, key);
  const off = disabled || b.cut;
  const length = at ? at.end - at.start : b.seconds;
  const items = b.items ?? [];
  const changed = !!was && JSON.stringify({ ...was, start: 0, end: 0 }) !== JSON.stringify({ ...b, start: 0, end: 0 });
  const subLabel = b.layout === "cta" ? "Texte du bouton" : b.layout === "number" ? "Ce que dit le chiffre" : "Sous-texte";
  // A layout that needs a list starts it from the sub-text (or two empty points), and gives it back when it leaves.
  const setLayout = (layout: ReelLayout) => {
    if (layout === b.layout) return;
    if (layout === "list" && items.length < 2) {
      const from = (b.sub ?? "").split(/\s*[·•;\n]\s*|\s+[–-]\s+/).map((x) => x.trim()).filter(Boolean).slice(0, L.items);
      return set({ layout, items: from.length >= 2 ? from.map((x) => x.slice(0, L.item)) : [...from, "", ""].slice(0, 2), sub: undefined });
    }
    if (b.layout === "list" && layout !== "list" && items.length && !b.sub) return set({ layout, sub: items.filter(Boolean).join(" · ").slice(0, L.sub), items: undefined });
    set({ layout });
  };

  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-[border-color,background-color] duration-150",
        b.cut ? "border-dashed border-line bg-transparent" : on ? "border-accent bg-surface" : under ? "border-accent/60 bg-surface" : "border-line bg-surface",
      )}
      onFocusCapture={() => !on && onSelect(b.id)}
    >
      <div className="mb-2 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
        <button
          onClick={() => set({ cut: !b.cut })}
          disabled={disabled || !canCut}
          aria-label={b.cut ? "Remettre ce temps fort" : "Couper ce temps fort"}
          title={b.cut ? "Remettre ce temps fort" : canCut ? "Couper ce temps fort" : "Une vidéo garde au moins deux temps forts"}
          className="press grid size-6 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-surface-2 disabled:opacity-40"
        >
          {b.cut ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        {at ? (
          <button onClick={() => (onSelect(b.id), onSeek?.(at.start + 0.05))} disabled={!onSeek} className="flex min-w-0 items-center gap-1.5 text-left hover:text-accent disabled:hover:text-ink-3" title="Aller à ce temps fort">
            <span className="tabular shrink-0 font-mono">
              {at.index + 1} · {fmtT(at.start)}
            </span>
            <span className="truncate text-[12.5px] font-medium text-ink">{b.title}</span>
          </button>
        ) : (
          <>
            <span className="shrink-0 rounded bg-ink/5 px-1.5 py-px font-medium">Coupé</span>
            <span className="truncate text-[12.5px] font-medium text-ink-2">{b.title}</span>
          </>
        )}
        {custom && !b.cut && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-px font-medium text-ink" title="Une animation sur mesure joue sur ce temps fort">
            <Sparkles className="size-3 text-accent" /> sur mesure
          </span>
        )}
        {changed && <span className="size-1.5 shrink-0 rounded-full bg-warn" title="Modifié à la main" />}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button onClick={() => onMove(b.id, -1)} disabled={disabled || i === 0} aria-label="Monter ce temps fort" className="press grid size-6 place-items-center rounded-md hover:bg-surface-2 disabled:opacity-40">
            <ArrowUp className="size-3.5" />
          </button>
          <button onClick={() => onMove(b.id, 1)} disabled={disabled || i === count - 1} aria-label="Descendre ce temps fort" className="press grid size-6 place-items-center rounded-md hover:bg-surface-2 disabled:opacity-40">
            <ArrowDown className="size-3.5" />
          </button>
        </span>
      </div>

      <div className={cn("flex flex-col gap-2", b.cut && "opacity-50")}>
        <Field label="Texte" n={b.text.length} max={B.text}>
          <input aria-label={`Texte du temps fort ${i + 1}`} value={b.text} onChange={(e) => set({ text: e.target.value }, `text:${b.id}`)} maxLength={L.text} disabled={off} className={cn(inputClass, "h-8 font-medium")} />
        </Field>
        {b.layout === "list" ? (
          <Field label="Points" n={items.length} max={L.items} unit="">
            <div className="flex flex-col gap-1">
              {items.map((it, k) => (
                <div key={k} className="flex items-center gap-1">
                  <input
                    aria-label={`Point ${k + 1} du temps fort ${i + 1}`}
                    value={it}
                    onChange={(e) => set({ items: items.map((x, j) => (j === k ? e.target.value : x)) }, `item:${b.id}:${k}`)}
                    maxLength={L.item}
                    disabled={off}
                    className={cn(inputClass, "h-8 min-w-0 flex-1", B.item && it.trim().length > B.item && "border-warn/70")}
                  />
                  <span className={cn("tabular w-10 shrink-0 text-right font-mono text-[10.5px]", B.item && it.trim().length > B.item ? "text-warn" : "text-ink-3")}>
                    {it.length}/{B.item}
                  </span>
                  <button onClick={() => set({ items: items.filter((_, j) => j !== k) })} disabled={off || items.length <= 2} aria-label="Retirer ce point" className="press grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:text-ink disabled:opacity-30">
                    <Minus className="size-3.5" />
                  </button>
                </div>
              ))}
              {items.length < L.items && (
                <button onClick={() => set({ items: [...items, ""] })} disabled={off} className="press inline-flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-[12px] font-medium text-ink-2 hover:text-ink disabled:opacity-40">
                  <Plus className="size-3.5" /> Ajouter un point
                </button>
              )}
            </div>
          </Field>
        ) : (
          B.sub !== undefined && (
            <Field label={subLabel} n={(b.sub ?? "").length} max={B.sub}>
              <textarea aria-label={`${subLabel} du temps fort ${i + 1}`} value={b.sub ?? ""} onChange={(e) => set({ sub: e.target.value || undefined }, `sub:${b.id}`)} maxLength={L.sub} rows={2} disabled={off} className={cn(inputClass, "resize-y py-1.5 leading-snug")} />
            </Field>
          )
        )}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <Field label="Emphase" n={(b.emphasis ?? "").length} max={L.emphasis} className="min-w-[180px] flex-1" hint={b.emphasis && !b.text.toLowerCase().includes(b.emphasis.trim().toLowerCase()) ? "Des mots du texte" : undefined}>
            <input aria-label={`Mots mis en avant du temps fort ${i + 1}`} value={b.emphasis ?? ""} onChange={(e) => set({ emphasis: e.target.value || undefined }, `emph:${b.id}`)} maxLength={L.emphasis} disabled={off} placeholder="Mots du texte à mettre en avant" className={cn(inputClass, "h-8")} />
          </Field>
          {b.layout === "number" && (
            <label className="flex h-8 items-center gap-2 text-[12px] text-ink-2">
              <Switch on={!!b.count} onChange={(count) => set({ count: count || undefined })} label="Le chiffre compte" />
              Le chiffre compte
            </label>
          )}
        </div>
        {shortList(b) && <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[11.5px] text-ink-2">{nb("Une liste a besoin de 2 points au moins : écris-les, ou choisis une autre mise en page.")}</p>}
        {overBudget(b) && !b.cut && <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[11.5px] text-ink-2">{nb("Trop long pour cette mise en page : le moteur réduira la taille. Raccourcis-le ou demande à Claude.")}</p>}

        {/* The engine's choices: two columns, four when the tools are wide. */}
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-1.5 @min-[560px]:grid-cols-4">
          <Choice label="Mise en page" value={b.layout} options={REEL_LAYOUTS} labels={LAYOUT_LABEL} onChange={setLayout} disabled={off} title={LAYOUT_HINT[b.layout]} />
          {first ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-ink-3">Enchaînement</span>
              <span className="flex h-8 items-center text-[12px] text-ink-3">Ouvre la vidéo</span>
            </div>
          ) : (
            <Choice label="Enchaînement" value={b.bridge} options={REEL_BRIDGES} labels={BRIDGE_LABEL} onChange={(bridge) => set({ bridge })} disabled={off} title="Comment ce temps fort naît du précédent" />
          )}
          <Choice label="Forme" value={b.actor} options={REEL_ACTORS} labels={ACTOR_LABEL} onChange={(actor) => set({ actor })} disabled={off} title="Ce que fait la forme de marque pendant ce temps fort" />
          <Choice label="Caméra" value={b.camera} options={REEL_CAMERAS} labels={CAMERA_LABEL} onChange={(camera) => set({ camera })} disabled={off} />
        </div>

        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="w-12 shrink-0">Durée</span>
          <input
            type="range"
            min={MIN_BEAT}
            max={MAX_BEAT}
            step={0.1}
            disabled={off}
            value={Math.min(MAX_BEAT, Math.max(MIN_BEAT, b.fixed ? b.seconds : length))}
            onChange={(e) => set({ seconds: Number(e.target.value), fixed: true }, `dur:${b.id}`)}
            aria-label={`Durée du temps fort ${i + 1}`}
            className="min-w-0 flex-1 accent-[var(--accent)]"
          />
          <span className="tabular w-11 text-right font-mono text-[11.5px]">{fmtLen(b.fixed ? b.seconds : length)}</span>
          {b.fixed ? (
            <button onClick={() => set({ fixed: undefined })} disabled={off} className="press w-9 text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" title="Laisser le moteur calculer la durée d'après le texte et le rythme">
              Auto
            </button>
          ) : (
            <span className="w-9 text-[11px] text-ink-3" title="Durée calculée d'après le texte et le rythme">
              auto
            </span>
          )}
        </label>
      </div>
    </li>
  );
}

/** A label, the field, and the characters it holds against its budget. */
function Field({ label, n, max, unit = "", hint, className, children }: { label: string; n: number; max: number; unit?: string; hint?: string; className?: string; children: React.ReactNode }) {
  const over = n > max;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="flex items-center gap-2 text-[11px] font-medium text-ink-3">
        {label}
        {hint && <span className="font-normal text-warn">{hint}</span>}
        <span className={cn("tabular ml-auto font-mono text-[10.5px] font-normal", over ? "text-warn" : "text-ink-3")}>
          {n}/{max}
          {unit}
        </span>
      </span>
      {children}
    </div>
  );
}

function Choice<T extends string>({ label, value, options, labels, onChange, disabled, title }: { label: string; value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void; disabled?: boolean; title?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1" title={title}>
      <span className="text-[11px] font-medium text-ink-3">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} disabled={disabled} className={cn(inputClass, "h-8 px-2 text-[12.5px]")}>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The bespoke animations Claude wrote: what each shows, where it plays, and a way back to the standard animation. */
function Moments({ video, fates, placed, disabled, onMoment, onSeek }: { video: ReelVideo; fates: Map<string, MomentFate>; placed: Placed[]; disabled?: boolean; onMoment: (id: string, patch: Partial<ReelMoment>) => void; onSeek?: (t: number) => void }) {
  const name = (id: string) => video.beats.find((b) => b.id === id)?.title ?? id;
  return (
    <section className="mt-1 rounded-xl border border-line bg-surface-2/50 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium">
        <Sparkles className="size-3.5 text-accent" /> Animations sur mesure
      </p>
      <ul className="flex flex-col gap-2">
        {video.moments.map((m) => {
          const on = liveMoment(m);
          const fate = on ? fates.get(m.id) : undefined;
          const start = placed.find((p) => p.scene.id === m.from)?.start;
          return (
            <li key={m.id} className={cn("rounded-lg border bg-surface px-2.5 py-2", fate ? "border-warn/50" : "border-line", !on && "opacity-60")}>
              <p className="text-[12.5px] leading-snug text-ink">{m.brief || "Animation sans description"}</p>
              {fate && <p className="mt-1 rounded-md bg-warn/10 px-2 py-1 text-[11.5px] leading-snug text-ink-2">{nb(fate.text)}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
                <button onClick={() => start !== undefined && onSeek?.(start + 0.05)} disabled={start === undefined || !onSeek} className="hover:text-accent disabled:hover:text-ink-3">
                  {m.from === m.to ? name(m.from) : `${name(m.from)} → ${name(m.to)}`}
                </button>
                <span className="ml-auto" />
                {on ? (
                  <button onClick={() => onMoment(m.id, { custom: false })} disabled={disabled} className="press font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline disabled:opacity-40">
                    Retirer l&apos;animation sur mesure
                  </button>
                ) : (
                  <>
                    <span>{nb("Retirée : les temps forts reprennent l'animation standard")}</span>
                    <button onClick={() => onMoment(m.id, { custom: true })} disabled={disabled} className="press inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink disabled:opacity-40">
                      <Undo2 className="size-3" /> Remettre
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
