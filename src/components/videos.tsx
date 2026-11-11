"use client";

import { postMediaIds } from "@/lib/formats";
import { CalendarPlus, FolderSync, ImageIcon, Sparkles, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Segmented } from "./calendar";
import { isImageFile, MEDIA_ACCEPT, VIDEO_FILE } from "@/lib/image";
import { useStore } from "@/lib/store";
import type { Media } from "@/lib/types";
import { cn, duration, fmt } from "@/lib/utils";
import { VideoTabs } from "./montage/parts";
import { Button, MediaThumb, SourceTag } from "./ui";

type Filter = "all" | "new" | "used";
type Kind = "all" | Media["kind"];

export function VideosPage() {
  const media = useStore((s) => s.media);
  const posts = useStore((s) => s.posts);
  const openComposer = useStore((s) => s.openComposer);
  const [filter, setFilter] = useState<Filter>("all");
  const [kind, setKind] = useState<Kind>("all");
  const uploadMedia = useStore((s) => s.uploadMedia);
  const deleteMedia = useStore((s) => s.deleteMedia);
  const inbox = useStore((s) => s.integrations.inbox);
  const [uploads, setUploads] = useState<{ name: string; pct: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const photo = isImageFile(file);
      if (!photo && !VIDEO_FILE.test(file.name)) {
        toast.error(`${file.name} : formats acceptés mp4, mov, m4v pour les vidéos, jpg, png, webp, heic pour les photos`);
        continue;
      }
      setUploads((u) => [...u, { name: file.name, pct: 0 }]);
      try {
        await uploadMedia(file, (pct) => setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, pct } : x))));
        toast.success(photo ? "Photo ajoutée" : "Vidéo ajoutée", { description: file.name });
      } catch (e) {
        toast.error("Envoi impossible", { description: (e as Error).message });
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
      }
    }
  };

  const usedBy = (id: string) => posts.filter((p) => postMediaIds(p).includes(id));
  const list = media
    .filter((m) => kind === "all" || m.kind === kind)
    .filter((m) => (filter === "all" ? true : filter === "new" ? usedBy(m.id).length === 0 : usedBy(m.id).length > 0));
  const photos = media.filter((m) => m.kind === "image").length;

  return (
    <>
      <header className="flex flex-wrap items-end gap-4 border-b border-line px-6 pt-5 pb-4 max-md:px-4">
        <div>
          <p className="text-[12px] font-medium text-ink-3">Bibliothèque</p>
          <h1 className="font-display text-[34px] leading-[1.05]">Médias</h1>
        </div>
        <VideoTabs />
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) upload(e.target.files);
              // The same file can be picked again after a failed upload.
              e.target.value = "";
            }}
          />
          <Button variant="primary" onClick={() => input.current?.click()}>
            <Upload className="size-4" />
            Importer
          </Button>
          <Segmented<Kind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "Tout" },
              { value: "video", label: "Vidéos" },
              { value: "image", label: "Photos" },
            ]}
          />
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Tous" },
              { value: "new", label: "À programmer" },
              { value: "used", label: "Programmés" },
            ]}
          />
        </div>
      </header>

      <div
        className={cn("scroll-thin relative flex-1 overflow-y-auto px-6 py-5 transition-colors duration-150 max-md:px-4", dragging && "bg-accent-soft")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files);
        }}
      >
        {uploads.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {uploads.map((u) => (
              <div key={u.name} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-[12.5px]">
                <div className="flex justify-between">
                  <span className="truncate">{u.name}</span>
                  <span className="tabular font-mono text-ink-3">{u.pct}%</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full origin-left rounded-full bg-accent transition-transform duration-200" style={{ transform: `scaleX(${u.pct / 100})` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <FolderSync className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-medium">Import automatique depuis Claude Code</p>
            <p className="text-ink-3">
              {inbox
                ? "Le dossier d'import est surveillé : chaque vidéo ou photo qui y arrive apparaît ici en quelques secondes."
                : "Claude Code peut envoyer ses vidéos et ses photos par l'API. Vous pouvez aussi glisser-déposer des fichiers ici."}{" "}
              Voir docs/CLAUDE_CODE.md.
            </p>
          </div>
        </div>

        {list.length === 0 && uploads.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
            <ImageIcon className="size-6 text-ink-3" />
            <p className="text-[14px] font-medium">{kind === "image" && photos === 0 ? "Pas encore de photo" : "Rien à afficher ici"}</p>
            <p className="max-w-[380px] text-[13px] text-ink-3">
              {kind === "image" && photos === 0
                ? "Importez des photos pour vos posts et vos stories : glissez-les ici, ou utilisez le bouton Importer."
                : "Changez de filtre, ou importez des vidéos et des photos."}
            </p>
            <Button className="mt-2" onClick={() => input.current?.click()}>
              <Upload className="size-4" />
              Importer
            </Button>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
          {list.map((m, i) => {
            const uses = usedBy(m.id);
            return (
              <article key={m.id} className="rise group flex flex-col" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="relative">
                  <MediaThumb media={m} playable className="aspect-[9/14] w-full shadow-card" />
                  {m.kind === "image" && (
                    <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-px text-[10.5px] font-medium text-white backdrop-blur group-hover:opacity-0 group-focus-within:opacity-0">
                      <ImageIcon className="size-3" /> Photo
                    </span>
                  )}
                  <SourceTag source={m.source} onMedia className="absolute top-2 left-2" />
                  {uses.length === 0 && (
                    <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-px text-[10.5px] font-medium text-white">
                      <Sparkles className="size-3" /> Nouveau
                    </span>
                  )}
                  <div className="absolute inset-x-2 bottom-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button size="sm" variant="primary" className="w-full" onClick={() => openComposer({ mediaId: m.id })}>
                      <CalendarPlus className="size-3.5" />
                      Programmer
                    </Button>
                  </div>
                </div>
                <h3 className="mt-2.5 line-clamp-1 text-[13.5px] font-medium">{m.title}</h3>
                <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                  {m.kind === "image" ? (
                    <span className="tabular font-mono">{m.width && m.height ? `${m.width} × ${m.height}` : "Photo"}</span>
                  ) : (
                    <>
                      <span className="tabular font-mono">{duration(m.duration)}</span>·<span>{m.aspect}</span>
                    </>
                  )}
                  ·<span>{fmt(m.createdAt, "d MMM")}</span>
                </p>
                <div className="mt-1 flex items-center">
                  <p className={cn("text-[12px]", uses.length ? "text-ink-2" : "text-accent")}>
                    {uses.length ? `Dans ${uses.length} post${uses.length > 1 ? "s" : ""}` : "Pas encore programmé"}
                  </p>
                  {uses.length === 0 && (
                    <button
                      aria-label={m.kind === "image" ? "Supprimer la photo" : "Supprimer la vidéo"}
                      title="Supprimer"
                      onClick={() =>
                        confirm(`Supprimer « ${m.title} » ?`) &&
                        deleteMedia(m.id).then(
                          () => toast(m.kind === "image" ? "Photo supprimée" : "Vidéo supprimée"),
                          (e: Error) => toast.error(e.message),
                        )
                      }
                      className="press ml-auto flex size-6 items-center justify-center rounded-md text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger focus-visible:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
