#!/usr/bin/env node
// Faux Metricove (contrat docs/MONTAGE.md) pour tester le worker en local, sans toucher au vrai site.
//   node test/mock-server.mjs <dossier-sortie> [port]
// Crée une tâche « montage » sur les rushes déclarés par le worker (premier scan), puis valide automatiquement
// la dernière version pour déclencher le rendu final. Les fichiers envoyés sont écrits dans <dossier-sortie>.
// Options (variables d'environnement) :
//   FORMAT=9:16             format du brief
//   STYLE='{"look":"pop"}'  job.style (style de sous-titres du projet)
//   EDIT='{"audio":{…},"captions":{…},"exports":["1:1"]}'  après la 1re version, une version « edit » avec ces réglages (action preview)
//   MARK=/chemin/image.jpg  ensuite, une demande de nouvelle version avec une note dessinée (action propose)
import { createServer } from "node:http";
import { mkdirSync, appendFileSync, writeFileSync, renameSync, readFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] || "/tmp/metricove-mock";
const port = Number(process.argv[3] || 3999);
mkdirSync(out, { recursive: true });
const TOKEN = "test-token";
const uploads = {};
let rushes = [];
let job = null;
let edited = false, marked = false, medias = 0;
const now = () => new Date().toISOString();
const say = (...a) => console.log("[mock]", ...a);

function newJob() {
  job = {
    id: "job-test-1", kind: "montage", title: "Test montage", status: "queued", action: "propose",
    brief: { format: process.env.FORMAT || "9:16", seconds: 20, hook: "", cta: "Abonne-toi" },
    rushIds: rushes.map((r) => r.id), versions: [], createdAt: now(), updatedAt: now(),
    ...(process.env.STYLE ? { style: JSON.parse(process.env.STYLE) } : {}),
  };
  say("tâche créée sur", job.rushIds.length, "rush(es)");
}

const body = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };

/** Suite du scénario de test après la version n. */
function next(n) {
  const v = job.versions.find((x) => x.n === n);
  if (process.env.EDIT && !edited) {
    edited = true;
    const edl = { ...structuredClone(v.edl), ...JSON.parse(process.env.EDIT) };
    job.versions.push({ n: n + 1, edl, preview: false, by: "edit", createdAt: now() });
    writeFileSync(join(out, `edl-v${n + 1}.json`), JSON.stringify(edl, null, 2));
    say(`version ${n + 1} (edit) créée → aperçu demandé`);
    job.action = "preview"; job.status = "working";
    return;
  }
  if (process.env.MARK && !marked) {
    marked = true;
    const image = `data:image/jpeg;base64,${readFileSync(process.env.MARK).toString("base64")}`;
    job.feedback = "Plus dynamique.";
    job.marks = [{ id: "m1", version: n, t: 1.5, text: "Mets ce mot en couleur et ajoute un emoji ici", image }];
    say("note dessinée envoyée → nouvelle proposition");
    job.action = "propose"; job.status = "queued";
    return;
  }
  say("→ validation automatique de la version", n, "pour tester le rendu final");
  job.status = "rendering"; job.approved = n; job.action = "final";
}

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
    say("aperçu :", f);
    next(n);
    return send(res, 200, job);
  }
  if (req.method === "POST" && (m = p.match(/^\/api\/montage\/jobs\/[\w-]+\/versions\/(\d+)\/preview$/))) {
    const d = json(); const n = Number(m[1]);
    const f = join(out, `apercu-v${n}.mp4`); if (uploads[d.upload]) renameSync(uploads[d.upload].file, f);
    say(`aperçu de la version ${n} (edit) :`, f);
    const v = job.versions.find((x) => x.n === n);
    if (v && Array.isArray(d.broll)) {
      v.edl.broll = d.broll;
      writeFileSync(join(out, `edl-v${n}.json`), JSON.stringify(v.edl, null, 2));
      say(`B-roll réenregistré : ${d.broll.map((b) => `${b.query} → ${b.source || "?"}:${b.ref || "?"}`).join(", ")}`);
    }
    next(n);
    return send(res, 200, job);
  }
  if (req.method === "POST" && p === "/api/media") {
    const d = json(); const id = `media-${++medias}`;
    const f = join(out, `${id}.mp4`); if (uploads[d.upload]) renameSync(uploads[d.upload].file, f);
    say(`média ajouté « ${d.title} » :`, f);
    return send(res, 201, { media: { id, title: d.title } });
  }
  if (req.method === "PUT" && (m = p.match(/^\/api\/media\/([\w-]+)\/cover$/))) {
    const f = join(out, `couverture-${m[1]}.jpg`); writeFileSync(f, raw);
    say("couverture reçue :", f, `(${raw.length} octets)`);
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === `/api/montage/jobs/${job?.id}/final`) {
    const d = json(); const f = join(out, "final.mp4"); if (uploads[d.upload]) renameSync(uploads[d.upload].file, f);
    job.status = "done"; job.mediaId = "media-final"; say("vidéo finale :", f);
    return send(res, 201, { job, media: { id: "media-final", title: d.title || job.title } });
  }
  send(res, 404, { error: `${req.method} ${p}` });
}).listen(port, () => say(`faux Metricove sur http://localhost:${port} (jeton ${TOKEN}), sorties dans ${out}`));
