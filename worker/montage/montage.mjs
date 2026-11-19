#!/usr/bin/env node
// Worker de montage Metricove (Mac). Voir README.md.
//   node montage.mjs              boucle : réclame une tâche toutes les 5 s, inventorie les rushes toutes les 60 s
//   node montage.mjs --once       une seule réclamation puis sortie
//   node montage.mjs --dry-run    réclame et travaille, mais n'envoie rien à Metricove (affiche les appels)
//   node montage.mjs --check      vérifie les outils, le disque et la connexion (et le reel vidéo)
//   node montage.mjs --setup      télécharge le modèle Whisper (≈ 1,6 Go) après vérification de la place
//   node montage.mjs --setup-reel prépare le reel vidéo : GSAP local, Chrome hors ligne, rendu de mesure, test de Claude
import { existsSync, createWriteStream, renameSync, readFileSync, writeFileSync, rmSync, copyFileSync, chmodSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadConfig, log, sleep, run, freeGb, ensureDir, home, HERE } from "./lib/util.mjs";
import { Api } from "./lib/api.mjs";
import { scan } from "./lib/rushes.mjs";
import { handle } from "./lib/jobs.mjs";
import { listTracks } from "./lib/audio.mjs";
import { macBrollList, setBrollApi } from "./lib/broll.mjs";
import { claudeFlags } from "./lib/claude.mjs";
import * as HF from "./lib/reel/hf-cli.mjs";
import { stagePage } from "./lib/reel/stage.mjs";
import { speedOf, learnStats, readStats, statsFile } from "./lib/reel/progress.mjs";
import { FPS, GSAP } from "./lib/reel/vocab.mjs";

const VERSION = "0.14.0";
const argv = new Set(process.argv.slice(2));
const cfg = loadConfig();
const CONFIG_FILE = process.env.MONTAGE_CONFIG || join(HERE, "config.json");
const FIXTURES = join(HERE, "test", "fixtures", "reel");

async function check() {
  const ok = (b, m) => console.log(`${b ? "✔" : "✘"} ${m}`);
  const warn = (m) => console.log(`! ${m}`);
  for (const [bin, args] of [["ffmpeg", ["-version"]], ["ffprobe", ["-version"]], [cfg.whisper.bin, ["--help"]], ["swift", ["--version"]], [cfg.claude.bin, ["--version"]], ["npx", ["--version"]]]) {
    ok(await run(bin, args).then(() => true, () => false), bin);
  }
  ok(existsSync(cfg.whisper.model), `modèle Whisper ${cfg.whisper.model}`);
  ok(freeGb(cfg.workDir) >= cfg.minFreeGb, `disque : ${freeGb(cfg.workDir).toFixed(1)} Go libres (minimum ${cfg.minFreeGb})`);
  ok(!!cfg.apiToken, "jeton API");
  const r = await fetch(cfg.metricoveUrl + "/login").then((x) => x.status, (e) => e.message);
  ok(r === 200, `Metricove ${cfg.metricoveUrl} (${r})`);

  // Reel vidéo (worker 0.14.0).
  const g = gsapState();
  ok(g.core, `GSAP local ${cfg.gsapDir || "(gsapDir absent : lance --setup-reel)"}`);
  if (g.core && g.missing.length) warn(`plugins GSAP absents : ${g.missing.join(", ")} (les moments qui s'en servent seront retirés)`);
  // La fixture écrite, lint, puis une image par le Chrome du rendu (le script hors ligne s'il est là) : un Chrome que ce
  // Mac refuserait ferait échouer toutes les vidéos, une simple présence du script ne suffit pas.
  const offline = HF.offlineBrowser(cfg);
  try {
    const dir = join(cfg.workDir, "check-reel");
    rmSync(dir, { recursive: true, force: true });
    const { plan } = fixture();
    await stagePage(cfg, plan, ensureDir(join(dir, "hf")), { safe: false, notes: [] });
    const l = await HF.lint(cfg, join(dir, "hf"));
    ok(!l.blocking.length, `hyperframes lint sur la fixture${l.blocking.length ? ` : ${l.blocking.map((f) => f.message).join(" ; ").slice(0, 300)}` : ""}`);
    const p = await HF.probeBrowser(cfg, join(dir, "hf"));
    if (offline) ok(p.ok, p.ok ? `Chrome hors ligne ${offline} (une image rendue)` : `Chrome hors ligne refusé (${p.error.slice(0, 200)}) : relance --setup-reel (il le retire si ce Mac le refuse) ou supprime ${offline}`);
    else {
      ok(p.ok, p.ok ? "Chrome de HyperFrames (une image rendue)" : `Chrome de HyperFrames : ${p.error.slice(0, 200)}`);
      warn("Chrome hors ligne absent (lance --setup-reel) : seule la CSP de la page bloque le réseau");
    }
    rmSync(dir, { recursive: true, force: true });
  } catch (e) { ok(false, `hyperframes sur la fixture : ${e.message}`); }
  const f = await claudeFlags(cfg);
  ok(f.found && f.restricted && f.tools && f.stream, f.found ? `claude : --restricted, --tools, stream-json${f.missing.length ? ` (manque ${f.missing.join(", ")} : mets Claude Code à jour)` : ""}` : "claude introuvable");
  if (cfg.reel?.restricted === false) warn("reel.restricted = false : Claude refuse le mode restreint sur ce Mac, les vidéos s'écrivent par l'ancien appel, sans relecture en images (lance « claude » puis /login, puis --setup-reel)");
  const s = readStats(cfg);
  ok(existsSync(statsFile(cfg)), existsSync(statsFile(cfg)) ? `reel-stats.json : ${s.frameMs ?? "?"} ms par image, écriture ${s.write ?? "?"} s, ${s.runs ?? 0} mesure(s)` : "reel-stats.json absent (lance --setup-reel pour amorcer le temps restant)");
}

/** gsapDir contient-il gsap.min.js et les plugins ? */
function gsapState(dir = home(cfg.gsapDir)) {
  const has = (f) => !!dir && existsSync(join(dir, f));
  return { core: has(GSAP.core), missing: GSAP.plugins.filter((p) => !has(p.file)).map((p) => p.name) };
}

/** La fixture de mesure : smoke-3s.json (paquet A) si elle est là, sinon score-basic.json. Renvoie { plan, name }. */
function fixture() {
  for (const name of ["smoke-3s.json", "score-basic.json"]) {
    const f = join(FIXTURES, name);
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, "utf8"));
    const plan = j.plan || j;
    if (plan?.video?.beats?.length) return { plan, name };
  }
  throw new Error(`Aucune fixture de reel dans ${FIXTURES}.`);
}

/** Ajoute des clés à config.json (copie config.json.bak avant) et affiche ce qui a changé. */
function updateConfig(patch) {
  const own = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : {};
  const lines = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "reel") {
      own.reel = own.reel || {};
      for (const [rk, rv] of Object.entries(v)) if (own.reel[rk] !== rv) { own.reel[rk] = rv; lines.push(`reel.${rk} = ${JSON.stringify(rv)}`); }
    } else if (own[k] === undefined || own[k] === "") { own[k] = v; lines.push(`${k} = ${JSON.stringify(v)}`); }
  }
  if (!lines.length) return;
  if (existsSync(CONFIG_FILE)) copyFileSync(CONFIG_FILE, CONFIG_FILE + ".bak");
  writeFileSync(CONFIG_FILE, JSON.stringify(own, null, 2) + "\n");
  log(`config.json mis à jour${existsSync(CONFIG_FILE + ".bak") ? " (copie dans config.json.bak)" : ""} :`);
  for (const l of lines) console.log(`  + ${l}`);
}

/** Empreinte image par image d'une vidéo (ffmpeg framemd5, sans les lignes d'en-tête). */
async function framemd5(file) {
  const out = await run("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v", "-f", "framemd5", "-"], { timeoutMs: 120_000 });
  return out.split("\n").filter((l) => l && !l.startsWith("#")).join("\n");
}

async function setupReel() {
  ensureDir(cfg.workDir);
  // 1. GSAP local (le rendu ne télécharge plus rien ; l'ancien rendu à scènes devient hors ligne aussi).
  const tools = ensureDir(join(dirname(cfg.workDir), "outils", "gsap"));
  const dist = join(tools, "package", "dist");
  if (!existsSync(join(dist, GSAP.core))) {
    log(`téléchargement de gsap@${GSAP.version}…`);
    const out = await run("npm", ["pack", `gsap@${GSAP.version}`, "--silent"], { cwd: tools, timeoutMs: 180_000 });
    const tgz = out.trim().split("\n").pop().trim();
    await run("tar", ["-xzf", tgz], { cwd: tools, timeoutMs: 60_000 });
    rmSync(join(tools, tgz), { force: true });
  }
  const g = gsapState(dist);
  if (!g.core) throw new Error(`gsap.min.js introuvable dans ${dist}.`);
  log(`GSAP local : ${dist}${g.missing.length ? ` (plugins absents : ${g.missing.join(", ")})` : " (plugins présents)"}`);
  updateConfig({ gsapDir: dist, gsapFile: join(dist, GSAP.core) });
  cfg.gsapDir = cfg.gsapDir || dist;
  cfg.gsapFile = cfg.gsapFile || join(dist, GSAP.core);

  // 2. Chrome de HyperFrames, lancé sans DNS hors de la boucle locale.
  log("Chrome de HyperFrames…");
  const chrome = await HF.browserPath(cfg, { ensure: true });
  const script = join(cfg.workDir, "chrome-offline.sh");
  writeFileSync(script, `#!/bin/sh\n# Écrit par node montage.mjs --setup-reel : Chrome sans DNS hors de la boucle locale (reel vidéo).\nexec "${chrome.replace(/(["\\$`])/g, "\\$1")}" --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1" "$@"\n`);
  chmodSync(script, 0o755);

  // 3. La fixture de mesure, lint, puis une image par le script : si ce Mac le refuse, il est retiré (CSP seule).
  const { plan, name } = fixture();
  const dir = join(cfg.workDir, "setup-reel");
  rmSync(dir, { recursive: true, force: true });
  const hf = ensureDir(join(dir, "hf"));
  const stage = await stagePage(cfg, plan, hf, { safe: false, notes: [] });
  const frames = Math.round(stage.duration * FPS);
  const l = await HF.lint(cfg, hf);
  if (l.blocking.length) throw new Error(`hyperframes lint refuse la fixture : ${l.blocking.map((f) => f.message).join(" ; ").slice(0, 400)}`);
  // Deux essais avec le script : un raté passager (Mac chargé, délai) ne le retire pas. Il n'est retiré que s'il échoue
  // deux fois ET que le Chrome de HyperFrames, lancé sans lui, rend l'image ; sinon il est remis en place.
  let probe = await HF.probeBrowser(cfg, hf);
  if (!probe.ok) {
    log(`Chrome hors ligne : premier essai raté (${probe.error.slice(0, 300)}) : nouvel essai`);
    probe = await HF.probeBrowser(cfg, hf);
  }
  if (probe.ok) log(`Chrome hors ligne : ${script} ✔`);
  else {
    log(`Chrome hors ligne : second essai raté (${probe.error.slice(0, 300)}) : essai sans le script`);
    const aside = `${script}.essai`;
    renameSync(script, aside);
    const plain = await HF.probeBrowser(cfg, hf);
    if (!plain.ok) {
      renameSync(aside, script);
      throw new Error(`${HF.LAUNCH_FAILURE.test(plain.error) ? HF.chromeDown(plain.error) : `Le Chrome de HyperFrames ne rend aucune image (${plain.error.slice(0, 300)}).`} Si ça recommence, signale-le.`);
    }
    rmSync(aside, { force: true });
    log(`! Chrome hors ligne refusé par ce Mac (${probe.error.slice(0, 200)}) : seule la CSP bloque le réseau (le reste marche).`);
  }

  // 4. Rendu de mesure, deux fois : temps par image (temps restant du Studio) et déterminisme SUR ce Mac.
  const sums = [], times = [], captures = [];
  let summary = null;
  for (const k of [1, 2]) {
    log(`rendu de mesure ${k}/2 (${name}, ${frames} images)…`);
    const out = join(dir, `mesure-${k}.mp4`);
    const t0 = Date.now();
    summary = await HF.render(cfg, hf, out, { timeoutMs: HF.renderTimeout(frames, 400) });
    times.push(Date.now() - t0);
    if (summary.captureS > 0) captures.push(summary.captureS * 1000);
    sums.push(await framemd5(out));
  }
  // Sur 3 s, le démarrage (Chrome, compilation) pèse plus que les images : la boucle de capture seule, si le résumé la donne.
  const frameMs = (captures.length ? Math.min(...captures) : Math.min(...times)) / Math.max(1, frames);
  learnStats(cfg, { frameMs });
  const same = sums[0] === sums[1];
  log(`mesure : ${Math.round(frameMs)} ms par image (${(Math.min(...times) / 1000).toFixed(1)} s pour ${frames} images), capture ${summary.mode || "?"}${summary.gpu ? `, gpu ${summary.gpu}` : ""}`);
  if (same) log("déterminisme : les deux rendus sont identiques image par image ✔");
  else log("✘ déterminisme : les deux rendus diffèrent. Les vidéos restent utilisables, mais signale-le (worker/montage/README.md).");
  rmSync(dir, { recursive: true, force: true });

  // 5. Claude en mode restreint.
  const f = await claudeFlags(cfg, { refresh: true });
  if (!f.found) log("✘ claude introuvable : vérifie claude.bin dans config.json.");
  else if (!f.ok && f.missing.length) log(`! Claude Code est trop ancien (manque ${f.missing.join(", ")}) : les vidéos s'écriront sans relecture en images. Mets-le à jour.`);
  else {
    try {
      // Le même appel que askStream (mode restreint, sans MCP de l'utilisateur, sans session gardée, même modèle).
      const args = ["-p", "--restricted", "--tools", "", "--output-format", "json", ...(f.strictMcp ? ["--strict-mcp-config"] : []), ...(f.noSession ? ["--no-session-persistence"] : []), ...(cfg.claude.model ? ["--model", cfg.claude.model] : [])];
      const out = await run(cfg.claude.bin, args, { input: "Réponds ok", timeoutMs: 90_000 });
      const j = JSON.parse(out.slice(out.indexOf("{")));
      if (j.is_error) throw new Error(String(j.result || j.subtype));
      log("Claude en mode restreint : ok ✔");
      if (cfg.reel?.restricted === false) updateConfig({ reel: { restricted: true } });
    } catch (e) {
      if (/OAuth|authenticat|not logged|log ?in|401/i.test(e.message)) {
        updateConfig({ reel: { restricted: false } });
        log("! Claude refuse le mode restreint à l'authentification : reel.restricted = false (ancien appel, sans relecture en images).");
      } else log(`! test de Claude impossible (${e.message.slice(0, 200)}) : réessaie plus tard avec --setup-reel.`);
    }
  }
  log("reel vidéo prêt. Lance node montage.mjs --check, puis redémarre le worker.");
}

async function setup() {
  const need = 2.5;
  const gb = freeGb(dirname(cfg.whisper.model));
  if (existsSync(cfg.whisper.model)) return log("modèle déjà présent");
  if (gb < need + cfg.minFreeGb) throw new Error(`Pas assez de place pour le modèle : ${gb.toFixed(1)} Go libres, il faut ${need + cfg.minFreeGb} Go.`);
  ensureDir(dirname(cfg.whisper.model));
  log("téléchargement du modèle Whisper…");
  const r = await fetch(cfg.whisper.modelUrl);
  if (!r.ok) throw new Error(`téléchargement → ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(cfg.whisper.model + ".part"));
  renameSync(cfg.whisper.model + ".part", cfg.whisper.model);
  log("modèle prêt :", cfg.whisper.model);
}

/**
 * Un seul worker par Mac : <workDir>/worker.lock = { pid, startedAt }, créé d'un coup (flag wx). Un verrou laissé par un
 * worker planté (coupure, kill -9) est repris si son pid n'est plus un « node … montage.mjs » (le pid peut avoir été
 * redonné à un autre programme). Retiré à la sortie ; l'arrêt par un signal (util.mjs) tue aussi Chrome et Claude.
 */
function takeLock() {
  ensureDir(cfg.workDir);
  const file = join(cfg.workDir, "worker.lock");
  const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  for (let k = 0; ; k++) {
    try { writeFileSync(file, body, { flag: "wx" }); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    let pid = 0;
    try { pid = Number(JSON.parse(readFileSync(file, "utf8"))?.pid) || 0; } catch { /* vide ou illisible */ }
    // Un verrou vide de moins de 10 s : un autre worker est en train de l'écrire.
    const young = (() => { try { return Date.now() - statSync(file).mtimeMs < 10_000; } catch { return false; } })();
    if ((pid && pid !== process.pid && isWorker(pid)) || (!pid && young)) {
      throw new Error(`Un autre worker tourne déjà${pid ? ` (pid ${pid})` : ""}. Si ce n'est pas le cas, supprime ${file} puis relance.`);
    }
    if (k) throw new Error(`Le verrou ${file} ne peut pas être repris : supprime-le puis relance.`);
    log(`verrou orphelin repris${pid ? ` (pid ${pid} : plus de worker)` : ""}`);
    rmSync(file, { force: true });
  }
  process.on("exit", () => {
    try { if (Number(JSON.parse(readFileSync(file, "utf8")).pid) === process.pid) rmSync(file, { force: true }); } catch { /* déjà retiré */ }
  });
}

/** Le pid est-il un worker vivant (node … montage.mjs) ? Sans ps, un pid vivant compte comme un worker (prudence). */
function isWorker(pid) {
  try { process.kill(pid, 0); } catch (e) { if (e.code !== "EPERM") return false; }
  try {
    return /montage\.mjs/.test(execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5000 }));
  } catch (e) {
    return e.status !== 1; // ps sort 1 quand le pid n'existe plus
  }
}

async function loop() {
  takeLock();
  const api = new Api(cfg, { dryRun: argv.has("--dry-run") });
  log(`worker de montage ${VERSION} → ${cfg.metricoveUrl}${api.dryRun ? " (essai à blanc)" : ""}`);
  let lastScan = 0;
  let sentTracks = null, sentAt = 0;
  let sentBroll = null, brollAt = 0;
  setBrollApi(api);
  for (;;) {
    try {
      if (Date.now() - lastScan > cfg.scanSeconds * 1000) {
        lastScan = Date.now();
        const list = await scan(api, cfg).catch((e) => { log("inventaire des rushes :", e.message); return []; });
        if (list.length) log(`${list.length} rush(es) dans ${cfg.rushesDir}`);
      }
      // La liste des morceaux part avec la demande quand elle a changé (et une fois au démarrage) : la page les propose par nom.
      let tracks;
      try { const now = listTracks(cfg).slice(0, 200); if (now.join("\n") !== sentTracks || Date.now() - sentAt > 600_000) tracks = now; } catch { /* dossier illisible : la page garde sa liste */ }
      // Les plans du dossier B-roll (avec une petite image) partent de même quand ils ont changé : la page les propose.
      let brolls, brollKey;
      try {
        const { list } = await macBrollList(cfg);
        brollKey = createHash("sha1").update(JSON.stringify(list.map((x) => [x.name, x.thumb || "", x.dur]))).digest("hex");
        if (brollKey !== sentBroll || Date.now() - brollAt > 600_000) brolls = list;
      } catch { /* dossier illisible : la page garde sa liste */ }
      // La vitesse apprise de ce Mac (ms par image, durée d'écriture) : le site en tire « prête dans environ N min ».
      const claimed = await api.claim(VERSION, tracks, brolls, speedOf(cfg));
      if (tracks) { sentTracks = tracks.join("\n"); sentAt = Date.now(); }
      if (brolls) { sentBroll = brollKey; brollAt = Date.now(); }
      if (claimed?.job) {
        log(`tâche « ${claimed.job.title} » → ${claimed.action}`);
        await handle(api, cfg, claimed);
        lastScan = 0;
        if (argv.has("--once")) return;
        continue;
      }
    } catch (e) { log("erreur :", e.message); }
    if (argv.has("--once")) return;
    await sleep(cfg.pollSeconds * 1000);
  }
}

const main = argv.has("--check") ? check : argv.has("--setup-reel") ? setupReel : argv.has("--setup") ? setup : loop;
main().catch((e) => { console.error("✘", e.message); process.exit(1); });
