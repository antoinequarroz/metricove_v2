"use client";

import { cn } from "@/lib/utils";

/** Small segmented control: one choice among a few. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-bg-2/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 rounded-md px-2.5 text-[12px] font-medium transition-[background-color,color,box-shadow] duration-150",
            o.value === value ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150", on ? "bg-accent" : "bg-ink/15")}
    >
      <span
        className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-out)]"
        style={{ transform: on ? "translateX(16px)" : "none" }}
      />
    </button>
  );
}

/** A labelled row of a settings panel. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium">{label}</p>
        {hint && <p className="text-[11.5px] text-ink-3">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, icon, children, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 pb-1">
        {icon}
        <h3 className="text-[12.5px] font-semibold">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}
