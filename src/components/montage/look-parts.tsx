"use client";

import { AlignCenter, AlignLeft, ImagePlus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Look } from "@/lib/profiles";
import { shrinkLogo } from "@/lib/use-profiles";
import { cn } from "@/lib/utils";
import { ACCENTS, type Deck, drawSlide, type Fonts, HEIGHTS, THEMES, W } from "@/lib/visuals";
import { Segmented } from "../calendar";
import { Button } from "../ui";

export const inputClass = "w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

/** One slide drawn on a canvas that follows the width it is given. */
export function SlideCanvas({ deck, index, fonts, small, className }: { deck: Deck; index: number; fonts: Fonts | null; small?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  const H = HEIGHTS[deck.format];
  // Only what this slide draws: typing in another slide or in the description redraws nothing here.
  const drawn = JSON.stringify([{ ...deck, slides: undefined, caption: undefined }, deck.slides[index], deck.slides.length]);
  const latest = useRef(deck);
  latest.current = deck;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !fonts) return;
    // Thumbnails are drawn small. The main preview is sharp on a Retina screen without drawing 1080 px at each keystroke.
    const width = small ? 204 : Math.min(W, Math.round((canvas.clientWidth || 400) * Math.min(2, window.devicePixelRatio || 1)));
    const height = Math.round((width * H) / W);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(width / W, 0, 0, width / W, 0, 0);
    drawSlide(ctx, latest.current, index, fonts, () => setTick((t) => t + 1));
  }, [drawn, index, fonts, small, H, tick]);

  return <canvas ref={ref} className={cn("block w-full bg-surface-2", className)} style={{ aspectRatio: `${W} / ${H}` }} aria-label={`Aperçu du visuel ${index + 1}`} role="img" />;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

/** The controls of a look: background, color, text, signature, logo. Used by the Studio and by the style profiles. */
export function LookControls({ look, onChange, suggestedHandle }: { look: Look; onChange: (p: Partial<Look>) => void; suggestedHandle?: string }) {
  const logoInput = useRef<HTMLInputElement>(null);
  const importLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      onChange({ logo: await shrinkLogo(file) });
    } catch (e) {
      toast.error("Logo refusé", { description: (e as Error).message });
    }
  };
  return (
    <>
      <Field label="Fond">
        <Segmented value={look.theme} onChange={(theme) => onChange({ theme })} options={THEMES} />
      </Field>
      <Field label="Couleur">
        <div className="flex flex-wrap items-center gap-1.5">
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ accent: c })}
              aria-label={`Couleur ${c}`}
              aria-pressed={look.accent === c}
              className={cn("press size-7 rounded-full outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-accent/50", look.accent === c ? "shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]" : "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]")}
              style={{ background: c }}
            />
          ))}
          <label
            className={cn("press relative grid size-7 cursor-pointer place-items-center rounded-full border border-dashed border-line-strong text-ink-3 hover:text-ink", !ACCENTS.includes(look.accent) && "border-solid shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]")}
            style={ACCENTS.includes(look.accent) ? undefined : { background: look.accent }}
            title="Autre couleur"
          >
            {ACCENTS.includes(look.accent) && <Plus className="size-3.5" />}
            <input type="color" value={look.accent} onChange={(e) => onChange({ accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Autre couleur" />
          </label>
        </div>
      </Field>
      <Field label="Texte">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={look.font}
            onChange={(font) => onChange({ font })}
            options={[
              { value: "serif", label: "Élégant" },
              { value: "sans", label: "Net" },
            ]}
          />
          <div className="flex rounded-lg border border-line bg-bg-2/70 p-0.5">
            {(
              [
                ["left", AlignLeft, "Aligner à gauche"],
                ["center", AlignCenter, "Centrer"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ align: value })}
                aria-label={label}
                aria-pressed={look.align === value}
                className={cn("grid h-7 w-8 place-items-center rounded-md transition-[background-color,color,box-shadow] duration-150", look.align === value ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
          <Segmented
            value={look.valign}
            onChange={(valign) => onChange({ valign })}
            options={[
              { value: "top", label: "Haut" },
              { value: "middle", label: "Milieu" },
              { value: "bottom", label: "Bas" },
            ]}
          />
        </div>
      </Field>
      <Field label="Signature et logo">
        <div className="flex flex-wrap gap-2">
          <input aria-label="Signature" value={look.handle} onChange={(e) => onChange({ handle: e.target.value })} maxLength={40} placeholder={suggestedHandle || "@toncompte"} className={cn(inputClass, "h-9 min-w-0 flex-1")} />
          {suggestedHandle && look.handle !== suggestedHandle && (
            <Button size="sm" className="h-9" type="button" onClick={() => onChange({ handle: suggestedHandle })}>
              {suggestedHandle}
            </Button>
          )}
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => (importLogo(e.target.files?.[0]), (e.target.value = ""))} />
          {look.logo ? (
            <span className="flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface-2 pr-1 pl-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={look.logo} alt="Logo" className="h-6 max-w-16 object-contain" />
              <button type="button" onClick={() => onChange({ logo: undefined })} aria-label="Retirer le logo" title="Retirer le logo" className="press grid size-6 place-items-center rounded-md text-ink-3 hover:text-danger">
                <X className="size-3.5" />
              </button>
            </span>
          ) : (
            <Button size="sm" className="h-9" type="button" onClick={() => logoInput.current?.click()}>
              <ImagePlus className="size-3.5" />
              Logo
            </Button>
          )}
        </div>
      </Field>
      <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
        <Toggle label="Grain" checked={look.grain} onChange={(grain) => onChange({ grain })} />
        <Toggle label="Numéros de page" checked={look.numbers} onChange={(numbers) => onChange({ numbers })} />
      </div>
    </>
  );
}
