#!/usr/bin/env node
// Worker de montage Metricove (Mac). Voir README.md.
//   node montage.mjs              boucle : réclame une tâche toutes les 5 s, inventorie les rushes toutes les 60 s
//   node montage.mjs --once       une seule réclamation puis sortie
//   node montage.mjs --dry-run    réclame et travaille, mais n'envoie rien à Metricove (affiche les appels)
//   node montage.mjs --check      vérifie les outils, le disque et la connexion
//   node montage.mjs --setup      télécharge le modèle Whisper (≈ 1,6 Go) après vérification de la place
import { existsSync, createWriteStream, renameSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadConfig, log, sleep, run, freeGb, ensureDir } from "./lib/util.mjs";
import { Api } from "./lib/api.mjs";
import { scan } from "./lib/rushes.mjs";
import { handle } from "./lib/jobs.mjs";

const VERSION = "0.6.0";
const argv = new Set(process.argv.slice(2));
const cfg = loadConfig();

async function check() {
  const ok = (b, m) => console.log(`${b ? "✔" : "✘"} ${m}`);
  for (const [bin, args] of [["ffmpeg", ["-version"]], ["ffprobe", ["-version"]], [cfg.whisper.bin, ["--help"]], ["swift", ["--version"]], [cfg.claude.bin, ["--version"]], ["npx", ["--version"]]]) {
    ok(await run(bin, args).then(() => true, () => false), bin);
  }
  ok(existsSync(cfg.whisper.model), `modèle Whisper ${cfg.whisper.model}`);
  ok(freeGb(cfg.workDir) >= cfg.minFreeGb, `disque : ${freeGb(cfg.workDir).toFixed(1)} Go libres (minimum ${cfg.minFreeGb})`);
  ok(!!cfg.apiToken, "jeton API");
  const r = await fetch(cfg.metricoveUrl + "/login").then((x) => x.status, (e) => e.message);
  ok(r === 200, `Metricove ${cfg.metricoveUrl} (${r})`);
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

async function loop() {
  const api = new Api(cfg, { dryRun: argv.has("--dry-run") });
  log(`worker de montage ${VERSION} → ${cfg.metricoveUrl}${api.dryRun ? " (essai à blanc)" : ""}`);
  let lastScan = 0;
  for (;;) {
    try {
      if (Date.now() - lastScan > cfg.scanSeconds * 1000) {
        lastScan = Date.now();
        const list = await scan(api, cfg).catch((e) => { log("inventaire des rushes :", e.message); return []; });
        if (list.length) log(`${list.length} rush(es) dans ${cfg.rushesDir}`);
      }
      const claimed = await api.claim(VERSION);
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

const main = argv.has("--check") ? check : argv.has("--setup") ? setup : loop;
main().catch((e) => { console.error("✘", e.message); process.exit(1); });
