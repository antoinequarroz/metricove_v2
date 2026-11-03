"use client";

/** Sends a file in 8 MB chunks (the server cuts bigger bodies). Returns the upload id. */
export async function uploadInChunks(file: Blob, name: string, onProgress?: (pct: number) => void): Promise<string> {
  const start = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, size: file.size }),
  });
  if (start.status === 401) window.location.href = "/login";
  const init = (await start.json().catch(() => ({}))) as { id?: string; chunk?: number; error?: string };
  if (!start.ok || !init.id) throw new Error(init.error ?? `Erreur ${start.status}`);
  const size = init.chunk ?? 8 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += size) {
    let tries = 0;
    for (;;) {
      const res = await fetch(`/api/uploads/${init.id}?offset=${offset}`, { method: "PUT", body: file.slice(offset, offset + size) }).catch(() => undefined);
      if (res?.ok) break;
      const err = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
      if (res && res.status < 500 && res.status !== 409) throw new Error(err ?? `Erreur ${res.status}`);
      if (++tries > 4) throw new Error(err ?? "Connexion perdue pendant l'envoi");
      await new Promise((r) => setTimeout(r, 1000 * 2 ** tries));
      // After a lost answer, ask the server where it stands.
      const st = (await fetch(`/api/uploads/${init.id}`).then((r) => r.json()).catch(() => ({}))) as { received?: number };
      if (st.received !== undefined && st.received > offset) break;
    }
    onProgress?.(Math.round((Math.min(file.size, offset + size) / file.size) * 100));
  }
  return init.id;
}
