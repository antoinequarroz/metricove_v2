// Client de l'API Metricove (contrat : docs/MONTAGE.md). Uniquement des requêtes sortantes.
import { open, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { log } from "./util.mjs";

const CHUNK = 8 * 1024 * 1024; // le serveur refuse les corps de plus de 10 Mo

export class Api {
  constructor(cfg, { dryRun = false } = {}) {
    this.base = cfg.metricoveUrl.replace(/\/$/, "");
    this.token = cfg.apiToken;
    this.dryRun = dryRun;
    if (!this.token) throw new Error("Jeton API introuvable : mettez API_TOKEN=… dans apiTokenFile, ou METRICOVE_API_TOKEN.");
  }

  async req(method, path, { json, body, headers = {}, raw = false, write = method !== "GET" } = {}) {
    if (this.dryRun && write && !path.endsWith("/worker/claim")) {
      log(`(essai à blanc) ${method} ${path}`, json ? JSON.stringify(json).slice(0, 300) : "");
      return null;
    }
    const h = { Authorization: `Bearer ${this.token}`, ...headers };
    if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const r = await fetch(this.base + path, { method, headers: h, body, duplex: body && typeof body !== "string" ? "half" : undefined });
    if (raw) return r;
    if (r.status === 204) return null;
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  claim(version) { return this.req("POST", "/api/montage/worker/claim", { json: { worker: "mac", version } }); }
  patch(id, data) { return this.req("PATCH", `/api/montage/jobs/${id}`, { json: data }); }
  step(id, step, progress) { return this.patch(id, { step, progress }).catch((e) => log("étape non envoyée :", e.message)); }
  fail(id, error) { return this.patch(id, { status: "failed", error: String(error).slice(0, 2000) }); }
  addVersion(id, data) { return this.req("POST", `/api/montage/jobs/${id}/versions`, { json: data }); }
  setPreview(id, n, upload) { return this.req("POST", `/api/montage/jobs/${id}/versions/${n}/preview`, { json: { upload } }); }
  final(id, upload, title) { return this.req("POST", `/api/montage/jobs/${id}/final`, { json: { upload, title } }); }
  /** Vidéo de plus dans la bibliothèque (formats en plus du rendu final). Renvoie { media }. */
  addMedia(upload, title) { return this.req("POST", "/api/media", { json: { upload, title } }); }
  scan(rushes) { return this.req("POST", "/api/montage/rushes/scan", { json: { rushes } }); }
  freeRush(id) { return this.req("DELETE", `/api/montage/rushes/${id}/file`); }

  /** Télécharge un rush « upload » vers `dest` en flux (sans tout charger en mémoire). */
  async downloadRush(id, dest) {
    const r = await this.req("GET", `/api/montage/rushes/${id}/file`, { raw: true });
    if (!r.ok) throw new Error(`téléchargement du rush ${id} → ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
  }

  /** Envoie un fichier par morceaux de 8 Mo ; renvoie l'id d'envoi à passer aux autres appels. */
  async upload(file, name = basename(file)) {
    const { size } = await stat(file);
    if (this.dryRun) { log(`(essai à blanc) envoi de ${name} (${(size / 1e6).toFixed(1)} Mo)`); return "essai-a-blanc"; }
    const { id } = await this.req("POST", "/api/uploads", { json: { name, size } });
    const fh = await open(file, "r");
    try {
      const buf = Buffer.alloc(CHUNK);
      for (let offset = 0; offset < size; ) {
        const { bytesRead } = await fh.read(buf, 0, CHUNK, offset);
        const res = await this.req("PUT", `/api/uploads/${id}?offset=${offset}`, {
          body: buf.subarray(0, bytesRead), headers: { "Content-Type": "application/octet-stream" },
        });
        offset += bytesRead;
        if (res && typeof res.received === "number" && res.received !== offset) throw new Error(`envoi désynchronisé (${res.received} ≠ ${offset})`);
      }
    } finally { await fh.close(); }
    return id;
  }
}
