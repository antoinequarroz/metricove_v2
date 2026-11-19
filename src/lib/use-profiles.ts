"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_STYLE, MAX_REF_IMAGE_BYTES, type Look, type StyleProfile } from "./profiles";

export type ProfileChange = {
  name?: string;
  notes?: string;
  /** `video: null` takes the video look away (left out, it stays as it is). */
  look?: Omit<Look, "video"> & { video?: Look["video"] | null };
  tone?: string;
  skill?: string;
  strategy?: string;
  strategySource?: string;
  preset?: string;
  refs?: { examples?: { id: string; text: string }[]; ideas?: { id: string; text: string }[] };
};

type Profiles = Record<string, StyleProfile>;
/** Every style of every project, the default one first. */
type Styles = Record<string, StyleProfile[]>;

// One copy for the whole app: the Studio and the settings page show the same profiles.
let cache: Profiles | undefined;
let stylesCache: Styles | undefined;
let loading: Promise<Profiles> | undefined;
const listeners = new Set<(p: Profiles) => void>();
const styleListeners = new Set<(s: Styles) => void>();

const publish = (p: Profiles) => {
  cache = p;
  // The default style of a project is also the first of its styles.
  if (stylesCache) {
    const next = { ...stylesCache };
    for (const [pid, prof] of Object.entries(p)) next[pid] = [prof, ...(next[pid] ?? []).slice(1)];
    publishStyles(next);
  }
  listeners.forEach((fn) => fn(p));
};
const publishStyles = (s: Styles) => {
  stylesCache = s;
  styleListeners.forEach((fn) => fn(s));
};
/** One style saved: in the list of its project, and as the profile when it is the default one. */
const publishStyle = (projectId: string, style: StyleProfile) => {
  const list = stylesCache?.[projectId] ?? [];
  const at = list.findIndex((x) => x.id === style.id);
  publishStyles({ ...(stylesCache ?? {}), [projectId]: at < 0 ? [...list, style] : list.map((x, i) => (i === at ? style : x)) });
  if (style.id === DEFAULT_STYLE) publish({ ...(cache ?? {}), [projectId]: style });
};
const styleQuery = (styleId?: string) => (styleId && styleId !== DEFAULT_STYLE ? `?style=${encodeURIComponent(styleId)}` : "");

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body as T;
}

function load() {
  loading ??= call<{ profiles: Profiles; styles?: Styles }>("/api/profiles")
    .then((r) => {
      stylesCache = r.styles ?? Object.fromEntries(Object.entries(r.profiles).map(([k, v]) => [k, [v]]));
      styleListeners.forEach((fn) => fn(stylesCache!));
      publish(r.profiles);
      return r.profiles;
    })
    .finally(() => (loading = undefined));
  return loading;
}

/** The style profile of every project, by project id. `undefined` until they are read. */
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profiles | undefined>(cache);
  const [styles, setStyles] = useState<Styles | undefined>(stylesCache);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setError("");
    return load().catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    listeners.add(setProfiles);
    styleListeners.add(setStyles);
    reload();
    return () => {
      listeners.delete(setProfiles);
      styleListeners.delete(setStyles);
    };
  }, [reload]);

  /** Saves a style of the project (its default one when `styleId` is left out). */
  const save = useCallback(async (projectId: string, change: ProfileChange, styleId?: string) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}${styleQuery(styleId)}`, { method: "PUT", body: JSON.stringify(change) });
    publishStyle(projectId, profile);
    return profile;
  }, []);
  /** The default style back to the starter style. */
  const reset = useCallback(async (projectId: string) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}`, { method: "DELETE" });
    publishStyle(projectId, profile);
    return profile;
  }, []);
  /** A new style for the project, copied from `from` (the default style when left out). */
  const createStyle = useCallback(async (projectId: string, name: string, from?: string) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}/styles`, { method: "POST", body: JSON.stringify({ name, from }) });
    publishStyle(projectId, profile);
    return profile;
  }, []);
  const removeStyle = useCallback(async (projectId: string, styleId: string) => {
    await call(`/api/profiles/${projectId}${styleQuery(styleId)}`, { method: "DELETE" });
    publishStyles({ ...(stylesCache ?? {}), [projectId]: (stylesCache?.[projectId] ?? []).filter((x) => x.id !== styleId) });
  }, []);
  /** This style becomes the project's default one: everything is read again (both styles changed places). */
  const makeDefault = useCallback(async (projectId: string, styleId: string) => {
    await call(`/api/profiles/${projectId}/styles/${styleId}/default`, { method: "POST" });
    await load();
  }, []);

  /** Sends an inspiration image (shrunk first) and adds it to a style of the project. */
  const addImage = useCallback(async (projectId: string, file: File, styleId?: string) => {
    const blob = await shrinkImage(file);
    const q = styleQuery(styleId);
    const res = await fetch(`/api/profiles/${projectId}/images?name=${encodeURIComponent(file.name.slice(0, 80))}${q.replace("?", "&")}`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
    publishStyle(projectId, body.profile);
    return body.profile as StyleProfile;
  }, []);
  const removeImage = useCallback(async (projectId: string, imageId: string, styleId?: string) => {
    const { profile } = await call<{ profile: StyleProfile }>(`/api/profiles/${projectId}/images/${imageId}${styleQuery(styleId)}`, { method: "DELETE" });
    publishStyle(projectId, profile);
    return profile;
  }, []);

  return { profiles, styles, error, reload, save, reset, createStyle, removeStyle, makeDefault, addImage, removeImage };
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
