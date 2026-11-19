// Outils communs : configuration, commandes, disque, journal.
import { spawn, execFileSync } from "node:child_process";
import { isatty } from "node:tty";
import { StringDecoder } from "node:string_decoder";
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
  // Réglages du reel vidéo : une clé absente de config.json garde la valeur de config.example.json.
  cfg.reel = { ...base.reel, ...own.reel };
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

/** Groupes de processus lancés avec un délai ou une annulation (detached) : tués si le worker s'arrête. */
const groups = new Set();

/**
 * Les groupes de processus d'un arbre lancé par run() : celui de l'enfant et ceux de tous ses descendants. Chrome,
 * lancé par puppeteer dans HyperFrames, a son propre groupe : tuer seulement le groupe de npx le laisserait orphelin.
 * Le groupe du worker lui-même n'en fait jamais partie. Synchrone (utilisable à la sortie du processus).
 */
export function treeGroups(pid) {
  const out = new Set([pid]);
  try {
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8", timeout: 5000 })
      .trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length === 3 && r.every(Number.isFinite));
    const kids = new Map(), group = new Map();
    for (const [p, pp, g] of rows) { group.set(p, g); if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
    const stack = [pid, ...rows.filter((r) => r[2] === pid).map((r) => r[0])], seen = new Set();
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      if (group.has(x)) out.add(group.get(x));
      for (const k of kids.get(x) || []) stack.push(k);
    }
    out.delete(group.get(process.pid));
  } catch { /* ps indisponible : le groupe de l'enfant seul */ }
  out.delete(0); out.delete(1); out.delete(process.pid);
  return [...out];
}
const killGroups = (list, sig) => { for (const g of list) { try { process.kill(-g, sig); } catch { /* déjà parti */ } } };

/** Tue tous les arbres encore vivants (sortie du worker, Ctrl-C) : aucun Chrome ni Claude orphelin. */
export function killAll(sig = "SIGKILL") {
  for (const pid of groups) killGroups(treeGroups(pid), sig);
  groups.clear();
}
process.on("exit", () => killAll());

/**
 * Arrêt par un signal (Ctrl-C, fenêtre du Terminal fermée, kill, Portly ; SIGHUP plus bas) : les commandes gardées sont lancées dans
 * leur propre session (detached) et ne reçoivent donc plus le signal du terminal. Pour toutes les entrées (boucle,
 * --setup-reel, --check) : SIGTERM aux arbres en cours, SIGKILL 1,5 s plus tard, puis sortie avec 128 + n (les
 * gestionnaires « exit » tournent : verrou retiré). Un second signal sort tout de suite. Un `kill -9` du worker,
 * lui, ne peut rien nettoyer.
 */
let stopping = false;
function onSignal(sig, n) {
  const code = 128 + n;
  if (stopping) { killAll("SIGKILL"); process.exit(code); }
  stopping = true;
  const busy = groups.size > 0;
  if (busy) console.log(`[${new Date().toLocaleTimeString("fr-CH", { hour12: false })}] arrêt (${sig}) : arrêt des commandes en cours…`);
  const trees = [...groups].flatMap((pid) => treeGroups(pid));
  killGroups(trees, "SIGTERM");
  // Minuterie non « unref » : elle garde le processus en vie pendant l'attente.
  setTimeout(() => {
    killGroups([...new Set([...trees, ...[...groups].flatMap((pid) => treeGroups(pid))])], "SIGKILL");
    groups.clear();
    process.exit(code);
  }, busy ? 1500 : 0);
}
for (const [sig, n] of [["SIGINT", 2], ["SIGTERM", 15], ["SIGQUIT", 3]]) {
  try { process.on(sig, () => onSignal(sig, n)); } catch { /* signal inconnu sur ce système */ }
}

/**
 * SIGHUP (fenêtre du Terminal fermée). Node remet à zéro au démarrage un signal ignoré par le parent : sous
 * `nohup node montage.mjs &`, SIGHUP tue donc Node quoi qu'on fasse, sauf s'il l'écoute. Lancé depuis un terminal
 * (une entrée ou une sortie est un terminal), le worker s'arrête proprement avec ses commandes ; détaché (nohup,
 * Portly, sorties redirigées), il ignore SIGHUP et continue, comme le promet nohup. MONTAGE_SIGHUP=stop ou ignore
 * force l'un ou l'autre. Renvoie le choix fait ("stop" | "ignore").
 */
export function sighupMode(env = process.env, tty = [0, 1, 2].some((fd) => { try { return isatty(fd); } catch { return false; } })) {
  const forced = String(env.MONTAGE_SIGHUP || "").toLowerCase();
  if (forced === "stop" || forced === "ignore") return forced;
  return tty ? "stop" : "ignore";
}
let hupSeen = false;
try {
  process.on("SIGHUP", sighupMode() === "stop" ? () => onSignal("SIGHUP", 1) : () => {
    if (!hupSeen) { hupSeen = true; log("SIGHUP ignoré : le worker tourne détaché du terminal (nohup). Arrête-le avec Ctrl-C, kill ou Portly."); }
  });
} catch { /* signal inconnu sur ce système */ }

/** Durée lisible en français : 45 s, 6 min, 2 min 30. */
export const fmtDelay = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${String(r).padStart(2, "0")}` : `${m} min`;
};

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[=>]/g;

/**
 * Lance une commande ; rejette avec la fin de stderr si elle échoue. `stderr: true` renvoie stderr (silencedetect, loudnorm).
 * Options du reel vidéo (absentes : comportement d'origine) :
 * - `timeoutMs` : au-delà, le groupe de processus reçoit SIGTERM puis SIGKILL 3 s plus tard ; erreur `code = "TIMEOUT"` ;
 * - `signal` (AbortSignal) : même arrêt ; l'erreur est `signal.reason` si c'en est une (annulation), sinon `code = "ABORT"` ;
 * - `onLine(line, stream)` : chaque ligne de stdout et stderr (découpée sur \r et \n, sans codes ANSI) ;
 * - `codes` : codes de sortie acceptés en plus de 0 (lint et check sortent 1 quand ils trouvent des erreurs) ;
 * - `keep` : octets de stdout gardés au plus (les derniers), pour les longues sorties suivies ligne à ligne.
 * stderr est gardé en entier quand on le demande (`stderr: true` : silencedetect écrit une ligne par pause, toutes
 * comptent) ; sinon seuls ses derniers 100 à 200 Ko (le message d'erreur est à la fin). Chaque flux est décodé par un
 * seul StringDecoder : une lettre accentuée coupée entre deux morceaux du tube reste entière (pas de « � »).
 */
export function run(cmd, args, { cwd, input, quiet = true, env, binary = false, stderr = false, timeoutMs, signal, onLine, codes = [], keep } = {}) {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(abortError(cmd, signal));
    const guarded = !!(timeoutMs || signal);
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, ...(guarded ? { detached: true } : {}) });
    if (guarded && p.pid) groups.add(p.pid);
    const chunks = []; let err = ""; let size = 0;
    let stopped = null, killTimer = null;
    const stop = (why) => {
      if (stopped) return;
      stopped = why;
      // L'arbre est relevé avant le premier signal : un Chrome devenu orphelin reste visé par le SIGKILL.
      const tree = treeGroups(p.pid);
      const kill = (sig) => { killGroups(tree, sig); try { p.kill(sig); } catch { /* déjà parti */ } };
      kill("SIGTERM");
      killTimer = setTimeout(() => { killGroups(treeGroups(p.pid).filter((g) => !tree.includes(g)), "SIGKILL"); kill("SIGKILL"); }, 3000);
      killTimer.unref?.();
    };
    const timer = timeoutMs ? setTimeout(() => stop("timeout"), timeoutMs) : null;
    const onAbort = () => stop("abort");
    signal?.addEventListener("abort", onAbort, { once: true });
    const lines = { stdout: "", stderr: "" };
    const dec = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    const feed = (text, which) => {
      if (!onLine || !text) return;
      const parts = (lines[which] + text).split(/[\r\n]+/);
      lines[which] = parts.pop();
      for (const l of parts) { const t = l.replace(ANSI, ""); if (t.trim()) { try { onLine(t, which); } catch { /* un lecteur de lignes ne fait pas tomber la commande */ } } }
    };
    p.stdout.on("data", (d) => {
      chunks.push(d); size += d.length;
      if (keep && size > keep * 2) { const b = Buffer.concat(chunks).subarray(-keep); chunks.length = 0; chunks.push(b); size = b.length; }
      if (!quiet) process.stdout.write(d);
      if (onLine) feed(dec.stdout.write(d), "stdout");
    });
    p.stderr.on("data", (d) => {
      const text = dec.stderr.write(d);
      err += text;
      if (!stderr && err.length > 200_000) err = err.slice(-100_000);
      if (!quiet) process.stderr.write(d);
      feed(text, "stderr");
    });
    p.on("error", (e) => { clearTimeout(timer); groups.delete(p.pid); rej(e); });
    p.on("close", (code) => {
      clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      groups.delete(p.pid);
      const tail = { stdout: dec.stdout.end(), stderr: dec.stderr.end() };
      err += tail.stderr;
      if (onLine) for (const w of ["stdout", "stderr"]) { const t = (lines[w] + tail[w]).replace(ANSI, ""); if (t.trim()) { try { onLine(t, w); } catch { /* idem */ } } }
      const out = binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf8");
      if (stopped === "timeout") {
        const sub = args.find((a) => /^[a-z][\w-]{0,20}$/.test(a));
        const e = new Error(`${cmd.split("/").pop()}${sub ? ` ${sub}` : ""} a dépassé ${fmtDelay(timeoutMs)} et a été arrêté.`);
        e.code = "TIMEOUT"; e.output = out;
        return rej(e);
      }
      if (stopped === "abort") return rej(abortError(cmd, signal));
      if (code === 0 || codes.includes(code)) return res(stderr ? err : out);
      // Claude Code en mode -p écrit son erreur dans le JSON de sortie, pas dans stderr.
      let detail = err.trim();
      if (!detail) { try { detail = JSON.parse(String(out)).result || ""; } catch { detail = String(out).trim(); } }
      if (/OAuth|authenticate|login/i.test(detail)) detail = `Claude Code n'est plus connecté sur le Mac (${detail}). Ouvrez un Terminal, lancez « claude » puis /login.`;
      const e = new Error(`${cmd.split("/").pop()} a échoué (${code}) : ${detail.slice(-800)}`);
      e.exitCode = code; e.output = out; e.stderr = err;
      rej(e);
    });
    // Un enfant qui sort avant d'avoir tout lu (EPIPE) ne fait pas tomber le worker.
    p.stdin.on("error", () => {});
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

/** L'erreur d'une commande arrêtée par un AbortSignal : sa raison si c'est une erreur (annulation, délai du job). */
function abortError(cmd, signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const e = new Error(`${cmd.split("/").pop()} a été arrêté.`);
  e.code = "ABORT";
  return e;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
