"use client";

import { Bookmark, ChevronLeft, ChevronRight, Heart, MessageCircle, MoreHorizontal, Repeat2, Send, Share, ThumbsUp, BarChart2, Globe2 } from "lucide-react";
import { ThumbsDown } from "lucide-react";
import { useState } from "react";
import { IG_PHOTO_RATIO, ratioOf } from "@/lib/formats";
import type { Account, Media, PostFormat, YouTubeOptions } from "@/lib/types";
import { cn, fmt } from "@/lib/utils";
import { Avatar, MediaThumb } from "./ui";

type Props = { account: Account; caption: string; media?: Media; /** Every media of a carousel, in order. */ items?: Media[]; date: Date; youtube?: YouTubeOptions; format?: PostFormat };

/** The shape a photo takes in a feed: its own ratio, within what the feeds show. */
const photoRatio = (m: Media) => Math.min(IG_PHOTO_RATIO.max, Math.max(IG_PHOTO_RATIO.min, ratioOf(m)));

function Caption({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return <span className="text-ink-3 italic">Votre texte apparaîtra ici…</span>;
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {text.split(/(\s+)/).map((w, i) =>
        /^[#@]\w/.test(w) ? (
          <span key={i} className="text-[#0a66c2] dark:text-[#5aa8ff]">
            {w}
          </span>
        ) : (
          w
        ),
      )}
    </span>
  );
}

/** The shape Instagram gives a media in the feed. A carousel takes the shape of its first media. */
const instagramRatio = (m: Media) => (m.kind === "image" ? photoRatio(m) : m.aspect === "16:9" ? 16 / 9 : m.aspect === "1:1" ? 1 : 4 / 5);

/** An Instagram carousel: one media at a time, arrows and dots to move through it. */
function InstagramCarousel({ items }: { items: Media[] }) {
  const [at, setAt] = useState(0);
  // The list can shrink while the editor is open.
  const i = Math.min(at, items.length - 1);
  return (
    <div>
      <div className="relative overflow-hidden" style={{ aspectRatio: instagramRatio(items[0]) }}>
        <div className="flex h-full transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ transform: `translateX(-${i * 100}%)` }}>
          {items.map((m) => (
            <MediaThumb key={m.id} media={m} playable className="h-full w-full shrink-0 rounded-none" />
          ))}
        </div>
        <span className="tabular absolute top-2.5 right-2.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white">
          {i + 1}/{items.length}
        </span>
        {i > 0 && (
          <button type="button" onClick={() => setAt(i - 1)} aria-label="Média précédent" className="press absolute top-1/2 left-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-black shadow">
            <ChevronLeft className="size-4" />
          </button>
        )}
        {i < items.length - 1 && (
          <button type="button" onClick={() => setAt(i + 1)} aria-label="Média suivant" className="press absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-black shadow">
            <ChevronRight className="size-4" />
          </button>
        )}
      </div>
      <div className="flex justify-center gap-1 pt-2.5">
        {items.map((m, k) => (
          <span key={m.id} className={cn("size-[5px] rounded-full transition-colors duration-200", k === i ? "bg-[#0095f6]" : "bg-ink/20")} />
        ))}
      </div>
    </div>
  );
}

/** Several photos in one Facebook post: a mosaic of up to four, the rest counted on the last tile. */
function FacebookMosaic({ items }: { items: Media[] }) {
  const shown = items.slice(0, 4);
  const more = items.length - shown.length;
  return (
    <div className={cn("grid aspect-square gap-0.5", shown.length === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2")}>
      {shown.map((m, k) => (
        <div key={m.id} className={cn("relative min-h-0", shown.length === 3 && k === 0 && "row-span-2")}>
          <MediaThumb media={m} playable showMeta={false} className="h-full w-full rounded-none" />
          {more > 0 && k === shown.length - 1 && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 text-[22px] font-semibold text-white">+{more}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function InstagramPreview({ account, caption, media, items }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface text-[13px] shadow-card">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="rounded-full bg-[linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf)] p-[2px]">
          <Avatar account={account} size={28} badge={false} />
        </span>
        <span className="font-semibold">{account.handle}</span>
        <MoreHorizontal className="ml-auto size-4" />
      </div>
      {items && items.length > 1 ? (
        <InstagramCarousel items={items} />
      ) : media ? (
        <MediaThumb media={media} playable className="w-full rounded-none" style={{ aspectRatio: instagramRatio(media) }} />
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center bg-surface-2 text-[12px] text-ink-3">Instagram exige une photo ou une vidéo</div>
      )}
      <div className="flex items-center gap-3.5 px-3 pt-2.5">
        <Heart className="size-[22px]" />
        <MessageCircle className="size-[22px]" />
        <Send className="size-[21px]" />
        <Bookmark className="ml-auto size-[22px]" />
      </div>
      <p className="px-3 pt-2 pb-3 leading-snug">
        <span className="mr-1.5 font-semibold">{account.handle}</span>
        <Caption text={caption} />
      </p>
    </div>
  );
}

export function XPreview({ account, caption, media, date }: Props) {
  const over = caption.length > 280;
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5 text-[14px] shadow-card">
      <div className="flex gap-2.5">
        <Avatar account={account} size={38} badge={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[13.5px]">
            <span className="font-bold">{account.name}</span>
            <span className="truncate text-ink-3">@{account.handle} · {fmt(date, "d MMM")}</span>
          </div>
          <p className="mt-0.5 leading-snug">
            {over ? (
              <>
                <Caption text={caption.slice(0, 280)} />
                <span className="bg-danger/15 text-danger">{caption.slice(280)}</span>
              </>
            ) : (
              <Caption text={caption} />
            )}
          </p>
          {media && <MediaThumb media={media} playable className="mt-2.5 aspect-video w-full rounded-xl border border-line" />}
          <div className="mt-2.5 flex justify-between pr-6 text-ink-3">
            <MessageCircle className="size-[17px]" />
            <Repeat2 className="size-[17px]" />
            <Heart className="size-[17px]" />
            <BarChart2 className="size-[17px]" />
            <Share className="size-[17px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function LinkedInPreview({ account, caption, media }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface text-[13.5px] shadow-card">
      <div className="flex gap-2.5 p-3">
        <Avatar account={account} size={44} badge={false} />
        <div className="min-w-0 leading-tight">
          <div className="font-semibold">{account.name}</div>
          <div className="text-[12px] text-ink-3">{account.followers.toLocaleString("fr-CH")} abonnés</div>
          <div className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-3">
            Maintenant · <Globe2 className="size-3" />
          </div>
        </div>
      </div>
      <p className="px-3 pb-3 leading-relaxed">
        <Caption text={caption} />
      </p>
      {media && <MediaThumb media={media} playable className="aspect-video w-full rounded-none" />}
      <div className="flex justify-around border-t border-line py-2 text-[12.5px] font-medium text-ink-2">
        <span className="flex items-center gap-1.5"><ThumbsUp className="size-4" />J&apos;aime</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="size-4" />Commenter</span>
        <span className="flex items-center gap-1.5"><Repeat2 className="size-4" />Republier</span>
        <span className="flex items-center gap-1.5"><Send className="size-4" />Envoyer</span>
      </div>
    </div>
  );
}

export function FacebookPreview({ account, caption, media, items, date }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface text-[14px] shadow-card">
      <div className="flex items-center gap-2.5 p-3">
        <Avatar account={account} size={38} badge={false} />
        <div className="leading-tight">
          <div className="font-semibold">{account.name}</div>
          <div className="flex items-center gap-1 text-[12px] text-ink-3">
            {fmt(date, "d MMMM 'à' HH:mm")} · <Globe2 className="size-3" />
          </div>
        </div>
        <MoreHorizontal className="ml-auto size-5 text-ink-3" />
      </div>
      <p className="px-3 pb-3 leading-snug">
        <Caption text={caption} />
      </p>
      {items && items.length > 1 ? (
        <FacebookMosaic items={items} />
      ) : (
        media &&
        (media.kind === "image" ? (
          <MediaThumb media={media} playable className="w-full rounded-none" style={{ aspectRatio: photoRatio(media) }} />
        ) : (
          <MediaThumb media={media} playable className="aspect-video w-full rounded-none" />
        ))
      )}
      <div className="flex justify-around border-t border-line py-2 text-[13px] font-medium text-ink-2">
        <span className="flex items-center gap-1.5"><ThumbsUp className="size-4" />J&apos;aime</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="size-4" />Commenter</span>
        <span className="flex items-center gap-1.5"><Share className="size-4" />Partager</span>
      </div>
    </div>
  );
}

export function YouTubePreview({ account, caption, media, youtube }: Props) {
  const title = youtube?.title.trim() || "Titre de la vidéo";
  if (youtube?.format === "short") {
    return (
      <div className="relative mx-auto aspect-[9/16] w-[260px] overflow-hidden rounded-[22px] bg-black text-white shadow-card ring-1 ring-line">
        {media ? <MediaThumb media={media} playable showMeta={false} className="absolute inset-0 rounded-none" /> : <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/60">Ajoutez une vidéo verticale</div>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-3.5 pt-16">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold">
            <Avatar account={account} size={24} badge={false} />@{account.handle}
            <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-black">S&apos;abonner</span>
          </div>
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug">{title}</p>
        </div>
        <div className="absolute right-2.5 bottom-24 flex flex-col items-center gap-4 text-[10.5px]">
          <span className="flex flex-col items-center gap-1"><ThumbsUp className="size-5" />J&apos;aime</span>
          <span className="flex flex-col items-center gap-1"><ThumbsDown className="size-5" />Je n&apos;aime pas</span>
          <span className="flex flex-col items-center gap-1"><MessageCircle className="size-5" />0</span>
          <span className="flex flex-col items-center gap-1"><Share className="size-5" />Partager</span>
        </div>
        <span className="absolute top-3 left-3 rounded-md bg-black/40 px-1.5 py-0.5 text-[11px] font-semibold backdrop-blur">Shorts</span>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface text-[13.5px] shadow-card">
      {media ? <MediaThumb media={media} playable className="aspect-video w-full rounded-none" /> : <div className="flex aspect-video items-center justify-center bg-surface-2 text-[12px] text-ink-3">YouTube exige une vidéo</div>}
      <div className="flex gap-3 p-3">
        <Avatar account={account} size={36} badge={false} />
        <div className="min-w-0">
          <p className="line-clamp-2 font-semibold leading-snug">{title}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">{account.name} · 0 vue · à l&apos;instant</p>
        </div>
      </div>
      <p className="mx-3 mb-3 line-clamp-3 rounded-lg bg-surface-2 p-2.5 text-[12.5px] leading-snug">
        <Caption text={caption} />
      </p>
    </div>
  );
}

export function TikTokPreview({ account, caption, media }: Props) {
  return (
    <div className="relative mx-auto aspect-[9/16] w-[260px] overflow-hidden rounded-[22px] bg-black text-white shadow-card ring-1 ring-line">
      {media ? <MediaThumb media={media} playable showMeta={false} className="absolute inset-0 rounded-none" /> : <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/60">TikTok exige une vidéo</div>}
      <div className="absolute inset-x-0 top-3 flex justify-center gap-4 text-[12.5px] font-semibold">
        <span className="text-white/60">Abonnements</span>
        <span className="border-b-2 border-white pb-0.5">Pour toi</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-3.5 pt-16 pr-14">
        <p className="text-[13px] font-semibold">@{account.handle}</p>
        <p className="mt-1 line-clamp-3 text-[12.5px] leading-snug [&_span]:!text-white">
          <Caption text={caption} />
        </p>
      </div>
      <div className="absolute right-2.5 bottom-20 flex flex-col items-center gap-4 text-[10.5px]">
        <Avatar account={account} size={34} badge={false} />
        <span className="flex flex-col items-center gap-1"><Heart className="size-6 fill-white" />0</span>
        <span className="flex flex-col items-center gap-1"><MessageCircle className="size-6" />0</span>
        <span className="flex flex-col items-center gap-1"><Bookmark className="size-6" />0</span>
        <span className="flex flex-col items-center gap-1"><Share className="size-6" />0</span>
      </div>
    </div>
  );
}

/** A story as the phone shows it: full screen, the account on top, gone after 24 hours. */
export function StoryPreview({ account, media: picked }: Props) {
  const instagram = account.network === "instagram";
  // The feed cover of a video plays no part in a story: show the video itself.
  const media = picked && { ...picked, cover: undefined };
  return (
    <div className="relative mx-auto aspect-[9/16] w-[260px] overflow-hidden rounded-[22px] bg-[#111] text-white shadow-card ring-1 ring-line">
      {media ? (
        <>
          {/* A photo or a video that isn't 9:16 is shown whole, on a blurred copy of itself. */}
          <MediaThumb media={media} showMeta={false} className="absolute inset-0 scale-125 rounded-none opacity-60 blur-2xl" />
          <MediaThumb media={media} playable showMeta={false} contain className="absolute inset-0 rounded-none" />
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] text-white/60">Ajoutez une photo ou une vidéo pour la story</div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent px-2.5 pt-2 pb-8">
        <div className="h-[2px] overflow-hidden rounded-full bg-white/35">
          <div className="h-full w-1/3 rounded-full bg-white" />
        </div>
        <div className="mt-2 flex items-center gap-2 text-[12px]">
          <Avatar account={account} size={26} badge={false} />
          <span className="truncate font-semibold">{instagram ? account.handle : account.name}</span>
          <span className="text-white/70">à l&apos;instant</span>
          <MoreHorizontal className="ml-auto size-4" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/55 to-transparent px-3 pt-8 pb-3">
        <span className="flex h-8 flex-1 items-center rounded-full border border-white/50 px-3.5 text-[11.5px] text-white/85">{instagram ? "Envoyer un message" : "Répondre…"}</span>
        <Heart className="size-5" />
        <Send className="size-5" />
      </div>
    </div>
  );
}

export function PostPreview(props: Props) {
  if (props.format === "story" && (props.account.network === "instagram" || props.account.network === "facebook")) return <StoryPreview {...props} />;
  switch (props.account.network) {
    case "youtube":
      return <YouTubePreview {...props} />;
    case "instagram":
      return <InstagramPreview {...props} />;
    case "tiktok":
      return <TikTokPreview {...props} />;
    case "x":
      return <XPreview {...props} />;
    case "linkedin":
      return <LinkedInPreview {...props} />;
    case "facebook":
      return <FacebookPreview {...props} />;
  }
}
