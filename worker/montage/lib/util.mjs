// Outils communs : configuration, commandes, disque, journal.
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const home = (p) => (typeof p === "string" && p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

export function log(...a) {
  const t = new Date().toLocaleTimeString("fr-CH", { hour12: false });
  console.log(`[${t}]`, ...a);
}

/** Lit config.json (à côté du worker), complète avec config.example.json et résout les chemins « ~ ». */
export function loadConfig(path = process.env.MONTAGE_CONFIG || join(HERE, "config.json")) {
  const base = JSON.parse(readFileSync(join(HERE, "config.example.json"), "utf8"));
  const own = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const cfg = { ...base, ...own, whisper: { ...base.whisper, ...own.whisper }, claude: { ...base.claude, ...own.claude }, theme: { ...base.theme, ...own.theme }, themes: own.themes || {} };
  for (const k of ["apiTokenFile", "rushesDir", "workDir"]) cfg[k] = home(cfg[k]);
  cfg.whisper.model = home(cfg.whisper.model);
  cfg.claude.bin = home(cfg.claude.bin);
  cfg.apiToken = process.env.METRICOVE_API_TOKEN || readToken(cfg.apiTokenFile);
  if (process.env.METRICOVE_URL) cfg.metricoveUrl = process.env.METRICOVE_URL;
  return cfg;
}

/**
 * Thème d'une tâche : le thème par défaut de la config, surchargé par `themes[projectId]`
 * puis par `job.theme` (apparence du profil de style du projet). Clés : font, fontFiles, accent, text, ink, dark, logo…
 */
export function themeFor(cfg, job = {}) {
  const t = { ...cfg.theme, ...(job.projectId && cfg.themes[job.projectId]), ...(job.theme || {}) };
  t.fontFiles = (t.fontFiles || []).map(home);
  t.logo = t.logo ? home(t.logo) : "";
  return t;
}

/** Le jeton est la ligne API_TOKEN=… du fichier de secrets (jamais affiché). */
function readToken(file) {
  if (!file || !existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("API_TOKEN="));
  return line ? line.slice("API_TOKEN=".length).trim() : "";
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

/** Espace libre (Go) sur le disque qui contient `p` (ou son premier parent existant). */
export function freeGb(p) {
  let d = p;
  while (!existsSync(d) && d !== dirname(d)) d = dirname(d);
  const s = statfsSync(d);
  return (s.bavail * s.bsize) / 1e9;
}

export function assertSpace(cfg, need = cfg.minFreeGb) {
  const gb = freeGb(cfg.workDir);
  if (gb < need) throw new Error(`Disque presque plein : ${gb.toFixed(1)} Go libres, il en faut au moins ${need}. Libérez de la place ou changez workDir/rushesDir dans config.json.`);
}

/** Lance une commande ; rejette avec la fin de stderr si elle échoue. `stderr: true` renvoie stderr (silencedetect, loudnorm). */
export function run(cmd, args, { cwd, input, quiet = true, env, binary = false, stderr = false } = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    const chunks = []; let err = "";
    p.stdout.on("data", (d) => { chunks.push(d); if (!quiet) process.stdout.write(d); });
    p.stderr.on("data", (d) => { err += d; if (!quiet) process.stderr.write(d); });
    p.on("error", rej);
    p.on("close", (code) => {
      const out = binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf8");
      if (code === 0) return res(stderr ? err : out);
      // Claude Code en mode -p écrit son erreur dans le JSON de sortie, pas dans stderr.
      let detail = err.trim();
      if (!detail) { try { detail = JSON.parse(String(out)).result || ""; } catch { detail = String(out).trim(); } }
      if (/OAuth|authenticate|login/i.test(detail)) detail = `Claude Code n'est plus connecté sur le Mac (${detail}). Ouvrez un Terminal, lancez « claude » puis /login.`;
      rej(new Error(`${cmd.split("/").pop()} a échoué (${code}) : ${detail.slice(-800)}`));
    });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
