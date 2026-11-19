// La chaîne d'un reel vidéo (paquet B) : produce() suit l'échelle de qualité du design.
//   a) checkMoment sur chaque moment (statique) : un moment refusé n'est pas construit ;
//   b) stagePage puis `hyperframes lint` : une erreur de lint est un bogue du moteur → mode sûr ;
//   c) `hyperframes check` : erreurs d'exécution attribuées (moment ou moteur), mouvement, lint ;
//   d) images à l'instant posé de chaque temps fort → planche-sprite envoyée au Studio (POST /board) ;
//   e) relecture par Claude (création seulement, si quelque chose mérite d'être regardé), un seul tour, revérifiée ;
//   f) un moment encore bloquant est retiré (avec une note) ; une erreur moteur → mode sûr ;
//   g) rendu, avec repli : sans les moments frais, sans aucun moment, en mode sûr, puis échec clair.
// LA PAGE RENDUE EST TOUJOURS LA DERNIÈRE PAGE VÉRIFIÉE. Puis finition ffmpeg (musique ou piste muette) et ffprobe.
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, log, ensureDir, fmtDelay } from "../util.mjs";
import { pickTrack, musicCue } from "../audio.mjs";
import { askStream, claudeFlags, flagsNote } from "../claude.mjs";
import { checkMoment } from "./sandbox.mjs";
import { stagePage } from "./stage.mjs";
import { cleanScore, applyReview } from "./score.mjs";
import * as HF from "./hf-cli.mjs";
import { REVIEW_SCHEMA, reviewPrompt } from "./prompt.mjs";
import { FPS, W, H, TOOLS, CODE } from "./vocab.mjs";
import { STEP } from "./progress.mjs";

/** Réglages du reel (config.json → reel), avec leurs valeurs par défaut. */
export const REEL_DEFAULTS = Object.freeze({ review: true, effort: "", restricted: true, claudeWriteMin: 6, claudeReviewMin: 4, claudeReviseMin: 5, maxFrameMs: 400, jobMaxMin: 30, reviewWithinMin: 6 });
/** Bornes des réglages numériques : une valeur absente, nulle, négative ou illisible reprend la valeur par défaut. */
export const REEL_BOUNDS = Object.freeze({ claudeWriteMin: [1, 15], claudeReviewMin: [1, 10], claudeReviseMin: [1, 15], jobMaxMin: [5, 90], maxFrameMs: [50, 2000], reviewWithinMin: [0, 30] });
const replaced = new Set();
/**
 * Réglages du reel normalisés : chaque nombre est borné (REEL_BOUNDS), review et restricted sont des booléens, effort
 * une chaîne. Une coquille de config.json ne peut ni supprimer un délai (0 ou NaN = aucun délai pour run()) ni arrêter
 * chaque job à la seconde. Une valeur remplacée est notée une fois au journal.
 */
export function reelCfg(cfg) {
  const own = cfg?.reel && typeof cfg.reel === "object" ? cfg.reel : {};
  const out = { ...REEL_DEFAULTS, ...own };
  const fix = (k, v, why) => {
    const key = `${k}=${JSON.stringify(own[k])}`;
    if (!replaced.has(key)) { replaced.add(key); log(`config.json : reel.${k} = ${JSON.stringify(own[k])} ${why}, ${JSON.stringify(v)} utilisé.`); }
    out[k] = v;
  };
  for (const [k, [lo, hi]] of Object.entries(REEL_BOUNDS)) {
    if (own[k] === undefined) continue;
    const v = typeof own[k] === "number" || (typeof own[k] === "string" && own[k].trim()) ? Number(own[k]) : NaN;
    const okZero = lo === 0 && v === 0;
    if (!Number.isFinite(v) || (v <= 0 && !okZero)) fix(k, REEL_DEFAULTS[k], "est invalide");
    else if (v < lo || v > hi) fix(k, Math.min(hi, Math.max(lo, v)), `est hors de ${lo}–${hi}`);
    else out[k] = v;
  }
  for (const k of ["review", "restricted"]) if (own[k] !== undefined && typeof own[k] !== "boolean") fix(k, own[k] === "false" || own[k] === 0 ? false : REEL_DEFAULTS[k], "n'est pas true ou false");
  if (own.effort !== undefined && typeof own.effort !== "string") fix("effort", REEL_DEFAULTS.effort, "n'est pas un texte");
  return out;
}

const f3 = (n) => Number(n).toFixed(3);
const stopIfAborted = (signal) => { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Annulé."); };
const codeSize = (c) => (c ? String(c.html || "").length + String(c.css || "").length + String(c.js || "").length : 0);
/** Les appels extérieurs de produce() (moteur, HyperFrames, Claude) : remplaçables dans les tests de la chaîne. */
export const io = { stagePage, lint: HF.lint, check: HF.check, snapshot: HF.snapshot, render: HF.render, askStream, claudeFlags };

/**
 * Les raisons écrites pour Antoine dans les notes de la version (sans jargon) ; le détail technique va au journal et
 * dans les prompts de relecture et de retouche.
 */
export const PLAIN = Object.freeze({
  sandbox: "son code ne respectait pas les règles de sécurité des animations",
  long: "son code était trop long",
  runtime: "elle provoquait une erreur pendant la vérification",
  bare: "une erreur est apparue pendant la vérification, la vidéo sort sans les animations sur mesure par prudence",
  render: "elle faisait échouer le rendu",
});
/** La raison en clair d'un refus du bac à sable (checkMoment ou budget commun). */
export const plainRefusal = (why = []) => (why.length && why.every((w) => /trop long/.test(String(w))) ? PLAIN.long : PLAIN.sandbox);

const reasonOf = (list) => [...new Set(list.map((f) => String(f.message || f.code).replace(/^moment [a-z0-9]+:\s*/, "").slice(0, 160)))].slice(0, 2).join(" ; ");

/** Les champs d'en-tête d'une vidéo qui ne viennent jamais d'une relecture (repris de la base s'ils manquent). */
export function withMeta(video, base) {
  const out = { ...video };
  for (const k of ["engine", "request", "source", "target", "direction", "seed", "title", "caption", "captions", "voiceOver", "motionStyle"]) {
    if (out[k] === undefined && base?.[k] !== undefined) out[k] = base[k];
  }
  if (out.engine === undefined) out.engine = 1;
  return out;
}

/**
 * a) Bac à sable : chaque moment repasse checkMoment (le code stocké comme le code frais). Renvoie le plan où seuls
 * les moments acceptés restent (avec le code nettoyé), les refusés [{ id, brief, why, moment }] et les conseils.
 */
export function vet(plan) {
  const refused = [], advice = [];
  let total = 0;
  const moments = [];
  for (const m of plan.video?.moments || []) {
    // Un moment sans code n'a rien à construire (comme checkMoments) : il n'est ni gardé ni refusé.
    if (!m?.code) { log(`moment « ${m?.id} » sans code : ignoré`); continue; }
    let r;
    try { r = checkMoment(m, { id: m.id }); } catch (e) { r = { ok: false, why: [`contrôle impossible : ${e.message}`] }; }
    if (!r?.ok) { refused.push({ id: m.id, brief: m.brief, why: (r?.why || ["refusé"]).slice(0, 6), moment: m }); continue; }
    const code = r.code || m.code;
    if (total + codeSize(code) > CODE.total) { refused.push({ id: m.id, brief: m.brief, why: [`code des animations trop long (${CODE.total} caractères au plus en tout)`], moment: m }); continue; }
    total += codeSize(code);
    for (const a of r.advice || []) advice.push({ code: "conseil_moment", severity: "review", target: `moment:${m.id}`, message: String(a).slice(0, 300) });
    moments.push({ ...m, code });
  }
  return { plan: { ...plan, video: { ...plan.video, moments } }, refused, advice };
}

/** Planche-sprite (tuiles 180×320 côte à côte, ≤ 12, JPEG q4, ≤ 600 Ko) à partir des images du check. */
async function sprite(files, out, signal) {
  const list = files.slice(0, 12);
  for (const q of [4, 8, 14]) {
    const inputs = list.flatMap((f) => ["-i", f]);
    const scale = list.map((_, i) => `[${i}:v]scale=180:320:force_original_aspect_ratio=increase,crop=180:320[t${i}]`).join(";");
    const filter = list.length > 1 ? `${scale};${list.map((_, i) => `[t${i}]`).join("")}hstack=inputs=${list.length}[o]` : scale.replace("[t0]", "[o]");
    await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[o]", "-frames:v", "1", "-q:v", String(q), out], { timeoutMs: 60_000, signal });
    if (statSync(out).size <= 600_000) return out;
  }
  throw new Error("planche trop lourde");
}

/** Délai de la finition : 60 s + 0,2 s par image, 120 s au moins (le grain animé coûte cher à encoder ; mesuré à 0,14 s par image sur une machine chargée). */
export const finishTimeout = (duration) => Math.max(120_000, 60_000 + Math.round(duration * FPS) * 200);

/** Débit vidéo au-delà duquel la finition réencode (le grain animé du moteur donne près de 58 Mb/s en CRF 16). */
export const MAX_BITRATE = 10_000_000;

/** La vidéo muette de HyperFrames peut-elle être gardée telle quelle (h264 yuv420p 1080×1920 30 i/s, débit ≤ 10,5 Mb/s) ? */
export async function canCopy(file, signal) {
  try {
    const j = JSON.parse(await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,width,height,r_frame_rate,bit_rate:format=bit_rate", "-of", "json", file], { timeoutMs: 20_000, signal }));
    const v = j.streams?.[0] || {};
    const rate = Number(v.bit_rate) || Number(j.format?.bit_rate) || Infinity;
    return v.codec_name === "h264" && v.pix_fmt === "yuv420p" && v.width === W && v.height === H && v.r_frame_rate === `${FPS}/1` && rate <= MAX_BITRATE * 1.05;
  } catch (e) {
    if (signal?.aborted) throw e;
    return false;
  }
}

/**
 * La finition (bloc ffmpeg de motion.mjs:553-561) : musique du dossier ou piste muette, aac, faststart. La vidéo de
 * HyperFrames est déjà en h264 : elle est gardée telle quelle (-c:v copy, une seconde) quand elle est conforme et
 * sous le plafond de débit ; sinon réencodée une fois en preset veryfast, crf 18, débit plafonné à 10 Mb/s (le grain
 * animé donne sinon près de 58 Mb/s). Mesuré sur 3 s : veryfast deux fois plus rapide que medium, SSIM 0,853 contre
 * 0,854. Délai proportionnel à la durée.
 */
async function finish(cfg, plan, silent, out, duration, notes, signal) {
  const track = plan.music ? pickTrack(cfg, plan.track || "", notes) : null;
  const cue = musicCue(plan.cue, duration);
  const audio = track
    ? ["-stream_loop", "-1", ...cue.seek, "-i", track, "-filter_complex", `[1:a]atrim=0:${f3(duration)},asetpts=N/SR/TB,volume=${f3(plan.volume ?? 0.7)}${cue.fades ? `,${cue.fades}` : ""}[a]`, "-map", "0:v", "-map", "[a]"]
    : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a"];
  const copy = await canCopy(silent, signal);
  const video = copy ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-maxrate", "10M", "-bufsize", "20M", "-pix_fmt", "yuv420p", "-r", String(FPS)];
  await run("ffmpeg", ["-v", "error", "-y", "-i", silent, ...audio, ...video,
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f3(duration), "-movflags", "+faststart", out], { timeoutMs: finishTimeout(duration), signal });
  return { copy };
}

/** ffprobe : h264 1080×1920, 30 i/s, nb_frames = round(D × 30) ± 1, une piste aac. Renvoie { frames } ou lève une erreur claire. */
export async function probe(file, duration, signal) {
  const j = JSON.parse(await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames", "-of", "json", file], { timeoutMs: 20_000, signal }));
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  const a = (j.streams || []).filter((s) => s.codec_type === "audio");
  const want = Math.round(duration * FPS);
  const bad = [];
  if (!v) bad.push("aucune image");
  else {
    if (v.codec_name !== "h264") bad.push(`codec ${v.codec_name}`);
    if (v.width !== W || v.height !== H) bad.push(`${v.width}×${v.height}`);
    if (v.r_frame_rate !== `${FPS}/1`) bad.push(`${v.r_frame_rate} i/s`);
    if (Math.abs(Number(v.nb_frames) - want) > 1) bad.push(`${v.nb_frames} images au lieu de ${want}`);
  }
  if (a.length !== 1 || a[0].codec_name !== "aac") bad.push(`${a.length} piste(s) son`);
  if (bad.length) throw new Error(`La vidéo finale n'est pas conforme (${bad.join(", ")}).`);
  return { frames: Number(v.nb_frames) };
}

/**
 * Fabrique la vidéo d'un plan. ctx = {
 *   api, job, plan (ReelPlan vidéo nettoyé, look.logo = data URL réinjecté), dir (dossier de la tâche), progress,
 *   signal, notes (tableau commun), fresh (Set des moments frais), findings (lintScore), review (relecture permise),
 *   startedAt (ms, début du job), board (envoi de la planche avec run, facultatif)
 * }. La phase check est ouverte ici ; write l'a été par l'appelant. Renvoie { video, duration, plan, notes, stats }.
 *
 * Chaque page vérifiée a son propre dossier (<tâche>/hf-<n>), gardé sur son état (st.dir) : revenir à la version
 * d'avant une relecture rend exactement la page qui a été vérifiée, jamais la dernière écrite.
 */
export async function produce(cfg, ctx) {
  const R = reelCfg(cfg);
  const { api, job, progress: P, signal } = ctx;
  const notes = ctx.notes || [];
  const note = (s) => { if (s && !notes.includes(s)) notes.push(s); };
  let fresh = new Set(ctx.fresh || []);
  let checks = 0;
  const removed = new Map(); // id → raison (moment retiré du plan rendu)
  const t0 = Date.now();

  /** Ne garde que les dossiers des états encore utiles. */
  const prune = (...keep) => {
    const live = new Set(keep.filter(Boolean).map((s) => s.dir));
    let list = [];
    try { list = readdirSync(ctx.dir); } catch { /* dossier absent */ }
    for (const f of list) if (/^hf-\d+$/.test(f) && !live.has(join(ctx.dir, f))) rmSync(join(ctx.dir, f), { recursive: true, force: true });
  };

  /** b) et c) : la composition écrite dans son dossier, lint puis check. */
  async function verify(plan, isSafe) {
    stopIfAborted(signal);
    if (++checks > 7) throw new Error("Trop de vérifications pour une seule vidéo : abandon.");
    const dir = join(ctx.dir, `hf-${checks}`);
    rmSync(dir, { recursive: true, force: true });
    ensureDir(dir);
    const stageNotes = [];
    const stage = await io.stagePage(cfg, plan, dir, { safe: isSafe, notes: stageNotes });
    P.setFrames(Math.round(stage.duration * FPS));
    const base = { plan, safe: isSafe, stage, dir, stageNotes };
    const l = await io.lint(cfg, dir, { signal });
    if (l.blocking.length) return { ...base, blocking: { engine: l.blocking, moments: {} }, advice: l.advice, lintFailed: true };
    const c = await io.check(cfg, dir, { signal });
    return { ...base, blocking: HF.blame(c.blocking, stage.momentIds), advice: [...l.advice, ...c.advice], timedOut: !!c.timedOut };
  }

  const clean = (st) => !st.blocking.engine.length && !Object.keys(st.blocking.moments).length;
  /** Retire des moments : `why(m)` (détail, au journal) et `plain` (la raison écrite pour Antoine dans les notes). */
  const dropMoments = (plan, ids, why, plain) => {
    const set = new Set(ids);
    for (const m of plan.video.moments) {
      if (!set.has(m.id)) continue;
      const detail = why(m);
      removed.set(m.id, detail);
      log(`moment « ${m.id} » retiré : ${detail}`);
      note(`L'animation sur mesure « ${m.brief || m.id} » a été retirée : ${plain || detail}.`);
    }
    return { ...plan, video: { ...plan.video, moments: plan.video.moments.filter((m) => !set.has(m.id)) } };
  };

  /** f) Rend la page propre : moments fautifs retirés, puis tous les moments, puis mode sûr ; sinon échec clair. */
  async function settle(st) {
    let triedBare = false;
    for (let k = 0; k < 4; k++) {
      if (clean(st)) return st;
      let plan = st.plan;
      const faulty = Object.entries(st.blocking.moments);
      if (faulty.length) plan = dropMoments(plan, faulty.map(([id]) => id), (m) => reasonOf(st.blocking.moments[m.id]), PLAIN.runtime);
      if (st.blocking.engine.length) {
        const built = plan.video.moments.filter((m) => st.stage.momentIds.includes(m.id));
        log(`erreur du moteur : ${reasonOf(st.blocking.engine)}`);
        if (!st.lintFailed && built.length && !triedBare) {
          // Une erreur sans auteur (page bloquée, erreur non préfixée) : d'abord sans aucun moment.
          triedBare = true;
          plan = dropMoments(plan, built.map((m) => m.id), () => `erreur dans Chrome sans auteur identifié (${reasonOf(st.blocking.engine)})`, PLAIN.bare);
        } else if (!st.safe) {
          log(`mode sûr : ${reasonOf(st.blocking.engine)}`);
          note("Une erreur est apparue pendant la vérification : la vidéo sort dans une version plus simple (enchaînements sobres, sans animation sur mesure).");
          P.step(STEP.safe);
          st = await verify(plan, true);
          continue;
        } else {
          throw new Error(`Le moteur vidéo a échoué même en mode sûr (${reasonOf(st.blocking.engine)}). Réessaie ; si ça recommence, signale-le.`);
        }
      }
      st = await verify(plan, st.safe);
    }
    if (clean(st)) return st;
    throw new Error(`La composition ne passe pas la vérification (${reasonOf([...st.blocking.engine, ...Object.values(st.blocking.moments).flat()])}).`);
  }

  /** d) Images à l'instant posé de chaque temps fort, planche-sprite au Studio. Une panne n'arrête pas la vidéo. */
  async function board(st) {
    P.step(STEP.board);
    try {
      const times = st.stage.settle.slice(0, 12);
      const files = await io.snapshot(cfg, st.dir, times, { signal });
      const out = join(ctx.dir, "board.jpg");
      await sprite(files, out, signal);
      const image = `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`;
      const frames = st.stage.marks.slice(0, 12).map((m, i) => ({ id: m.id, t: Math.round((times[i] ?? m.start) * 1000) / 1000 }));
      // ctx.board (index.mjs) ajoute run et change un 409 en annulation ; sinon le client seul (tests, outils).
      if (image.length <= 800_000 && !api.dryRun) await (ctx.board ? ctx.board(image, frames) : api.board(job.id, image, frames, { signal }));
      return { files, frames, sheet: existsSync(HF.contactSheet(st.dir)) ? HF.contactSheet(st.dir) : null, key: keyOf(st) };
    } catch (e) {
      if (signal?.aborted) throw e;
      log("planche non faite :", e.message);
      return null;
    }
  }
  const keyOf = (st) => JSON.stringify([st.safe, st.plan.video.beats, st.plan.video.moments.map((m) => [m.id, m.zone, m.from, m.to, codeSize(m.code)]), st.plan.pace]);

  // a) Bac à sable.
  P.start("check", STEP.check);
  const vetted = vet(ctx.plan);
  let refused = vetted.refused;
  for (const r of refused) log(`moment « ${r.id} » refusé : ${r.why.join(" ; ")}`);
  let st = await verify(vetted.plan, false);
  // Une erreur moteur se règle avant de regarder (rien à relire sur une page cassée) ; sans relecture possible
  // (retouche, édition à la main), tout se règle avant la planche, qui n'est alors faite qu'une fois.
  const canReview = !!ctx.review && R.review !== false;
  if (st.blocking.engine.length || (!canReview && !clean(st))) st = await settle(st);
  prune(st);
  let shots = await board(st);

  // e) Relecture par Claude.
  const findings = [...(ctx.findings || []).filter((f) => f.severity === "review"), ...vetted.advice, ...st.advice];
  const faulty = Object.entries(st.blocking.moments).map(([id, fs]) => ({ id, brief: st.plan.video.moments.find((m) => m.id === id)?.brief || id, why: [reasonOf(fs)] }));
  const worth = st.plan.video.moments.length > 0 || refused.length > 0 || faulty.length > 0 || findings.length > 0;
  const within = Date.now() - (ctx.startedAt || t0) < R.reviewWithinMin * 60_000;
  let reviewed = false;
  if (canReview && worth && within && shots?.sheet) {
    const flags = await io.claudeFlags(cfg);
    if (!flags.ok) note(flagsNote(flags.why));
    else {
      P.start("review", STEP.review);
      const patch = await reviewVideo(cfg, ctx, { st, shots, findings, refused: [...refused, ...faulty], note });
      const changes = patch && ((patch.beats || []).length > 0 || (patch.moments || []).some((m) => m.action !== "keep"));
      const said = patch?.notes ? `Relecture : ${String(patch.notes).trim()}` : "";
      if (!changes) note(said);
      else {
        P.step(STEP.recheck);
        const r = await recheck(st, patch);
        if (r) {
          st = r.st;
          reviewed = true;
          note(said);
          r.next.fixes.forEach(note);
          fresh = new Set([...fresh, ...r.next.fresh]);
          // Les refusés d'avant que la relecture n'a pas remplacés restent retirés (et notés), plus les nouveaux refus.
          const seen = new Set();
          refused = [...refused.filter((x) => !r.next.fresh.has(x.id)), ...r.v2.refused].filter((x) => !seen.has(x.id) && seen.add(x.id));
        }
        // Sinon : st reste la version d'avant, telle qu'elle a été vérifiée (son dossier est intact).
      }
    }
  }
  if (!reviewed && P.phase !== "review") P.drop("review");
  // Le détail du refus est au journal (vet) et dans le prompt de relecture ; la note dit la raison en clair.
  for (const r of refused) { if (!removed.has(r.id) && r.id) { removed.set(r.id, r.why.join(" ; ")); note(`L'animation sur mesure « ${r.brief || r.id} » a été retirée : ${plainRefusal(r.why)}.`); } }

  /**
   * La relecture revérifiée (un seul tour). Renvoie { st, next, v2 } si elle est gardée, null si la version d'avant
   * l'est. Une nouvelle erreur du moteur (ou un échec de la vérification) écarte toute la relecture. Un moment écrit
   * par la relecture qui casse reprend sa version d'avant (déjà vérifiée), ou est retiré s'il n'en avait pas, et la
   * page est revérifiée une fois.
   */
  async function recheck(before, patch) {
    const back = (why) => { note(`La correction de la relecture ${why} : la version d'avant est gardée.`); return null; };
    const noted = (why) => { log(`relecture : ${why}`); return back("provoquait une erreur"); };
    try {
      const next = applyPatch(before.plan, patch, refused);
      const v2 = vet(next.plan);
      v2.refused.forEach((x) => log(`moment « ${x.id} » refusé après relecture : ${x.why.join(" ; ")}`));
      // Un moment qui bloquait au premier check et que la relecture n'a pas remplacé est retiré tout de suite :
      // une vérification de moins (il serait retiré juste après de toute façon).
      const stale = Object.keys(before.blocking.moments).filter((id) => !next.fresh.has(id) && v2.plan.video.moments.some((m) => m.id === id));
      const p2 = stale.length ? dropMoments(v2.plan, stale, (m) => reasonOf(before.blocking.moments[m.id]), PLAIN.runtime) : v2.plan;
      let st2 = await verify(p2, before.safe);
      const added = (s) => Object.keys(s.blocking.moments).filter((id) => !before.blocking.moments[id]);
      if (st2.blocking.engine.length) return noted(`écartée : ${reasonOf(st2.blocking.engine)}`);
      const broke = added(st2);
      if (broke.length) {
        const prev = new Map(before.plan.video.moments.filter((m) => !before.blocking.moments[m.id]).map((m) => [m.id, m]));
        const kept = new Set(st2.plan.video.beats.filter((b) => !b.cut).map((b) => b.id));
        const moments = st2.plan.video.moments.flatMap((m) => {
          if (!broke.includes(m.id)) return [m];
          const old = prev.get(m.id);
          const why = reasonOf(st2.blocking.moments[m.id]);
          log(`moment « ${m.id} » après relecture : ${why}`);
          if (old && kept.has(old.from) && kept.has(old.to)) { note(`La correction de l'animation « ${m.brief || m.id} » provoquait une erreur : la version d'avant est gardée.`); next.fresh.delete(m.id); return [old]; }
          removed.set(m.id, why);
          note(`L'animation sur mesure « ${m.brief || m.id} » a été retirée : ${PLAIN.runtime}.`);
          return [];
        });
        st2 = await verify({ ...st2.plan, video: { ...st2.plan.video, moments } }, before.safe);
        if (st2.blocking.engine.length || added(st2).length) return noted(`écartée au second essai : ${reasonOf([...st2.blocking.engine, ...Object.values(st2.blocking.moments).flat()])}`);
      }
      return { st: st2, next, v2 };
    } catch (e) {
      if (signal?.aborted || e.code === "CHROME") throw e;
      log(`relecture non appliquée : ${e.message}`);
      return back("n'a pas pu être appliquée");
    }
  }

  // f) La page qui sera rendue est vérifiée, et la planche lui correspond.
  if (!clean(st)) { P.step(STEP.recheck); st = await settle(st); }
  prune(st);
  if (!shots || shots.key !== keyOf(st)) shots = (await board(st)) || shots;

  // g) Rendu, avec repli.
  const silent = join(ctx.dir, "muet.mp4");
  let rendered = null, summary = null, frameMs = 0, relaunched = false;
  for (let rung = 0; rung < 4 && !rendered; rung++) {
    stopIfAborted(signal);
    prune(st);
    // Les repères envoyés au Studio suivent la page qui sera rendue (relecture, retouche, replis).
    P.beats(st.stage.marks);
    const frames = Math.round(st.stage.duration * FPS);
    const timeoutMs = HF.renderTimeout(frames, R.maxFrameMs);
    P.start("render", `Rendu : image 0 sur ${frames}`);
    P.setFrames(frames);
    const tr = Date.now();
    try {
      summary = await io.render(cfg, st.dir, silent, { signal, timeoutMs, onFrame: (i, n) => { if (n > 0) P.frames(i, n); } });
      rendered = st;
      frameMs = (Date.now() - tr) / Math.max(1, frames);
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e.code === "TIMEOUT") throw new Error(`Le rendu a dépassé ${fmtDelay(timeoutMs)} et a été arrêté (${frames} images). Le Mac est peut-être trop chargé : réessaie.`);
      // Chrome qui ne démarre pas n'est pas la faute de la page : même page relancée une fois, sinon erreur claire.
      if (HF.LAUNCH_FAILURE.test(String(e.message))) {
        if (relaunched) throw Object.assign(new Error(HF.chromeDown(e.message)), { code: "CHROME" });
        relaunched = true;
        log(`rendu : Chrome n'a pas démarré (${String(e.message).replace(/\s+/g, " ").slice(-200)}) : nouvel essai`);
        rung--;
        continue;
      }
      log(`rendu refusé (${String(e.message).slice(0, 300)})`);
      const built = st.plan.video.moments.filter((m) => st.stage.momentIds.includes(m.id));
      const freshBuilt = built.filter((m) => fresh.has(m.id));
      let next;
      if (freshBuilt.length && freshBuilt.length < built.length) {
        P.step(STEP.noFresh);
        next = await verify(dropMoments(st.plan, freshBuilt.map((m) => m.id), () => `rendu refusé : ${String(e.message).replace(/\s+/g, " ").slice(-160)}`, PLAIN.render), st.safe);
      } else if (built.length) {
        P.step(STEP.noFresh);
        next = await verify(dropMoments(st.plan, built.map((m) => m.id), () => `rendu refusé : ${String(e.message).replace(/\s+/g, " ").slice(-160)}`, PLAIN.render), st.safe);
      } else if (!st.safe) {
        P.step(STEP.safe);
        note("Le rendu a échoué une première fois : la vidéo sort dans une version plus simple (enchaînements sobres).");
        next = await verify(st.plan, true);
      } else {
        throw new Error(`Le rendu de la vidéo a échoué (${String(e.message).replace(/\s+/g, " ").slice(-300)}).`);
      }
      st = await settle(next);
    }
  }
  if (!rendered) throw new Error("Le rendu de la vidéo a échoué après tous les replis.");
  st.stageNotes.forEach(note);

  // Finition et contrôle.
  const D = st.stage.duration;
  P.start("finish", STEP.finish);
  const out = join(ctx.dir, "reel.mp4");
  const fin = await finish(cfg, st.plan, silent, out, D, notes, signal);
  rmSync(silent, { force: true });
  await probe(out, D, signal);
  P.fraction(1);

  // Le texte au plancher devient une note pour Antoine.
  const titleOf = new Map(st.plan.video.beats.map((b) => [b.id, b.title || b.id]));
  for (const a of st.advice) {
    const id = String(a.target || "").startsWith("beat:") ? a.target.slice(5) : null;
    if (id && ["texte_trop_long", "text_box_overflow", "hors_zone"].includes(a.code)) note(`Le texte du temps fort « ${titleOf.get(id) || id} » dépasse : raccourcis-le ou demande à Claude.`);
  }

  const plan = renderedPlan(st);
  prune();
  log(`vidéo rendue : ${D.toFixed(2)} s, ${plan.video.moments.length} moment(s), ${st.safe ? "mode sûr, " : ""}${checks} vérification(s), finition ${fin.copy ? "sans réencodage" : "réencodée"}, ${((Date.now() - t0) / 1000).toFixed(0)} s (${summary?.summary || "sans résumé"})`);
  return { video: out, duration: D, plan, notes, safe: st.safe, stats: { checks, summary, frames: Math.round(D * FPS), frameMs: Math.round(frameMs * 10) / 10, reviewed, copy: fin.copy } };
}

/** Le plan rendu : temps forts avec start/end du moteur, moments gardés avec leur code, look sans logo, outils. */
export function renderedPlan(st) {
  const p = st.plan;
  const at = new Map(st.stage.marks.map((m) => [m.id, m]));
  const beats = p.video.beats.map((b) => {
    const rest = { ...b };
    delete rest.start;
    delete rest.end;
    const m = at.get(b.id);
    return m && !b.cut ? { ...rest, start: m.start, end: m.end } : rest;
  });
  return {
    scenes: [],
    look: { ...p.look, logo: "" },
    logo: p.logo !== false,
    music: p.music !== false,
    volume: p.volume ?? 0.7,
    track: p.track || "",
    ...(p.cue ? { cue: p.cue } : {}),
    texts: p.texts || [],
    pace: p.pace,
    duration: st.stage.duration,
    video: { ...p.video, beats, moments: st.safe ? [] : p.video.moments, tools: { ...TOOLS } },
  };
}

/** Applique la relecture : applyReview, puis cleanScore avec la version d'avant pour base. Un moment refusé ne revient que remplacé. */
export function applyPatch(plan, patch, refused = []) {
  const base = plan.video;
  const refusedIds = new Set(refused.map((r) => r.id));
  const withRefused = { ...base, moments: [...base.moments, ...refused.filter((r) => r.moment && !base.moments.some((m) => m.id === r.id)).map((r) => r.moment)] };
  const r = applyReview(withRefused, patch);
  const fresh = new Set(r.fresh || []);
  const video = { ...r.video, moments: (r.video.moments || []).filter((m) => !refusedIds.has(m.id) || fresh.has(m.id)) };
  const c = cleanScore(video, { target: base.target, pace: plan.pace, base, seed: base.seed });
  return { plan: { ...plan, pace: c.pace || plan.pace, video: withMeta(c.video, base) }, fresh, fixes: c.fixes || [] };
}

/** e) L'appel de relecture : dossier review/ avec la planche, les images et les constats ; Read restreint ; 4 min. */
async function reviewVideo(cfg, ctx, { st, shots, findings, refused, note }) {
  const R = reelCfg(cfg);
  const dir = join(ctx.dir, "review");
  rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  copyFileSync(shots.sheet, join(dir, "contact-sheet.jpg"));
  shots.files.forEach((f, i) => copyFileSync(f, join(dir, `frame-${String(i).padStart(2, "0")}.png`)));
  const lines = [...findings.map((f) => `${f.target} : ${f.message}`), ...refused.map((r) => `moment ${r.id} refusé : ${r.why.join(" ; ")}`)];
  writeFileSync(join(dir, "constats.txt"), lines.join("\n") || "aucun constat");
  const prompt = reviewPrompt({ video: st.plan.video, marks: st.stage.marks, duration: st.stage.duration, frames: shots.frames, findings, refused, look: st.plan.look });
  try {
    return await io.askStream(cfg, prompt, REVIEW_SCHEMA, dir, { tools: "Read", timeoutMs: R.claudeReviewMin * 60_000, signal: ctx.signal, what: "review" });
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    log(`relecture en images sautée : ${e.message}`);
    note(e.code === "TIMEOUT" ? "Claude n'a pas eu le temps de relire les images : la vidéo sort telle qu'il l'a écrite." : e.code === "LIMIT" ? `Relecture en images sautée : ${String(e.message).slice(0, 200)}` : "La relecture en images n'a pas pu se faire : la vidéo sort telle que Claude l'a écrite.");
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
