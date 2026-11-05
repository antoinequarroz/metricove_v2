"use client";

import { useCallback, useEffect, useState } from "react";
import type { MontageJob, Rush } from "@/lib/montage";

export type WorkerStatus = { online: boolean; lastSeen?: string; name?: string; version?: string };
type Data = { jobs: MontageJob[]; rushes: Rush[]; worker: WorkerStatus; freeDisk: number };

export async function montageApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Session expirée");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data as T;
}

const ACTIVE = new Set(["queued", "working", "rendering"]);

/** Jobs, rushes and Mac status. Refreshed every 3 s while something runs, every 15 s otherwise. */
export function useMontage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await montageApi<Data>("/api/montage"));
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

  return { data, error, refresh };
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
