"use client";

import { Minus, Plus, Save, Scissors, Star, Type, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { captionBlocks, DEFAULT_CAPTIONS, FILLER, type CaptionStyle, type Edl } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { Row, Section, Segmented, Switch } from "./controls";
import { fmtSec } from "./parts";

const COLORS = ["#ff5a1f", "#ffd60a", "#34d399", "#38bdf8", "#f472b6", "#ffffff"];
const EMOJIS = ["🔥", "💡", "✅", "❌", "👉", "🚀", "😅", "📚", "⚡", "❤️"];

type Pick = { seg: number; word: number } | null;

/** Subtitle editor: style of the subtitles, then each block word by word (text, cut, keyword, emoji, timing). */
export function CaptionsEditor({
  edl,
  fallback,
  onChange,
  onSeek,
  time,
  onSaveStyle,
}: {
  edl: Edl;
  /** Style used when this version has none (project style or default). */
  fallback?: CaptionStyle;
  onChange: (next: Edl) => void;
  onSeek: (t: number) => void;
  time: number;
  onSaveStyle?: (s: CaptionStyle) => void;
}) {
  const style = edl.captions ?? fallback ?? DEFAULT_CAPTIONS;
  const blocks = useMemo(() => captionBlocks(edl, style), [edl, style]);
  const [pick, setPick] = useState<Pick>(null);
  const setStyle = (patch: Partial<CaptionStyle>) => onChange({ ...structuredClone(edl), captions: { ...style, ...patch } });
  const hl = style.highlight || "var(--accent)";

  const word = pick ? edl.segments[pick.seg]?.words?.[pick.word] : undefined;
  const editWord = (fn: (w: NonNullable<typeof word>) => void) => {
    if (!pick) return;
    const next = structuredClone(edl);
    const s = next.segments[pick.seg];
    fn(s.words![pick.word]);
    s.text = s.words!.filter((w) => !w.cut).map((w) => w.w).join(" ");
    onChange(next);
  };

  const fillers = edl.segments.reduce((n, s) => n + (s.kept ? (s.words ?? []).filter((w) => !w.cut && FILLER.test(w.w)).length : 0), 0);
  const cutFillers = () => {
    const next = structuredClone(edl);
    for (const s of next.segments) {
      if (!s.kept) continue;
      for (const w of s.words ?? []) if (FILLER.test(w.w)) w.cut = true;
      s.text = (s.words ?? []).filter((w) => !w.cut).map((w) => w.w).join(" ");
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <Section
        title="Style des sous-titres"
        icon={<Type className="size-3.5 text-accent" />}
        action={
          onSaveStyle && (
            <Button size="sm" variant="ghost" onClick={() => onSaveStyle(style)} title="Les prochains montages de ce projet partiront de ce style">
              <Save className="size-3.5" /> Style du projet
            </Button>
          )
        }
      >
        <Row label="Sous-titres incrustés">
          <Switch on={style.on} onChange={(on) => setStyle({ on })} label="Sous-titres incrustés" />
        </Row>
        <Row label="Position" hint="Auto : au-dessus ou en dessous du visage">
          <Segmented
            label="Position"
            value={style.position}
            onChange={(position) => setStyle({ position })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "top", label: "Haut" },
              { value: "middle", label: "Milieu" },
              { value: "bottom", label: "Bas" },
            ]}
          />
        </Row>
        <Row label="Animation">
          <Segmented
            label="Animation"
            value={style.look}
            onChange={(look) => setStyle({ look })}
            options={[
              { value: "karaoke", label: "Karaoké" },
              { value: "pop", label: "Mot par mot" },
              { value: "simple", label: "Ligne" },
            ]}
          />
        </Row>
        <Row label="Taille">
          <Segmented
            label="Taille"
            value={style.size}
            onChange={(size) => setStyle({ size })}
            options={[
              { value: "s", label: "S" },
              { value: "m", label: "M" },
              { value: "l", label: "L" },
            ]}
          />
        </Row>
        <Row label="Couleur des mots clés">
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setStyle({ highlight: c })}
                aria-label={`Couleur ${c}`}
                className={cn("size-5 rounded-full border border-line-strong", style.highlight === c && "ring-2 ring-accent ring-offset-1 ring-offset-surface")}
                style={{ background: c }}
              />
            ))}
            <input type="color" value={style.highlight ?? "#ff5a1f"} onChange={(e) => setStyle({ highlight: e.target.value })} aria-label="Autre couleur" className="size-6 cursor-pointer rounded bg-transparent" />
          </div>
        </Row>
        <Row label="Emojis de temps en temps" hint="Claude en ajoute sur les mots forts">
          <Switch on={style.emoji} onChange={(emoji) => setStyle({ emoji })} label="Emojis" />
        </Row>
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">Texte des sous-titres</h3>
        <span className="text-[12px] text-ink-3">{blocks.length} blocs</span>
        <Button size="sm" className="ml-auto" onClick={cutFillers} disabled={!fillers}>
          <Wand2 className="size-3.5" /> Couper les « euh »{fillers ? ` (${fillers})` : ""}
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">Clique sur un mot pour le corriger, le couper, le mettre en couleur ou lui ajouter un emoji.</p>

      {word && pick && (
        <div className="sticky top-0 z-10 flex flex-col gap-2 rounded-xl border border-accent/40 bg-surface p-3 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <input
              key={`${pick.seg}-${pick.word}`}
              defaultValue={word.w}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== word.w && editWord((w) => (w.w = e.target.value.trim()))}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Texte du mot"
              className="h-8 w-40 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-accent/60"
            />
            <Button size="sm" variant={word.cut ? "primary" : "secondary"} onClick={() => editWord((w) => (w.cut = !w.cut || undefined))} title="Retire ce mot de la vidéo (son et image)">
              <Scissors className="size-3.5" /> {word.cut ? "Coupé" : "Couper"}
            </Button>
            <Button size="sm" variant={word.hl ? "primary" : "secondary"} onClick={() => editWord((w) => (w.hl = !w.hl || undefined))}>
              <Star className="size-3.5" /> Mot clé
            </Button>
            <button onClick={() => setPick(null)} className="ml-auto text-[12px] text-ink-3 hover:text-ink">
              Fermer
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => editWord((w) => (w.emoji = w.emoji === e ? undefined : e))}
                className={cn("press grid size-7 place-items-center rounded-md text-[15px]", word.emoji === e ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-surface-2")}
              >
                {e}
              </button>
            ))}
            {word.emoji && (
              <button onClick={() => editWord((w) => (w.emoji = undefined))} className="ml-1 text-[12px] text-ink-3 hover:text-ink">
                Sans emoji
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className="text-ink-3">Timing</span>
            <Nudge label="début" value={word.t0} onChange={(v) => editWord((w) => (w.t0 = Math.min(v, w.t1 - 0.02)))} />
            <Nudge label="fin" value={word.t1} onChange={(v) => editWord((w) => (w.t1 = Math.max(v, w.t0 + 0.02)))} />
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-1">
        {blocks.map((b, k) => {
          const s = edl.segments[b.seg];
          const live = time >= b.start && time < b.end;
          return (
            <li key={`${s.id}-${b.from}`} className={cn("flex gap-3 rounded-lg border px-2.5 py-1.5", live ? "border-accent/50 bg-accent-soft/50" : "border-line bg-surface")}>
              <button onClick={() => onSeek(b.start)} className="tabular w-9 shrink-0 pt-0.5 text-left font-mono text-[11px] text-ink-3 hover:text-accent" aria-label={`Aller au bloc ${k + 1}`}>
                {fmtSec(b.start)}
              </button>
              <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
                {s.words!.slice(b.from, b.to + 1).map((w, i) => {
                  const wi = b.from + i;
                  const on = pick?.seg === b.seg && pick.word === wi;
                  return (
                    <span key={wi}>
                      <button
                        onClick={() => setPick({ seg: b.seg, word: wi })}
                        className={cn("rounded px-0.5", on ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-surface-2", w.cut && "text-ink-3 line-through", w.hl && !w.cut && "font-semibold")}
                        style={w.hl && !w.cut ? { color: hl } : undefined}
                      >
                        {w.w}
                        {w.emoji && <span className="ml-0.5">{w.emoji}</span>}
                      </button>{" "}
                    </span>
                  );
                })}
              </p>
            </li>
          );
        })}
        {!blocks.length && <li className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-[12.5px] text-ink-3">Pas de sous-titres : cette version n&apos;a pas de mots minutés.</li>}
      </ol>
    </div>
  );
}

function Nudge({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-ink-3">{label}</span>
      <button onClick={() => onChange(value - 0.05)} className="press grid size-6 place-items-center rounded-md border border-line-strong" aria-label={`${label} −0,05 s`}>
        <Minus className="size-3" />
      </button>
      <span className="tabular w-12 text-center font-mono">{value.toFixed(2)}</span>
      <button onClick={() => onChange(value + 0.05)} className="press grid size-6 place-items-center rounded-md border border-line-strong" aria-label={`${label} +0,05 s`}>
        <Plus className="size-3" />
      </button>
    </span>
  );
}
