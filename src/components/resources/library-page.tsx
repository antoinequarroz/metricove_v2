"use client";

import { Loader2, Pause, Play, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ASSET_ACCEPT, type AssetKind, ILLUSTRATION_TAGS, type LibraryItem, MAX_ASSET_BYTES, MAX_ASSET_NAME, MAX_TAGS, MUSIC_TAGS, nameFromFile, SFX_TAGS, styleRef } from "@/lib/library";
import { useStore } from "@/lib/store";
import { fileUrl, useLibrary } from "@/lib/use-library";
import { useProfiles } from "@/lib/use-profiles";
import { cn } from "@/lib/utils";
import { inputClass } from "../montage/look-parts";
import { Button } from "../ui";
import { AssetMaker } from "./asset-maker";
import { MusicMaker } from "./music-maker";
import { ResourceShell } from "./shell";

const TEXT = {
  illustration: {
    one: "illustration",
    intro:
      "Les images que Claude peut poser dans tes vidéos : pictos, personnages, schémas, fonds tech. PNG ou SVG à fond transparent de préférence. Range-les dans un style pour que Claude prenne celles qui vont avec.",
    empty: "Aucune illustration pour l'instant. Glisse tes PNG ou SVG ici.",
  },
  sfx: {
    one: "bruitage",
    intro: "Les sons courts que Claude place sur 2 ou 3 moments clés : whoosh, pop, click, thud… MP3 ou WAV. Range-les dans un style pour que Claude prenne ceux qui vont avec.",
    empty: "Aucun bruitage pour l'instant. Glisse tes MP3 ou WAV ici.",
  },
  music: {
    one: "musique",
    intro:
      "Les musiques de fond de tes vidéos : composées par ElevenLabs ou Google Lyria, ou ajoutées à la main. Choisis-en une dans le Reel animé ou le montage face cam, ou laisse Metricove en composer une à la bonne durée pour chaque vidéo.",
    empty: "Aucune musique pour l'instant. Compose-en une ci-dessus, ou glisse tes MP3 ici.",
  },
} as const;

/** "all", "none" (in no style), or a style "<projectId>:<styleId>". */
type Filter = string;

/** Médias → Ressources → Illustrations or Bruitages. */
export function LibraryPage({ kind }: { kind: AssetKind }) {
  const t = TEXT[kind];
  const projects = useStore((s) => s.projects);
  const { styles } = useProfiles();
  const { items, error, reload, add, update, remove } = useLibrary();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(0);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  /** Every style, labelled "Projet · Style". */
  const styleOptions = useMemo(
    () => projects.flatMap((p) => (styles?.[p.id] ?? []).map((s) => ({ ref: styleRef(p.id, s.id), label: `${p.name} · ${s.name}` }))),
    [projects, styles],
  );
  const label = (ref: string) => styleOptions.find((o) => o.ref === ref)?.label;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        i.kind === kind &&
        (filter === "all" || (filter === "none" ? !i.styles.length : i.styles.includes(filter))) &&
        (!q || i.name.toLowerCase().includes(q) || i.tags.some((x) => x.includes(q))),
    );
  }, [items, kind, filter, query]);
  const current = (items ?? []).find((i) => i.id === picked);

  const send = async (files: FileList | File[] | null) => {
    const all = Array.from(files ?? []);
    if (!all.length) return;
    setSending((n) => n + all.length);
    let ok = 0;
    for (const file of all) {
      try {
        if (file.size > MAX_ASSET_BYTES[kind]) throw new Error(`trop lourd (${Math.round(MAX_ASSET_BYTES[kind] / 1e6)} Mo au plus)`);
        // The tags a file name suggests ("whoosh_fast.wav" → whoosh).
        const known = (kind === "sfx" ? SFX_TAGS : kind === "music" ? MUSIC_TAGS : ILLUSTRATION_TAGS).filter((x) => file.name.toLowerCase().includes(x));
        await add(kind, file, { name: nameFromFile(file.name), tags: known, styles: filter !== "all" && filter !== "none" ? [filter] : [] });
        ok++;
      } catch (e) {
        toast.error(`${file.name} non ajouté`, { description: (e as Error).message });
      } finally {
        setSending((n) => n - 1);
      }
    }
    if (ok) toast.success(ok > 1 ? `${ok} fichiers ajoutés` : "Fichier ajouté", filter !== "all" && filter !== "none" ? { description: `Rangé dans ${label(filter)}` } : undefined);
  };

  return (
    <ResourceShell
      intro={t.intro}
      actions={
        <>
          <input ref={input} type="file" multiple accept={ASSET_ACCEPT[kind]} className="hidden" onChange={(e) => (send(e.target.files), (e.target.value = ""))} />
          <Button variant="primary" onClick={() => input.current?.click()} disabled={sending > 0}>
            {sending > 0 ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Ajouter
          </Button>
        </>
      }
    >
      {kind === "music" ? (
        <MusicMaker styleRef={filter !== "all" && filter !== "none" ? filter : undefined} onDone={reload} />
      ) : (
        <AssetMaker kind={kind} styles={styleOptions} styleRef={filter !== "all" && filter !== "none" ? filter : undefined} onDone={reload} />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 max-sm:w-full">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher un nom ou une étiquette" aria-label="Chercher" className={cn(inputClass, "h-9 w-64 pl-8 max-sm:w-full")} />
        </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Style" className="h-9 max-w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-accent/60">
          <option value="all">Tous les styles</option>
          <option value="none">Rangés dans aucun style</option>
          {styleOptions.map((o) => (
            <option key={o.ref} value={o.ref}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-ink-3">
          {list.length} {t.one}
          {list.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className={cn("grid gap-4", current && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
        <div
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => (e.preventDefault(), setOver(false), send(e.dataTransfer.files))}
          className={cn("min-h-48 rounded-xl transition-[box-shadow,background-color] duration-150", over && "bg-accent-soft/40 shadow-[0_0_0_2px_var(--accent)]")}
        >
          {error && !items ? (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-[13px]">
              <span className="size-2 shrink-0 rounded-full bg-warn" />
              <p className="min-w-0 flex-1">Bibliothèque illisible : {error}</p>
              <Button size="sm" onClick={reload}>
                Réessayer
              </Button>
            </div>
          ) : !items ? (
            <p className="text-[13px] text-ink-3">Lecture…</p>
          ) : !list.length ? (
            <button type="button" onClick={() => input.current?.click()} className="press grid h-48 w-full place-items-center rounded-xl border border-dashed border-line-strong text-[13px] text-ink-3 hover:border-ink-3 hover:text-ink">
              <span className="flex flex-col items-center gap-2">
                <Upload className="size-5" />
                {query || filter !== "all" ? "Rien ici avec ce filtre." : t.empty}
              </span>
            </button>
          ) : kind === "illustration" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {list.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setPicked((p) => (p === i.id ? null : i.id))}
                  className={cn("press flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface text-left shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent/50", picked === i.id ? "border-accent/60 shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line hover:border-ink-3/40")}
                >
                  <span className="checker grid aspect-square place-items-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(i)} alt={i.name} loading="lazy" className="size-full object-contain p-3" />
                  </span>
                  <span className="border-t border-line px-2.5 py-2">
                    <span className="block truncate text-[12.5px] font-medium">{i.name}</span>
                    <span className="block truncate text-[11px] text-ink-3">{i.styles.length ? i.styles.map(label).filter(Boolean).join(", ") : i.tags.join(", ") || "Aucun style"}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              {list.map((i, n) => (
                <SoundRow key={i.id} item={i} first={!n} on={picked === i.id} label={label} onPick={() => setPicked((p) => (p === i.id ? null : i.id))} />
              ))}
            </div>
          )}
        </div>
        {current && (
          <ItemEditor
            key={current.id}
            item={current}
            options={styleOptions}
            suggestions={kind === "sfx" ? SFX_TAGS : kind === "music" ? MUSIC_TAGS : ILLUSTRATION_TAGS}
            onClose={() => setPicked(null)}
            onSave={(change) => update(current.id, change)}
            onRemove={async () => {
              await remove(current.id);
              setPicked(null);
            }}
          />
        )}
      </div>
    </ResourceShell>
  );
}

/** A sound effect: play it, see its length, its tags and its styles. */
function SoundRow({ item, first, on, label, onPick }: { item: LibraryItem; first: boolean; on: boolean; label: (ref: string) => string | undefined; onPick: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [length, setLength] = useState<number>();
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      a.currentTime = 0;
      a.play().catch(() => setPlaying(false));
    } else a.pause();
  };
  return (
    <div role="button" tabIndex={0} onClick={onPick} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick())} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 outline-none hover:bg-ink/[0.03] focus-visible:bg-ink/[0.04]", !first && "border-t border-line", on && "bg-accent-soft/40")}>
      <audio ref={audio} src={fileUrl(item)} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onLoadedMetadata={(e) => setLength(e.currentTarget.duration)} />
      <button type="button" onClick={toggle} aria-label={playing ? `Arrêter ${item.name}` : `Écouter ${item.name}`} className="press grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{item.name}</span>
        <span className="block truncate text-[11.5px] text-ink-3">
          {item.source === "elevenlabs" ? "ElevenLabs · " : item.source === "google" ? "Google Lyria · " : ""}
          {item.styles.length ? item.styles.map(label).filter(Boolean).join(", ") : "Aucun style"}
        </span>
      </span>
      <span className="flex shrink-0 gap-1 max-sm:hidden">
        {item.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] text-ink-2">
            {tag}
          </span>
        ))}
      </span>
      <span className="w-12 shrink-0 text-right text-[11.5px] tabular-nums text-ink-3">{length && Number.isFinite(length) ? `${length.toFixed(1)} s` : ""}</span>
    </div>
  );
}

/** Name, tags and styles of one item; remove it. */
function ItemEditor({
  item,
  options,
  suggestions,
  onClose,
  onSave,
  onRemove,
}: {
  item: LibraryItem;
  options: { ref: string; label: string }[];
  suggestions: string[];
  onClose: () => void;
  onSave: (change: { name?: string; tags?: string[]; styles?: string[] }) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const [name, setName] = useState(item.name);
  const [tags, setTags] = useState(item.tags);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setTags(item.tags), [item.tags]);
  const dirty = name.trim() !== item.name || tags.join(",") !== item.tags.join(",");
  const addTag = (raw: string) => {
    const v = raw.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 30);
    if (v && !tags.includes(v) && tags.length < MAX_TAGS) setTags((x) => [...x, v]);
    setTag("");
  };
  const act = async (what: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(what, { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  // A style ticked or unticked is saved at once.
  const toggleStyle = (ref: string) => act("Style non changé", () => onSave({ styles: item.styles.includes(ref) ? item.styles.filter((s) => s !== ref) : [...item.styles, ref] }));

  return (
    <aside className="rise flex h-fit flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-card xl:sticky xl:top-0">
      <div className="flex items-start gap-2">
        {item.kind === "illustration" ? (
          <span className="checker grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(item)} alt="" className="size-full object-contain p-1.5" />
          </span>
        ) : (
          <audio src={fileUrl(item)} controls className="h-9 min-w-0 flex-1" />
        )}
        <span className={cn("min-w-0 text-[11.5px] text-ink-3", item.kind === "illustration" && "flex-1")}>
          {item.kind === "illustration" && (
            <>
              {item.ext.toUpperCase()} · {Math.max(1, Math.round(item.size / 1000))} Ko
              <br />
              {item.source === "claude" ? "Fait par Claude" : "Ajouté à la main"}
            </>
          )}
        </span>
        <button type="button" onClick={onClose} aria-label="Fermer" className="press grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-ink/5 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">Nom</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_ASSET_NAME} className={cn(inputClass, "h-9")} />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">Étiquettes (Claude s&apos;en sert pour choisir)</span>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((x) => (
            <span key={x} className="flex items-center gap-1 rounded-full border border-line-strong py-0.5 pr-1 pl-2.5 text-[12px] text-ink-2">
              {x}
              <button type="button" onClick={() => setTags((l) => l.filter((y) => y !== x))} aria-label={`Retirer ${x}`} className="press grid size-4 place-items-center rounded-full text-ink-3 hover:text-danger">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => (e.key === "Enter" || e.key === ",") && (e.preventDefault(), addTag(tag))} onBlur={() => tag && addTag(tag)} placeholder="Ajouter une étiquette, puis Entrée" className={cn(inputClass, "h-8")} />
        <div className="flex flex-wrap gap-1">
          {suggestions
            .filter((x) => !tags.includes(x))
            .map((x) => (
              <button key={x} type="button" onClick={() => addTag(x)} className="press rounded-full px-2 py-0.5 text-[11px] text-ink-3 hover:bg-ink/5 hover:text-ink">
                + {x}
              </button>
            ))}
        </div>
      </div>
      <Button size="sm" variant="primary" className="h-8 self-end" disabled={busy || !dirty || !name.trim()} onClick={() => act("Non enregistré", () => onSave({ name, tags }))}>
        Enregistrer
      </Button>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span className="text-[12px] font-medium text-ink-2">Styles</span>
        {options.length ? (
          <div className="scroll-thin flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {options.map((o) => (
              <label key={o.ref} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-ink/[0.03]">
                <input type="checkbox" checked={item.styles.includes(o.ref)} disabled={busy} onChange={() => toggleStyle(o.ref)} className="size-4 accent-[var(--accent)]" />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-ink-3">Aucun style : crée d&apos;abord un projet.</p>
        )}
        <span className="text-[11.5px] text-ink-3">Sans style, Claude ne le prend que pour un style qui n&apos;a rien de rangé.</span>
      </div>
      <Button size="sm" variant="ghost" className="h-8 self-start hover:text-danger" disabled={busy} onClick={() => confirm(`Supprimer « ${item.name} » ?`) && act("Non supprimé", onRemove)}>
        <Trash2 className="size-3.5" />
        Supprimer
      </Button>
    </aside>
  );
}
