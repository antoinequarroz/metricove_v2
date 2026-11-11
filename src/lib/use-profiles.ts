"use client";

import { useCallback, useEffect, useState } from "react";
import type { Look, StyleProfile } from "./profiles";

type Profiles = Record<string, StyleProfile>;

// One copy for the whole app: the Studio and the settings page show the same profiles.
let cache: Profiles | undefined;
let loading: Promise<Profiles> | undefined;
const listeners = new Set<(p: Profiles) => void>();

const publish = (p: Profiles) => {
  cache = p;
  listeners.forEach((fn) => fn(p));
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body as T;
}

function load() {
  loading ??= call<{ profiles: Profiles }>("/api/profiles")
    .then((r) => (publish(r.profiles), r.profiles))
    .finally(() => (loading = undefined));
  return loading;
}

/** The style profile of every project, by project id. `undefined` until they are read. */
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profiles | undefined>(cache);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setError("");
    return load().catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    listeners.add(setProfiles);
    reload();
    return () => void listeners.delete(setProfiles);
  }, [reload]);

  const save = useCallback(async (projectId: string, change: { look?: Look; tone?: string; skill?: string; preset?: string }) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}`, { method: "PUT", body: JSON.stringify(change) });
    publish({ ...(cache ?? {}), [projectId]: profile });
    return profile;
  }, []);
  const reset = useCallback(async (projectId: string) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}`, { method: "DELETE" });
    publish({ ...(cache ?? {}), [projectId]: profile });
    return profile;
  }, []);

  return { profiles, error, reload, save, reset };
}

/** A logo file made small enough to travel with every visual: 256 px at most, PNG (keeps transparency). */
export async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Dessin impossible dans ce navigateur");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    throw new Error("Logo illisible par ce navigateur : exporte-le en PNG ou en JPEG.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
