"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssetKind, LibraryItem } from "./library";

// One copy for the whole app: the Styles page counts what the library pages show.
let cache: LibraryItem[] | undefined;
let loading: Promise<LibraryItem[]> | undefined;
const listeners = new Set<(items: LibraryItem[]) => void>();
const publish = (items: LibraryItem[]) => {
  cache = items;
  listeners.forEach((fn) => fn(items));
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body as T;
}

function load() {
  loading ??= call<{ items: LibraryItem[] }>("/api/library")
    .then((r) => (publish(r.items), r.items))
    .finally(() => (loading = undefined));
  return loading;
}

/** The illustrations and the sound effects. `undefined` until read. */
export function useLibrary() {
  const [items, setItems] = useState<LibraryItem[] | undefined>(cache);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setError("");
    return load().catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    listeners.add(setItems);
    reload();
    return () => void listeners.delete(setItems);
  }, [reload]);

  const add = useCallback(async (kind: AssetKind, file: File, meta: { name: string; tags?: string[]; styles?: string[] }) => {
    const q = new URLSearchParams({ kind, name: meta.name });
    if (meta.tags?.length) q.set("tags", meta.tags.join(","));
    if (meta.styles?.length) q.set("styles", meta.styles.join(","));
    const { item } = await call<{ item: LibraryItem }>(`/api/library?${q}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    publish([item, ...(cache ?? [])]);
    return item;
  }, []);
  const update = useCallback(async (id: string, change: { name?: string; tags?: string[]; styles?: string[] }) => {
    const { item } = await call<{ item: LibraryItem }>(`/api/library/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
    publish((cache ?? []).map((x) => (x.id === id ? item : x)));
    return item;
  }, []);
  const remove = useCallback(async (id: string) => {
    await call(`/api/library/${id}`, { method: "DELETE" });
    publish((cache ?? []).filter((x) => x.id !== id));
  }, []);

  return { items, error, reload, add, update, remove };
}

export const fileUrl = (item: LibraryItem) => `/api/library/${item.id}/file`;
