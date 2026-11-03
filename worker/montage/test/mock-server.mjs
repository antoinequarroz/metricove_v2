#!/usr/bin/env node
// Faux Metricove (contrat docs/MONTAGE.md) pour tester le worker en local, sans toucher au vrai site.
//   node test/mock-server.mjs <dossier-sortie> [port]
// Crée une tâche « montage » sur les rushes déclarés par le worker (premier scan), puis valide automatiquement
// la 1re version pour déclencher le rendu final. Les fichiers envoyés sont écrits dans <dossier-sortie>.
import { createServer } from "node:http";
import { mkdirSync, appendFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] || "/tmp/metricove-mock";
const port = Number(process.argv[3] || 3999);
mkdirSync(out, { recursive: true });
const TOKEN = "test-token";
const uploads = {};
let rushes = [];
let job = null;
const now = () => new Date().toISOString();
const say = (...a) => console.log("[mock]", ...a);

function newJob() {
  job = {
    id: "job-test-1", kind: "montage", title: "Test montage", status: "queued", action: "propose",
    brief: { format: process.env.FORMAT || "9:16", seconds: 20, hook: "", cta: "Abonne-toi" },
    rushIds: rushes.map((r) => r.id), versions: [], createdAt: now(), updatedAt: now(),
  };
  say("tâche créée sur", job.rushIds.length, "rush(es)");
}

const body = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/login") return send(res, 200, {});
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "jeton" });
  const raw = await body(req);
  const json = () => JSON.parse(raw.toString() || "{}");

  if (req.method === "POST" && p === "/api/montage/rushes/scan") {
    rushes = json().rushes.map((r, i) => ({ id: r.from || `rush-${i + 1}`, origin: "mac", ...r, thumb: r.thumb ? `${r.thumb.length} car.` : undefined }));
    say("scan :", rushes.map((r) => `${r.name} (${r.duration?.toFixed(1)} s, vignette ${r.thumb || "—"})`).join(", "));
    if (!job && rushes.length) newJob();
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/api/montage/worker/claim") {
    if (!job || !job.action) return send(res, 204);
    const action = job.action; job.action = null; job.status = action === "final" ? "rendering" : "working";
    return send(res, 200, { job, action, rushes });
  }
  if (req.method === "POST" && p === "/api/uploads") { const id = `up${Object.keys(uploads).length + 1}`; uploads[id] = { ...json(), file: join(out, id) }; writeFileSync(uploads[id].file, ""); return send(res, 200, { id }); }
  let m;
  if (req.method === "PUT" && (m = p.match(/^\/api\/uploads\/(\w+)$/))) {
    const u = uploads[m[1]];
    if (raw.length > 10 * 1024 * 1024) return send(res, 413, { error: "trop gros" });
    appendFileSync(u.file, raw); u.received = (u.received || 0) + raw.length;
    if (Number(url.searchParams.get("offset")) + raw.length !== u.received) return send(res, 409, { error: "offset" });
    return send(res, 200, { received: u.received });
  }
  if (req.method === "PATCH" && p === `/api/montage/jobs/${job?.id}`) {
    const d = json(); Object.assign(job, d); say("patch :", JSON.stringify(d).slice(0, 160)); return send(res, 200, job);
  }
  if (req.method === "POST" && p === `/api/montage/jobs/${job?.id}/versions`) {
    const d = json(); const n = job.versions.length + 1;
    const f = join(out, `apercu-v${n}.mp4`); if (uploads[d.upload]) renameSync(uploads[d.upload].file, f);
    writeFileSync(join(out, `edl-v${n}.json`), JSON.stringify(d.edl, null, 2));
    job.versions.push({ n, edl: d.edl, notes: d.notes, preview: true, by: "claude", createdAt: now() });
    say(`version ${n} reçue — ${d.edl.segments.filter((s) => s.kept).length}/${d.edl.segments.length} phrases gardées — notes : ${d.notes}`);
    say("aperçu :", f, "→ validation automatique pour tester le rendu final");
    job.status = "rendering"; job.approved = n; job.action = "final";
    return send(res, 200, job);
  }
  if (req.method === "POST" && p === `/api/montage/jobs/${job?.id}/final`) {
    const d = json(); const f = join(out, "final.mp4"); if (uploads[d.upload]) renameSync(uploads[d.upload].file, f);
    job.status = "done"; say("vidéo finale :", f); return send(res, 200, job);
  }
  send(res, 404, { error: `${req.method} ${p}` });
}).listen(port, () => say(`faux Metricove sur http://localhost:${port} (jeton ${TOKEN}), sorties dans ${out}`));
