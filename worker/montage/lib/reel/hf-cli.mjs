// HyperFrames pour le reel vidéo (paquet B) : environnement, Chrome hors ligne, lint, check, snapshot, render, et
// l'attribution des constats (moteur ou moment). HyperFrames reste épinglé (vocab.HF_PACKAGE) : lint, check, snapshot
// et render seulement, jamais validate (déprécié), add ni skills update. Chaque appel a un délai et s'arrête avec son
// groupe de processus (run de util.mjs).
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { run, log } from "../util.mjs";
import { HF_PACKAGE, MOMENT_ID, SAFE } from "./vocab.mjs";

/** Délais par défaut (ms). render : 120 s + maxFrameMs par image, plafonné à 25 min (renderTimeout). */
export const HF_TIMEOUTS = Object.freeze({ lint: 60_000, check: 180_000, snapshot: 120_000, browser: 300_000 });

/** Le script qui lance Chrome sans DNS hors de la boucle locale (écrit par --setup-reel), s'il est là et exécutable. */
export function offlineBrowser(cfg) {
  const f = join(cfg.workDir, "chrome-offline.sh");
  try { return existsSync(f) && statSync(f).mode & 0o111 ? f : null; } catch { return null; }
}

let warned = false;

/**
 * Variables de chaque appel HyperFrames : ni télémétrie, ni vérification de mise à jour, ni installation automatique,
 * ni skills ; Chrome hors ligne s'il est installé (sinon la CSP de la page reste la seule barrière : une ligne au journal).
 * GEMINI_API_KEY est vidée : snapshot n'appelle jamais de service de description.
 */
// HYPERFRAMES_RENDER_DETACHED=1 : sinon `render` surveille TOUS ses ancêtres et s'annule (render_cancelled_parent_exited)
// dès que l'un d'eux sort, par exemple le terminal qui a lancé le worker avec nohup (vérifié dans le bac à sable).
// L'arrêt reste assuré par run() : délai, annulation et arbre de processus tué ; SIGTERM et SIGINT sont toujours suivis.
// npm_config_prefer_offline : npx revérifie le registre npm dès que son cache a plus de 5 min, même pour une version
// épinglée ; registre injoignable (panne, DNS, réseau filtré) → environ 70 s d'essais avant le cache, et lint (60 s) était
// arrêté avant : toutes les vidéos échouaient, après l'écriture payée de Claude. Avec prefer-offline, le paquet en cache
// sert tout de suite (1 s) ; un paquet absent du cache est toujours téléchargé (premier --setup-reel).
// PRODUCER_EXPERIMENTAL_FAST_CAPTURE=false : sur macOS (et Windows), HyperFrames 0.8 capture par défaut avec
// canvas.drawElementImage et encode chaque image dans un Worker créé depuis une URL blob:. La CSP de nos pages
// (script-src 'self' 'unsafe-inline', sans worker-src) bloque ce Worker : « drawElement worker encode timed out (frame 1) »
// et aucun rendu ne sort (vu sur le Mac d'Antoine, 19 novembre 2026 ; Linux capture par beginframe ou screenshot et ne
// passe jamais par là). On garde la CSP telle quelle (un moment de Claude ne doit pas pouvoir lancer de Worker) et on
// capture par screenshot, le chemin que les tests du bac à sable couvrent.
const QUIET_ENV = Object.freeze({ PRODUCER_EXPERIMENTAL_FAST_CAPTURE: "false", HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1", HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_RENDER_DETACHED: "1", DO_NOT_TRACK: "1", GEMINI_API_KEY: "", npm_config_prefer_offline: "true", npm_config_update_notifier: "false" });

/**
 * Le PATH des commandes HyperFrames : le dossier du Node qui fait tourner le worker d'abord. Lancé par launchd ou Portly
 * (PATH court) avec un Node de nvm ou de Homebrew, « npx » et le « node » de son « #!/usr/bin/env node » sont trouvés
 * quand même (spawn cherche la commande dans le PATH de l'environnement donné).
 */
export const toolPath = (env = process.env) => [dirname(process.execPath), env.PATH].filter(Boolean).join(delimiter);

/** npx est-il trouvable par le worker (dans toolPath) ? Vérifié avant d'appeler Claude : sans lui, aucune vidéo ne sort. */
export function npxFound(env = process.env) {
  return toolPath(env).split(delimiter).some((d) => { try { return !!d && statSync(join(d, "npx")).mode & 0o111; } catch { return false; } });
}

/** Le message clair quand npx manque (spawn ENOENT ou EACCES), sinon null. */
export function npxMissing(e) {
  if (!e || !/^spawn\b/.test(String(e.syscall || "")) || !["ENOENT", "EACCES"].includes(e.code)) return null;
  return Object.assign(new Error(`npx introuvable pour le worker (${e.code}, PATH : ${toolPath().slice(0, 160)}) : installe Node.js avec npm, ou lance le worker depuis un Terminal où « npx --version » répond, puis node montage.mjs --check.`), { code: "NPX" });
}

export function hfEnv(cfg) {
  const env = { ...QUIET_ENV, PATH: toolPath() };
  const b = offlineBrowser(cfg);
  if (b) { env.HYPERFRAMES_BROWSER_PATH = b; env.PRODUCER_HEADLESS_SHELL_PATH = b; }
  else if (!warned) { warned = true; log("Chrome hors ligne absent (lance node montage.mjs --setup-reel) : seule la CSP de la page bloque le réseau."); }
  return env;
}

const hf = (cfg, sub, args, dir, o = {}) => run("npx", ["--yes", HF_PACKAGE, sub, ...args], { cwd: dir, env: hfEnv(cfg), ...o }).catch((e) => { throw npxMissing(e) || e; });

/** Le JSON d'une sortie HyperFrames (du premier « { » au dernier « } » : une ligne d'avis peut précéder). */
export function parseJson(out, what) {
  const s = String(out || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error(`hyperframes ${what} n'a pas rendu de JSON (${s.trim().slice(0, 200) || "sortie vide"}).`);
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error(`hyperframes ${what} : JSON illisible (${e.message.slice(0, 100)}).`); }
}

const MOMENT_MSG = /^moment ([a-z][a-z0-9]{0,11}):\s*/;
const MOMENT_URL = /\/assets\/m-([a-z][a-z0-9]{0,11})\.js\b/;
const TOO_LONG = /texte trop long ([a-z][a-z0-9-]{0,23})/;
const BEAT_SEL = /#t-([a-z][a-z0-9-]{0,23})\b/;

/** La cible d'un constat d'exécution : « moment <id>: … » ou une erreur dans assets/m-<id>.js → ce moment ; sinon le moteur. */
export function targetOf(f) {
  const m = MOMENT_MSG.exec(String(f.message || "")) || MOMENT_URL.exec(String(f.url || "")) || MOMENT_URL.exec(String(f.sourceFile || "")) || MOMENT_URL.exec(String(f.message || ""));
  return m && MOMENT_ID.test(m[1]) ? `moment:${m[1]}` : "engine";
}

const finding = (code, severity, target, message, extra = {}) => ({ code, severity, target, message: String(message || code).slice(0, 600), ...extra });

/** Constats d'un rapport de lint (seul ou dans check) : erreurs bloquantes (moteur : lint ne lit que la coquille). */
function lintPart(j, blocking, advice) {
  for (const f of j?.findings || []) {
    if (f.code === "nested_structure_needs_subcomposition") continue; // attendu : une seule scène imbriquée
    if (f.severity === "error") blocking.push(finding(`lint_${f.code}`, "block", "engine", `lint ${f.code} : ${f.message}`, f.fixHint ? { fixHint: String(f.fixHint).slice(0, 300) } : {}));
    else if (f.severity === "warning") advice.push(finding(`lint_${f.code}`, "note", "engine", `lint ${f.code} : ${f.message}`));
  }
}

/** `hyperframes lint --json` (environ 1 s) → { blocking, advice }. Une erreur de lint est un bogue du moteur. */
export async function lint(cfg, dir, { signal, timeoutMs = HF_TIMEOUTS.lint } = {}) {
  const out = await hf(cfg, "lint", ["--json", "."], dir, { signal, timeoutMs, codes: [1] });
  const blocking = [], advice = [];
  lintPart(parseJson(out, "lint"), blocking, advice);
  return { blocking, advice };
}

/**
 * Lit un rapport de `check --json` → { blocking, advice } :
 * - bloquant : erreurs d'exécution (console_error, page_error, request_failed…), erreurs de mouvement, erreurs de lint ;
 * - conseil : « texte trop long <id> » (console.warn du moteur, texte au plancher), text_box_overflow et contenu hors de
 *   x 90–990 ; les autres constats de mise en page sont ignorés (faux positifs connus sur le texte masqué).
 */
export function checkFindings(j) {
  const blocking = [], advice = [];
  lintPart(j?.lint, blocking, advice);
  for (const f of j?.runtime?.findings || []) {
    const long = TOO_LONG.exec(String(f.message || ""));
    if (long) { advice.push(finding("texte_trop_long", "review", `beat:${long[1]}`, `Le texte du temps fort « ${long[1]} » est au plancher de taille et dépasse encore.`)); continue; }
    if (f.severity !== "error") continue;
    blocking.push(finding(f.code || "runtime_error", "block", targetOf(f), f.message, { ...(f.url ? { url: String(f.url).slice(0, 300) } : {}), ...(Number.isFinite(f.time) ? { time: f.time } : {}) }));
  }
  for (const f of j?.motion?.findings || []) {
    if (f.severity === "error") blocking.push(finding(f.code || "motion_error", "block", "engine", f.message, Number.isFinite(f.time) ? { time: f.time } : {}));
  }
  for (const f of j?.layout?.findings || []) {
    const beat = BEAT_SEL.exec(`${f.selector || ""} ${f.containerSelector || ""}`);
    const target = beat ? `beat:${beat[1]}` : "engine";
    const r = f.rect || {};
    if (f.code === "text_box_overflow") advice.push(finding("text_box_overflow", "review", target, f.message, Number.isFinite(f.time) ? { time: f.time } : {}));
    else if (beat && (Number(r.left) < SAFE.x - 4 || Number(r.right) > SAFE.x + SAFE.w + 4) && Number(r.width) > 0) {
      advice.push(finding("hors_zone", "review", target, `Du texte sort de la zone sûre (x ${Math.round(r.left)}–${Math.round(r.right)}).`, Number.isFinite(f.time) ? { time: f.time } : {}));
    }
  }
  // Un même constat répété à plusieurs instants ne compte qu'une fois.
  const seen = new Set();
  const uniq = (list) => list.filter((f) => { const k = `${f.code}|${f.target}|${f.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { blocking: uniq(blocking), advice: uniq(advice) };
}

/**
 * Les constats de place (hors_zone, text_box_overflow) d'un temps fort ne comptent que pendant qu'il est posé, de son
 * instant posé à sa fin moins une liaison : pendant une liaison (plongée du zoom, sortie), le mouvement fait sortir le
 * texte exprès. Vu sur une vraie vidéo : la plongée vers le temps fort suivant donnait « Accroche dépasse » à Antoine.
 * `marks` : [{ id, start, end }] ; `settle` : l'instant posé de chacun ; `bridge` : la durée B d'une liaison.
 */
export function heldOnly(advice, marks = [], settle = [], bridge = 0.7) {
  const at = new Map(marks.map((m, i) => [m.id, [settle[i] ?? m.start, m.end - bridge]]));
  return advice.filter((a) => {
    if (!["hors_zone", "text_box_overflow"].includes(a.code) || !Number.isFinite(a.time)) return true;
    const w = at.get(String(a.target || "").replace(/^beat:/, ""));
    return !w || (a.time >= w[0] - 0.05 && a.time <= w[1] + 0.05);
  });
}

/**
 * Chrome n'a pas démarré (lancement refusé, binaire ou script hors ligne absent) : une panne du Mac, jamais de la page.
 * `render` de HyperFrames 0.8.137 le dit autrement que puppeteer : « ✗ Chrome cannot start … Failed to run
 * "…/chrome-offline.sh" --version (exit code 127) ».
 */
export const LAUNCH_FAILURE = /Failed to launch the browser process|Could not find (?:Chrome|Chromium|expected browser)|Browser was not found|Tried to find the browser|browser executable|Chrome cannot start|Failed to run .{1,400}? --version|spawn \S+ E(?:NOENT|ACCES)/i;

/** Le message clair d'une panne de Chrome (première ligne de l'erreur de puppeteer, sans le lien de dépannage). */
export function chromeDown(message) {
  const lines = String(message || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/TROUBLESHOOTING|pptr\.dev/.test(l));
  // La ligne de puppeteer qui dit l'échec (au milieu de la sortie de npx pour un rendu), et les deux suivantes.
  const at = Math.max(0, lines.findIndex((l) => LAUNCH_FAILURE.test(l)));
  // Sans l'en-tête de run() (« npx a échoué (1) : ») ni la croix de HyperFrames (« ✗ »).
  const why = lines.slice(at, at + 3).join(" ").replace(/^.*?a échoué \(\d+\) :\s*/, "").replace(/^[✗✘×]\s*/, "").replace(/\s+/g, " ").slice(0, 200);
  return `Chrome ne démarre pas sur le Mac${why ? ` (${why})` : ""} : relance node montage.mjs --setup-reel, puis réessaie.`;
}

/** L'échec de Chrome lui-même dans un rapport de check (check_runtime_failure : le navigateur n'a pas tourné jusqu'au bout), ou null. */
export function browserFailure(j) {
  const f = (j?.runtime?.findings || []).find((x) => x.code === "check_runtime_failure" && x.severity === "error");
  return f && j?.browserSkipped !== false ? String(f.message || "") : null;
}

/**
 * `hyperframes check --json --no-contrast` (20–60 s) → { blocking, advice }. Un dépassement du délai (page bloquée,
 * boucle infinie) renvoie un constat bloquant « check_timeout » attribué au moteur, que l'appelant traite.
 * Quand Chrome n'a pas tourné jusqu'au bout (check_runtime_failure), check est relancé une fois : une panne passagère
 * ne coûte pas les moments. Si Chrome ne démarre toujours pas, erreur claire (`code = "CHROME"`, chromeDown) au lieu
 * d'un constat attribué à la page ; un autre échec du navigateur (page plantée…) reste un constat du moteur, que
 * l'échelle de produce() traite (sans les moments, puis mode sûr).
 */
export async function check(cfg, dir, { signal, timeoutMs = HF_TIMEOUTS.check, retry = true } = {}) {
  let out;
  try {
    out = await hf(cfg, "check", ["--json", "--no-contrast", "."], dir, { signal, timeoutMs, codes: [1], keep: 8 * 1024 * 1024 });
  } catch (e) {
    if (e.code !== "TIMEOUT") throw e;
    return { blocking: [finding("check_timeout", "block", "engine", `La vérification dans Chrome n'a pas fini en ${Math.round(timeoutMs / 1000)} s (page bloquée).`)], advice: [], timedOut: true };
  }
  const j = parseJson(out, "check");
  const crash = browserFailure(j);
  if (crash) {
    log(`hyperframes check : Chrome n'a pas tourné (${crash.split(/\r?\n/)[0].slice(0, 160)})${retry ? " : nouvel essai" : ""}`);
    if (retry && !signal?.aborted) return check(cfg, dir, { signal, timeoutMs, retry: false });
    if (LAUNCH_FAILURE.test(crash)) throw Object.assign(new Error(chromeDown(crash)), { code: "CHROME" });
  }
  return checkFindings(j);
}

/** Les constats bloquants groupés : { engine: [], moments: { id: [] } } (un id inconnu revient au moteur). */
export function blame(findings, momentIds = []) {
  const known = new Set(momentIds);
  const out = { engine: [], moments: {} };
  for (const f of findings || []) {
    const id = String(f.target || "").startsWith("moment:") ? f.target.slice(7) : null;
    if (id && known.has(id)) (out.moments[id] ||= []).push(f);
    else out.engine.push(f);
  }
  return out;
}

/** Le dossier des images d'un projet, et sa planche (grille) écrite par snapshot. */
export const snapDir = (dir) => join(dir, "snapshots");
export const contactSheet = (dir) => join(dir, "snapshots", "contact-sheet.jpg");
/**
 * Toutes les planches de snapshot, dans l'ordre : HyperFrames 0.8 pagine par 9 images, donc au-delà de 9 temps forts
 * il écrit contact-sheet-1.jpg, contact-sheet-2.jpg… et plus de contact-sheet.jpg (vu sur une vraie vidéo de 11 temps forts).
 */
export function contactSheets(dir) {
  if (!existsSync(snapDir(dir))) return [];
  const num = (f) => Number(/-(\d+)\.jpg$/.exec(f)?.[1] || 0);
  return readdirSync(snapDir(dir)).filter((f) => /^contact-sheet(-\d+)?\.jpg$/.test(f)).sort((a, b) => num(a) - num(b)).map((f) => join(snapDir(dir), f));
}

/**
 * `hyperframes snapshot --at t1,t2… --describe false --no-end` (environ 1 s par image) → chemins des PNG dans l'ordre
 * des instants. Les planches sont à contactSheets(dir).
 */
export async function snapshot(cfg, dir, times, { signal, timeoutMs = HF_TIMEOUTS.snapshot } = {}) {
  const at = times.map((t) => Math.max(0, Number(t) || 0).toFixed(3)).join(",");
  rmSync(snapDir(dir), { recursive: true, force: true });
  await hf(cfg, "snapshot", [`--at=${at}`, "--describe=false", "--no-end", "."], dir, { signal, timeoutMs });
  const files = existsSync(snapDir(dir)) ? readdirSync(snapDir(dir)).filter((f) => /^frame-\d+.*\.png$/.test(f)) : [];
  files.sort((a, b) => Number(/^frame-(\d+)/.exec(a)[1]) - Number(/^frame-(\d+)/.exec(b)[1]));
  if (files.length < times.length) throw new Error(`hyperframes snapshot n'a rendu que ${files.length} image(s) sur ${times.length}.`);
  return files.map((f) => join(snapDir(dir), f));
}

/** Une ligne d'avancement du rendu (stdout sans --quiet) : « 47%  Streaming frame 24/60 ». */
export const RENDER_PROGRESS = /(\d+)%\s+Streaming frame (\d+)\/(\d+)/;

/** La ligne de résumé du rendu : « beginframe capture · software gpu · … · capture 2.8s (ou 1m 32.1s) · … » → { mode, gpu, captureS }. */
export function parseSummary(line) {
  const s = String(line || "");
  return {
    mode: /(\w+) capture\b/.exec(s)?.[1] || "",
    gpu: /(\w+) gpu\b/.exec(s)?.[1] || "",
    // HyperFrames écrit « capture 8.1s », ou « capture 1m 32.1s » au-delà d'une minute.
    captureS: ((m) => (m ? Number(m[1] || 0) * 60 + Number(m[2]) : 0))(/\bcapture (?:(\d+)m )?([\d.]+)s\b/.exec(s)),
  };
}

/** Délai d'un rendu de `frames` images : 120 s + maxFrameMs par image, plafonné à 25 min. */
export const renderTimeout = (frames, maxFrameMs = 400) => Math.min(25 * 60_000, 120_000 + Math.max(0, frames) * Math.max(1, maxFrameMs));

/**
 * `hyperframes render --format mp4 --fps 30 --workers 1 -o <out> .`, SANS --quiet : `onFrame(i, n)` à chaque ligne
 * « Streaming frame i/N » (0, 0 pendant la compilation). Renvoie { summary, mode, gpu, captureS }.
 */
export async function render(cfg, dir, out, { onFrame, signal, timeoutMs } = {}) {
  let summary = "";
  const onLine = (line) => {
    const m = RENDER_PROGRESS.exec(line);
    if (m) { onFrame?.(Number(m[2]), Number(m[3])); return; }
    if (/Compiling composition/.test(line)) onFrame?.(0, 0);
    else if (/\bcapture (?:\d+m )?[\d.]+s\b/.test(line) && line.includes("·")) summary = line.trim();
  };
  rmSync(out, { force: true });
  await hf(cfg, "render", ["--format", "mp4", "--fps", "30", "--workers", "1", "-o", out, "."], dir, { signal, timeoutMs, onLine, keep: 256 * 1024 });
  if (!existsSync(out) || statSync(out).size < 1000) throw new Error("Le rendu HyperFrames n'a produit aucune vidéo.");
  return { summary, ...parseSummary(summary) };
}

/** `hyperframes browser path` : le Chrome sans tête que HyperFrames utilise (après `browser ensure`). */
export async function browserPath(cfg, { ensure = false, signal } = {}) {
  // Le Chrome de HyperFrames lui-même (jamais le script hors ligne, qui n'existe pas encore pendant --setup-reel).
  const env = { ...QUIET_ENV, PATH: toolPath(), HYPERFRAMES_BROWSER_PATH: "", PRODUCER_HEADLESS_SHELL_PATH: "" };
  const npx = (args, o) => run("npx", ["--yes", HF_PACKAGE, ...args], { env, signal, ...o }).catch((e) => { throw npxMissing(e) || e; });
  if (ensure) await npx(["browser", "ensure"], { timeoutMs: HF_TIMEOUTS.browser });
  const out = await npx(["browser", "path"], { timeoutMs: 60_000 });
  const p = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("/") || /^[A-Z]:\\/.test(l)).pop();
  if (!p || !existsSync(p)) throw new Error(`Chrome de HyperFrames introuvable (${out.trim().slice(0, 200)}).`);
  return p;
}

/**
 * Essai rapide du Chrome du rendu sur un projet déjà écrit (une image à 0,5 s), avec le script hors ligne s'il est là :
 * { ok, offline, error }. Pour --setup-reel (qui retire un script refusé par ce Mac) et --check.
 */
export async function probeBrowser(cfg, dir, { signal, timeoutMs = HF_TIMEOUTS.snapshot } = {}) {
  const offline = !!offlineBrowser(cfg);
  try {
    await snapshot(cfg, dir, [0.5], { signal, timeoutMs });
    return { ok: true, offline };
  } catch (e) {
    return { ok: false, offline, error: String(e.message || e).replace(/\s+/g, " ").slice(-400) };
  } finally {
    rmSync(snapDir(dir), { recursive: true, force: true });
  }
}
