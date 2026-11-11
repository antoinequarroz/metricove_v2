"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { CalendarPlus, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { duration, fmt } from "@/lib/utils";
import { CoverControl } from "./cover";
import { Button, SourceTag } from "./ui";

/** Plays a library video, or shows a photo, in a window. Opened with useStore().playMedia(id). */
export function VideoPlayer() {
  const id = useStore((s) => s.playing);
  const media = useStore((s) => s.media);
  const posts = useStore((s) => s.posts);
  const play = useStore((s) => s.playMedia);
  const openComposer = useStore((s) => s.openComposer);
  const composerOpen = useStore((s) => s.composer.open);
  const m = media.find((x) => x.id === id);
  const uses = m ? posts.filter((p) => p.mediaId === m.id).length : 0;
  const wide = m?.aspect === "16:9";

  return (
    <Dialog.Root open={!!m} onOpenChange={(o) => !o && play(undefined)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-[60] bg-[rgba(10,9,8,0.72)] backdrop-blur-[4px]" />
        <Dialog.Popup className="dialog-popup fixed top-1/2 left-1/2 z-[70] flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 outline-none sm:w-auto">
          {m?.url && (
            <>
              {m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={m.id}
                  src={m.url}
                  alt={m.title}
                  className="max-h-[calc(100dvh-140px)] w-auto max-w-full rounded-xl bg-black object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
                />
              ) : (
              <video
                key={m.id}
                src={m.url}
                controls
                autoPlay
                playsInline
                className={
                  wide
                    ? "max-h-[calc(100dvh-200px)] w-[min(960px,100%)] rounded-xl bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
                    : "max-h-[calc(100dvh-200px)] w-auto max-w-full rounded-xl bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
                }
                style={wide ? undefined : { aspectRatio: m.aspect === "1:1" ? "1 / 1" : "9 / 16" }}
              />
              )}
              <div className="flex w-full max-w-[min(960px,100%)] items-center gap-3 rounded-xl border border-white/10 bg-[rgba(20,19,17,0.85)] px-3 py-2 text-white backdrop-blur">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-[13.5px] font-medium">{m.title}</Dialog.Title>
                  <p className="mt-0.5 flex items-center gap-1.5 overflow-hidden text-[12px] whitespace-nowrap text-white/60">
                    <SourceTag source={m.source} onMedia />
                    {m.kind === "image" ? <span className="tabular font-mono">{m.width && m.height ? `${m.width} × ${m.height}` : "Photo"}</span> : <><span className="tabular font-mono">{duration(m.duration)}</span>·<span>{m.aspect}</span></>}<span className="max-sm:hidden">· {fmt(m.createdAt, "d MMM")}</span>
                    {uses > 0 && <span className="max-sm:hidden">· dans {uses} post{uses > 1 ? "s" : ""}</span>}
                  </p>
                </div>
                {!composerOpen && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      play(undefined);
                      openComposer({ mediaId: m.id });
                    }}
                  >
                    <CalendarPlus className="size-3.5" />
                    Programmer
                  </Button>
                )}
                <Dialog.Close aria-label="Fermer" className="press flex size-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </Dialog.Close>
              </div>
              {m.kind !== "image" && (
                <div className="w-full max-w-[min(960px,100%)] rounded-xl border border-white/10 bg-[rgba(20,19,17,0.85)] px-3 py-2 backdrop-blur">
                  <CoverControl media={m} tone="dark" />
                </div>
              )}
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
