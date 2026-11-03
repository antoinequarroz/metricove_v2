"use client";

import { Bookmark, Heart, MessageCircle, MoreHorizontal, Repeat2, Send, Share, ThumbsUp, BarChart2, Globe2 } from "lucide-react";
import type { Account, Media } from "@/lib/types";
import { cn, fmt } from "@/lib/utils";
import { Avatar, MediaThumb } from "./ui";

type Props = { account: Account; caption: string; media?: Media; date: Date };

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

export function InstagramPreview({ account, caption, media }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface text-[13px] shadow-card">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="rounded-full bg-[linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf)] p-[2px]">
          <Avatar account={account} size={28} badge={false} />
        </span>
        <span className="font-semibold">{account.handle}</span>
        <MoreHorizontal className="ml-auto size-4" />
      </div>
      {media ? (
        <MediaThumb media={media} className={cn("w-full rounded-none", media.aspect === "16:9" ? "aspect-video" : media.aspect === "1:1" ? "aspect-square" : "aspect-[4/5]")} />
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center bg-surface-2 text-[12px] text-ink-3">Instagram exige une image ou une vidéo</div>
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
          {media && <MediaThumb media={media} className="mt-2.5 aspect-video w-full rounded-xl border border-line" />}
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
      {media && <MediaThumb media={media} className="aspect-video w-full rounded-none" />}
      <div className="flex justify-around border-t border-line py-2 text-[12.5px] font-medium text-ink-2">
        <span className="flex items-center gap-1.5"><ThumbsUp className="size-4" />J&apos;aime</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="size-4" />Commenter</span>
        <span className="flex items-center gap-1.5"><Repeat2 className="size-4" />Republier</span>
        <span className="flex items-center gap-1.5"><Send className="size-4" />Envoyer</span>
      </div>
    </div>
  );
}

export function FacebookPreview({ account, caption, media, date }: Props) {
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
      {media && <MediaThumb media={media} className="aspect-video w-full rounded-none" />}
      <div className="flex justify-around border-t border-line py-2 text-[13px] font-medium text-ink-2">
        <span className="flex items-center gap-1.5"><ThumbsUp className="size-4" />J&apos;aime</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="size-4" />Commenter</span>
        <span className="flex items-center gap-1.5"><Share className="size-4" />Partager</span>
      </div>
    </div>
  );
}

export function PostPreview(props: Props) {
  switch (props.account.network) {
    case "instagram":
      return <InstagramPreview {...props} />;
    case "x":
      return <XPreview {...props} />;
    case "linkedin":
      return <LinkedInPreview {...props} />;
    case "facebook":
      return <FacebookPreview {...props} />;
  }
}
