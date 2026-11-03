import { siFacebook, siInstagram, siTiktok, siX, siYoutube } from "simple-icons";
import clsx from "clsx";
import type { Network } from "./types";

export const NETWORKS: Record<Network, { label: string; color: string; limit: number }> = {
  instagram: { label: "Instagram", color: "#E1306C", limit: 2200 },
  facebook: { label: "Facebook", color: "#0866FF", limit: 63206 },
  x: { label: "X", color: "#111111", limit: 280 },
  linkedin: { label: "LinkedIn", color: "#0A66C2", limit: 3000 },
  youtube: { label: "YouTube", color: "#FF0000", limit: 5000 },
  tiktok: { label: "TikTok", color: "#000000", limit: 2200 },
};

export const NETWORK_ORDER: Network[] = ["instagram", "tiktok", "facebook", "x", "linkedin", "youtube"];

const PATHS: Partial<Record<Network, string>> = {
  instagram: siInstagram.path,
  facebook: siFacebook.path,
  x: siX.path,
  youtube: siYoutube.path,
  tiktok: siTiktok.path,
};

export function NetworkGlyph({ network, className }: { network: Network; className?: string }) {
  if (network === "linkedin") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d={PATHS[network]} />
    </svg>
  );
}

/** Small colored badge with the network logo. */
export function NetworkBadge({ network, size = "sm", className }: { network: Network; size?: "xs" | "sm" | "md"; className?: string }) {
  const dims = size === "xs" ? "size-3.5 p-[2px]" : size === "sm" ? "size-[18px] p-[3px]" : "size-6 p-1";
  return (
    <span
      title={NETWORKS[network].label}
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-[5px] text-white ring-1 ring-black/5", dims, className)}
      style={{ background: network === "instagram" ? "linear-gradient(135deg,#feda75,#fa7e1e 30%,#d62976 60%,#962fbf 85%,#4f5bd5)" : NETWORKS[network].color }}
    >
      <NetworkGlyph network={network} className="size-full" />
    </span>
  );
}
