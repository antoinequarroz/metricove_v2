"use client";

import { Play, Sparkles, Bot, Upload } from "lucide-react";
import { forwardRef } from "react";
import { NetworkBadge } from "@/lib/networks";
import { useStore } from "@/lib/store";
import type { Account, Media, PostStatus } from "@/lib/types";
import { cn, duration } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "press inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
        variant === "primary" &&
          "bg-accent text-accent-ink shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_1px_2px_rgba(0,0,0,0.12),0_6px_16px_-6px_var(--accent)] hover:brightness-[1.06]",
        variant === "secondary" && "border border-line-strong bg-surface text-ink shadow-card hover:bg-surface-2",
        variant === "ghost" && "text-ink-2 hover:bg-ink/5 hover:text-ink",
        className,
      )}
      {...props}
    />
  );
});

export function Avatar({ account, size = 28, badge = true, dim = false }: { account: Account; size?: number; badge?: boolean; dim?: boolean }) {
  const initials = account.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  return (
    <span className={cn("relative inline-flex shrink-0", dim && "opacity-40 grayscale")} style={{ width: size, height: size }}>
      <span
        className="flex size-full items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-surface"
        style={{
          background: `linear-gradient(140deg, oklch(0.72 0.14 ${account.hue}), oklch(0.5 0.16 ${account.hue + 40}))`,
          fontSize: size * 0.36,
        }}
      >
        {account.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.avatarUrl} alt="" className="size-full rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          initials
        )}
      </span>
      {badge && (
        <span className="absolute -right-1.5 -bottom-1" style={{ width: Math.max(12, Math.round(size * 0.48)), height: Math.max(12, Math.round(size * 0.48)) }}>
          <NetworkBadge network={account.network} size="xs" className="!size-full !p-[2px] ring-2 ring-surface" />
        </span>
      )}
    </span>
  );
}

export function AvatarStack({ accounts, size = 20 }: { accounts: Account[]; size?: number }) {
  return (
    <span className="flex -space-x-1.5">
      {accounts.slice(0, 3).map((a) => (
        <Avatar key={a.id} account={a} size={size} badge={false} />
      ))}
    </span>
  );
}

const SOURCE_META = {
  "claude-code": { label: "Claude Code", Icon: Sparkles },
  hermes: { label: "Hermes", Icon: Bot },
  upload: { label: "Import", Icon: Upload },
};

export function SourceTag({ source, className, onMedia }: { source: keyof typeof SOURCE_META; className?: string; onMedia?: boolean }) {
  const { label, Icon } = SOURCE_META[source];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] font-medium backdrop-blur",
        onMedia ? "border-white/20 bg-black/40 text-white" : "border-line bg-surface/80 text-ink-2",
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2.2} />
      {label}
    </span>
  );
}

/** Thumbnail of a video (cover or first frame) or of a photo. A gradient shows until the file loads. */
export function MediaThumb({
  media,
  className,
  showMeta = true,
  playable = false,
  contain = false,
  style,
}: {
  media: Media;
  className?: string;
  style?: React.CSSProperties;
  /** Show the whole picture (letterboxed) instead of filling the frame. */
  contain?: boolean;
  showMeta?: boolean;
  /** Clicking the thumbnail opens the video player. */
  playable?: boolean;
}) {
  const [h1, h2] = media.hues;
  const play = useStore((s) => s.playMedia);
  const canPlay = playable && !!media.url;
  const image = media.kind === "image";
  const fit = contain ? "object-contain" : "object-cover";
  return (
    <div
      // A caller that places the thumbnail itself ("absolute inset-0") must not be overridden by "relative".
      className={cn(!/(^|\s)absolute(\s|$)/.test(className ?? "") && "relative", "overflow-hidden rounded-lg", className)}
      style={{
        background: contain
          ? undefined
          : `radial-gradient(120% 90% at 20% 10%, oklch(0.78 0.15 ${h1}), transparent 60%), radial-gradient(120% 100% at 90% 100%, oklch(0.45 0.17 ${h2}), transparent 65%), oklch(0.3 0.06 ${h2})`,
        ...style,
      }}
    >
      {image && media.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt="" loading="lazy" decoding="async" className={cn("absolute inset-0 size-full", fit)} />
      ) : media.cover ? (
        // The feed cover, as Instagram will show it on the grid.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.cover} alt="" loading="lazy" className={cn("absolute inset-0 size-full", fit)} />
      ) : media.url ? (
        // First frame of the real video, loaded lazily.
        <video src={`${media.url}#t=0.5`} muted playsInline preload="metadata" className={cn("absolute inset-0 size-full", fit)} />
      ) : (
        <div className="absolute inset-0 opacity-30 mix-blend-overlay" style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.15) 0 1px, transparent 1px 3px)" }} />
      )}
      {canPlay && (
        <button
          type="button"
          aria-label={image ? `Agrandir « ${media.title} »` : `Lire « ${media.title} »`}
          onClick={(e) => {
            e.stopPropagation();
            play(media.id);
          }}
          className="group/play absolute inset-0 flex items-center justify-center outline-none"
        >
          {image ? (
            // A photo has nothing to play: the whole thumbnail opens it, with only a focus ring.
            <span className="absolute inset-0 rounded-[inherit] group-focus-visible/play:ring-2 group-focus-visible/play:ring-accent group-focus-visible/play:ring-inset" />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-full bg-black/35 text-white ring-1 ring-white/40 backdrop-blur-md transition-transform duration-150 group-hover/play:scale-110 group-focus-visible/play:ring-2 group-focus-visible/play:ring-accent group-active/play:scale-95">
              <Play className="ml-0.5 size-4 fill-current" />
            </span>
          )}
        </button>
      )}
      {showMeta && !image && (
        <>
          {!canPlay && (
            <span className="absolute top-1/2 left-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white ring-1 ring-white/30 backdrop-blur-md">
              <Play className="ml-0.5 size-4 fill-current" />
            </span>
          )}
          <span className="tabular pointer-events-none absolute right-1.5 bottom-1.5 rounded-md bg-black/45 px-1.5 py-px font-mono text-[10.5px] text-white backdrop-blur">
            {duration(media.duration)}
          </span>
        </>
      )}
    </div>
  );
}

export const STATUS_META: Record<PostStatus, { label: string; dot: string; text: string }> = {
  draft: { label: "Brouillon", dot: "bg-ink-3", text: "text-ink-2" },
  scheduled: { label: "Programmé", dot: "bg-accent", text: "text-accent" },
  publishing: { label: "Publication…", dot: "bg-accent animate-pulse", text: "text-accent" },
  published: { label: "Publié", dot: "bg-ok", text: "text-ok" },
  failed: { label: "Échec", dot: "bg-danger", text: "text-danger" },
};

export function StatusPill({ status, inbox = false }: { status: PostStatus; inbox?: boolean }) {
  // Published on TikTok's side but still waiting for Antoine in the app.
  const m = inbox && status === "published" ? { label: "À finaliser dans TikTok", dot: "bg-warn animate-pulse", text: "text-warn" } : STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[11.5px] font-medium", m.text)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-mono text-[10.5px] text-ink-3">
      {children}
    </kbd>
  );
}
