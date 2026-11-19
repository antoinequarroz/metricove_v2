"use client";

import { useCallback, useEffect, useState } from "react";
import type { MontageJob, Rush, WorkerSpeed } from "@/lib/montage";

/**
 * The Mac as the server sees it. `online`: seen less than 30 s ago, or busy and seen less than 90 s ago.
 * `busy`: the job it reports on; `silent`: busy but quiet for a while (asleep?); `speed`: what it learned of its own
 * speed (ms per rendered frame, seconds Claude takes to write a video).
 */
export type WorkerStatus = {
  online: boolean;
  lastSeen?: string;
  name?: string;
  version?: string;
  tracks?: string[];
  busy?: { id: string; title: string };
  silent?: boolean;
  speed?: WorkerSpeed;
};
/** `now`: the server's clock (ms) when it answered, absent from an older server. */
type Data = { jobs: MontageJob[]; rushes: Rush[]; worker: WorkerStatus; freeDisk: number; now?: number };

/** The site did not answer within the time given to a request. */
export const TIMEOUT_MESSAGE = "Le site ne répond pas : réessaie dans un instant.";

/**
 * A call to the montage API. It never waits forever: after `timeoutMs` (60 s by default, enough for a validation that
 * copies the video into the library) it gives up with a French message, so a screen never stays busy.
 */
export async function montageApi<T>(url: string, init?: RequestInit, { timeoutMs = 60_000 }: { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const outer = init?.signal;
  const forward = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", forward, { once: true });
  }
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { "Content-Type": "application/json", ...init?.headers } });
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("Session expirée");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
    return data as T;
  } catch (e) {
    // Stopped by the caller: its own abort; stopped by the clock: a message that says what to do.
    if (ctrl.signal.aborted && !outer?.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

const ACTIVE = new Set(["queued", "working", "rendering"]);

/**
 * Jobs, rushes and Mac status. Refreshed every 3 s while something runs, every 15 s otherwise. `error`: the last read
 * failed (`data` is then the last good one); `at`: when that last good read came back (this browser's clock, ms).
 */
export function useMontage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [at, setAt] = useState<number | undefined>();

  const refresh = useCallback(async () => {
    try {
      setData(await montageApi<Data>("/api/montage", undefined, { timeoutMs: 20_000 }));
      setAt(Date.now());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const busy = data?.jobs.some((j) => ACTIVE.has(j.status)) ?? false;
  useEffect(() => {
    refresh();
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), busy ? 3000 : 15000);
    return () => clearInterval(id);
  }, [refresh, busy]);

  return { data, error, at, refresh };
}

export const STATUS_LABEL: Record<MontageJob["status"], { label: string; tone: "accent" | "ok" | "warn" | "danger" | "muted" }> = {
  queued: { label: "En attente du Mac", tone: "warn" },
  working: { label: "En cours", tone: "accent" },
  review: { label: "À valider", tone: "accent" },
  rendering: { label: "Rendu final", tone: "accent" },
  done: { label: "Terminé", tone: "ok" },
  failed: { label: "Échec", tone: "danger" },
  cancelled: { label: "Annulé", tone: "muted" },
};
