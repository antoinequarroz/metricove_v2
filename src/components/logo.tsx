import { cn } from "@/lib/utils";

/**
 * Metricove's paper plane, from the Postmelo identity kit, in its light and dark variants.
 * Both images are in the page; CSS shows the one for the system theme (.theme-light / .theme-dark in globals.css).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-block size-7 shrink-0", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/metricove/icon-light-128.png" alt="" width={128} height={128} draggable={false} className="theme-light absolute inset-0 size-full" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/metricove/icon-dark-128.png" alt="" width={128} height={128} draggable={false} className="theme-dark absolute inset-0 size-full" />
    </span>
  );
}
