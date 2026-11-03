import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7", className)} aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--ink)" />
      <rect x="6" y="15" width="3.6" height="7" rx="1.2" fill="var(--bg)" opacity=".55" />
      <rect x="12.2" y="10.5" width="3.6" height="11.5" rx="1.2" fill="var(--bg)" opacity=".8" />
      <rect x="18.4" y="6" width="3.6" height="16" rx="1.2" fill="var(--accent)" />
    </svg>
  );
}
