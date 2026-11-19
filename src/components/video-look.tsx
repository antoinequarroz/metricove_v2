"use client";

import { Clapperboard, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { VIDEO_FONT, VIDEO_HOOKS, type Look, type VideoLook } from "@/lib/profiles";
import { cn } from "@/lib/utils";
import { Segmented } from "./calendar";
import { Field, inputClass, Swatch, Toggle } from "./montage/look-parts";

// Fonts creators use a lot, all on Google Fonts (any other Google family can be typed).
const FONTS = ["Montserrat", "Poppins", "Inter", "Bebas Neue", "Anton", "Oswald", "Archivo Black", "Lexend", "Manrope", "Outfit", "Sora", "Space Grotesk", "Bricolage Grotesque", "Barlow Condensed", "Rubik", "Kanit", "League Spartan", "Lilita One", "Luckiest Guy", "Bangers", "Titan One", "Permanent Marker", "Playfair Display", "DM Serif Display", "Instrument Serif", "Fraunces", "Caveat"];

const luma = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** A Google font in the page, for the preview only (the Mac downloads its own copy to render). */
function useGoogleFont(family?: string, weight = 800) {
  useEffect(() => {
    if (!family || !VIDEO_FONT.test(family)) return;
    const id = `gf-${family.replace(/\s+/g, "-")}-${weight}`;
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&display=swap`;
    document.head.appendChild(l);
  }, [family, weight]);
}

/**
 * « Look des vidéos » of a style: font, case, outline or box behind the subtitles, hook, where the subtitles sit.
 * Filled by « Copier un créateur », changed here by hand; the preview draws a frame the way the Mac will.
 */
export function VideoLookControls({ look, onChange }: { look: Look; onChange: (video: VideoLook | null) => void }) {
  const v = look.video ?? {};
  const set = (p: Partial<VideoLook>) => onChange({ ...v, ...p });
  const [font, setFont] = useState(v.font ?? "");
  useEffect(() => setFont(v.font ?? ""), [v.font]);
  const weight = v.weight ?? 800;
  useGoogleFont(v.font, weight);
  const box = v.box ?? "none";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <Clapperboard className="size-3.5 text-accent" />
        <span className="text-[12.5px] font-medium">Look des vidéos</span>
        <span className="text-[11.5px] text-ink-3">sous-titres, accroche et cartes des montages faits avec ce style</span>
        {look.video && (
          <button type="button" onClick={() => onChange(null)} className="press ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-3 hover:text-ink" title="Revenir au look par défaut du Mac">
            <RotateCcw className="size-3" /> Par défaut
          </button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
        <Preview look={look} />
        <div className="flex min-w-0 flex-col gap-3">
          <Field label="Police (Google Fonts)">
            <input
              aria-label="Police des vidéos"
              list="video-fonts"
              value={font}
              onChange={(e) => setFont(e.target.value)}
              onBlur={() => {
                const f = font.replace(/\s+/g, " ").trim();
                if (!f) set({ font: undefined });
                else if (VIDEO_FONT.test(f)) set({ font: f });
                else setFont(v.font ?? "");
              }}
              placeholder="Par ex. Montserrat, Anton, Bebas Neue"
              className={cn(inputClass, "h-9 sm:max-w-72")}
            />
            <datalist id="video-fonts">
              {FONTS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Field>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              Graisse
              <select aria-label="Graisse" value={weight} onChange={(e) => set({ weight: Number(e.target.value) })} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px]">
                {[400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <Toggle label="Capitales" checked={!!v.upper} onChange={(upper) => set({ upper })} />
            <Toggle label="Ombre" checked={v.shadow !== false} onChange={(shadow) => set({ shadow })} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-ink-2">
            <span className="flex items-center gap-2">
              Texte <Swatch label="Couleur des sous-titres" value={v.text ?? "#ffffff"} onChange={(text) => set({ text })} />
            </span>
            <span className="flex items-center gap-2">
              Mot mis en avant <Swatch label="Couleur des mots mis en avant" value={v.highlight ?? look.accent} onChange={(highlight) => set({ highlight })} />
            </span>
            <label className="flex items-center gap-2">
              Contour
              <input type="range" min={0} max={12} value={v.stroke ?? 0} onChange={(e) => set({ stroke: Number(e.target.value) })} aria-label="Épaisseur du contour" className="w-24 accent-[var(--accent)]" />
              {(v.stroke ?? 0) > 0 && <Swatch label="Couleur du contour" value={v.strokeColor ?? "#000000"} onChange={(strokeColor) => set({ strokeColor })} />}
            </label>
          </div>
          <Field label="Fond derrière les sous-titres">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<NonNullable<VideoLook["box"]>>
                value={box}
                onChange={(b) => set({ box: b })}
                options={[
                  { value: "none", label: "Aucun" },
                  { value: "line", label: "Toute la ligne" },
                  { value: "word", label: "Le mot dit" },
                ]}
              />
              {box !== "none" && <Swatch label="Couleur du fond" value={v.boxColor ?? look.accent} onChange={(boxColor) => set({ boxColor })} />}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Place des sous-titres">
              <Segmented<NonNullable<VideoLook["position"]>>
                value={v.position ?? "auto"}
                onChange={(position) => set({ position })}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "top", label: "Haut" },
                  { value: "middle", label: "Milieu" },
                  { value: "bottom", label: "Bas" },
                ]}
              />
            </Field>
            <Field label="Apparition">
              <Segmented<NonNullable<VideoLook["anim"]>>
                value={v.anim ?? "karaoke"}
                onChange={(anim) => set({ anim })}
                options={[
                  { value: "karaoke", label: "Karaoké" },
                  { value: "pop", label: "Mot à mot" },
                  { value: "simple", label: "Ligne" },
                ]}
              />
            </Field>
            <Field label="Taille">
              <Segmented<NonNullable<VideoLook["size"]>>
                value={v.size ?? "m"}
                onChange={(size) => set({ size })}
                options={[
                  { value: "s", label: "Petite" },
                  { value: "m", label: "Moyenne" },
                  { value: "l", label: "Grande" },
                ]}
              />
            </Field>
            <Field label="Accroche d'ouverture">
              <Segmented<NonNullable<VideoLook["hook"]>> value={v.hook ?? "band"} onChange={(hook) => set({ hook })} options={[...VIDEO_HOOKS]} />
            </Field>
          </div>
          <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
            Fond des cartes plein écran <Swatch label="Fond des cartes" value={v.card ?? "#111418"} onChange={(card) => set({ card })} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One frame of a video with this look: the hook at the top, two lines of subtitles, the spoken word lit. */
function Preview({ look }: { look: Look }) {
  const v = look.video ?? {};
  const fam = v.font ? `"${v.font}", ` : "";
  const text = v.text ?? "#ffffff";
  const hl = v.highlight ?? look.accent;
  const sw = v.stroke ?? 0;
  const sc = v.strokeColor ?? "#000000";
  const s = 150 / 1080;
  const ring = sw ? [0, 45, 90, 135, 180, 225, 270, 315].map((d) => `${(sw * s * Math.cos((d * Math.PI) / 180)).toFixed(2)}px ${(sw * s * Math.sin((d * Math.PI) / 180)).toFixed(2)}px 0 ${sc}`) : [];
  const shadow = [...ring, ...(v.shadow === false ? [] : ["0 1px 4px rgba(0,0,0,0.6)"])].join(",") || "none";
  const bc = v.boxColor ?? look.accent;
  const onBox = luma(bc) > 0.55 ? "#111111" : "#ffffff";
  const size = { s: 11, m: 13, l: 15.5 }[v.size ?? "m"];
  const top = { top: "16%", middle: "44%", bottom: "68%", auto: "68%" }[v.position ?? "auto"];
  const font: React.CSSProperties = { fontFamily: `${fam}system-ui, sans-serif`, fontWeight: v.weight ?? 800, textTransform: v.upper ? "uppercase" : undefined };
  const hook = v.hook ?? "band";
  const word = (w: string, lit = false) => (
    <span
      style={{
        color: v.box === "line" ? onBox : lit ? (v.box === "word" ? onBox : hl) : text,
        background: lit && v.box === "word" ? bc : undefined,
        borderRadius: 3,
        padding: v.box === "word" ? "0 2px" : undefined,
      }}
    >
      {w}
    </span>
  );
  return (
    <div className="relative mx-auto aspect-[9/16] w-[150px] overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_50%_38%,#8a7563_0%,#4b3d33_32%,#1d1916_75%)] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.5)]" aria-label="Aperçu du look vidéo" role="img">
      <div className="absolute top-[30%] left-1/2 size-14 -translate-x-1/2 rounded-full bg-[#c9a68a]/70 blur-[2px]" />
      <div className="absolute inset-x-0 top-[9%] flex justify-center" style={hook === "text" || v.position === "top" ? { top: v.position === "top" ? "4%" : "9%" } : undefined}>
        <span
          className="px-2 py-1 text-center leading-none"
          style={{
            ...font,
            fontSize: hook === "text" ? 14 : 11.5,
            background: hook === "box" ? "#ffffff" : hook === "band" ? look.accent : "transparent",
            color: hook === "box" ? "#111111" : hook === "band" ? (luma(look.accent) > 0.45 ? "#141414" : "#ffffff") : text,
            borderRadius: hook === "box" ? 5 : 0,
            textShadow: hook === "text" ? shadow : undefined,
          }}
        >
          3 erreurs à éviter
        </span>
      </div>
      <div className="absolute inset-x-2 flex justify-center" style={{ top }}>
        <p
          className="text-center leading-[1.1]"
          style={{ ...font, fontSize: size, textShadow: v.box === "line" ? "none" : shadow, background: v.box === "line" ? bc : undefined, padding: v.box === "line" ? "3px 6px" : undefined, borderRadius: 4 }}
        >
          {word("La")} {word("première")} {word("erreur", true)}
          <br />
          {word("c'est")} {word("de")} {word("tout")} {word("tester")}
        </p>
      </div>
    </div>
  );
}
