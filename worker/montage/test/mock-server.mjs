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
//
// MOCK=video : le reel vidéo continu (worker 0.14.0), voir videoMock() plus bas et docs/MONTAGE.md.
//   MOCK=video [REQUEST=…] [SECONDS=20] node test/mock-server.mjs /tmp/mc/mock 3999
// `node test/mock-server.mjs --fake-claude …` : faux `claude` (appelé par claude-spy.sh quand CLAUDE_FAKE est posé).
import { createServer } from "node:http";
import { mkdirSync, appendFileSync, writeFileSync, renameSync, readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const MODE = process.argv[2] === "--fake-claude" ? "fake-claude" : process.env.MOCK === "video" ? "video" : "montage";
const out = process.argv[2] || "/tmp/metricove-mock";
const port = Number(process.argv[3] || 3999);
if (MODE !== "fake-claude") mkdirSync(out, { recursive: true });
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

if (MODE === "montage") createServer(async (req, res) => {
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

if (MODE === "video") videoMock(await versionGate());
if (MODE === "fake-claude") fakeClaude(process.argv.slice(3));

/* ---------- MOCK=video : reel vidéo continu (worker 0.14.0) ---------- */

/**
 * La comparaison de versions de la porte : celle du site (src/lib/worker-version.ts, que Node ≥ 22.18 lit directement
 * en retirant les types), sinon une copie (Node plus ancien, dépôt incomplet). Le scénario OLD ne teste donc que la
 * porte du faux serveur ; celle du vrai serveur (claimJob) se vérifie avec `check-video-run.mjs --run server`.
 */
async function versionGate() {
  try {
    const m = await import(new URL("../../../src/lib/worker-version.ts", import.meta.url).href);
    if (typeof m.atLeast === "function") return { atLeast: m.atLeast, from: "src/lib/worker-version.ts" };
  } catch { /* Node qui ne lit pas le TypeScript : la copie */ }
  const atLeast = (v, min) => {
    if (!min) return true;
    const p = (x) => [0, 1, 2].map((i) => Math.max(0, parseInt(String(x ?? "").split(".")[i], 10) || 0));
    const a = p(v), b = p(min);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return true;
  };
  return { atLeast, from: "copie dans mock-server.mjs (ce Node ne lit pas src/lib/worker-version.ts)" };
}

/**
 * Faux Metricove pour le reel vidéo : il suit le contrat des vraies routes (docs/MONTAGE.md, « Reel vidéo continu ») et
 * rejoue une suite de demandes, puis note tout dans <dossier-sortie> pour test/check-video-run.mjs :
 *   state.json (scénario, étape, versions, échec, fin), events.jsonl (chaque requête), patches.jsonl (chaque PATCH du
 *   worker, avec son numéro de passage `_run`), claims.jsonl, boards/board-N.jpg + boards.jsonl, reel-vN.json (plan
 *   reçu, code compris), apercu-vN.mp4, notes-vN.txt, final.jsonl (ne doit jamais exister pour une vidéo).
 * Scénarios (variables d'environnement) :
 *   (aucun)          suite complète : v1 (Claude écrit) → RETOUCHE (passage = 2e repère, « rends le chiffre plus frappant »)
 *                    → v2 → ÉDITION à la main (texte du 1er temps fort, un temps fort coupé, un moment retiré, musique
 *                    coupée ; action preview) → aperçu de v3 → RÉGÉNÉRER → v4.
 *   SUITE=short      v1 seulement.
 *   STOP=1           une version et une édition ; action mise à null au premier PATCH de la phase render.
 *   STOP_REGEN=1     comme STOP, puis « Régénérer » 1 s après l'arrêt (avant la veille suivante du Mac) : le passage
 *                    arrêté doit tomber à son premier rapport refusé (409), sans rien envoyer, et le Mac prendre la
 *                    nouvelle demande ; le scénario finit 15 s après cette réclamation.
 *   OLDSERVER=1      serveur d'avant la vidéo : 400 sur POST /versions d'un plan vidéo, 404 sur /board.
 *   EVIL=1           une version stockée avec le moment de fixtures/reel/evil-tripwire.json, puis une édition.
 *   CLAUDE_TIMEOUT=1 une création (le délai de Claude est réglé par la config du worker).
 *   OLD=1            une création ; seules les réclamations comptent (0.13.0 → 204). Porte du FAUX serveur seulement
 *                    (versionGate) : la porte réelle se vérifie avec check-video-run.mjs --run server.
 *   LEGACY=1         un ancien reel à scènes (kind motion sans mode).
 *   REQUEST, SECONDS (15|30|45|60, vide = Auto), SOURCE, PACE, LOOK (JSON), REVISE (texte de la retouche).
 *   EXIT_WHEN_DONE=1 le faux serveur s'arrête quand le scénario est fini.
 */
function videoMock({ atLeast, from: gateFrom }) {
  const OUT = resolve(out);
  const E = process.env;
  const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "reel");
  const scenario = E.STOP_REGEN ? "stop-regen" : E.STOP ? "stop" : E.OLDSERVER ? "oldserver" : E.EVIL ? "evil" : E.LEGACY ? "legacy" : E.CLAUDE_TIMEOUT ? "claude-timeout" : E.OLD ? "old" : E.SUITE === "short" ? "short" : "suite";
  for (const f of ["state.json", "events.jsonl", "patches.jsonl", "claims.jsonl", "boards.jsonl", "final.jsonl"]) rmSync(join(OUT, f), { force: true });
  mkdirSync(join(OUT, "boards"), { recursive: true });
  mkdirSync(join(OUT, "uploads"), { recursive: true });
  const t0 = Date.now();
  const jsonl = (f, o) => appendFileSync(join(OUT, f), JSON.stringify({ t: Date.now() - t0, at: now(), ...o }) + "\n");
  const LOOK = { theme: "night", accent: "#ff5a1f", font: "grotesque", fields: [], grid: false, pill: false, align: "left", valign: "middle", grain: true, numbers: false, handle: "@metricove", ...(E.LOOK ? JSON.parse(E.LOOK) : {}) };
  const SECONDS = [15, 30, 45, 60].find((s) => s === Number(E.SECONDS));
  const REQUEST = E.REQUEST || "Idée : 3 erreurs qui font décrocher sur un reel Instagram, finir par Abonne-toi";
  const VOICE = { tone: "Direct, tutoiement, phrases courtes, un brin d'humour. Jamais de jargon.", examples: ["Tu postes tous les jours et rien ne bouge ? Le problème n'est pas l'algorithme : c'est tes 3 premières secondes."] };
  const LOGO = pngDataUrl(96, 96, [0xff, 0x5a, 0x1f]);
  // runIds : run.startedAt de chaque réclamation → numéro de passage, pour attribuer une écriture qui porte `run` au
  // passage qui l'a envoyée (une écriture tardive d'un passage arrêté arrive parfois après la réclamation suivante).
  const state = { scenario, status: "running", stage: "create", startedAt: now(), versions: [], timeline: [], claims: 0, finals: 0, runs: 0, runIds: {}, gate: gateFrom };
  // Appels de Claude notés par test/claude-spy.sh (lignes « appel ») : une édition à la main ne doit en ajouter aucun.
  const SPY = E.CLAUDE_SPY_LOG || "/tmp/mc/claude-calls.log";
  const calls = () => { try { return readFileSync(SPY, "utf8").split("\n").filter((l) => / appel /.test(l)).length; } catch { return 0; } };
  state.callsAtStart = calls();
  const save = () => writeFileSync(join(OUT, "state.json"), JSON.stringify(state, null, 2));
  const mark = (what, extra = {}) => { state.timeline.push({ at: now(), t: Date.now() - t0, what, ...extra }); save(); say(what); };
  let claimed = false;

  const fixture = (name) => JSON.parse(readFileSync(join(FIX, name), "utf8"));
  const iso = now();
  let job = {
    id: `video-${scenario}-1`, kind: "motion", title: "Reel animé : " + REQUEST.split("\n")[0].slice(0, 60), projectId: "prj-test", status: "queued", action: "motion",
    brief: { format: "9:16", ...(SECONDS ? { seconds: SECONDS } : {}) },
    motion: { mode: "video", scenes: [], request: REQUEST, source: ["idea", "script", "post"].includes(E.SOURCE) ? E.SOURCE : "idea", ...(SECONDS ? { seconds: SECONDS } : {}), ...(["calm", "normal", "fast"].includes(E.PACE) ? { pace: E.PACE } : {}), music: true, logo: true, look: LOOK, project: "Test" },
    minWorker: "0.14.0", rushIds: [], versions: [], createdAt: iso, updatedAt: iso,
  };
  if (scenario === "legacy") {
    job = { ...job, title: "Reel animé : Trois erreurs", minWorker: undefined, motion: { scenes: [{ title: "Trois erreurs", body: "qui font décrocher sur un reel" }, { title: "Abonne-toi", body: "pour la suite" }], look: LOOK, logo: false, music: true, project: "Test" } };
  }
  if (scenario === "stop" || scenario === "stop-regen" || scenario === "evil") {
    // Une vidéo déjà faite (plan de fixture, code compris), puis une édition à la main en attente du Mac.
    const plan = fixture(scenario === "evil" ? "evil-tripwire.json" : "score-basic.json").plan;
    const v1 = { n: 1, edl: { format: "9:16", segments: [] }, reel: plan, notes: "Version de fixture.", preview: true, by: "claude", createdAt: iso };
    job.versions.push(v1);
    job.versions.push({ n: 2, edl: v1.edl, reel: pageEdit(plan).plan, preview: false, by: "edit", createdAt: iso });
    job.action = "preview";
    state.stage = "edit";
  }
  save();

  /** Une édition à la main comme la page la ferait (cleanReel avec base) : texte changé, temps fort coupé, moment retiré, musique coupée. */
  function pageEdit(plan) {
    const p = structuredClone(plan);
    delete p.duration;
    const beats = p.video.beats.map((b) => { const c = { ...b }; delete c.start; delete c.end; return c; });
    const moments = p.video.moments || [];
    const index = new Map(beats.map((b, i) => [b.id, i]));
    const keep = moments[0];
    const drop = moments[1];
    const covered = keep ? beats.slice(index.get(keep.from), index.get(keep.to) + 1).map((b) => b.id) : [];
    const kept = beats.filter((b) => !b.cut);
    const changed = [...new Set([kept[0]?.id, covered[0]].filter(Boolean))];
    for (const id of changed) { const b = beats[index.get(id)]; b.text = `Vraiment : ${b.text}`.slice(0, 110); }
    // Le temps fort coupé : ni le premier, ni le dernier, ni un temps fort du moment gardé.
    const cut = kept.length >= 4 ? kept.slice(1, -1).find((b, i) => i >= 1 && !covered.includes(b.id) && !changed.includes(b.id)) : undefined;
    if (cut) beats[index.get(cut.id)].cut = true;
    p.video = { ...p.video, beats, moments: moments.filter((m) => m !== drop) };
    p.music = false;
    return { plan: p, edit: { changed, cut: cut?.id ?? null, kept: keep?.id ?? null, dropped: drop?.id ?? null, coveredBy: keep ? covered : [] } };
  }

  // Comme staleWrite du vrai serveur : une écriture d'un passage terminé (run différent ; sans run, une vidéo sans
  // action ou de nouveau en file) est refusée en 409 et rien n'est enregistré.
  const stale = (d) => (typeof d.run === "string" && d.run ? d.run !== job.run?.startedAt : !!job.minWorker && (!job.action || job.status === "queued"));
  /** Le passage d'une écriture : celui de son `run` (worker 0.14.0), sinon le dernier réclamé. */
  const runOf = (d) => (typeof d.run === "string" && state.runIds[d.run]) || state.runs;
  const STALE = { error: "Ce passage du Mac est terminé (arrêté, repris ou remplacé) : rien n'est enregistré" };
  const pageJob = (j) => ({ ...j, versions: j.versions.map((v) => (v.reel?.video ? { ...v, reel: { ...v.reel, video: { ...v.reel.video, moments: (v.reel.video.moments || []).map(({ code, ...m }) => ({ ...m, custom: !!code })) } } } : v)) });
  const queue = (action) => { job.action = action; job.status = "queued"; job.step = job.progress = job.error = undefined; job.run = undefined; claimed = false; };
  const release = (status) => { job.action = null; job.status = status; job.step = job.progress = undefined; job.run = undefined; claimed = false; };
  const finish = (status, extra = {}) => {
    if (state.status !== "running") return;
    Object.assign(state, { status, endedAt: now() }, extra);
    mark(`scénario ${scenario} fini : ${status}`);
    // Quelques secondes pour noter ce qui arriverait encore (un PATCH après un arrêt, un /final…).
    if (E.EXIT_WHEN_DONE) setTimeout(() => { say("arrêt du faux serveur"); process.exit(0); }, scenario === "stop" ? 25_000 : 4_000);
  };

  function next() {
    const v = job.versions.at(-1);
    if (scenario !== "suite") return finish("done");
    if (state.stage === "create") {
      // RETOUCHE : le passage du 2e repère de v1.
      const kept = v.reel.video.beats.filter((b) => !b.cut);
      const b = kept[1] || kept[0];
      job.feedback = E.REVISE || "Rends le chiffre plus frappant : il doit claquer dès qu'il apparaît.";
      job.range = Number.isFinite(b.start) && Number.isFinite(b.end) ? [b.start, b.end] : undefined;
      job.base = v.n;
      state.stage = "revise";
      state.revise = { range: job.range, base: v.n, feedback: job.feedback };
      queue("motion");
      return mark(`retouche demandée sur ${b.id} (${job.range?.join("–")} s)`);
    }
    if (state.stage === "revise") {
      const { plan, edit } = pageEdit(v.reel);
      const n = v.n + 1;
      job.versions.push({ n, edl: v.edl, reel: plan, preview: false, by: "edit", createdAt: now() });
      writeFileSync(join(OUT, `reel-v${n}-page.json`), JSON.stringify(plan, null, 2));
      state.stage = "edit";
      state.edit = { n, ...edit };
      queue("preview");
      return mark(`édition à la main (version ${n}) : ${JSON.stringify(edit)}`);
    }
    if (state.stage === "edit") {
      job.regen = true;
      job.feedback = job.marks = job.range = job.base = undefined;
      state.stage = "regen";
      queue("motion");
      return mark("régénération demandée");
    }
    return finish("done");
  }

  createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const reply = (code, obj, note) => { jsonl("events.jsonl", { m: req.method, p, s: code, ...(note ? { note } : {}) }); send(res, code, obj); };
    if (p === "/login") return reply(200, {});
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: "jeton" });
    const raw = await body(req);
    const json = () => { try { return JSON.parse(raw.toString() || "{}"); } catch { return {}; } };
    let m;

    if (req.method === "POST" && p === "/api/montage/rushes/scan") return reply(200, { count: (json().rushes || []).length });
    if (req.method === "POST" && p === "/api/montage/worker/claim") {
      const d = json();
      const free = job.action && !claimed && state.status === "running";
      const gate = atLeast(d.version, job.minWorker);
      jsonl("claims.jsonl", { version: d.version ?? null, speed: d.speed ?? null, result: free && gate ? 200 : 204 });
      if (!free || !gate) return reply(204);
      claimed = true;
      state.claims++;
      state.runs++;
      const at = now();
      job.status = "working";
      job.step = "Pris en charge par le Mac";
      job.run = { startedAt: at, by: d.version, beatAt: at };
      state.runIds[at] = state.runs;
      mark(`réclamé par ${d.version} → ${job.action} (passage ${state.runs})`, { run: state.runs, action: job.action, stage: state.stage, calls: calls() });
      // STOP_REGEN : le Mac a lâché le passage arrêté et prend la nouvelle demande ; 15 s pour voir si l'ancien écrit encore.
      if (scenario === "stop-regen" && Number.isFinite(state.requeueT) && !state.reclaim) {
        state.reclaim = { t: Date.now() - t0, run: state.runs, action: job.action, regen: job.regen === true };
        save();
        setTimeout(() => finish("done"), 15_000);
      }
      const sent = { ...job, ...(job.minWorker ? { voice: VOICE } : {}), motion: { ...job.motion, look: { ...job.motion.look, ...(job.motion.logo !== false ? { logo: LOGO } : {}) } } };
      return reply(200, { job: sent, action: job.action, rushes: [] });
    }
    if (req.method === "POST" && p === "/api/uploads") {
      const d = json();
      const id = `up${Object.keys(uploads).length + 1}`;
      uploads[id] = { ...d, file: join(OUT, "uploads", id), received: 0 };
      writeFileSync(uploads[id].file, "");
      jsonl("events.jsonl", { m: "POST", p, s: 200, note: `${d.size} octets`, stage: state.stage, action: job.action });
      return send(res, 200, { id });
    }
    if (req.method === "PUT" && (m = p.match(/^\/api\/uploads\/(\w+)$/))) {
      const u = uploads[m[1]];
      if (!u) return reply(404, { error: "envoi inconnu" });
      if (raw.length > 10 * 1024 * 1024) return reply(413, { error: "trop gros" });
      if (Number(url.searchParams.get("offset")) !== u.received) return reply(409, { error: "offset" });
      appendFileSync(u.file, raw);
      u.received += raw.length;
      return reply(200, { received: u.received });
    }
    if (p === `/api/montage/jobs/${job.id}` && req.method === "GET") {
      if (state.deleted) return reply(404, { error: "Montage introuvable" });
      return reply(200, { job: pageJob(job), worker: { online: true, version: "0.14.0", busy: job.action ? { id: job.id, title: job.title } : undefined }, now: Date.now() });
    }
    if (p === `/api/montage/jobs/${job.id}` && req.method === "PATCH") {
      const d = json();
      jsonl("patches.jsonl", { _run: runOf(d), _action: job.action, _stage: state.stage, ...d });
      if ((d.status !== undefined || d.step !== undefined || d.progress !== undefined || d.phase !== undefined) && stale(d)) return reply(409, STALE, "écriture d'un passage terminé");
      if (d.status === "failed") {
        job.error = String(d.error || "").slice(0, 2000);
        job.regen = undefined;
        state.failure = job.error;
        release(job.versions.some((v) => v.reel && v.preview) ? "review" : "failed");
        mark(`échec envoyé par le worker : ${job.error.slice(0, 200)}`);
        // Attendu pour ces scénarios ; un échec ailleurs fait échouer le test.
        finish(["oldserver", "claude-timeout"].includes(scenario) ? "done" : "failed");
        return reply(200, { job: pageJob(job) });
      }
      if (typeof d.step === "string") job.step = d.step.slice(0, 200);
      if (typeof d.progress === "number") job.progress = Math.min(1, Math.max(0, d.progress));
      if (job.action && job.run) {
        const at = now();
        if (d.phase && d.phase !== job.run.phase) { job.run.phase = d.phase; job.run.phaseAt = at; }
        if (Array.isArray(d.phases)) job.run.phases = d.phases;
        if (typeof d.eta === "number") job.run.etaAt = new Date(Date.now() + d.eta * 1000).toISOString();
        if (Array.isArray(d.frames)) job.run.frames = d.frames;
        if (Array.isArray(d.beats)) job.run.beats = d.beats;
        if (Array.isArray(d.done)) job.run.done = d.done;
        job.run.beatAt = at;
      }
      // STOP : « Arrêter » dans la page dès que le rendu annonce ses premières images (Chrome est alors au travail).
      if ((scenario === "stop" || scenario === "stop-regen") && d.phase === "render" && Array.isArray(d.frames) && d.frames[0] >= 1 && job.action && !state.stopAt) {
        job.versions = job.versions.filter((v) => v.by !== "edit" || v.preview);
        release("review");
        state.stopAt = now();
        state.stopT = Date.now() - t0;
        state.stopRun = runOf(d);
        mark(`ARRÊT demandé par la page (action null) au premier PATCH du rendu avec des images (${d.frames.join("/")})`);
        if (scenario === "stop") setTimeout(() => finish("done"), 15_000);
        else {
          // « Régénérer » 1 s plus tard, avant la veille suivante du Mac (toutes les 10 s) : le job est de nouveau en file,
          // sans run. Filet : sans nouvelle réclamation, le scénario finit 2 min après l'arrêt (et échoue).
          setTimeout(() => {
            job.regen = true;
            job.feedback = job.marks = job.range = job.base = undefined;
            state.stage = "regen";
            queue("motion");
            state.requeueT = Date.now() - t0;
            mark("RÉGÉNÉRER demandé par la page 1 s après l'arrêt (job de nouveau en file, sans run)");
          }, 1000);
          setTimeout(() => finish("done"), 120_000);
        }
      }
      return reply(200, { job: pageJob(job) });
    }
    if (req.method === "POST" && p === `/api/montage/jobs/${job.id}/board`) {
      if (scenario === "oldserver") return reply(404, { error: "POST /board inconnu" });
      const d = json();
      if (stale(d)) return reply(409, STALE, "planche d'un passage terminé");
      const prefix = "data:image/jpeg;base64,";
      const bytes = typeof d.image === "string" && d.image.startsWith(prefix) ? Buffer.from(d.image.slice(prefix.length), "base64") : Buffer.alloc(0);
      const jpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
      const frames = Array.isArray(d.frames) ? d.frames : [];
      const n = (state.boards = (state.boards || 0) + 1);
      if (jpeg) writeFileSync(join(OUT, "boards", `board-${n}.jpg`), bytes);
      jsonl("boards.jsonl", { n, run: runOf(d), stage: state.stage, chars: String(d.image || "").length, bytes: bytes.length, jpeg, frames });
      if (!jpeg || d.image.length > 800_000 || !frames.length || frames.length > 12) return reply(400, { error: "Planche invalide" });
      job.run = { ...job.run, board: { v: Date.now(), n: frames.length, frames } };
      save();
      return reply(200, { board: job.run.board });
    }
    if (req.method === "GET" && p === `/api/montage/jobs/${job.id}/board`) {
      const f = join(OUT, "boards", `board-${state.boards || 0}.jpg`);
      if (!existsSync(f)) return reply(404, { error: "Introuvable" });
      jsonl("events.jsonl", { m: "GET", p, s: 200 });
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" });
      return res.end(readFileSync(f));
    }
    if (req.method === "POST" && p === `/api/montage/jobs/${job.id}/versions`) {
      const d = json();
      if (scenario === "oldserver" && d.reel?.video) return reply(400, { error: "Garde au moins une scène" }, "ancien serveur : plan vidéo refusé");
      if (stale(d)) return reply(409, STALE, "version d'un passage terminé");
      if (!d.reel || typeof d.reel !== "object") return reply(400, { error: "Plan manquant" });
      const n = (job.versions.at(-1)?.n ?? 0) + 1;
      const v = { n, edl: { format: "9:16", segments: [] }, reel: d.reel, notes: typeof d.notes === "string" ? d.notes.slice(0, 2000) : undefined, preview: false, by: "claude", createdAt: now() };
      if (uploads[d.upload]) { renameSync(uploads[d.upload].file, join(OUT, `apercu-v${n}.mp4`)); v.preview = true; }
      const first = d.reel.video && !job.versions.some((x) => x.reel?.video);
      job.versions.push(v);
      writeFileSync(join(OUT, `reel-v${n}.json`), JSON.stringify(d.reel, null, 2));
      writeFileSync(join(OUT, `notes-v${n}.txt`), String(d.notes ?? ""));
      if (first && d.reel.video.title) job.title = `Reel animé : ${d.reel.video.title}`.slice(0, 120);
      job.regen = undefined;
      job.feedback = job.marks = job.range = job.base = undefined;
      state.versions.push({ n, by: "claude", stage: state.stage, run: state.runs, preview: v.preview, notesChars: String(d.notes ?? "").length, rawNotesChars: typeof d.notes === "string" ? d.notes.length : 0, calls: calls(), t: Date.now() - t0, at: now() });
      release("review");
      mark(`version ${n} reçue (${state.stage}) : ${d.reel.video ? `${d.reel.video.beats?.length} temps forts, ${d.reel.video.moments?.length} moment(s), ${d.reel.duration} s` : `${d.reel.scenes?.length} scènes`}`);
      reply(201, { job: pageJob(job), version: n });
      return next();
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/montage\/jobs\/[\w-]+\/versions\/(\d+)\/preview$/))) {
      const d = json();
      const n = Number(m[1]);
      const v = job.versions.find((x) => x.n === n);
      if (!v) return reply(404, { error: "Version introuvable" });
      if (stale(d)) return reply(409, STALE, "aperçu d'un passage terminé");
      if (!d.upload || !uploads[d.upload]) return reply(400, { error: "Champ « upload » manquant" });
      renameSync(uploads[d.upload].file, join(OUT, `apercu-v${n}.mp4`));
      v.preview = true;
      if (d.reel) { v.reel = { ...d.reel, ...(v.reel?.texts?.length ? { texts: v.reel.texts } : {}) }; writeFileSync(join(OUT, `reel-v${n}.json`), JSON.stringify(d.reel, null, 2)); }
      if (typeof d.notes === "string" && d.notes.trim()) v.notes = d.notes.trim().slice(0, 2000);
      writeFileSync(join(OUT, `notes-v${n}.txt`), String(d.notes ?? ""));
      state.versions.push({ n, by: "edit", stage: state.stage, run: state.runs, preview: true, notesChars: String(d.notes ?? "").length, calls: calls(), t: Date.now() - t0, at: now() });
      release("review");
      mark(`aperçu de la version ${n} reçu`);
      reply(200, { job: pageJob(job) });
      return next();
    }
    if (req.method === "POST" && p === `/api/montage/jobs/${job.id}/final`) {
      const d = json();
      state.finals++;
      jsonl("final.jsonl", { upload: d.upload, title: d.title });
      mark("/final appelé (jamais pour une vidéo)");
      return reply(201, { job, media: { id: "media-final", title: d.title || job.title } });
    }
    reply(404, { error: `${req.method} ${p}` });
  }).listen(port, () => say(`faux Metricove (reel vidéo, scénario ${scenario}) sur http://localhost:${port} (jeton ${TOKEN}), sorties dans ${OUT}`));
}

/** Une image PNG unie w×h (le logo du faux projet), en data URL. */
function pngDataUrl(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/* ---------- Faux `claude` (CLAUDE_FAKE, via claude-spy.sh) ---------- */

/**
 * Répond comme `claude -p --output-format stream-json --json-schema …` sans appeler Claude : la partition de la fixture
 * score-basic pour une écriture, une relecture vide, ou une retouche qui allonge le premier temps fort ouvert.
 * CLAUDE_FAKE=slow ne répond jamais (test du délai) ; CLAUDE_FAKE=bad renvoie une sortie illisible.
 */
function fakeClaude(args) {
  if (args.includes("--help")) {
    console.log("Usage: claude [options]\n  -p, --print\n  --output-format <format> (text, json, stream-json)\n  --include-partial-messages\n  --json-schema <schema>\n  --restricted\n  --tools <tools...>\n  --effort <level>\n  --strict-mcp-config\n  --no-session-persistence\n  --verbose");
    return;
  }
  if (args.includes("--version")) { console.log("2.1.327 (Claude Code, faux)"); return; }
  if (process.env.CLAUDE_FAKE === "slow") { setInterval(() => {}, 60_000); return; }
  const schema = args[args.indexOf("--json-schema") + 1] || "";
  let input = "";
  try { input = readFileSync(0, "utf8"); } catch { /* pas d'entrée */ }
  const fx = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "reel", "score-basic.json"), "utf8"));
  let answer;
  if (/"new"/.test(schema)) {
    const open = (input.match(/Temps forts ouverts[^:]*:\s*([^\n]*)/) || [])[1] || "";
    const ids = [...open.matchAll(/\[([a-z0-9-]+)\]/g)].map((x) => x[1]);
    const beats = fx.clean.video.beats.filter((b) => ids.includes(b.id)).map((b, i) => (i === 0 ? { ...b, text: `${b.text} Vraiment.`.slice(0, 110), seconds: Math.min(10, b.seconds + 1) } : b));
    answer = { notes: "J'ai renforcé le passage.", beats, moments: [] };
  } else if (/"ok"/.test(schema)) answer = { ok: true, notes: "", beats: [], moments: [] };
  else answer = { ...fx.raw, title: `${fx.raw.title}`.slice(0, 80) };
  const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  emit({ type: "system", subtype: "init" });
  if (process.env.CLAUDE_FAKE === "bad") { emit({ type: "result", subtype: "success", is_error: false, result: "pas de json ici" }); return; }
  const text = JSON.stringify(answer);
  for (let i = 0; i < text.length; i += 400) emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: text.slice(i, i + 400) } } });
  emit({ type: "result", subtype: "success", is_error: false, result: "", structured_output: answer, total_cost_usd: 0 });
}
