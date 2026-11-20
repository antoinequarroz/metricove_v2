// Reel vidéo continu (paquet B) : l'aiguillage d'un job vidéo et ses trois chemins.
//   makeVideo   : création ou régénération (Claude écrit la partition, relecture en images possible) → POST /versions ;
//   reviseVideo : retouche d'un passage par Claude (openBeats + mergeRevision, sans relecture) → POST /versions ;
//   renderVideo : édition à la main, SANS Claude (le plan stocké est revérifié puis rendu) → POST /versions/:n/preview.
// Chaque job a un plafond (reel.jobMaxMin, 30 min) et une veille toutes les 10 s : la tâche supprimée (404), arrêtée
// depuis la page (action null) ou reprise ailleurs (run.startedAt changé) arrête tout de suite les processus en cours,
// sans PATCH failed. La progression (phases, %, temps restant) part par Progress, battement de 15 s compris.
import { statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, log } from "../util.mjs";
import { askStream } from "../claude.mjs";
import { cleanMotion } from "../motion.mjs";
import { referenceImages } from "../voice.mjs";
import { voiceOfJob } from "./narration.mjs";
import { writeReelMarks } from "../motion-revise.mjs";
import { cleanScore, timeScore, openBeats, mergeRevision } from "./score.mjs";
import { scoreSchema, reviseSchema, writePrompt, revisePrompt, countLayouts } from "./prompt.mjs";
import { Progress, STEP, reviseStep } from "./progress.mjs";
import { io, produce, reelCfg, withMeta } from "./render.mjs";
import { ENGINE, ENGINE_NEW, FPS, VIDEO_WORKER, seedOf } from "./vocab.mjs";

const ALIVE_MS = 10_000;
const NOTES_MAX = 2000;
/** Images d'inspiration : délai de chaque téléchargement (corps compris) et de l'ensemble. */
const IMG_MS = 30_000, IMG_ALL_MS = 100_000;
const STALE = "reel arrêté ou repris ailleurs (Metricove refuse la suite de ce passage)";
const GONE = "reel annulé (la tâche n'existe plus)";
const statusIs = (e, n) => e?.status === n || new RegExp(`→ ${n}\\b`).test(String(e?.message || ""));
const short = (id) => String(id).slice(0, 8);
const slug = (s) => String(s || "reel").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "reel";
const fmtS = (s) => `${s > 0 ? "+" : "−"}${Math.abs(s).toFixed(1).replace(".", ",")} s`;

/** Une annulation venue de la page : le job s'arrête sans PATCH failed (jobs.mjs lit `cancelled`). */
export const cancelled = (why) => Object.assign(new Error(why), { cancelled: true, code: "ABORT" });

/** Un job vidéo ? Par la demande (mode video) ou par la forme d'une version (plan avec video). */
export const isVideoJob = (job) => job?.kind === "motion" && (job.motion?.mode === "video" || (job.versions || []).some((v) => !!v?.reel?.video));

/**
 * Point d'entrée appelé par jobs.mjs pour un job vidéo. `dir` = <workDir>/taches/<id>-r<passage>, propre à ce passage (supprimé à la fin).
 * action "preview" → renderVideo ; action "motion" → makeVideo (régénération ou aucune version vidéo) ou reviseVideo.
 */
export async function handleVideo(api, cfg, job, action, dir) {
  const R = reelCfg(cfg);
  const versions = job.versions || [];
  const controller = new AbortController();
  const signal = controller.signal;
  const startedAt = Date.now();
  // L'identité du passage (run.startedAt de la réclamation) part avec chaque écriture : Metricove répond 409 à la
  // queue d'un passage terminé (arrêté, fini, repris par une autre réclamation), traitée comme une annulation.
  const run = typeof job.run?.startedAt === "string" || typeof job.run?.startedAt === "number" ? job.run.startedAt : undefined;
  const stop = (why) => { if (!signal.aborted) controller.abort(cancelled(why)); return signal.reason; };
  /** Une erreur d'écriture : 409 (passage terminé) ou 404 (tâche supprimée) arrête le job sans PATCH failed. */
  const ended = (e) => (statusIs(e, 409) ? stop(STALE) : statusIs(e, 404) ? stop(GONE) : null);
  // Plafond du job : un enfant bloqué est tué par son propre délai, tout le job par celui-ci (même une opération qui
  // n'écoute pas le signal : la course plus bas rend la main à l'heure).
  const cap = setTimeout(() => controller.abort(Object.assign(new Error(`Le reel a dépassé ${R.jobMaxMin} min et a été arrêté. Réessaie ; si ça recommence, raccourcis la demande.`), { code: "TIMEOUT" })), R.jobMaxMin * 60_000);
  // Veille : la tâche existe-t-elle encore, et est-elle toujours à nous ?
  let watching = false, warned = false;
  const watch = api.dryRun ? null : setInterval(async () => {
    if (watching || signal.aborted) return;
    watching = true;
    try {
      const now = await api.job(job.id, { signal });
      if (!now) stop(GONE);
      else if (!now.action) stop("reel arrêté depuis la page");
      else if (run && now.run?.startedAt && now.run.startedAt !== run) stop("reel repris par un autre worker");
    } catch (e) {
      if (signal.aborted) return;
      if (!warned) { warned = true; log(`[${short(job.id)}] veille de la tâche impossible (${e.message}) : on continue`); }
    } finally { watching = false; }
  }, ALIVE_MS);
  // Les PATCH de progression (avec run) : un 404 ou un 409 arrête tout de suite, sans attendre la veille suivante.
  // Après un arrêt, plus rien ne part (le battement d'un travail encore en route se tait).
  const steps = {
    step: (id, s, p, extra) => (signal.aborted ? Promise.resolve() : api.patch(id, { step: s, progress: p, ...extra, ...(run !== undefined ? { run } : {}) }).catch((e) => {
      if (!ended(e)) log("étape non envoyée :", e.message);
    })),
  };
  // Les écritures de fin (planche, version, aperçu) portent run ; un 409 ou un 404 devient l'annulation.
  const writes = {
    board: (image, frames) => api.board(job.id, image, frames, { run, signal }).catch((e) => { throw ended(e) || e; }),
    addVersion: (data) => api.addVersion(job.id, { ...data, ...(run !== undefined ? { run } : {}) }, { signal }).catch((e) => { throw ended(e) || e; }),
    setPreview: (n, upload, more) => api.setPreview(job.id, n, upload, undefined, { ...more, ...(run !== undefined ? { run } : {}) }, { signal }).catch((e) => { throw ended(e) || e; }),
  };
  const ctx = { api, cfg, job, dir, signal, startedAt, R, steps, writes };
  const work = (async () => {
    // Les outils du Mac d'abord : sans eux la vidéo échouerait plus tard, après l'écriture payée de Claude.
    await io.toolchain(cfg, { claude: action === "motion" });
    if (action === "preview") {
      const v = versions[versions.length - 1];
      if (!v?.reel?.video) throw new Error("Version du reel introuvable.");
      return await renderVideo(ctx, v);
    }
    if (action !== "motion") throw new Error(`Action inconnue pour un reel : ${action}`);
    const last = [...versions].reverse().find((v) => v.reel?.video);
    if (job.regen || !last) return await makeVideo(ctx, last);
    const from = versions.find((v) => v.n === job.base && v.reel?.video) || last;
    return await reviseVideo(ctx, from);
  })();
  // Le travail laissé en route après un arrêt finit seul (ses écritures sont coupées par le signal, chaque étape
  // commence par regarder le signal) : son échec éventuel ne doit pas faire tomber le worker. Son dossier est à lui seul
  // (un par passage, jobs.mjs) : il est retiré à la fin de handleVideo, puis encore une fois quand ce travail s'arrête,
  // pour ce qu'il aurait écrit entre-temps. La même tâche relancée travaille ailleurs.
  work.catch(() => {});
  const clean = () => {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (e) { log(`[${short(job.id)}] dossier de travail non supprimé (${e.code || e.message}) : ${dir}`); }
  };
  let onAbort;
  const aborted = new Promise((_, rej) => {
    onAbort = () => rej(signal.reason instanceof Error ? signal.reason : cancelled("reel arrêté"));
    if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
  });
  aborted.catch(() => {});
  try {
    return await Promise.race([work, aborted]);
  } catch (e) {
    // Une erreur levée pendant l'annulation (processus tué…) cède la place à la raison de l'annulation.
    if (signal.aborted && signal.reason instanceof Error) throw signal.reason;
    throw e;
  } finally {
    clearTimeout(cap);
    if (watch) clearInterval(watch);
    signal.removeEventListener("abort", onAbort);
    clean();
    if (signal.aborted) work.then(clean, clean);
  }
}

/** Le plan d'une version, avec le logo du projet (jamais gardé dans la tâche : il arrive avec elle) et sa video. */
function planOf(job, v) {
  const video = v.reel.video;
  if (Number(video.engine) > ENGINE) throw new Error("Ce reel a été fait par un Mac plus récent : mets le Mac à jour.");
  const plan = cleanMotion({ ...v.reel, look: { ...v.reel.look, logo: v.reel.logo === false ? "" : job.motion?.look?.logo } });
  return { ...plan, video: { ...video, beats: video.beats || [], moments: video.moments || [] } };
}

/** Les notes de la version (≤ 2000 caractères), lignes entières : Claude, puis ce que la chaîne a retiré, puis les corrections. */
function joinNotes(...groups) {
  const out = [];
  let size = 0;
  for (const s of groups.flat()) {
    const line = String(s || "").replace(/\s+/g, " ").trim();
    if (!line || out.includes(line)) continue;
    if (size + line.length + 1 > NOTES_MAX) break;
    out.push(line);
    size += line.length + 1;
  }
  return out.join("\n");
}

/** Lit le flux de Claude : « N temps forts » d'après les "layout" vus (compte sur la jointure de deux morceaux). */
function streamCounter(P) {
  let tail = "", beats = 0;
  return (t, chars) => {
    const s = tail + t;
    beats += countLayouts(s) - countLayouts(tail);
    tail = s.slice(-16);
    P.writing(chars, beats);
  };
}

/** La progression d'un job : arrêtée dès l'annulation (un travail laissé en route par le plafond dur se tait). */
function progressOf(ctx, kind) {
  const P = new Progress(ctx.steps, ctx.cfg, ctx.job, { kind });
  if (ctx.signal.aborted) P.stop();
  else ctx.signal.addEventListener("abort", () => P.stop(), { once: true });
  return P;
}

const stopIfAborted = (signal) => { if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : cancelled("reel annulé"); };

/** Envoi de la vidéo (phase upload, fraction = morceaux envoyés), puis dernier PATCH de progression. */
async function send(ctx, P, file, name) {
  stopIfAborted(ctx.signal);
  P.start("upload", STEP.upload);
  P.setUploadBytes(statSync(file).size);
  const upload = await ctx.api.upload(file, name, (sent, size) => P.fraction(size ? sent / size : 1), { signal: ctx.signal });
  stopIfAborted(ctx.signal);
  P.fraction(1);
  // Le dernier PATCH part AVANT la version : après elle, la tâche est rendue et un step la salirait.
  await P.end();
  return upload;
}

/**
 * Le message d'un 400 du serveur sur une version vidéo : un ancien serveur, qui ne connaît que les reels à scènes,
 * répond « Garde au moins une scène » (le plan vidéo n'en a aucune) ; sinon c'est le refus du serveur lui-même (code
 * trop long, moins de deux temps forts, moteur inconnu…), redonné tel quel.
 */
export function refusal(e) {
  const raw = String(e?.body ?? String(e?.message || "").replace(/^[\s\S]*?→ 400 ?/, ""));
  let msg = raw;
  try { msg = String(JSON.parse(raw)?.error || raw); } catch { /* texte brut */ }
  msg = msg.replace(/\s+/g, " ").trim();
  if (/au moins une sc[eè]ne/i.test(msg)) return "Metricove ne connaît pas encore les reels vidéo : mets le site à jour.";
  return `Metricove a refusé la vidéo : ${msg.slice(0, 300) || "requête refusée (400)"}${/[.!?]$/.test(msg) ? "" : "."}`;
}

const is400 = (e) => e?.status === 400 || /→ 400\b/.test(String(e?.message || ""));

/** Ajoute la version (avec run) ; un 400 est un échec clair (refusal), jamais un repli /final ; un 409 ou un 404, l'annulation. */
async function addVideoVersion(ctx, data) {
  try {
    await ctx.writes.addVersion(data);
  } catch (e) {
    if (is400(e)) throw new Error(refusal(e));
    throw e;
  }
}

/**
 * Les images d'inspiration du projet (3 au plus), téléchargées dans le dossier de Claude : 30 s par image (corps
 * compris), 100 s en tout, l'annulation du job suivie. Une image qui ne vient pas est sautée ; au-delà, sans images.
 */
export async function inspiration(ctx, dir, { each = IMG_MS, all = IMG_ALL_MS } = {}) {
  const { api, job, signal } = ctx;
  const imgApi = { req: (method, url, o = {}) => api.req(method, url, { ...o, timeoutMs: each, signal }) };
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => { log(`[${short(job.id)}] images d'inspiration trop lentes : la vidéo s'écrit sans elles`); r({ files: [] }); }, all); });
  try {
    const r = await Promise.race([referenceImages(imgApi, { ...job, voice: { ...job.voice, images: (job.voice?.images || []).slice(0, 3) } }, dir), late]);
    stopIfAborted(signal);
    return r;
  } finally { clearTimeout(timer); }
}

/**
 * Appel de Claude avec UNE nouvelle écriture si la réponse est inexploitable (illisible, hors schéma, ou refusée par
 * `accept`, qui lève une Error en français). Renvoie ce que `accept` renvoie.
 */
async function askTwice(ctx, P, { prompt, schema, cwd, tools, timeoutMs, what }, accept) {
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) P.step(STEP.rewrite);
    let raw;
    try {
      raw = await askStream(ctx.cfg, prompt(why), schema, cwd, { tools, timeoutMs, signal: ctx.signal, what, onDelta: streamCounter(P) });
    } catch (e) {
      if (e.code !== "BAD_OUTPUT" || ctx.signal.aborted) throw e;
      why = e.message;
      log(`[${short(ctx.job.id)}] réponse de Claude inexploitable : ${why}`);
      continue;
    }
    try {
      return accept(raw);
    } catch (e) {
      why = e.message;
      log(`[${short(ctx.job.id)}] partition inexploitable : ${why}`);
    }
  }
  throw new Error(what === "revise" ? `Claude n'a pas écrit de retouche exploitable (${why}). Réessaie.` : `Claude n'a pas écrit de partition exploitable (${why}). Réessaie.`);
}

/** a ≥ b pour des versions x.y.z (morceaux absents ou illisibles = 0). */
export function atLeast(a, b) {
  const p = (v) => String(v ?? "").split(".").map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
}

/**
 * Le moteur d'une nouvelle vidéo : ENGINE_NEW (2, Signature) quand le site la demande à un Mac qui le joue
 * (job.minWorker ≥ VIDEO_WORKER : un site plus ancien ne connaît pas engine 2 et refuserait la vidéo) ; 1 sinon, ou
 * quand config.json → reel.engine vaut 1 (retour au moteur Plateau).
 */
export function engineFor(job, R = {}) {
  if (Number(R.engine) === 1) return 1;
  return atLeast(job?.minWorker, VIDEO_WORKER) ? ENGINE_NEW : 1;
}

/** Les repères (temps forts gardés avec start/end) envoyés au Studio dès que la partition est connue. */
function announce(P, video, pace) {
  const t = timeScore(video, { pace });
  P.beats(t.video.beats.filter((b) => !b.cut));
  P.setFrames(Math.round(t.duration * FPS));
  return t;
}

/** Création ou régénération : écriture par Claude, chaîne complète avec relecture, nouvelle version. */
async function makeVideo(ctx, last) {
  const { api, cfg, job, dir, signal, R } = ctx;
  const P = progressOf(ctx, "write");
  try {
    P.start("write", STEP.write);
    const versions = job.versions || [];
    // layouts : les scènes de la version d'avant (engine 2 : le prompt de régénération les nomme pour en changer).
    const prev = job.regen && last ? last.reel.video.beats.filter((b) => !b.cut) : [];
    const regen = job.regen && last ? { titles: prev.map((b) => b.title), layouts: prev.map((b) => b.layout), shape: last.reel.video.shape } : null;
    const nextN = (versions[versions.length - 1]?.n ?? 0) + 1;
    // Graine : seedOf(job.id) à la création, seedOf(job.id, n) quand des versions existent (n = la version créée).
    const seed = versions.length ? seedOf(job.id, nextN) : seedOf(job.id);
    // Les images d'inspiration du projet (3 au plus), lues par Claude avec Read dans son dossier.
    const writeDir = ensureDir(join(dir, "write"));
    const ref = await inspiration(ctx, writeDir);
    const motion = cleanMotion(job.motion || {});
    const m = job.motion || {};
    const t0 = Date.now();
    // Voix off (une phrase dite par temps fort) et musique à composer (une consigne) : demandées dans la partition.
    const voice = voiceOfJob(job);
    const gen = motion.music && motion.track === "gen";
    // Engine 2 (Signature) : le storyboard de la bibliothèque de scènes, sur la grille du tempo.
    const engine = engineFor(job, R);
    const result = await askTwice(ctx, P, {
      prompt: (why) => writePrompt(job, { cfg, images: ref.files, regen, retry: why, engine }),
      schema: scoreSchema({ voice: !!voice, music: gen, engine }),
      cwd: writeDir,
      tools: ref.files.length ? "Read" : "",
      timeoutMs: R.claudeWriteMin * 60_000,
      what: "write",
    }, (raw) => ({ raw, c: cleanScore(raw, { target: m.seconds, pace: m.pace, seed, request: m.request, source: m.source, direction: m.direction, engine }) }));
    rmSync(writeDir, { recursive: true, force: true });
    const { raw, c } = result;
    log(`[${short(job.id)}] partition : ${c.video.beats.length} temps forts, ${engine === 2 ? `moteur Signature, ${Math.round((FPS * 600) / c.video.fpb) / 10} BPM` : `${c.video.moments.length} moment(s)`}, rythme ${c.pace} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    const plan = {
      scenes: [],
      look: motion.look,
      logo: motion.logo,
      music: motion.music,
      volume: motion.volume,
      track: motion.track,
      ...(motion.cue ? { cue: motion.cue } : {}),
      ...(motion.sfx === false ? { sfx: false } : {}),
      texts: [],
      pace: c.pace,
      video: { ...withMeta(c.video, null), ...(voice ? { voiceOver: voice } : {}) },
      ...(gen && typeof raw.music === "string" && raw.music.trim() ? { musicPrompt: raw.music.trim().slice(0, 500) } : {}),
    };
    if (!plan.logo) plan.look = { ...plan.look, logo: "" };
    announce(P, plan.video, plan.pace);
    const notes = [];
    const r = await produce(cfg, { api, job, plan, dir, progress: P, signal, notes, fresh: new Set(), findings: c.findings, review: true, startedAt: ctx.startedAt, board: ctx.writes.board });
    const upload = await send(ctx, P, r.video, `${slug(r.plan.video.title || job.title)}.mp4`);
    await addVideoVersion(ctx, { reel: r.plan, notes: joinNotes(raw.notes, notes, c.fixes), upload });
    P.learn(r.stats.frameMs ? { frameMs: r.stats.frameMs } : {});
    log(`[${short(job.id)}] reel vidéo envoyé (version ${nextN}, ${r.duration.toFixed(1)} s, ${r.plan.video.moments.length} moment(s)${r.safe ? ", mode sûr" : ""}, ${((Date.now() - ctx.startedAt) / 1000).toFixed(0)} s en tout)`);
    return r;
  } finally {
    P.stop();
  }
}

/** Retouche d'un passage : Claude ne réécrit que les temps forts ouverts, sans relecture. */
async function reviseVideo(ctx, from) {
  const { api, cfg, job, dir, signal, R } = ctx;
  const P = progressOf(ctx, "revise");
  try {
    const base = planOf(job, from);
    const video = base.video;
    const pace = base.pace;
    const timed = timeScore(video, { pace });
    const marks = timed.video.beats.filter((b) => !b.cut).map((b) => ({ id: b.id, title: b.title, start: b.start, end: b.end }));
    const reviseDir = ensureDir(join(dir, "revise"));
    const drawn = writeReelMarks(job, reviseDir);
    const range = Array.isArray(job.range) && job.range.length === 2 ? job.range.map(Number) : null;
    const open = openBeats(video, { range, marks: drawn, pace });
    // Le passage affiché : celui choisi par Antoine, sinon celui des temps forts ouverts (notes dessinées).
    const shown = open.length && open.length < marks.length ? marks.filter((m) => open.includes(m.id)) : [];
    P.start("write", reviseStep(range || (shown.length ? [Math.min(...shown.map((m) => m.start)), Math.max(...shown.map((m) => m.end))] : null)));
    log(`[${short(job.id)}] retouche : temps forts ouverts ${open.join(", ") || "aucun"}`);
    const result = await askTwice(ctx, P, {
      prompt: (why) => revisePrompt(job, { video, marks, open, range, notes: drawn, feedback: [job.feedback, why && `(Ta réponse précédente était inexploitable : ${why}. Renvoie le JSON complet du schéma.)`].filter(Boolean).join("\n"), look: base.look, engine: video.engine }),
      schema: reviseSchema({ voice: !!video.voiceOver, engine: video.engine }),
      cwd: reviseDir,
      tools: drawn.some((d) => d.file) ? "Read" : "",
      timeoutMs: R.claudeReviseMin * 60_000,
      what: "revise",
    }, (rev) => {
      const merged = mergeRevision(video, rev, open);
      merged.ignored.forEach((s) => log(`[${short(job.id)}] ${s}`));
      if (!merged.changed) return { rev, merged, c: null };
      // target: null : une retouche ne remet jamais la vidéo à l'échelle de la durée visée (les temps forts verrouillés
      // gardent leurs secondes) ; la durée visée reste dans les champs d'en-tête (withMeta).
      return { rev, merged, c: cleanScore(merged.video, { base: video, pace, target: null, seed: video.seed }) };
    });
    rmSync(reviseDir, { recursive: true, force: true });
    const { rev, merged, c } = result;
    if (!c) throw new Error("Claude n'a rien changé : précise ta demande ou choisis un autre passage.");
    const plan = { ...base, pace: c.pace, video: withMeta(c.video, video) };
    const t = announce(P, plan.video, plan.pace);
    const notes = [];
    const shift = Math.round((t.duration - timed.duration) * 10) / 10;
    if (Math.abs(shift) >= 0.1) notes.push(`La fin est décalée de ${fmtS(shift)}.`);
    const r = await produce(cfg, { api, job, plan, dir, progress: P, signal, notes, fresh: merged.fresh, findings: c.findings, review: false, startedAt: ctx.startedAt, board: ctx.writes.board });
    const upload = await send(ctx, P, r.video, `${slug(r.plan.video.title || job.title)}.mp4`);
    await addVideoVersion(ctx, { reel: r.plan, notes: joinNotes(rev.notes, notes, c.fixes), upload });
    P.learn(r.stats.frameMs ? { frameMs: r.stats.frameMs } : {});
    log(`[${short(job.id)}] retouche du reel envoyée (${r.duration.toFixed(1)} s, depuis la version ${from.n})`);
    return r;
  } finally {
    P.stop();
  }
}

/** Édition à la main : le plan stocké (code compris) repasse le bac à sable, le moteur et Chrome, sans Claude. */
async function renderVideo(ctx, v) {
  const { api, cfg, job, dir, signal } = ctx;
  const P = progressOf(ctx, "edit");
  try {
    const base = planOf(job, v);
    // Les liaisons se recalculent après un réordonnancement (carry sans mot commun → morph…), avec une note.
    const c = cleanScore(base.video, { base: base.video, pace: base.pace, target: null, seed: base.video.seed });
    const plan = { ...base, pace: c.pace, video: withMeta(c.video, base.video) };
    announce(P, plan.video, plan.pace);
    const notes = [];
    const r = await produce(cfg, { api, job, plan, dir, progress: P, signal, notes, fresh: new Set(), findings: [], review: false, startedAt: ctx.startedAt, board: ctx.writes.board });
    const upload = await send(ctx, P, r.video, `reel-${job.id}-v${v.n}.mp4`);
    try {
      await ctx.writes.setPreview(v.n, upload, { reel: r.plan, notes: joinNotes(c.fixes, notes) });
    } catch (e) {
      if (is400(e)) throw new Error(refusal(e));
      throw e;
    }
    P.learn(r.stats.frameMs ? { frameMs: r.stats.frameMs } : {});
    log(`[${short(job.id)}] aperçu du reel vidéo envoyé (version ${v.n}, ${r.duration.toFixed(1)} s)`);
    return r;
  } finally {
    P.stop();
  }
}
