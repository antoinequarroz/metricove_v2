#!/usr/bin/env node
// Vérifie un passage du worker contre le faux Metricove (test/mock-server.mjs, MOCK=video), ou le lance d'abord ;
// ou vérifie les routes du VRAI serveur (scénario server).
//
//   node test/check-video-run.mjs <dossier-sortie>
//       vérifie un passage déjà fait (state.json, patches.jsonl, reel-vN.json… écrits par le faux serveur) ;
//   node test/check-video-run.mjs --run [scénario] [--root /tmp/mc] [--out <dossier>] [--port 3999] [--fake] [--minutes N] [--gsap <dist>]
//       prépare le bac à sable (dossiers, piste de musique, Chrome hors ligne, config dérivée de test/config.sandbox.json),
//       lance le faux serveur puis le worker (node montage.mjs), attend la fin du scénario, arrête tout et vérifie.
//       claude.bin est toujours le claude-spy.sh de ce dossier ; --gsap : le dossier dist de gsap@3.14.2 (npm pack), par
//       défaut gsapDir de config.sandbox.json (le scénario refuse de tourner sans gsap.min.js).
//       --minutes : délai du scénario ; par défaut suite 30 min avec --fake et 45 min avec le vrai Claude (une suite
//       réelle dure plus de 30 min sur un conteneur Linux), les autres 15 min avec --fake et 20 min sans.
//   node test/check-video-run.mjs --run server [--server http://localhost:3000] [--token <API_TOKEN>] [--slow] [--out <dossier>]
//       joue le Mac et la page contre un vrai Metricove (pnpm dev) : porte de version de claimJob, identité du passage
//       (`run`), écritures tardives d'un passage arrêté refusées (409), regen, stop, espaces insécables, code jamais
//       renvoyé à la page ; --slow ajoute le silence du Mac (deux attentes de 50 s). Il refuse de tourner (code 2) si
//       la file du serveur n'est pas vide ou si un autre worker l'interroge ; il supprime ce qu'il crée.
//
// Scénarios : suite (défaut : v1 → retouche → v2 → édition à la main → aperçu → régénération), short, stop, stop-regen, oldserver,
// evil, claude-timeout, old, legacy (voir videoMock() dans mock-server.mjs), server. --fake : faux Claude (CLAUDE_FAKE=1,
// joue la partition de la fixture score-basic) au lieu du vrai, qui coûte de l'argent. claude-timeout passe toujours par
// un faux Claude qui ne répond jamais (CLAUDE_FAKE=slow) : seul le délai et l'arrêt du groupe de processus comptent.
// old ne vérifie que la porte du FAUX serveur (auto-test du faux serveur, qui compare les versions avec
// src/lib/worker-version.ts quand Node sait le lire) : la porte réelle (claimJob) se vérifie avec server.
// Code de sortie : 0 si tout passe, 1 sinon (2 : scénario server non lancé). Le résumé va aussi dans <dossier>/check.json.
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTORS, BEAT_ID, BRIDGES, CAMERAS, ENGINE, FPS, HYPERFRAMES, LAYOUTS, MOMENT_ID, SHAPES, SOURCES, TARGETS, VIDEO_WORKER, ZONES } from "../lib/reel/vocab.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(HERE, "..");
const PHASES = ["write", "check", "review", "render", "finish", "upload"];
const SCENARIOS = ["suite", "short", "stop", "stop-regen", "oldserver", "evil", "claude-timeout", "old", "legacy", "server"];
/** Scénarios où le worker rend une vidéo par le chemin vidéo (Chrome hors ligne attendu). */
const VIDEO_RUNS = ["suite", "short", "stop", "stop-regen", "oldserver", "evil", "claude-timeout"];
/** Le drapeau que chrome-offline.sh (node montage.mjs --setup-reel) ajoute à Chrome. */
const OFFLINE_FLAG = "--host-resolver-rules=MAP * ~NOTFOUND";
const ENV_OF = { stop: { STOP: "1" }, "stop-regen": { STOP_REGEN: "1" }, oldserver: { OLDSERVER: "1" }, evil: { EVIL: "1" }, "claude-timeout": { CLAUDE_TIMEOUT: "1" }, old: { OLD: "1" }, legacy: { LEGACY: "1" }, short: { SUITE: "short" }, suite: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log("[check]", ...a);

/* ---------- Lecture du dossier de sortie ---------- */

const readJson = (f, fallback = undefined) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fallback; } };
const readJsonl = (f) => { try { return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
/** Les prompts notés par claude-spy.sh (CLAUDE_PROMPT_LOG) : [{ at, cwd, text }], dans l'ordre des appels. */
const readPrompts = (f) => {
  let raw = "";
  try { raw = readFileSync(f, "utf8"); } catch { return []; }
  return raw.split(/^=== CLAUDE-PROMPT /m).filter(Boolean).map((chunk) => {
    const nl = chunk.indexOf("\n");
    const [at, ...cwd] = chunk.slice(0, nl).split(" ");
    return { at, cwd: cwd.join(" "), text: chunk.slice(nl + 1) };
  });
};

/** ffprobe d'un mp4 : { ok, why, frames, width, height, fps, aac, h264 }. */
function probe(file, duration) {
  if (!existsSync(file)) return { ok: false, why: `${file} absent` };
  let j;
  try {
    j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,nb_read_packets", "-of", "json", file], { encoding: "utf8", timeout: 30_000 }));
  } catch (e) { return { ok: false, why: `ffprobe : ${String(e.message).slice(0, 200)}` }; }
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  const a = (j.streams || []).find((s) => s.codec_type === "audio");
  if (!v) return { ok: false, why: "pas de piste vidéo" };
  const [num, den] = String(v.r_frame_rate || "0/1").split("/").map(Number);
  const fps = den ? num / den : 0;
  const frames = Number(v.nb_frames || v.nb_read_packets || 0);
  const want = Math.round(duration * FPS);
  const out = { frames, want, width: v.width, height: v.height, fps, h264: v.codec_name === "h264", aac: a?.codec_name === "aac" };
  const why = [
    !out.h264 && `codec ${v.codec_name}`,
    (v.width !== 1080 || v.height !== 1920) && `${v.width}×${v.height}`,
    Math.abs(fps - 30) > 0.01 && `${fps} i/s`,
    Math.abs(frames - want) > 1 && `${frames} images au lieu de ${want}`,
    !out.aac && "pas de piste aac",
  ].filter(Boolean);
  return { ...out, ok: !why.length, why: why.join(", ") };
}

/** Dimensions d'une image (ffprobe) ou null si illisible. */
function imageSize(file) {
  try {
    const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height,codec_name", "-of", "json", file], { encoding: "utf8", timeout: 20_000 }));
    const s = j.streams?.[0];
    return s ? { w: s.width, h: s.height, codec: s.codec_name } : null;
  } catch { return null; }
}

const PLAN_KEYS = new Set(["scenes", "look", "logo", "music", "volume", "track", "cue", "texts", "pace", "direction", "duration", "video"]);
const VIDEO_KEYS = new Set(["engine", "request", "source", "target", "direction", "title", "shape", "beats", "moments", "caption", "seed", "tools", "captions", "voiceOver", "motionStyle"]);
const BEAT_KEYS = new Set(["id", "title", "text", "sub", "items", "emphasis", "count", "layout", "bridge", "actor", "camera", "seconds", "fixed", "cut", "say", "start", "end"]);
const MOMENT_KEYS = new Set(["id", "brief", "from", "to", "zone", "code"]);
const unknown = (o, keys) => Object.keys(o || {}).filter((k) => !keys.has(k));
const sameish = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
/** Le JSON d'un temps fort sans ses temps (start/end bougent quand un temps fort ouvert change de durée). */
const bare = (b) => { const c = { ...b }; delete c.start; delete c.end; return JSON.stringify(c); };

/**
 * Forme d'un plan vidéo rendu par le Mac (POST /versions ou /versions/:n/preview), comme le contrat la décrit
 * (docs/MONTAGE.md « Reel vidéo continu ») et comme cleanVideo du serveur l'accepte. Renvoie la liste des écarts.
 */
function planProblems(plan) {
  const p = [];
  if (!plan || typeof plan !== "object") return ["plan absent"];
  const v = plan.video;
  if (!Array.isArray(plan.scenes) || plan.scenes.length) p.push("scenes ≠ []");
  if (!v) return [...p, "video absent"];
  if (unknown(plan, PLAN_KEYS).length) p.push(`champs inconnus du plan : ${unknown(plan, PLAN_KEYS)}`);
  if (unknown(v, VIDEO_KEYS).length) p.push(`champs inconnus de video : ${unknown(v, VIDEO_KEYS)}`);
  if (v.engine !== ENGINE) p.push(`engine ${v.engine}`);
  if (typeof plan.look?.logo === "string" && plan.look.logo.length > 0) p.push("le logo (data URL) est resté dans look");
  if (!SOURCES.includes(v.source)) p.push(`source ${v.source}`);
  if (v.target !== undefined && !TARGETS.includes(v.target)) p.push(`target ${v.target}`);
  if (!SHAPES.includes(v.shape)) p.push(`shape ${v.shape}`);
  if (!(typeof v.title === "string" && v.title.length && v.title.length <= 80)) p.push("title vide ou > 80");
  if (!(Number.isInteger(v.seed) && v.seed >= 0 && v.seed <= 0xffffffff)) p.push(`seed ${v.seed}`);
  if (v.tools?.worker !== VIDEO_WORKER || v.tools?.hyperframes !== HYPERFRAMES) p.push(`tools ${JSON.stringify(v.tools)}`);
  const beats = Array.isArray(v.beats) ? v.beats : [];
  if (beats.length < 3 || beats.length > 12) p.push(`${beats.length} temps forts (3 à 12)`);
  const ids = new Set();
  for (const b of beats) {
    if (unknown(b, BEAT_KEYS).length) p.push(`temps fort ${b.id} : champs inconnus ${unknown(b, BEAT_KEYS)}`);
    if (!BEAT_ID.test(b.id) || ids.has(b.id)) p.push(`id de temps fort ${b.id}`);
    ids.add(b.id);
    if (!LAYOUTS.includes(b.layout) || !BRIDGES.includes(b.bridge) || !ACTORS.includes(b.actor) || !CAMERAS.includes(b.camera)) p.push(`temps fort ${b.id} : vocabulaire inconnu`);
    if (!(b.text?.length > 0 && b.text.length <= 110) || !(b.title?.length > 0 && b.title.length <= 40)) p.push(`temps fort ${b.id} : texte ou titre hors bornes`);
    if (!(b.seconds >= 1.5 && b.seconds <= 10)) p.push(`temps fort ${b.id} : seconds ${b.seconds}`);
  }
  const kept = beats.filter((b) => !b.cut);
  if (kept.length < 2) p.push("moins de 2 temps forts gardés");
  let t = 0;
  for (const b of kept) {
    if (!Number.isFinite(b.start) || !Number.isFinite(b.end)) { p.push(`temps fort ${b.id} sans start/end`); break; }
    if (!sameish(b.start, t, 0.002) || !(b.end > b.start)) p.push(`temps fort ${b.id} : ${b.start}–${b.end} ne suit pas ${t}`);
    t = b.end;
  }
  for (const b of beats.filter((x) => x.cut)) if (b.start !== undefined || b.end !== undefined) p.push(`temps fort coupé ${b.id} avec start/end`);
  if (!(plan.duration >= 15 && plan.duration <= 60)) p.push(`durée ${plan.duration} s (15 à 60)`);
  if (Number.isFinite(t) && kept.length && !sameish(t, plan.duration, 1 / 30 + 1e-3)) p.push(`fin du dernier temps fort ${t} ≠ durée ${plan.duration}`);
  const moments = Array.isArray(v.moments) ? v.moments : [];
  if (moments.length > 3) p.push(`${moments.length} moments`);
  for (const m of moments) {
    if (unknown(m, MOMENT_KEYS).length) p.push(`moment ${m.id} : champs inconnus ${unknown(m, MOMENT_KEYS)}`);
    if (!MOMENT_ID.test(m.id)) p.push(`id de moment ${m.id}`);
    if (!ZONES.includes(m.zone)) p.push(`moment ${m.id} : zone ${m.zone}`);
    if (!ids.has(m.from) || !ids.has(m.to)) p.push(`moment ${m.id} : ${m.from}→${m.to} inconnus`);
    if (!m.code || typeof m.code.html !== "string" || typeof m.code.js !== "string") p.push(`moment ${m.id} sans code`);
  }
  return p;
}

/**
 * Les PATCH d'un passage du worker (même `_run`) : phases dans l'ordre, progression jamais en recul, temps restant,
 * images qui avancent, repères avant le rendu, durées des phases. Renvoie { problems, info }.
 */
function runProblems(patches, { kind, duration, keptIds, beatsOf }) {
  const p = [];
  const steps = patches.filter((x) => x.status === undefined);
  if (!steps.length) return { problems: ["aucun PATCH de progression"], info: {} };
  const missing = steps.filter((x) => typeof x.step !== "string" || typeof x.progress !== "number");
  if (missing.length) p.push(`${missing.length} PATCH sans step ou progress (un ancien serveur ne suivrait plus)`);
  // Phases dans l'ordre, jamais en arrière.
  const seq = [];
  for (const x of steps) if (x.phase && seq.at(-1) !== x.phase) seq.push(x.phase);
  const idx = seq.map((ph) => PHASES.indexOf(ph));
  if (idx.some((i) => i < 0)) p.push(`phase inconnue : ${seq}`);
  if (idx.some((i, k) => k && i <= idx[k - 1])) p.push(`phases dans le désordre : ${seq.join(" → ")}`);
  const first = kind === "edit" ? "check" : "write";
  if (seq[0] !== first) p.push(`première phase ${seq[0]} (attendu ${first})`);
  if (seq.at(-1) !== "upload") p.push(`dernière phase ${seq.at(-1)} (attendu upload)`);
  for (const need of ["check", "render", "finish", "upload"]) if (!seq.includes(need)) p.push(`phase ${need} absente`);
  const planned = steps.map((x) => x.phases).filter(Array.isArray).at(-1) || [];
  if (kind === "edit" && JSON.stringify(planned) !== JSON.stringify(["check", "render", "finish", "upload"])) p.push(`phases prévues d'une édition : ${planned}`);
  if (kind === "write" && planned.includes("review") !== seq.includes("review")) p.push(`review prévue ${planned.includes("review")} mais jouée ${seq.includes("review")}`);
  // Progression.
  const prog = steps.map((x) => x.progress).filter((x) => typeof x === "number");
  const back = prog.findIndex((x, k) => k && x < prog[k - 1] - 1e-9);
  if (back >= 0) p.push(`progression en recul : ${prog[back - 1]} → ${prog[back]}`);
  if (prog.some((x) => x < 0 || x > 1)) p.push("progression hors de 0..1");
  // Temps restant et images pendant le rendu.
  const render = steps.filter((x) => x.phase === "render");
  const etas = render.map((x) => x.eta).filter((x) => typeof x === "number");
  if (!etas.length) p.push("aucun temps restant (eta) pendant le rendu");
  else {
    const up = etas.findIndex((x, k) => k && x > etas[k - 1] + 10);
    if (up >= 0) p.push(`temps restant qui remonte pendant le rendu : ${etas[up - 1]} → ${etas[up]} s`);
    if (etas.length > 2 && !(etas.at(-1) < etas[0])) p.push(`temps restant qui ne descend pas pendant le rendu (${etas[0]} → ${etas.at(-1)} s)`);
  }
  if (steps.some((x) => x.eta !== undefined && !(x.eta >= 0 && x.eta <= 3600))) p.push("eta hors de 0..3600");
  const frames = render.map((x) => x.frames).filter((f) => Array.isArray(f) && f.length === 2);
  const want = Math.round(duration * FPS);
  if (!frames.length) p.push("aucune image comptée pendant le rendu");
  else {
    if (frames.some((f, k) => k && f[0] < frames[k - 1][0])) p.push("images rendues en recul");
    if (frames.some((f) => Math.abs(f[1] - want) > 1)) p.push(`total d'images ${[...new Set(frames.map((f) => f[1]))]} ≠ ${want}`);
    if (!(frames.at(-1)[0] > frames[0][0] || frames.length === 1)) p.push("les images rendues n'avancent pas");
  }
  // Repères connus avant le rendu, et les mêmes que la version rendue.
  const firstRender = steps.findIndex((x) => x.phase === "render");
  const beatsAt = steps.findIndex((x) => Array.isArray(x.beats) && x.beats.length);
  if (beatsAt < 0) p.push("repères (beats) jamais envoyés");
  else if (firstRender >= 0 && beatsAt > firstRender) p.push("repères envoyés après le début du rendu");
  const lastBeats = steps.map((x) => x.beats).filter((b) => Array.isArray(b) && b.length).at(-1) || [];
  if (keptIds && lastBeats.length) {
    if (JSON.stringify(lastBeats.map((b) => b.id)) !== JSON.stringify(keptIds)) p.push(`repères ${lastBeats.map((b) => b.id)} ≠ temps forts rendus ${keptIds}`);
    else if (beatsOf) for (const b of lastBeats) { const r = beatsOf.get(b.id); if (r && (!sameish(b.start, r.start, 0.05) || !sameish(b.end, r.end, 0.05))) p.push(`repère ${b.id} ${b.start}–${b.end} ≠ rendu ${r.start}–${r.end}`); }
  }
  // Durées réelles des phases finies.
  const done = steps.map((x) => x.done).filter(Array.isArray).at(-1) || [];
  if (!done.length) p.push("done jamais rempli");
  else if (!["write", "check"].filter((ph) => seq.includes(ph)).every((ph) => done.some((d) => d.phase === ph))) p.push(`done incomplet : ${done.map((d) => d.phase)}`);
  return { problems: p, info: { phases: seq.join(" → "), planned: planned.join(","), patches: steps.length, eta: etas.length ? `${etas[0]} → ${etas.at(-1)} s` : "—", frames: frames.length ? `${frames[0].join("/")} → ${frames.at(-1).join("/")}` : "—", done: done.map((d) => `${d.phase} ${Math.round(d.s)} s`).join(", ") } };
}

/* ---------- Vérifications ---------- */

function check(outDir, { orchestrator = {} } = {}) {
  const OUT = resolve(outDir);
  const state = readJson(join(OUT, "state.json"));
  const results = [];
  const ok = (cond, msg, detail) => { results.push({ ok: !!cond, msg, ...(detail ? { detail } : {}) }); console.log(`  ${cond ? "✔" : "✘"} ${msg}${detail && !cond ? ` — ${detail}` : detail ? ` (${detail})` : ""}`); };
  const info = (msg) => { results.push({ info: msg }); console.log(`  · ${msg}`); };
  if (!state) { ok(false, `state.json lisible dans ${OUT}`); return results; }
  const scenario = state.scenario;
  const patches = readJsonl(join(OUT, "patches.jsonl"));
  const events = readJsonl(join(OUT, "events.jsonl"));
  const claims = readJsonl(join(OUT, "claims.jsonl"));
  const boards = readJsonl(join(OUT, "boards.jsonl"));
  const finals = readJsonl(join(OUT, "final.jsonl"));
  const reelOf = (n) => readJson(join(OUT, `reel-v${n}.json`));
  const notesOf = (n) => { try { return readFileSync(join(OUT, `notes-v${n}.txt`), "utf8"); } catch { return ""; } };
  const t = (x) => (x / 1000).toFixed(0);
  console.log(`\nScénario ${scenario} — ${OUT}`);
  for (const l of state.timeline || []) info(`${t(l.t)} s ${l.what}`);
  if (orchestrator.timedOut) ok(false, `scénario fini avant ${orchestrator.minutes} min`, "délai dépassé");

  // Une vidéo n'arrive jamais par /final (repli réservé aux reels à scènes d'un ancien serveur).
  if (scenario !== "legacy") ok(!finals.length && !state.finals, "aucun appel à /final");

  /** Vérifie une version produite par le worker (plan + mp4 + planche + PATCH de son passage). */
  const version = (v, kind) => {
    const plan = reelOf(v.n);
    const probs = planProblems(plan);
    ok(!probs.length, `v${v.n} (${v.stage}) : plan vidéo conforme (scenes [], engine 1, temps forts contigus, ≤ 3 moments, champs connus)`, probs.slice(0, 6).join(" ; "));
    if (!plan?.video) return plan;
    const kept = plan.video.beats.filter((b) => !b.cut);
    info(`v${v.n} : « ${plan.video.title} », ${plan.duration} s, ${kept.length}/${plan.video.beats.length} temps forts (${kept.map((b) => `${b.layout}/${b.bridge}`).join(" ")}), ${plan.video.moments.length} moment(s), forme ${plan.video.shape}, rythme ${plan.pace}`);
    ok(v.notesChars <= 2000, `v${v.n} : notes ≤ 2000 caractères (${v.notesChars})`);
    const pr = probe(join(OUT, `apercu-v${v.n}.mp4`), plan.duration);
    ok(pr.ok, `v${v.n} : mp4 h264 1080×1920 30 i/s, ${pr.want} images ± 1, piste aac`, pr.ok ? `${pr.frames} images` : pr.why);
    const mine = patches.filter((x) => x._run === v.run);
    const r = runProblems(mine, { kind, duration: plan.duration, keptIds: kept.map((b) => b.id), beatsOf: new Map(kept.map((b) => [b.id, b])) });
    ok(!r.problems.length, `v${v.n} : progression (${r.info.phases || "?"} ; ${r.info.patches ?? 0} PATCH ; eta ${r.info.eta} ; images ${r.info.frames})`, r.problems.slice(0, 6).join(" ; "));
    if (r.info.done) info(`v${v.n} : durées réelles ${r.info.done}`);
    const bs = boards.filter((b) => b.run === v.run);
    const last = bs.at(-1);
    if (!last) ok(false, `v${v.n} : planche reçue`, "aucune planche");
    else {
      const size = imageSize(join(OUT, "boards", `board-${last.n}.jpg`));
      ok(last.jpeg && last.chars <= 800_000 && size?.codec === "mjpeg" && last.frames.length === kept.length && JSON.stringify(last.frames.map((f) => f.id)) === JSON.stringify(kept.map((b) => b.id)),
        `v${v.n} : planche JPEG valide, une tuile par temps fort gardé (${last.frames.length}/${kept.length}, ${size ? `${size.w}×${size.h}` : "?"}, ${Math.round(last.bytes / 1024)} Ko)`,
        `jpeg ${last.jpeg}, ${last.chars} car., tuiles ${last.frames.map((f) => f.id)}`);
      const firstRender = mine.find((x) => x.phase === "render");
      if (firstRender) ok(last.t <= firstRender.t || bs[0].t <= firstRender.t, `v${v.n} : planche arrivée avant le rendu`);
    }
    return plan;
  };

  const byStage = (stage, by) => (state.versions || []).filter((v) => v.stage === stage && (!by || v.by === by));
  const callsAt = (run) => (state.timeline || []).find((l) => l.run === run && l.calls !== undefined)?.calls;

  if (scenario === "suite" || scenario === "short") {
    ok(state.status === "done", `scénario fini (${state.status})`, state.failure);
    const v1 = byStage("create", "claude")[0];
    ok(!!v1, "v1 reçue (Claude écrit la vidéo)");
    const p1 = v1 && version(v1, "write");
    if (p1?.video) {
      ok(p1.video.source === "idea" && p1.video.request?.length > 10, "v1 : demande et source reprises de la tâche");
      ok(p1.music === true && !!p1.look?.theme, "v1 : musique et style du projet");
    }
    if (scenario === "suite") {
      const v2 = byStage("revise", "claude")[0];
      ok(!!v2, "v2 reçue (retouche d'un passage par Claude)");
      const p2 = v2 && version(v2, "revise");
      if (p1?.video && p2?.video) {
        // Temps forts ouverts : ceux qui recoupent le passage de plus de 0,15 s (aucune note dessinée ici).
        const [a, z] = state.revise?.range || [];
        const open = new Set(p1.video.beats.filter((b) => !b.cut && Number.isFinite(a) && Math.min(b.end, z) - Math.max(b.start, a) > 0.15).map((b) => b.id));
        const locked1 = p1.video.beats.filter((b) => !open.has(b.id));
        const ids2 = new Map(p2.video.beats.map((b) => [b.id, b]));
        const diff = locked1.filter((b) => !ids2.has(b.id) || bare(ids2.get(b.id)) !== bare(b)).map((b) => b.id);
        ok(!diff.length && locked1.length > 0, `v2 : les ${locked1.length} temps forts hors du passage (${[...open].join(", ")} ouverts) ont exactement le même JSON qu'en v1`, diff.length ? `changés : ${diff.join(", ")}` : "");
        const order1 = locked1.map((b) => b.id).filter((id) => ids2.has(id));
        const order2 = p2.video.beats.map((b) => b.id).filter((id) => order1.includes(id));
        ok(JSON.stringify(order1) === JSON.stringify(order2), "v2 : ordre des temps forts verrouillés gardé");
        const changed = p2.video.beats.filter((b) => open.has(b.id)).some((b) => bare(b) !== bare(p1.video.beats.find((x) => x.id === b.id) || {})) || p2.video.beats.length !== p1.video.beats.length;
        ok(changed, "v2 : le passage ouvert a changé");
        ok(p2.video.seed === p1.video.seed && p2.video.request === p1.video.request && p2.video.title === p1.video.title, "v2 : graine, demande et titre gardés");
        info(`v2 : notes « ${notesOf(v2.n).replace(/\s+/g, " ").slice(0, 200)} »`);
      }
      const ve = byStage("edit", "edit")[0];
      ok(!!ve, "aperçu de l'édition à la main reçu");
      if (ve && state.edit) {
        const pe = version(ve, "edit");
        const before = callsAt(ve.run);
        ok(before !== undefined && ve.calls === before, `édition : AUCUN appel à Claude (${before} → ${ve.calls} appels notés par claude-spy.sh)`);
        if (pe?.video) {
          const E = state.edit;
          const page = readJson(join(OUT, `reel-v${E.n}-page.json`));
          if (E.kept) {
            const m = pe.video.moments.find((x) => x.id === E.kept);
            ok(!!m?.code, `édition : le moment « ${E.kept} » survit au changement de texte de ${E.changed.filter((id) => E.coveredBy.includes(id)).join(", ") || "son temps fort"}`, m?.code ? undefined : m ? "sans code" : "retiré");
          } else info("édition : pas de moment à garder (la v2 n'en a pas)");
          if (E.dropped) ok(!pe.video.moments.some((x) => x.id === E.dropped), `édition : le moment « ${E.dropped} » retiré par la page n'est pas rendu`);
          else info("édition : pas de second moment à retirer");
          for (const id of E.changed) {
            const b = pe.video.beats.find((x) => x.id === id);
            const want = page?.video?.beats.find((x) => x.id === id)?.text;
            ok(b && want && b.text === want, `édition : texte de ${id} modifié à la main gardé`);
          }
          if (E.cut) ok(pe.video.beats.find((b) => b.id === E.cut)?.cut === true, `édition : temps fort ${E.cut} coupé (gardé dans le plan)`);
          ok(pe.music === false, "édition : musique coupée (piste muette)");
        }
      }
      const v4 = byStage("regen", "claude")[0];
      ok(!!v4, "version de la régénération reçue");
      const p4 = v4 && version(v4, "write");
      if (p1?.video && p4?.video) {
        const t1 = p1.video.beats.map((b) => b.title).join("|");
        const t4 = p4.video.beats.map((b) => b.title).join("|");
        ok(p1.video.seed !== p4.video.seed, `régénération : nouvelle graine (${p1.video.seed} → ${p4.video.seed})`);
        info(`régénération : titres ${t1 === t4 ? "identiques (normal avec --fake : le faux Claude rejoue la même partition)" : "différents"}`);
      }
      // Ce que Claude a reçu pour la régénération (claude-spy.sh, CLAUDE_PROMPT_LOG) : les titres de la version
      // d'avant et la demande d'une idée nettement différente (design §3 K) ; jamais dans la première écriture.
      const prompts = readPrompts(join(OUT, "claude-prompts.log"));
      const before = state.edit?.n ? reelOf(state.edit.n) : null;
      const prevTitles = (before?.video?.beats || []).filter((b) => !b.cut).map((b) => String(b.title).slice(0, 40));
      const regenPrompts = prompts.filter((x) => /VERSION PRÉCÉDENTE/.test(x.text));
      if (!prompts.length) ok(false, "régénération : prompts de Claude notés (claude-prompts.log)", "journal absent ou vide (CLAUDE_PROMPT_LOG)");
      else {
        ok(!/VERSION PRÉCÉDENTE/.test(prompts[0].text), "première écriture : aucune « version précédente » dans le prompt");
        const rp = regenPrompts.at(-1);
        const missing = rp ? prevTitles.filter((t) => !rp.text.includes(`« ${t} »`)) : prevTitles;
        const asks = !!rp && /idée visuelle nettement différente/.test(rp.text);
        const why = !rp ? `aucun prompt avec « VERSION PRÉCÉDENTE » sur ${prompts.length}` : !prevTitles.length ? "titres de la version d'avant inconnus" : missing.length ? `titres absents : ${missing.join(", ")}` : !asks ? "section « idée visuelle nettement différente » absente" : undefined;
        ok(!why, `régénération : le prompt donne les ${prevTitles.length} titres de la version ${state.edit?.n ?? "?"} et demande une idée visuelle nettement différente`, why);
      }
    }
    const total = state.endedAt ? Date.parse(state.endedAt) - Date.parse(state.startedAt) : NaN;
    if (Number.isFinite(total)) ok(total < 15 * 60_000, `durée totale ${Math.round(total / 1000)} s (moins de 15 min)`);
  }

  if (scenario === "stop") {
    const stopT = state.stopT;
    ok(Number.isFinite(stopT), "arrêt demandé au premier PATCH du rendu qui annonce des images");
    if (Number.isFinite(stopT)) {
      const failed = patches.filter((x) => x.status === "failed");
      ok(!failed.length, "aucun PATCH failed après l'arrêt", failed.map((x) => x.error).join(" ; "));
      const late = events.filter((e) => e.t > stopT + 1000 && (e.p === "/api/uploads" || /\/versions/.test(e.p) || /\/board$/.test(e.p)) && e.m === "POST");
      ok(!late.length, "aucun envoi (upload, version, aperçu, planche) après l'arrêt", late.map((e) => `${e.m} ${e.p}`).join(", "));
      const after = patches.filter((x) => x.t > stopT + 12_000);
      ok(!after.length, "plus aucun PATCH 12 s après l'arrêt", `${after.length} PATCH`);
      if (orchestrator.stop) {
        const s = orchestrator.stop;
        info(`Chrome du worker : ${s.chromeSeen ?? "?"} vu(s) pendant le passage, ${s.chromeJustBefore ?? "?"} juste avant l'arrêt, ${s.chromeAtStop} à l'arrêt, ${s.chromeAfter} ${s.afterS} s plus tard (processus enfants : ${s.childrenAfter})`);
        if (s.chromeJustBefore !== undefined) ok(s.chromeJustBefore > 0, `Chrome rendait encore au moment de l'arrêt (${s.chromeJustBefore} processus ; sinon le test ne prouverait rien)`, s.chromeJustBefore > 0 ? undefined : "aucun Chrome sous le worker dans la demi-seconde d'avant");
        ok(s.chromeAfter === 0 && !s.chromeAlive, `Chrome du worker tué en moins de ${s.afterS} s`, `${s.chromeAfter} descendant(s) et ${s.chromeAlive ?? 0} pid vu(s) encore vivant(s)`);
      }
      const back = claims.filter((c) => c.t > stopT);
      ok(back.length > 0, `le worker redemande du travail après l'arrêt (${back.length} réclamation(s))`);
    }
    ok(!(state.versions || []).length, "aucune version ni aperçu reçu");
  }

  // Arrêter puis Régénérer 1 s plus tard (avant la veille suivante du Mac) : le passage arrêté tombe à son premier
  // rapport refusé (409), n'envoie rien, et le Mac prend la nouvelle demande au lieu de finir l'ancienne.
  if (scenario === "stop-regen") {
    const stopT = state.stopT;
    ok(Number.isFinite(stopT), "arrêt demandé au premier PATCH du rendu qui annonce des images");
    ok(Number.isFinite(state.requeueT) && state.requeueT - stopT <= 2000, `nouvelle demande (régénérer) mise en file ${Number.isFinite(state.requeueT) ? `${((state.requeueT - stopT) / 1000).toFixed(1)} s` : "?"} après l'arrêt, avant la veille du Mac`);
    if (Number.isFinite(stopT)) {
      const failed = patches.filter((x) => x.status === "failed");
      ok(!failed.length, "aucun PATCH failed", failed.map((x) => x.error).join(" ; "));
      const old = patches.filter((x) => x._run === state.stopRun && x.t > stopT);
      const lateOld = old.filter((x) => x.t > stopT + 15_000);
      ok(!lateOld.length, `plus aucun PATCH du passage arrêté 15 s après l'arrêt (${old.length} PATCH après l'arrêt, le dernier à +${old.length ? ((old.at(-1).t - stopT) / 1000).toFixed(1) : 0} s)`, `${lateOld.length} PATCH après 15 s`);
      const refused = events.filter((e) => e.t > stopT && e.s === 409 && e.m !== "PUT");
      info(`écritures du passage arrêté refusées (409) : ${refused.length} (${[...new Set(refused.map((e) => `${e.m} ${e.p.replace(/^\/api\/montage\/jobs\/[^/]+/, "…")}`))].join(", ") || "aucune"})`);
      const until = state.reclaim?.t ?? Infinity;
      const sent = events.filter((e) => e.t > stopT + 1000 && e.t < until && e.m === "POST" && (e.p === "/api/uploads" || /\/versions/.test(e.p) || /\/board$/.test(e.p)));
      ok(!sent.length, "aucun envoi (upload, version, aperçu, planche) entre l'arrêt et la réclamation suivante", sent.map((e) => `${e.m} ${e.p} → ${e.s}`).join(", "));
      const oldBoards = boards.filter((b) => b.run === state.stopRun && b.t > stopT);
      ok(!oldBoards.length, "aucune planche du passage arrêté acceptée après l'arrêt", `${oldBoards.length}`);
      const r = state.reclaim;
      ok(!!r && r.action === "motion" && r.regen === true, `le Mac prend la nouvelle demande (régénération) ${r ? `${((r.t - stopT) / 1000).toFixed(1)} s après l'arrêt` : ""}`, r ? JSON.stringify(r) : "jamais réclamée");
      if (r) ok(r.t - stopT < 30_000, "réclamée moins de 30 s après l'arrêt (le passage arrêté n'a pas été fini)", `${((r.t - stopT) / 1000).toFixed(1)} s`);
      if (orchestrator.stop) {
        const s = orchestrator.stop;
        info(`Chrome du passage arrêté : ${s.chromeSeen ?? "?"} vu(s), ${s.chromeJustBefore ?? "?"} juste avant l'arrêt, ${s.chromeAlive ?? "?"} encore vivant(s) ${s.afterS} s plus tard`);
        if (s.chromeJustBefore !== undefined) ok(s.chromeJustBefore > 0, `Chrome rendait encore au moment de l'arrêt (${s.chromeJustBefore} processus)`, s.chromeJustBefore > 0 ? undefined : "aucun Chrome sous le worker dans la demi-seconde d'avant");
        ok(!s.chromeAlive, `les Chrome du passage arrêté sont morts ${s.afterS} s après l'arrêt`, `${s.chromeAlive} pid encore vivant(s)`);
      }
    }
    ok(!(state.versions || []).length, "aucune version ni aperçu reçu du passage arrêté");
  }

  if (scenario === "oldserver") {
    ok(/mets le site à jour/.test(state.failure || ""), "échec clair « Metricove ne connaît pas encore les reels vidéo : mets le site à jour »", state.failure);
    ok(events.some((e) => /\/versions$/.test(e.p) && e.s === 400), "POST /versions refusé (400) par l'ancien serveur");
    ok(events.some((e) => /\/board$/.test(e.p) && e.s === 404), "POST /board → 404, ignoré par le worker");
    ok(!(state.versions || []).length, "rien n'est arrivé dans la bibliothèque ni en version");
  }

  if (scenario === "evil") {
    const ve = (state.versions || []).find((v) => v.by === "edit");
    ok(state.status === "done" && !!ve, "aperçu de l'édition reçu malgré le moment piégé", state.failure);
    if (ve) {
      const pe = reelOf(ve.n);
      ok(pe?.video && !pe.video.moments.some((m) => m.id === "evil"), "le moment piégé « evil » est retiré du rendu");
      const notes = notesOf(ve.n);
      ok(/retir/i.test(notes), "une note dit que l'animation sur mesure a été retirée", notes.replace(/\s+/g, " ").slice(0, 300));
      ok(ve.calls === state.callsAtStart, "aucun appel à Claude");
      const pr = pe && probe(join(OUT, `apercu-v${ve.n}.mp4`), pe.duration);
      if (pr) ok(pr.ok, "mp4 de l'aperçu conforme", pr.why);
    }
  }

  if (scenario === "claude-timeout") {
    ok(/Claude n'a pas fini d'écrire/.test(state.failure || ""), "échec « Claude n'a pas fini d'écrire… »", state.failure);
    ok(!(state.versions || []).length, "aucune version");
    if (orchestrator.timeout) {
      const o = orchestrator.timeout;
      ok(o.claudeAfter === 0 && !o.claudeAlive, `aucun processus Claude orphelin après le délai (${o.claudeSeen ?? "?"} vu(s) pendant l'écriture)`, `${o.claudeAfter} descendant(s) et ${o.claudeAlive ?? 0} pid vu(s) encore vivant(s)`);
    }
  }

  if (scenario === "old") {
    // Auto-test du FAUX serveur : la porte du vrai serveur (claimJob) se vérifie avec --run server.
    info(`porte du faux serveur seulement (comparaison des versions : ${state.gate || "?"}) ; la porte réelle, claimJob, se vérifie avec --run server`);
    const r = (v) => claims.find((c) => (c.version ?? null) === v)?.result;
    ok(r(null) === 204, "faux serveur : réclamation sans version → 204 (la vidéo attend)");
    ok(r("0.13.0") === 204, "faux serveur : réclamation 0.13.0 → 204 tant que la vidéo est en file");
    ok(r("0.14.0") === 200, "faux serveur : réclamation 0.14.0 → la vidéo");
  }

  // Chrome hors ligne (JAMAIS retiré) : le worker a rendu par chrome-offline.sh, et chaque Chrome vu sous lui le portait.
  if (VIDEO_RUNS.includes(scenario)) {
    let log = "";
    try { log = readFileSync(join(OUT, "worker.log"), "utf8"); } catch { /* passage vérifié sans son journal */ }
    if (log) ok(!/Chrome hors ligne absent/.test(log), "Chrome hors ligne installé (aucun « Chrome hors ligne absent » dans worker.log)");
    const c = orchestrator.chrome;
    if (c?.browsers) ok(c.online === 0, `Chrome du worker lancé hors ligne (${c.offline}/${c.browsers} navigateur(s) vus avec ${OFFLINE_FLAG})`, c.online ? `sans le drapeau : ${(c.onlineCmds || []).join(" | ").slice(0, 300)}` : undefined);
    else if (c && scenario !== "claude-timeout") ok(false, "Chrome du worker vu pendant le passage", "aucun navigateur vu sous le worker");
  }

  if (scenario === "legacy") {
    const v = (state.versions || [])[0];
    ok(state.status === "done" && !!v, "ancien reel à scènes rendu et reçu", state.failure);
    const plan = v && reelOf(v.n);
    ok(plan && Array.isArray(plan.scenes) && plan.scenes.length >= 1 && !plan.video, "plan à scènes (renderPlan), sans video");
    ok(claims.some((c) => c.result === 200), "réclamé sans porte de version (pas de minWorker)");
    if (plan) {
      // Un ancien plan n'a pas toujours `duration` : la somme des longueurs rendues des scènes gardées.
      const d = plan.duration ?? (plan.scenes || []).filter((s) => !s.cut).reduce((n, s) => n + (Number(s.dur) || 0), 0);
      const pr = probe(join(OUT, `apercu-v${v.n}.mp4`), d);
      ok(pr.ok, `mp4 conforme (${d.toFixed(2)} s)`, pr.why);
    }
  }

  const failed = results.filter((r) => r.ok === false);
  console.log(`\n${results.filter((r) => r.ok).length} vérifications passées, ${failed.length} en échec.`);
  writeFileSync(join(OUT, "check.json"), JSON.stringify({ scenario, passed: results.filter((r) => r.ok).length, failed: failed.length, results, orchestrator }, null, 2));
  return results;
}

/* ---------- Lancement du bac à sable ---------- */

/** Les processus descendants d'un pid (lus dans /proc) : { pid, cmd }. */
function descendants(root) {
  const kids = new Map();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push({ pid: Number(d), cmd });
    } catch { /* processus fini entre-temps */ }
  }
  const out = [];
  const walk = (pid) => { for (const k of kids.get(pid) || []) { out.push(k); walk(k.pid); } };
  walk(root);
  return out;
}
const isChrome = (c) => /chrome|headless_shell/i.test(c.cmd);
/** Un processus navigateur principal (pas un enfant --type=renderer, gpu…, ni le script chrome-offline.sh avant son exec). */
const isBrowser = (c) => { const exe = basename(c.cmd.split(" ")[0] || ""); return /chrome|headless_shell/i.test(exe) && !/\.sh$/.test(exe) && !/ --type=/.test(` ${c.cmd}`); };
const isClaude = (c) => /claude-spy|--fake-claude|(^|\/)claude\s/.test(c.cmd);
/** Combien de ces pid vivent encore et sont toujours le même programme (un pid peut être réutilisé). */
const alive = (pids, is) => pids.filter((pid) => { try { return is({ cmd: readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ") }); } catch { return false; } }).length;

async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* pas encore */ }
    await sleep(250);
  }
  return false;
}

async function orchestrate(args) {
  const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
  const scenario = args.find((a, i) => SCENARIOS.includes(a) && args[i - 1] !== "--out" && args[i - 1] !== "--root") || "suite";
  const root = resolve(opt("--root", "/tmp/mc"));
  const out = resolve(opt("--out", join(root, `mock-${scenario}`)));
  const port = Number(opt("--port", 3999));
  const fake = args.includes("--fake") ? "1" : scenario === "claude-timeout" ? "slow" : "";
  // Une suite avec le vrai Claude dure plus de 30 min sur un conteneur Linux (docs/MONTAGE.md, durées mesurées).
  const minutes = Number(opt("--minutes", scenario === "suite" ? (fake === "1" ? 30 : 45) : fake ? 15 : 20));
  for (const d of ["work", "fonts", "music", "rushes", "broll", "broll-cache"]) mkdirSync(join(root, d), { recursive: true });
  mkdirSync(out, { recursive: true });
  // Une piste de 30 s dans le dossier de musique (ffmpeg -f lavfi -i sine), comme le plan de test le demande.
  const track = join(root, "music", "sinus-220.mp3");
  if (!existsSync(track)) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=30", "-q:a", "6", track], { timeout: 60_000 });
  // La config du worker : test/config.sandbox.json, dossiers sous --root, faux serveur sur --port. claude.bin est le
  // claude-spy.sh de CE dossier (chemin absolu : Claude est lancé depuis son dossier de travail), quel que soit l'endroit
  // du dépôt ; GSAP vient de --gsap ou de gsapDir, et doit exister.
  const base = readJson(join(HERE, "config.sandbox.json"));
  const gsapDir = resolve(opt("--gsap", base.gsapDir || ""));
  const needsGsap = scenario !== "old";
  if (needsGsap && !existsSync(join(gsapDir, "gsap.min.js"))) throw new Error(`GSAP introuvable dans « ${gsapDir} » : passe --gsap <dossier dist de gsap@3.14.2> (npm pack gsap@3.14.2, puis package/dist), ou lance node montage.mjs --setup-reel et reprends son gsapDir`);
  const cfg = {
    ...base,
    claude: { ...base.claude, bin: join(HERE, "claude-spy.sh") },
    gsapDir,
    gsapFile: join(gsapDir, "gsap.min.js"),
    metricoveUrl: `http://localhost:${port}`,
    rushesDir: join(root, "rushes"), workDir: join(root, "work"), fontsDir: join(root, "fonts"), musicDir: join(root, "music"), brollDir: join(root, "broll"), brollCache: join(root, "broll-cache"),
    reel: { ...base.reel, ...(scenario === "claude-timeout" ? { claudeWriteMin: 0.05 } : {}) },
  };
  const cfgFile = join(out, "config.json");
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  // Chrome hors ligne (JAMAIS retiré) : sans lui, toute la vérification tournerait avec le réseau ouvert.
  if (VIDEO_RUNS.includes(scenario)) await ensureOfflineChrome(cfg);
  const spyLog = join(root, "claude-calls.log");
  const promptLog = join(out, "claude-prompts.log");
  writeFileSync(promptLog, "");
  const env = { ...process.env, CLAUDE_SPY_LOG: spyLog, CLAUDE_PROMPT_LOG: promptLog, ...(fake ? { CLAUDE_FAKE: fake } : {}) };
  delete env.MOCK;
  say(`scénario ${scenario}${scenario === "old" ? " (faux serveur seul, sans worker)" : fake ? ` (faux Claude : ${fake})` : " (vrai Claude)"} — sorties ${out}`);
  const logTo = (name) => { const f = join(out, name); writeFileSync(f, ""); return f; };
  const pipeTo = (child, file) => { const w = (d) => { try { writeFileSync(file, d, { flag: "a" }); } catch { /* */ } }; child.stdout.on("data", w); child.stderr.on("data", w); };

  const mock = spawn(process.execPath, [join(HERE, "mock-server.mjs"), out, String(port)], { cwd: WORKER, env: { ...env, MOCK: "video", EXIT_WHEN_DONE: "1", ...ENV_OF[scenario] }, stdio: ["ignore", "pipe", "pipe"] });
  pipeTo(mock, logTo("mock.log"));
  let mockDone = false;
  mock.on("exit", () => (mockDone = true));
  if (!(await waitHttp(`http://localhost:${port}/login`, 10_000))) { mock.kill("SIGKILL"); throw new Error(`le faux serveur ne répond pas sur le port ${port} (voir ${out}/mock.log)`); }
  const orch = { scenario, fake: fake || false, minutes, startedAt: new Date().toISOString() };

  if (scenario === "old") {
    // Un Mac trop ancien (ou qui ne dit pas sa version) ne reçoit jamais la vidéo ; un 0.14.0 la prend.
    const claim = (version) => fetch(`http://localhost:${port}/api/montage/worker/claim`, { method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify({ worker: "mac", ...(version ? { version } : {}) }) }).then((r) => r.status);
    orch.claims = { none: await claim(), old: await claim("0.13.0"), new: await claim("0.14.0") };
    mock.kill("SIGTERM");
    await sleep(500);
    return finishRun(out, orch);
  }

  const worker = spawn(process.execPath, ["montage.mjs"], { cwd: WORKER, env: { ...env, METRICOVE_URL: `http://localhost:${port}`, METRICOVE_API_TOKEN: "test-token", MONTAGE_CONFIG: cfgFile }, stdio: ["ignore", "pipe", "pipe"] });
  pipeTo(worker, logTo("worker.log"));
  let workerDone = false;
  worker.on("exit", (code) => { workerDone = true; orch.workerExit = code; });
  const end = Date.now() + minutes * 60_000;
  let watchedStop = false, watchedFail = false;
  // Les Chrome et les Claude vus sous le worker, par pid : un processus rattaché à init après la mort de son parent
  // n'est plus un descendant, mais son pid dit encore s'il vit (les Chrome des autres programmes ne sont pas comptés).
  const seen = { chrome: new Set(), claude: new Set() };
  // Les navigateurs principaux vus sous le worker, par pid : lancés par chrome-offline.sh (drapeau) ou pas.
  const browsers = new Map();
  let lastChrome = [];
  const watch = scenario === "stop" || scenario === "stop-regen" || scenario === "claude-timeout";
  while (!mockDone && !workerDone && Date.now() < end) {
    await sleep(watch ? 500 : 1000);
    const now = descendants(worker.pid);
    for (const c of now.filter(isBrowser)) if (!browsers.has(c.pid)) browsers.set(c.pid, c.cmd.includes(OFFLINE_FLAG) ? "" : c.cmd);
    if (watch && !watchedStop && !watchedFail) {
      lastChrome = now.filter(isChrome).map((c) => c.pid);
      for (const pid of lastChrome) seen.chrome.add(pid);
      for (const c of now.filter(isClaude)) seen.claude.add(c.pid);
    }
    const st = readJson(join(out, "state.json"), {});
    // Arrêt depuis la page : les Chrome du worker (vus pendant le rendu) vivent-ils encore 10 s plus tard ? Avec
    // stop-regen, le passage suivant peut déjà lancer les siens : seuls comptent les pid vus avant l'arrêt (chromeAlive).
    if ((scenario === "stop" || scenario === "stop-regen") && st.stopAt && !watchedStop) {
      watchedStop = true;
      const atStop = descendants(worker.pid).filter(isChrome);
      for (const c of atStop) seen.chrome.add(c.pid);
      await sleep(10_000);
      const after = descendants(worker.pid);
      orch.stop = { chromeSeen: seen.chrome.size, chromeJustBefore: lastChrome.length, chromeAtStop: atStop.length, chromeAfter: after.filter(isChrome).length, chromeAlive: alive([...seen.chrome], isChrome), childrenAfter: after.length, afterS: 10 };
    }
    // Délai de Claude : plus aucun Claude du worker 5 s après l'échec.
    if (scenario === "claude-timeout" && st.failure && !watchedFail) {
      watchedFail = true;
      await sleep(5000);
      orch.timeout = { claudeSeen: seen.claude.size, claudeAfter: descendants(worker.pid).filter(isClaude).length, claudeAlive: alive([...seen.claude], isClaude) };
    }
  }
  orch.timedOut = !mockDone && !workerDone;
  orch.endedAt = new Date().toISOString();
  const onlineCmds = [...browsers.values()].filter(Boolean);
  orch.chrome = { browsers: browsers.size, offline: browsers.size - onlineCmds.length, online: onlineCmds.length, onlineCmds: onlineCmds.slice(0, 3).map((c) => c.slice(0, 200)) };
  if (workerDone && !mockDone) orch.workerDied = true;
  // Fin : le worker (et ses enfants) puis le faux serveur.
  if (!workerDone) {
    worker.kill("SIGTERM");
    for (let i = 0; i < 50 && !workerDone; i++) await sleep(100);
    if (!workerDone) worker.kill("SIGKILL");
  }
  if (!mockDone) mock.kill("SIGTERM");
  await sleep(300);
  return finishRun(out, orch);
}

function finishRun(out, orch) {
  writeFileSync(join(out, "orchestrator.json"), JSON.stringify(orch, null, 2));
  if (orch.workerDied) say(`le worker s'est arrêté tout seul (code ${orch.workerExit}) : voir ${out}/worker.log`);
  const results = check(out, { orchestrator: orch });
  return results.some((r) => r.ok === false) ? 1 : 0;
}

/**
 * Le Chrome hors ligne du bac à sable : <workDir>/chrome-offline.sh, écrit comme le fait node montage.mjs --setup-reel
 * (sans son rendu de mesure ni son test de Claude) quand il manque, à partir du Chrome de HyperFrames (browserPath de
 * lib/reel/hf-cli.mjs). Un échec arrête le scénario : il ne doit jamais tourner avec le réseau ouvert.
 */
async function ensureOfflineChrome(cfg) {
  const script = join(cfg.workDir, "chrome-offline.sh");
  if (existsSync(script)) return script;
  say("Chrome hors ligne absent du bac à sable : écriture de chrome-offline.sh (comme --setup-reel)…");
  const { browserPath } = await import("../lib/reel/hf-cli.mjs");
  const chrome = await browserPath(cfg, { ensure: true });
  writeFileSync(script, `#!/bin/sh\n# Écrit par test/check-video-run.mjs, comme node montage.mjs --setup-reel : Chrome sans DNS hors de la boucle locale.\nexec "${chrome.replace(/(["\\$`])/g, "\\$1")}" --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1" "$@"\n`);
  chmodSync(script, 0o755);
  say(`Chrome hors ligne : ${script}`);
  return script;
}

/* ---------- Serveur réel (--run server) ---------- */

/**
 * Les routes du VRAI serveur (pnpm dev, ou tout Metricove de test), sans worker : ce script joue le Mac et la page.
 * Vérifie la porte de version de claimJob, l'identité du passage (`run` = run.startedAt de la réclamation) et le refus
 * (409, rien d'enregistré) des écritures tardives d'un passage arrêté, avec ou sans `run` ; une édition de la page qui
 * hérite du code par id de moment et dont le code, les moments en plus et les champs réservés sont ignorés (la moitié
 * serveur de la frontière du bac à sable) ; regen effacé par withdraw, cancel et une retouche ; stop refusé sur un reel
 * à scènes ; espaces insécables gardés ; code jamais renvoyé à la page ; aperçu en Range ; valider → média ; avec
 * --slow, le silence du Mac (45 s sur une vidéo, pas sur un texte de prompteur, dont le battement est de 60 s), la
 * présence qui tient 60 s sans réclamation, et une écriture refusée après « Arrêter » puis « Régénérer » qui garde le Mac
 * en ligne. Il réclame des jobs : il refuse de tourner (code 2) si la file du serveur n'est pas vide ou si un autre
 * worker l'interroge (il prendrait leurs jobs). Tout ce qu'il crée est annulé puis supprimé à la fin (média compris), et
 * la fiche de présence du Mac est remise à son nom et à sa version d'avant (par une dernière réclamation, file vide).
 */
async function serverRun(args) {
  const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
  const base = opt("--server", process.env.METRICOVE_URL || "http://localhost:3000").replace(/\/$/, "");
  const token = opt("--token", process.env.METRICOVE_API_TOKEN || "");
  const slow = args.includes("--slow");
  const out = resolve(opt("--out", join(resolve(opt("--root", "/tmp/mc")), "server")));
  mkdirSync(out, { recursive: true });
  const results = [];
  const ok = (cond, msg, detail) => { results.push({ ok: !!cond, msg, ...(detail ? { detail } : {}) }); console.log(`  ${cond ? "✔" : "✘"} ${msg}${detail && !cond ? ` — ${detail}` : ""}`); };
  const info = (msg) => { results.push({ info: msg }); console.log(`  · ${msg}`); };
  const NAME = "check-video-run";
  const OLD_RUN = "2000-01-01T00:00:00.000Z";
  const req = async (method, path, body, headers = {}) => {
    const bin = body instanceof Uint8Array;
    const r = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !bin ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : bin ? body : JSON.stringify(body),
      // pnpm dev compile une route à son premier appel (ou après un changement de fichier) : jusqu'à une minute.
      signal: AbortSignal.timeout(120_000),
    });
    const text = await r.text().catch(() => "");
    let b = null;
    try { b = text ? JSON.parse(text) : null; } catch { b = null; }
    return { s: r.status, b, text, headers: r.headers };
  };
  const patch = (id, body) => req("PATCH", `/api/montage/jobs/${id}`, body);
  const get = async (id) => (await req("GET", `/api/montage/jobs/${id}`)).b || {};
  const mine = new Set();
  const created = [];
  const notRun = (msg) => Object.assign(new Error(msg), { notRun: true });
  /** La file ne contient que les jobs du test, et aucun autre worker n'interroge le serveur (sinon : code 2). */
  const queueOk = async () => {
    const r = await req("GET", "/api/montage");
    if (r.s !== 200) throw notRun(`GET /api/montage → ${r.s} ${r.text.slice(0, 160)}${r.s === 401 ? " (passe --token <API_TOKEN du serveur>)" : ""}`);
    const foreign = (r.b.jobs || []).filter((j) => j.action && !mine.has(j.id));
    if (foreign.length) throw notRun(`la file du serveur n'est pas vide (${foreign.map((j) => `« ${j.title} », ${j.status}`).join(" ; ")}) : relance quand elle l'est, une réclamation prendrait ces jobs`);
    const w = r.b.worker || {};
    const age = w.lastSeen ? (r.b.now ?? Date.now()) - Date.parse(w.lastSeen) : Infinity;
    if (w.name && w.name !== NAME && age < 20_000) throw notRun(`un worker (« ${w.name} ») interroge ce serveur : arrête-le d'abord, il réclamerait les jobs du test`);
    return r.b;
  };
  const claim = async (version) => {
    await queueOk();
    const r = await req("POST", "/api/montage/worker/claim", { worker: NAME, ...(version ? { version } : {}) });
    if (r.s === 200 && !mine.has(r.b?.job?.id)) throw new Error(`la réclamation a pris un job qui n'est pas au test (${r.b?.job?.id}, « ${r.b?.job?.title} ») : remets-le en file à la main`);
    return r;
  };
  const upload = async (file) => {
    const bytes = readFileSync(file);
    const u = await req("POST", "/api/uploads", { name: basename(file), size: bytes.length });
    if (u.s >= 300 || !u.b?.id) throw new Error(`POST /api/uploads → ${u.s} ${u.text.slice(0, 160)}`);
    const p = await req("PUT", `/api/uploads/${u.b.id}?offset=0`, new Uint8Array(bytes), { "Content-Type": "application/octet-stream" });
    if (p.s >= 300) throw new Error(`PUT /api/uploads → ${p.s} ${p.text.slice(0, 160)}`);
    return u.b.id;
  };
  // Une petite vidéo et une planche JPEG faites par ffmpeg ; le plan vidéo de la fixture score-basic (code compris),
  // avec des espaces insécables de typographie française dans le premier temps fort.
  const mp4 = join(out, "petit.mp4");
  if (!existsSync(mp4)) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x101010:s=180x320:d=1:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { timeout: 60_000 });
  const jpg = join(out, "planche.jpg");
  if (!existsSync(jpg)) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xff5a1f:s=180x320", "-frames:v", "1", "-q:v", "4", jpg], { timeout: 60_000 });
  const board = `data:image/jpeg;base64,${readFileSync(jpg).toString("base64")}`;
  const NB = "Chapitre 3\u00a0: abonne-toi\u202f!";
  const plan = structuredClone(readJson(join(HERE, "fixtures", "reel", "score-basic.json")).plan);
  plan.video.beats[0].text = NB;
  const look = { theme: "night", accent: "#ff5a1f", font: "grotesque" };
  const frames = [{ id: plan.video.beats[0].id, t: 0.6 }, { id: plan.video.beats[1].id, t: 3 }];
  const ourJob = (list, id) => (list || []).find((j) => j.id === id);
  console.log(`\nScénario server — ${base}${slow ? " (avec les attentes de silence)" : ""}`);
  const t0 = Date.now();
  const medias = [];
  let before;
  try {
    // La fiche de présence avant le test (nom, version) : remise en état à la fin.
    before = (await queueOk()).worker || {};
    // A. Création et porte de version (claimJob).
    const projectId = (await req("GET", "/api/projects")).b?.projects?.[0]?.id;
    const c = await req("POST", "/api/montage/jobs", { kind: "motion", mode: "video", request: "Contrôle check-video-run : porte de version et passages arrêtés (job de test, supprimé à la fin)", music: false, logo: false, look, ...(projectId ? { projectId } : {}) });
    const J = c.b?.job;
    if (J?.id) { mine.add(J.id); created.push(J.id); }
    ok(c.s === 201 && J?.minWorker === VIDEO_WORKER && J.status === "queued" && J.action === "motion" && J.motion?.mode === "video", `création d'une vidéo → 201, minWorker ${VIDEO_WORKER}, en file`, `${c.s} ${c.text.slice(0, 200)}`);
    if (!J?.id) throw new Error("création impossible");
    ok((await claim()).s === 204, "réclamation sans version → 204 (la vidéo attend)");
    ok((await claim("0.13.0")).s === 204, "réclamation 0.13.0 → 204");
    ok((await claim("0.9.9")).s === 204, "réclamation 0.9.9 → 204 (versions comparées en nombres, pas en texte)");
    const c1 = await claim(VIDEO_WORKER);
    const R1 = c1.b?.job?.run?.startedAt;
    ok(c1.s === 200 && c1.b.job.id === J.id && c1.b.action === "motion", `réclamation ${VIDEO_WORKER} → la vidéo`, `${c1.s}`);
    ok(!!R1 && c1.b.job.run.by === VIDEO_WORKER && c1.b.job.status === "working", "la vidéo arrive en cours, avec run { startedAt, by }", JSON.stringify(c1.b?.job?.run));
    // `voice` vient du profil du projet (voiceOf) : absent quand le projet n'a ni ton, ni skill, ni modèles, ni images.
    const voice = c1.b?.job?.voice;
    if (voice === undefined) info(`pas de voice dans la réclamation : ${projectId ? "le projet n'a ni ton, ni skill, ni modèles, ni images" : "aucun projet sur ce serveur"}`);
    else ok(typeof voice === "object" && Object.keys(voice).every((k) => ["tone", "skill", "examples", "images"].includes(k)), `la vidéo arrive avec voice { ${Object.keys(voice).join(", ")} }`, JSON.stringify(voice).slice(0, 200));

    // B. Le passage en cours écrit ; un autre passage (run différent) est refusé.
    let r = await patch(J.id, { step: "Claude écrit la vidéo…", progress: 0.1, phase: "write", phases: ["write", "check", "review", "render", "finish", "upload"], eta: 240, run: R1 });
    let g = await get(J.id);
    ok(r.s === 200 && g.job?.run?.phase === "write" && !!g.job.run.etaAt && g.job.step === "Claude écrit la vidéo…" && g.worker?.busy?.id === J.id && g.worker.online, "PATCH du passage en cours → run.phase, etaAt, step ; Mac occupé et en ligne", `${r.s} ${JSON.stringify(g.job?.run)} ${JSON.stringify(g.worker)}`);
    r = await patch(J.id, { step: "Rendu : image 1 sur 2", progress: 0.9, phase: "render", run: OLD_RUN });
    g = await get(J.id);
    ok(r.s === 409 && g.job?.step === "Claude écrit la vidéo…" && g.job.run?.phase === "write", "PATCH d'un autre passage (run différent) → 409, rien d'enregistré", `${r.s} ${g.job?.step}`);
    r = await req("POST", `/api/montage/jobs/${J.id}/board`, { image: board, frames, run: R1 });
    ok(r.s === 200 && r.b?.board?.n === 2, "planche du passage en cours → 200", `${r.s} ${r.text.slice(0, 160)}`);
    r = await req("POST", `/api/montage/jobs/${J.id}/board`, { image: board, frames, run: OLD_RUN });
    ok(r.s === 409, "planche d'un autre passage → 409", `${r.s}`);
    r = await req("POST", `/api/montage/jobs/${J.id}/versions`, { reel: plan, notes: "Version de contrôle.", upload: await upload(mp4), run: R1 });
    g = await get(J.id);
    ok(r.s === 201 && r.b?.version === 1 && g.job?.status === "review" && g.job.action === null && !g.job.run, "POST /versions du passage en cours → version 1, en relecture, run effacé", `${r.s} ${r.text.slice(0, 200)}`);
    ok(g.job?.title === `Reel animé : ${plan.video.title}`, "première vidéo : le job prend le titre de Claude", g.job?.title);
    const text0 = g.job?.versions?.[0]?.reel?.video?.beats?.[0]?.text;
    const nb = [...String(text0 ?? "")].filter((ch) => ch === "\u00a0" || ch === "\u202f").length;
    ok(text0 === NB, `espaces insécables gardés (« Chapitre 3 : abonne-toi ! » relu avec ${nb} insécable(s) sur 2)`, JSON.stringify(text0));
    const pages = await Promise.all(["/api/montage", "/api/montage/jobs"].map((p) => req("GET", p)));
    const one = await req("GET", `/api/montage/jobs/${J.id}`);
    const leaks = [...pages.map((p) => JSON.stringify(ourJob(p.b?.jobs, J.id) ?? "absent")), one.text].filter((t) => t.includes('"html"') || t.includes('"absent"'));
    ok(!leaks.length, "le code des moments ne va jamais à la page (GET /api/montage, /api/montage/jobs, /api/montage/jobs/:id)", `${leaks.length} réponse(s) avec du code ou sans le job`);
    const ms = g.job?.versions?.[0]?.reel?.video?.moments || [];
    ok(ms.length > 0 && ms.every((m) => m.custom === true && !m.code), `la page apprend seulement qu'un moment a du code (${ms.length} moment(s), custom: true)`);
    const range = await req("GET", `/api/montage/jobs/${J.id}/versions/1/preview`, undefined, { Range: "bytes=0-99" });
    ok(range.s === 206 && /^bytes 0-99\//.test(range.headers.get("content-range") || ""), "aperçu en Range → 206", `${range.s} ${range.headers.get("content-range")}`);
    {
      // Le Mac a fini entre le clic (après confirm) et la requête : rien à arrêter, la vidéo est là (pas de 400 « annule plutôt »).
      const before = (await req("GET", `/api/montage/jobs/${J.id}`)).b?.job;
      const st = await patch(J.id, { stop: true });
      ok(st.s === 200 && st.b?.job?.status === before?.status && st.b?.job?.versions?.length === before?.versions?.length && !st.text.includes('"html"'), "arrêter quand plus rien ne tourne (le Mac a fini) → 200, rien ne change", `${st.s} ${st.text.slice(0, 160)}`);
    }

    // C. Arrêt pendant une régénération, nouvelle demande, puis les écritures tardives de l'ancien passage.
    r = await patch(J.id, { regenerate: true });
    ok(r.s === 200 && r.b?.job?.status === "queued" && r.b.job.action === "motion" && r.b.job.regen === true, "régénérer → en file, action motion, regen", `${r.s} ${r.text.slice(0, 160)}`);
    const c2 = await claim(VIDEO_WORKER);
    const R2 = c2.b?.job?.run?.startedAt;
    ok(c2.s === 200 && !!R2 && R2 !== R1 && c2.b.job.regen === true, "réclamation de la régénération → nouveau run.startedAt, regen transmis", `${c2.s} ${R1} → ${R2}`);
    r = await patch(J.id, { step: "Rendu : image 300 sur 600", progress: 0.7, phase: "render", eta: 60, frames: [300, 600], run: R2 });
    ok(r.s === 200, "PATCH du rendu de la régénération → 200", `${r.s}`);
    r = await patch(J.id, { stop: true });
    ok(r.s === 200 && r.b?.job?.status === "review" && r.b.job.action === null && r.b.job.regen === undefined && r.b.job.versions?.length === 1, "arrêter → relecture, action null, regen effacé, la version 1 reste", `${r.s} ${r.text.slice(0, 160)}`);
    r = await patch(J.id, { regenerate: true, seconds: 45 });
    ok(r.s === 200 && r.b?.job?.status === "queued" && r.b.job.motion?.seconds === 45, "nouvelle demande après l'arrêt : régénérer en 45 s → en file", `${r.s}`);
    const late = [
      ["PATCH de progression avec l'ancien run", () => patch(J.id, { step: "Rendu : image 320 sur 600", progress: 0.72, phase: "render", eta: 55, frames: [320, 600], run: R2 })],
      ["PATCH de progression sans run", () => patch(J.id, { step: "Rendu : image 330 sur 600", progress: 0.73, phase: "render", frames: [330, 600] })],
      ["planche avec l'ancien run", () => req("POST", `/api/montage/jobs/${J.id}/board`, { image: board, frames, run: R2 })],
      ["planche sans run", () => req("POST", `/api/montage/jobs/${J.id}/board`, { image: board, frames })],
      ["version avec l'ancien run", async () => req("POST", `/api/montage/jobs/${J.id}/versions`, { reel: plan, notes: "Version tardive.", upload: await upload(mp4), run: R2 })],
      ["version sans run", async () => req("POST", `/api/montage/jobs/${J.id}/versions`, { reel: plan, notes: "Version tardive.", upload: await upload(mp4) })],
      ["échec (PATCH failed) sans run", () => patch(J.id, { status: "failed", error: "reel arrêté depuis la page" })],
    ];
    for (const [what, fn] of late) {
      const x = await fn();
      ok(x.s === 409, `écriture tardive de l'ancien passage, ${what} → 409`, `${x.s} ${x.text.slice(0, 160)}`);
    }
    // L'envoi d'une version refusée est oublié tout de suite (pas 24 h de disque pris).
    const up = await upload(mp4);
    r = await req("POST", `/api/montage/jobs/${J.id}/versions`, { reel: plan, notes: "Version tardive.", upload: up, run: R2 });
    ok(r.s === 409 && (await req("GET", `/api/uploads/${up}`)).s === 404, "la vidéo d'une version refusée est effacée du serveur aussitôt", `${r.s}`);
    g = await get(J.id);
    ok(g.job?.status === "queued" && g.job.action === "motion" && g.job.regen === true && g.job.motion?.seconds === 45 && g.job.versions?.length === 1 && !g.job.error, "la nouvelle demande (45 s) est intacte : en file, regen, une seule version, aucune erreur", JSON.stringify({ status: g.job?.status, action: g.job?.action, regen: g.job?.regen, versions: g.job?.versions?.length, error: g.job?.error }));
    ok(g.job?.step === undefined && g.job.progress === undefined && !g.job.run, "aucun reste de l'ancien passage sur le job en file (step, progress, run)", JSON.stringify({ step: g.job?.step, progress: g.job?.progress, run: g.job?.run }));
    ok(!g.worker?.busy, "le Mac n'est pas « occupé » par un job en file", JSON.stringify(g.worker?.busy));
    const c3 = await claim(VIDEO_WORKER);
    const R3 = c3.b?.job?.run?.startedAt;
    ok(c3.s === 200 && !!R3 && R3 !== R2 && c3.b.job.step === "Pris en charge par le Mac" && c3.b.job.progress === undefined, "réclamation suivante : nouveau run, « Pris en charge par le Mac », sans progression héritée", `${c3.s} ${c3.b?.job?.step} ${c3.b?.job?.progress}`);
    const a = await patch(J.id, { step: "Rendu : image 400 sur 600", progress: 0.8, run: R2 });
    const z = await patch(J.id, { step: "Claude écrit la vidéo…", progress: 0.05, phase: "write", run: R3 });
    ok(a.s === 409 && z.s === 200, "après la réclamation : ancien run → 409, run courant → 200", `${a.s} / ${z.s}`);
    r = await req("POST", `/api/montage/jobs/${J.id}/versions`, { reel: plan, notes: "Version 2.", upload: await upload(mp4), run: R3 });
    g = await get(J.id);
    ok(r.s === 201 && r.b?.version === 2 && g.job?.regen === undefined && g.job.status === "review", "version du passage courant → version 2, regen effacé", `${r.s} ${r.text.slice(0, 160)}`);

    // G. Édition à la main depuis la page (cleanReel avec base) : la page change des textes et essaie de changer ce qui
    // ne lui appartient pas ; le Mac reçoit le code de la version de départ, à l'octet près, et rien de la page.
    {
      const INJECT = "INJECTE-PAR-LA-PAGE";
      const v1page = g.job?.versions?.find((v) => v.n === 1)?.reel;
      const edit = structuredClone(v1page);
      const son = edit?.video?.beats?.find((b) => b.id === "son");
      const m0 = edit?.video?.moments?.[0];
      if (!son || !m0) throw new Error("plan de la fixture inattendu (temps fort « son » ou moment absent)");
      son.text = "Texte changé à la main\u00a0: le son d'abord.";
      Object.assign(m0, { zone: m0.zone === "full" ? "below" : "full", from: "accroche", brief: `Brief de la page ${INJECT}`, code: { html: `<script>${INJECT}</script>`, css: `/* ${INJECT} */`, js: `/* ${INJECT} */` }, custom: true });
      edit.video.moments.push({ id: "en-plus", brief: `Moment en plus ${INJECT}`, from: "accroche", to: "accroche", zone: "below", custom: true, code: { html: `<i>${INJECT}</i>`, css: "", js: "" } });
      Object.assign(edit.video, { engine: 2, seed: 1, request: `Demande de la page ${INJECT}`, title: `Titre ${INJECT}` });
      r = await patch(J.id, { reel: edit, from: 1 });
      ok(r.s === 200 && r.b?.job?.action === "preview" && r.b.job.versions?.at(-1)?.by === "edit" && r.b.job.versions.at(-1).n === 3, "édition à la main d'après la version 1 → version 3 (edit), action preview", `${r.s} ${r.text.slice(0, 200)}`);
      const ce = await claim(VIDEO_WORKER);
      const RE = ce.b?.job?.run?.startedAt;
      const vs = ce.b?.job?.versions || [];
      const base1 = vs.find((v) => v.n === 1)?.reel?.video;
      const mac = vs.find((v) => v.n === 3)?.reel?.video;
      ok(ce.s === 200 && ce.b.action === "preview" && !!mac && !!base1, "le Mac reçoit l'édition (action preview, version 3)", `${ce.s} ${ce.b?.action}`);
      if (mac && base1) {
        const want = plan.video.moments[0];
        const got = mac.moments?.find((m) => m.id === want.id);
        ok(!!got && JSON.stringify(got.code) === JSON.stringify(want.code) && JSON.stringify(base1.moments[0].code) === JSON.stringify(want.code), `code du moment « ${want.id} » hérité de la version 1 par son id, à l'octet près`, got ? "code différent" : "moment absent");
        ok(!JSON.stringify(vs.find((v) => v.n === 3)).includes(INJECT), "rien de ce que la page a injecté (code, brief, demande, titre) n'arrive au Mac");
        ok(mac.moments.length === 1 && !mac.moments.some((m) => m.id === "en-plus"), `aucun moment en plus (la page n'en crée pas) : ${mac.moments.map((m) => m.id).join(", ")}`);
        ok(got && got.zone === want.zone && got.from === want.from && got.to === want.to && got.brief === want.brief, "zone, début, fin et brief du moment viennent de la version 1", JSON.stringify({ zone: got?.zone, from: got?.from, brief: got?.brief?.slice(0, 40) }));
        ok(mac.engine === base1.engine && mac.seed === base1.seed && mac.request === base1.request && mac.title === base1.title, "engine, graine, demande et titre viennent de la version 1", JSON.stringify({ engine: mac.engine, seed: mac.seed, title: mac.title }));
        ok(mac.beats.find((b) => b.id === "son")?.text === son.text, "le texte changé à la main est gardé (insécable compris)");
      }
      r = await req("POST", `/api/montage/jobs/${J.id}/versions/3/preview`, { upload: await upload(mp4), reel: { ...ce.b?.job?.versions?.find((v) => v.n === 3)?.reel, duration: plan.duration }, notes: "", run: RE });
      g = await get(J.id);
      ok(r.s === 200 && g.job?.status === "review" && g.job.versions?.find((v) => v.n === 3)?.preview === true, "aperçu de l'édition (passage courant) → en relecture, version 3 avec aperçu", `${r.s} ${r.text.slice(0, 160)}`);
    }

    // D. regen ne survit ni à withdraw ni à cancel, et une retouche n'est jamais une régénération.
    await patch(J.id, { regenerate: true });
    r = await patch(J.id, { withdraw: true });
    ok(r.s === 200 && r.b?.job?.status === "review" && r.b.job.regen === undefined, "régénérer puis reprendre la demande (withdraw) → regen effacé", `${r.s} regen ${r.b?.job?.regen}`);
    r = await patch(J.id, { revise: "Plus court, s'il te plaît.", range: [0, 2.4], from: 2 });
    ok(r.s === 200 && r.b?.job?.action === "motion" && r.b.job.base === 2 && r.b.job.regen === undefined, "retouche → action motion, base 2, sans regen", `${r.s}`);
    const c4 = await claim(VIDEO_WORKER);
    ok(c4.s === 200 && c4.b.job.regen === undefined && c4.b.job.base === 2, "le Mac reçoit une retouche (reviseVideo), pas une régénération", `${c4.s} regen ${c4.b?.job?.regen}`);
    await patch(J.id, { stop: true });
    await patch(J.id, { regenerate: true });
    r = await patch(J.id, { cancel: true });
    ok(r.s === 200 && r.b?.job?.status === "cancelled" && r.b.job.regen === undefined, "régénérer puis annuler (cancel) → regen effacé", `${r.s} regen ${r.b?.job?.regen}`);

    // E. Un ancien reel à scènes : pris par un Mac 0.13.0, versions sans run comme avant, stop refusé, withdraw gardé.
    const o = await req("POST", "/api/montage/jobs", { kind: "motion", scenes: [{ title: "Trois erreurs", body: "qui font décrocher" }, { title: "Abonne-toi", body: "pour la suite" }], look, music: false });
    const O = o.b?.job;
    if (O?.id) { mine.add(O.id); created.push(O.id); }
    ok(o.s === 201 && !!O && !O.minWorker && O.motion?.mode === undefined, "ancien reel à scènes → 201, sans minWorker", `${o.s} ${o.text.slice(0, 160)}`);
    if (O?.id) {
      const co = await claim("0.13.0");
      ok(co.s === 200 && co.b.job.id === O.id, "un Mac 0.13.0 prend toujours un reel à scènes", `${co.s}`);
      const scenes = { scenes: [{ id: "s1", title: "Trois erreurs", body: "qui font décrocher", dur: 3 }, { id: "s2", title: "Abonne-toi", body: "pour la suite", dur: 3 }], look, music: false, pace: "normal", duration: 6 };
      r = await req("POST", `/api/montage/jobs/${O.id}/versions`, { reel: scenes, notes: "Ancien chemin.", upload: await upload(mp4) });
      ok(r.s === 201 && r.b?.version === 1, "version d'un ancien Mac (sans run) acceptée comme avant", `${r.s} ${r.text.slice(0, 160)}`);
      r = await patch(O.id, { revise: "Plus vif." });
      ok(r.s === 200 && r.b?.job?.action === "motion", "retouche d'un reel à scènes → en file", `${r.s}`);
      r = await patch(O.id, { stop: true });
      ok(r.s === 400 && /annule plutôt/.test(r.b?.error || ""), "arrêter un reel à scènes → 400 « Rien à rétablir : annule plutôt » (son worker ne lit pas action null)", `${r.s} ${r.text.slice(0, 160)}`);
      r = await patch(O.id, { withdraw: true });
      ok(r.s === 200 && r.b?.job?.status === "review", "un reel à scènes garde withdraw", `${r.s}`);
    }

    // F. Silence du Mac (--slow) : 45 s sur une vidéo d'un worker 0.14.0, 120 s sur ses autres chemins (battement 60 s).
    if (slow) {
      const sj = await req("POST", "/api/montage/jobs", { kind: "script", title: "Contrôle check-video-run (présence)", brief: { instructions: "Contrôle de présence : job de test, supprimé à la fin." } });
      const S = sj.b?.job;
      if (S?.id) { mine.add(S.id); created.push(S.id); }
      const cs = await claim(VIDEO_WORKER);
      ok(cs.s === 200 && cs.b.job.id === S?.id, `un texte de prompteur réclamé par un worker ${VIDEO_WORKER}`, `${cs.s}`);
      await patch(S.id, { step: "Écriture du texte du prompteur…", progress: 0.3 });
      info("50 s sans nouvelles du texte de prompteur (battement de 60 s sur ce chemin)…");
      await sleep(50_000);
      let w = (await req("GET", "/api/montage")).b?.worker || {};
      ok(w.online && w.busy?.id === S.id && !w.silent, "texte de prompteur, 50 s après le dernier PATCH : en ligne, occupé, PAS silencieux", JSON.stringify(w));
      await patch(S.id, { cancel: true });
      await patch(J.id, { regenerate: true });
      const cv = await claim(VIDEO_WORKER);
      await patch(J.id, { step: "Claude écrit la vidéo…", progress: 0.05, phase: "write", run: cv.b?.job?.run?.startedAt });
      info("50 s sans nouvelles de la vidéo (battement de 15 s)…");
      await sleep(50_000);
      w = (await req("GET", "/api/montage")).b?.worker || {};
      ok(w.online && w.busy?.id === J.id && w.silent === true, "vidéo, 50 s après le dernier PATCH : en ligne, occupée, silencieuse (45 s)", JSON.stringify(w));
      await sleep(10_000);
      w = (await req("GET", "/api/montage")).b?.worker || {};
      ok(w.online && w.busy?.id === J.id, "vidéo, 60 s sans PATCH ni réclamation : toujours en ligne (occupé, 90 s au plus)", JSON.stringify(w));
      // « Arrêter » puis « Régénérer » avant que le Mac le voie : son rapport suivant est refusé (409, l'ordre de s'arrêter
      // pour un worker 0.14.0), mais dit qu'il est là. Sans cela la carte en file lirait « Ton Mac est éteint ».
      await patch(J.id, { stop: true });
      await patch(J.id, { regenerate: true });
      w = (await req("GET", "/api/montage")).b?.worker || {};
      if (w.online) info(`le Mac paraît encore en ligne avant l'écriture refusée (${JSON.stringify(w)}) : la vérification suivante ne prouve rien`);
      const lateRun = await patch(J.id, { step: "Claude écrit la vidéo…", progress: 0.06, phase: "write", run: cv.b?.job?.run?.startedAt });
      w = (await req("GET", "/api/montage")).b?.worker || {};
      ok(lateRun.s === 409 && w.online === true && !w.busy, "arrêter, régénérer, puis un rapport de l'ancien passage → 409, et le Mac reste « en ligne », pas occupé", `${lateRun.s} ${JSON.stringify(w)}`);
      await patch(J.id, { cancel: true });
    }

    // H. Valider une version : la vidéo va dans la bibliothèque (le média est supprimé à la fin).
    r = await patch(J.id, { approve: 3 });
    if (r.b?.media?.id) medias.push(r.b.media.id);
    ok(r.s === 200 && r.b?.job?.status === "done" && r.b.job.approved === 3 && !!r.b.media?.id && r.b.job.mediaId === r.b.media.id, "valider la version 3 → 200, terminé, média dans la bibliothèque", `${r.s} ${r.text.slice(0, 200)}`);
  } catch (e) {
    if (e.notRun) {
      console.log(`[check] non lancé : ${e.message}`);
      if (!created.length) return 2;
    }
    ok(false, `contrôle interrompu : ${e.message}`);
  } finally {
    for (const id of created) {
      await patch(id, { cancel: true }).catch(() => {});
      await req("DELETE", `/api/montage/jobs/${id}`).catch(() => {});
    }
    for (const id of medias) await req("DELETE", `/api/media/${id}`).catch(() => {});
    // La fiche de présence : le test a réclamé sous son nom (dernière version annoncée : 0.13.0 sans --slow), ce qui
    // ferait dire au Studio « Mac à mettre à jour ». Une dernière réclamation, file vide, remet le nom et la version
    // d'avant (ou VIDEO_WORKER s'il n'y en avait pas). Elle rafraîchit aussi la présence : le Mac paraît en ligne 30 s.
    if (before) {
      const name = before.name || NAME;
      const version = before.version || VIDEO_WORKER;
      try {
        await queueOk();
        const fix = await req("POST", "/api/montage/worker/claim", { worker: name, version });
        if (fix.s === 200) console.log(`[check] ✘ la réclamation de remise en état a pris un job (« ${fix.b?.job?.title} ») : remets-le en file à la main`);
        const w = (await req("GET", "/api/montage")).b?.worker || {};
        console.log(`[check] fiche de présence du Mac touchée par le test, remise à « ${w.name} » ${w.version} (elle paraît en ligne 30 s)`);
      } catch (e) {
        console.log(`[check] fiche de présence du Mac laissée à « ${NAME} » (dernière version annoncée par le test) : ${e.message}`);
      }
    }
  }
  const failed = results.filter((x) => x.ok === false);
  console.log(`\n${results.filter((x) => x.ok).length} vérifications passées, ${failed.length} en échec (${Math.round((Date.now() - t0) / 1000)} s ; jobs de test supprimés : ${created.length}).`);
  writeFileSync(join(out, "check.json"), JSON.stringify({ scenario: "server", server: base, slow, passed: results.filter((x) => x.ok).length, failed: failed.length, results }, null, 2));
  return failed.length ? 1 : 0;
}

const argv = process.argv.slice(2);
if (argv[0] === "--run" && argv[1] === "server") {
  serverRun(argv.slice(2)).then((code) => process.exit(code), (e) => { console.error("[check] ✘", e.message); process.exit(1); });
} else if (argv[0] === "--run") {
  orchestrate(argv.slice(1)).then((code) => process.exit(code), (e) => { console.error("[check] ✘", e.message); process.exit(1); });
} else if (argv[0] && !argv[0].startsWith("-")) {
  const orch = readJson(join(resolve(argv[0]), "orchestrator.json"), {});
  process.exit(check(argv[0], { orchestrator: orch }).some((r) => r.ok === false) ? 1 : 0);
} else {
  console.log("node test/check-video-run.mjs <dossier-sortie> | --run [scénario] [--root /tmp/mc] [--out dossier] [--port 3999] [--fake] [--minutes N] [--gsap dist]");
  console.log("  --minutes : par défaut suite 30 (avec --fake) ou 45 (vrai Claude), autres 15 (avec --fake) ou 20");
  console.log("node test/check-video-run.mjs --run server [--server http://localhost:3000] [--token API_TOKEN] [--slow] [--out dossier]");
  console.log(`scénarios : ${SCENARIOS.join(", ")}`);
  process.exit(2);
}
