// Client de l'API Metricove (contrat : docs/MONTAGE.md). Uniquement des requêtes sortantes.
import { open, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { log } from "./util.mjs";

const CHUNK = 8 * 1024 * 1024; // le serveur refuse les corps de plus de 10 Mo
/** Délais des requêtes (ms) : une requête simple, un morceau de 8 Mo envoyé. Une requête `raw` (flux) n'en a pas par défaut. */
export const REQ_TIMEOUT = Object.freeze({ json: 60_000, chunk: 180_000 });

/** Le signal d'une requête : son délai, plus l'annulation du job s'il y en a une. */
function requestSignal(timeoutMs, signal) {
  const list = [timeoutMs ? AbortSignal.timeout(timeoutMs) : null, signal || null].filter(Boolean);
  if (list.length < 2) return list[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
  const c = new AbortController();
  for (const s of list) { if (s.aborted) { c.abort(s.reason); break; } s.addEventListener("abort", () => c.abort(s.reason), { once: true }); }
  return c.signal;
}

export class Api {
  constructor(cfg, { dryRun = false } = {}) {
    this.base = cfg.metricoveUrl.replace(/\/$/, "");
    this.token = cfg.apiToken;
    this.dryRun = dryRun;
    if (!this.token) throw new Error("Jeton API introuvable : mettez API_TOKEN=… dans apiTokenFile, ou METRICOVE_API_TOKEN.");
  }

  /**
   * Une requête. `timeoutMs` : délai de toute la requête, corps de la réponse compris (60 s par défaut, aucun pour une
   * requête `raw` lue en flux, comme le téléchargement d'un rush) ; `signal` : l'annulation du job (sa raison remonte).
   * Un délai dépassé donne une erreur claire en français, `code = "TIMEOUT"`.
   */
  async req(method, path, { json, body, headers = {}, raw = false, write = method !== "GET", timeoutMs = raw ? 0 : REQ_TIMEOUT.json, signal } = {}) {
    if (this.dryRun && write && !path.endsWith("/worker/claim")) {
      log(`(essai à blanc) ${method} ${path}`, json ? JSON.stringify(json).slice(0, 300) : "");
      return null;
    }
    const h = { Authorization: `Bearer ${this.token}`, ...headers };
    if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    try {
      const r = await fetch(this.base + path, { method, headers: h, body, duplex: body && typeof body !== "string" ? "half" : undefined, signal: requestSignal(timeoutMs, signal) });
      if (raw) return r;
      if (r.status === 204) return null;
      const text = await r.text();
      if (!r.ok) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`), { status: r.status, body: text.slice(0, 2000) });
      return text ? JSON.parse(text) : null;
    } catch (e) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      if (e?.name === "TimeoutError" || (e?.name === "AbortError" && !signal?.aborted)) {
        throw Object.assign(new Error(`${method} ${path} : pas de réponse de Metricove en ${Math.round(timeoutMs / 1000)} s.`), { code: "TIMEOUT" });
      }
      throw e;
    }
  }

  /** `speed` : { frameMs, writeS } appris par le Mac (reel vidéo) ; le site en tire « prête dans environ 5 min ». */
  claim(version, tracks, brolls, speed) { return this.req("POST", "/api/montage/worker/claim", { json: { worker: "mac", version, ...(tracks ? { tracks } : {}), ...(brolls ? { brolls } : {}), ...(speed ? { speed } : {}) } }); }
  patch(id, data) { return this.req("PATCH", `/api/montage/jobs/${id}`, { json: data }); }
  /** Étape et avancement ; `extra` = champs du reel vidéo (phase, phases, eta, frames, beats, done), ignorés par un ancien serveur. */
  step(id, step, progress, extra = {}) { return this.patch(id, { step, progress, ...extra }).catch((e) => log("étape non envoyée :", e.message)); }
  /**
   * Planche d'images du reel vidéo (data:image/jpeg;base64,…) et ses tuiles [{ id, t }]. Un ancien serveur répond 404 :
   * avalé, comme toute autre erreur (la planche n'est qu'un aperçu), SAUF un 409 (passage terminé : `run` ne
   * correspond plus) et l'annulation du job, relancés pour que le job s'arrête. Renvoie true si elle est arrivée.
   * `o.run` : le run.startedAt de la réclamation ; `o.signal` : l'annulation du job.
   */
  board(id, image, frames, { run, signal } = {}) {
    return this.req("POST", `/api/montage/jobs/${id}/board`, { json: { image, frames, ...(run !== undefined ? { run } : {}) }, signal }).then(() => true, (e) => {
      if (e?.status === 409 || signal?.aborted) throw e;
      log(/→ 404/.test(String(e.message)) ? "planche ignorée : Metricove ne la connaît pas encore" : `planche non envoyée : ${e.message}`);
      return false;
    });
  }
  /** La tâche vue par le site ({ job, worker, now } d'un serveur récent, la tâche seule d'un ancien) ; null si elle n'existe plus. */
  async job(id, { signal } = {}) {
    const r = await this.req("GET", `/api/montage/jobs/${id}`, { raw: true, timeoutMs: 30_000, signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GET /api/montage/jobs/${id} → ${r.status}`);
    const j = await r.json();
    return j && typeof j === "object" && j.job && typeof j.job === "object" ? j.job : j;
  }
  /** Échec de la tâche ; `run` (reel vidéo) : le run.startedAt de la réclamation (un 409 dit que le passage était déjà fini). */
  fail(id, error, run) { return this.patch(id, { status: "failed", error: String(error).slice(0, 2000), ...(run !== undefined ? { run } : {}) }); }
  /** `o.signal` : l'annulation du job (reel vidéo). */
  addVersion(id, data, { signal } = {}) { return this.req("POST", `/api/montage/jobs/${id}/versions`, { json: data, signal }); }
  /** Aperçu d'une version modifiée ; `broll` = plans trouvés (source, ref, thumb), réenregistrés dans la version. */
  setPreview(id, n, upload, broll, more = {}, { signal } = {}) { return this.req("POST", `/api/montage/jobs/${id}/versions/${n}/preview`, { json: { upload, ...(broll ? { broll } : {}), ...more }, signal }); }
  final(id, upload, title, notes) { return this.req("POST", `/api/montage/jobs/${id}/final`, { json: { upload, title, ...(notes ? { notes } : {}) } }); }
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

  /**
   * Envoie un fichier par morceaux de 8 Mo ; renvoie l'id d'envoi à passer aux autres appels. `onChunk(envoyé, total)`
   * après chaque morceau ; `o.signal` : l'annulation du job. Chaque morceau a 3 min au plus.
   */
  async upload(file, name = basename(file), onChunk, { signal } = {}) {
    const { size } = await stat(file);
    if (this.dryRun) { log(`(essai à blanc) envoi de ${name} (${(size / 1e6).toFixed(1)} Mo)`); return "essai-a-blanc"; }
    const { id } = await this.req("POST", "/api/uploads", { json: { name, size }, signal });
    const fh = await open(file, "r");
    try {
      const buf = Buffer.alloc(CHUNK);
      for (let offset = 0; offset < size; ) {
        const { bytesRead } = await fh.read(buf, 0, CHUNK, offset);
        const res = await this.req("PUT", `/api/uploads/${id}?offset=${offset}`, {
          body: buf.subarray(0, bytesRead), headers: { "Content-Type": "application/octet-stream" }, timeoutMs: REQ_TIMEOUT.chunk, signal,
        });
        offset += bytesRead;
        if (res && typeof res.received === "number" && res.received !== offset) throw new Error(`envoi désynchronisé (${res.received} ≠ ${offset})`);
        onChunk?.(offset, size);
      }
    } finally { await fh.close(); }
    return id;
  }
}
