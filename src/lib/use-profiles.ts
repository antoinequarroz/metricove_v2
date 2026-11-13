"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_REF_IMAGE_BYTES, type Look, type StyleProfile } from "./profiles";

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

  const save = useCallback(async (projectId: string, change: { look?: Look; tone?: string; skill?: string; preset?: string; refs?: { examples?: { id: string; text: string }[]; ideas?: { id: string; text: string }[] } }) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}`, { method: "PUT", body: JSON.stringify(change) });
    publish({ ...(cache ?? {}), [projectId]: profile });
    return profile;
  }, []);
  const reset = useCallback(async (projectId: string) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}`, { method: "DELETE" });
    publish({ ...(cache ?? {}), [projectId]: profile });
    return profile;
  }, []);

  /** Sends an inspiration image (shrunk first) and adds it to the project. */
  const addImage = useCallback(async (projectId: string, file: File) => {
    const blob = await shrinkImage(file);
    const res = await fetch(`/api/profiles/${projectId}/images?name=${encodeURIComponent(file.name.slice(0, 80))}`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
    publish({ ...(cache ?? {}), [projectId]: body.profile });
    return body.profile as StyleProfile;
  }, []);
  const removeImage = useCallback(async (projectId: string, imageId: string) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}/images/${imageId}`, { method: "DELETE" });
    publish({ ...(cache ?? {}), [projectId]: profile });
    return profile;
  }, []);

  return { profiles, error, reload, save, reset, addImage, removeImage };
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

/** An inspiration image as a JPEG of 1600 px at most: enough for Claude to read it, light enough to keep. */
async function shrinkImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    for (const [side, quality] of [[1600, 0.85], [1200, 0.75], [900, 0.65]] as const) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_REF_IMAGE_BYTES) return blob;
    }
    throw new Error("trop lourde");
  } catch {
    throw new Error("Image illisible par ce navigateur : exporte-la en JPEG ou en PNG.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
