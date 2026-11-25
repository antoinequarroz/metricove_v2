#!/usr/bin/env node
// Rendu d'une fixture du reel vidéo par le moteur seul, sans Claude (paquet A, plan de test 2) :
//   node test/reel-render.mjs test/fixtures/reel/<f>.json <dossier de sortie> [--twice] [--no-render] [--keep]
// Étapes : partition (cleanScore si la fixture n'a que `raw`), bac à sable (checkMoment, sauf `sandbox: false`),
// (expect : dropped = ids retirés par check, built = ids construits, why = { id: "expression" } raison du retrait)
// stagePage, `hyperframes lint`, `hyperframes check` (un moment fautif est retiré et la page réécrite, comme produce()),
// images aux instants posés et au milieu des liaisons + planche maison (sheet.jpg), rendu mp4 avec délai et arrêt du
// groupe de processus, piste son muette, ffprobe, puis (--twice) un second rendu comparé image par image (framemd5).
// Vérifie aussi : aucune ligne « Fetched … » (aucune police téléchargée par HyperFrames), aucun Chrome orphelin, et
// affiche les ms par image. Sortie : un résumé lisible puis une ligne JSON. Code de sortie 1 si une vérification échoue
// (sauf `expect.fail` : la fixture doit échouer proprement).
//
// Réglages : config.json du worker (gsapDir, fontsDir, workDir), ou les variables GSAP_DIR, FONTS_DIR, REEL_WORK.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, run } from "../lib/util.mjs";
import * as HF from "../lib/reel/hf-cli.mjs";
import { checkMoments } from "../lib/reel/sandbox.mjs";
import { cleanScore, timeScore } from "../lib/reel/score.mjs";
import { stagePage } from "../lib/reel/stage.mjs";
import { FPS, H, HF_PACKAGE, RHYTHM, TOOLS, W } from "../lib/reel/vocab.mjs";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [fixtureFile, outArg] = args.filter((a) => !a.startsWith("--"));
if (!fixtureFile || !outArg) {
  console.error("usage : node test/reel-render.mjs test/fixtures/reel/<f>.json <dossier de sortie> [--twice] [--no-render] [--keep]");
  process.exit(2);
}
const out = resolve(outArg);
const fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
const name = fixtureFile.replace(/^.*\//, "").replace(/\.json$/, "");

let base = {};
try { base = loadConfig(); } catch { base = {}; }
const cfg = {
  ...base,
  gsapDir: process.env.GSAP_DIR || base.gsapDir,
  gsapFile: process.env.GSAP_DIR ? "" : base.gsapFile,
  fontsDir: process.env.FONTS_DIR || base.fontsDir,
  workDir: process.env.REEL_WORK || base.workDir,
};

const fails = [];
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const fail = (s) => { fails.push(s); say(`ÉCHEC : ${s}`); };
const f3 = (n) => Number(n).toFixed(3);
const sum = { fixture: name };

/** Le plan rendu : fixture.plan, ou un ReelPlan fait de raw (cleanScore) et du look du job. */
function planOf() {
  if (fixture.plan) return JSON.parse(JSON.stringify(fixture.plan));
  const job = fixture.job?.motion || {};
  const c = cleanScore(fixture.raw, fixture.options || {});
  const t = timeScore(c.video, { pace: c.pace });
  return {
    scenes: [], look: { ...(job.look || {}), logo: job.look?.logo || "" }, logo: !!job.logo, music: job.music !== false, volume: 0.7, track: "", texts: [],
    pace: c.pace, duration: t.duration, video: { ...t.video, tools: { ...TOOLS } },
  };
}

/** Nombre de Chrome sans tête vivants (orphelins après un échec). */
/** Marque posée dans l'environnement des rendus de ce lancement : Chrome en hérite, ce qui permet de compter ses
 * processus à lui (d'autres rendus peuvent tourner en même temps sur la machine). */
const TAG = `REEL_RENDER_TAG=${process.pid}-${Date.now()}`;

/** Processus Chrome de ce lancement (Linux : /proc/<pid>/environ) ; ailleurs, tous les chrome-headless. */
async function chromes() {
  if (existsSync("/proc/self/environ")) {
    let n = 0;
    for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        if (readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(TAG) && /chrom/i.test(readFileSync(`/proc/${pid}/cmdline`, "latin1"))) n++;
      } catch { /* processus disparu ou illisible */ }
    }
    return n;
  }
  try { return Number((await run("pgrep", ["-c", "-f", "chrome-headless"], { codes: [1], timeoutMs: 5000 })).trim()) || 0; } catch { return 0; }
}

/** Planche maison : 6 images par ligne, 360 px de large, l'instant écrit sous chaque image. */
async function sheet(files, times, file) {
  const n = files.length, cols = Math.min(6, n), rows = Math.ceil(n / cols);
  const inputs = files.flatMap((f) => ["-i", f]);
  const tiles = files.map((_, i) => `[${i}:v]scale=360:640,drawbox=x=0:y=600:w=360:h=40:color=black@0.6:t=fill,drawtext=text='${f3(times[i])} s':x=12:y=610:fontsize=22:fontcolor=white[t${i}]`);
  const pad = [];
  for (let i = n; i < rows * cols; i++) pad.push(`color=c=black:s=360x640:d=1[t${i}]`);
  const rowsF = Array.from({ length: rows }, (_, r) => `${Array.from({ length: cols }, (_, c) => `[t${r * cols + c}]`).join("")}hstack=inputs=${cols}[r${r}]`);
  const all = rows > 1 ? `${Array.from({ length: rows }, (_, r) => `[r${r}]`).join("")}vstack=inputs=${rows}[o]` : "[r0]null[o]";
  const filter = [...tiles, ...pad, ...rowsF, all].join(";");
  try {
    await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[o]", "-frames:v", "1", "-q:v", "3", file], { timeoutMs: 60_000 });
  } catch {
    // drawtext indisponible (ffmpeg sans freetype) : la même planche sans les instants.
    const plain = filter.replace(/,drawbox=[^[]*/g, "");
    await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", plain, "-map", "[o]", "-frames:v", "1", "-q:v", "3", file], { timeoutMs: 60_000 });
  }
  return file;
}

/** Rendu HyperFrames (sans --quiet), avec délai : { file, lines, ms }. */
async function renderOnce(hf, file, timeoutMs) {
  const log = [];
  const t0 = Date.now();
  rmSync(file, { force: true });
  await run("npx", ["--yes", HF_PACKAGE, "render", "--format", "mp4", "--fps", String(FPS), "--workers", "1", "-o", file, "."], { cwd: hf, env: { ...HF.hfEnv(cfg), [TAG.split("=")[0]]: TAG.split("=")[1] }, timeoutMs, onLine: (l) => log.push(l), keep: 512 * 1024 });
  if (!existsSync(file)) throw new Error("aucune vidéo produite");
  return { file, lines: log, ms: Date.now() - t0 };
}

async function framemd5(file) {
  const o = await run("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v", "-f", "framemd5", "-"], { timeoutMs: 120_000, keep: 16 * 1024 * 1024 });
  return o.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop().trim());
}

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  mkdirSync(cfg.workDir, { recursive: true });
  const before = await chromes();
  let plan = planOf();

  // a) Bac à sable (sauf fixture du piège, où le filtre statique est volontairement coupé).
  if (fixture.sandbox !== false) {
    const r = checkMoments(plan.video.moments || []);
    for (const x of r.refused) say(`moment « ${x.id} » refusé par le bac à sable : ${x.why.join(" ; ")}`);
    plan.video.moments = r.kept;
    sum.refused = r.refused.map((x) => x.id);
  } else say("bac à sable statique coupé (fixture du piège) : le code passe tel quel");

  // b) et c) : stagePage, lint, check ; un moment fautif est retiré et la page réécrite.
  const hf = join(out, "hf");
  let stage, notes = [], dropped = [];
  const why = {}; // id du moment → messages de check qui l'ont retiré
  for (let round = 0; round < 4; round++) {
    rmSync(hf, { recursive: true, force: true });
    mkdirSync(hf, { recursive: true });
    notes = [];
    stage = await stagePage(cfg, plan, hf, { notes });
    const l = await HF.lint(cfg, hf);
    if (l.blocking.length) { fail(`lint : ${l.blocking.map((f) => f.message).join(" | ")}`); break; }
    const t0 = Date.now();
    const c = await HF.check(cfg, hf);
    sum.checkMs = Date.now() - t0;
    // Comme produce() : les constats de place pendant une liaison ne comptent pas (HF.heldOnly).
    sum.advice = HF.heldOnly(c.advice, stage.marks, stage.settle, (RHYTHM[plan.pace] || RHYTHM.normal).bridge).map((f) => `${f.code} ${f.target}${f.message ? ` : ${String(f.message).slice(0, 160)}` : ""}`);
    const b = HF.blame(c.blocking, stage.momentIds);
    for (const f of c.blocking) say(`check : ${f.code} ${f.target} — ${f.message}`);
    const faulty = Object.keys(b.moments);
    for (const id of faulty) (why[id] ||= []).push(...b.moments[id].map((f) => String(f.message || "")));
    if (b.engine.length) { fail(`check (moteur) : ${b.engine.map((f) => f.message).join(" | ").slice(0, 400)}`); break; }
    if (!faulty.length) break;
    dropped.push(...faulty);
    plan = { ...plan, video: { ...plan.video, moments: plan.video.moments.filter((m) => !faulty.includes(m.id)) } };
    say(`moment(s) retiré(s) après check : ${faulty.join(", ")} ; page réécrite`);
  }
  sum.duration = stage.duration;
  sum.momentIds = stage.momentIds;
  sum.dropped = dropped;
  sum.notes = notes;
  for (const n of notes) say(`note : ${n}`);
  for (const id of fixture.expect?.dropped || []) if (!dropped.includes(id)) fail(`le moment « ${id} » devait être retiré par check`);
  for (const id of fixture.expect?.built || []) if (!stage.momentIds.includes(id)) fail(`le moment « ${id} » devait être construit`);
  // expect.why : { id: "expression" } — le moment est retiré pour cette raison-là (pas par accident).
  for (const [id, re] of Object.entries(fixture.expect?.why || {})) {
    if (!(why[id] || []).some((m) => new RegExp(re).test(m))) fail(`le moment « ${id} » n'a pas été retiré pour la raison attendue (${re}) : ${(why[id] || []).join(" | ") || "aucun message"}`);
  }
  sum.why = why;

  // d) Images aux instants posés et au milieu des liaisons, planche maison.
  const B = { calm: 0.9, normal: 0.7, fast: 0.5 }[plan.pace] || 0.7;
  const times = [];
  stage.marks.forEach((m, i) => {
    if (i) times.push(Math.max(0, m.start - 0.25 * B));
    times.push(stage.settle[i]);
  });
  times.push(Math.max(0, stage.duration - 1 / FPS));
  const shots = await HF.snapshot(cfg, hf, times);
  sum.sheet = await sheet(shots, times, join(out, "sheet.jpg"));
  say(`planche : ${sum.sheet}`);

  if (flags.has("--no-render")) return;

  // e) Rendu, avec délai et arrêt du groupe de processus.
  const frames = Math.round(stage.duration * FPS);
  const R = fixture.render || {};
  const timeoutMs = (R.baseMs ?? 120_000) + frames * (R.maxFrameMs ?? 400);
  const silent = join(out, "silent.mp4");
  let first, peak = 0;
  // Pendant le rendu : le nombre de Chrome de ce lancement (pour savoir si le contrôle des orphelins prouve quelque chose).
  const sampler = setInterval(() => { chromes().then((n) => { peak = Math.max(peak, n); }); }, 300);
  try {
    first = await renderOnce(hf, silent, timeoutMs);
  } catch (e) {
    clearInterval(sampler);
    await new Promise((r) => setTimeout(r, 4000)); // SIGKILL du groupe 3 s après SIGTERM
    const after = await chromes();
    sum.renderError = e.message;
    sum.orphans = Math.max(0, after - before);
    sum.chromePeak = peak;
    say(`rendu interrompu : ${e.message} (Chrome de ce lancement : avant ${before}, au plus fort ${peak}, après ${after})`);
    if (!peak) say("attention : Chrome n'avait pas démarré, le contrôle des orphelins ne prouve rien (allonger render.baseMs)");
    if (after > before) fail(`${after - before} Chrome orphelin(s) après l'échec du rendu`);
    if (!fixture.expect?.fail) fail(`rendu : ${e.message}`);
    else if (!/délai|temps|timeout|TIMEOUT|dépass/i.test(e.message) && e.code !== "TIMEOUT") fail(`l'échec n'est pas un délai dépassé : ${e.message}`);
    return;
  }
  clearInterval(sampler);
  if (fixture.expect?.fail) fail("le rendu devait échouer (délai) et il a réussi");
  sum.msPerFrame = Math.round(first.ms / frames);
  const fetched = first.lines.filter((l) => /Fetched/.test(l));
  if (fetched.length) fail(`HyperFrames a téléchargé quelque chose : ${fetched[0].slice(0, 160)}`);

  // f) Piste son muette (aac), faststart, puis ffprobe.
  const final = join(out, `${name}.mp4`);
  await run("ffmpeg", ["-v", "error", "-y", "-i", silent, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f3(stage.duration), "-movflags", "+faststart", final], { timeoutMs: 120_000 });
  const pj = JSON.parse(await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames", "-of", "json", final], { timeoutMs: 20_000 }));
  const v = pj.streams.find((s) => s.codec_type === "video"), a = pj.streams.filter((s) => s.codec_type === "audio");
  sum.video = { file: final, width: v?.width, height: v?.height, fps: v?.r_frame_rate, frames: Number(v?.nb_frames), audio: a.map((s) => s.codec_name) };
  if (!v || v.width !== W || v.height !== H) fail(`taille ${v?.width}×${v?.height}`);
  if (v?.r_frame_rate !== `${FPS}/1`) fail(`cadence ${v?.r_frame_rate}`);
  if (Math.abs(Number(v?.nb_frames) - frames) > 1) fail(`${v?.nb_frames} images au lieu de ${frames}`);
  if (a.length !== 1 || a[0].codec_name !== "aac") fail("piste son aac absente");
  say(`vidéo : ${final} (${v?.width}×${v?.height}, ${v?.r_frame_rate}, ${v?.nb_frames} images, ${sum.msPerFrame} ms par image)`);

  // g) Déterminisme : un second rendu, image par image.
  if (flags.has("--twice")) {
    const second = await renderOnce(hf, join(out, "silent-2.mp4"), timeoutMs);
    const [h1, h2] = [await framemd5(first.file), await framemd5(second.file)];
    const diff = h1.findIndex((h, i) => h !== h2[i]);
    sum.deterministic = diff < 0 && h1.length === h2.length;
    if (!sum.deterministic) fail(`deux rendus différents (première image différente : ${diff})`);
    else say(`déterminisme : ${h1.length} images identiques sur deux rendus`);
    if (!flags.has("--keep")) rmSync(second.file, { force: true });
  }
  if (!flags.has("--keep")) rmSync(silent, { force: true });
  const after = await chromes();
  if (after > before) fail(`${after - before} Chrome orphelin(s) après le rendu`);
}

try {
  await main();
} catch (e) {
  fail(e.message);
}
sum.ok = !fails.length;
sum.fails = fails;
writeFileSync(join(out, "summary.json"), `${JSON.stringify(sum, null, 2)}\n`);
console.log(JSON.stringify(sum));
process.exit(fails.length ? 1 : 0);
