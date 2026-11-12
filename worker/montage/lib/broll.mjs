// B-roll : plans d'illustration posés par-dessus Antoine (sa voix continue).
// Recherche : d'abord les fichiers de `brollDir` (noms descriptifs), sinon Pexels (clé `pexelsKey` du config.json,
// jamais affichée). Les vidéos Pexels sont gardées dans `brollCache`, plafonné en taille (les plus anciennes partent).
import { existsSync, readdirSync, statSync, rmSync, renameSync, createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { home, ensureDir, run, log } from "./util.mjs";

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
const STOP = new Set(["avec", "dans", "pour", "sans", "sous", "vers", "chez", "des", "les", "une", "sur", "par", "qui", "que", "aux", "the", "and"]);

/** Client de l'API Metricove : pour les plans pris dans la bibliothèque (posé par montage.mjs). */
let API = null;
export const setBrollApi = (api) => { API = api; };

export const brollDir = (cfg) => ensureDir(home(cfg.brollDir || "~/Movies/Metricove/broll"));
const cacheDir = (cfg) => ensureDir(home(cfg.brollCache || "~/Movies/Metricove/broll-cache"));
export const listBroll = (cfg) => readdirSync(brollDir(cfg)).filter((f) => VIDEO.test(f) && !f.startsWith(".")).sort((a, b) => a.localeCompare(b, "fr"));

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
/** Mot proche : même racine (pluriels, féminins). */
const near = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, Math.max(4, b.length - 2))) || b.startsWith(a.slice(0, Math.max(4, a.length - 2)))));

/** Meilleur fichier du dossier pour une recherche (au moins un mot en commun), ou null. */
export function matchMine(cfg, query) {
  const q = tokens(query);
  let best = null, score = 0;
  for (const f of listBroll(cfg)) {
    const t = tokens(basename(f, extname(f)));
    const sc = q.filter((w) => t.some((x) => near(w, x))).length / Math.max(q.length, 1);
    if (sc > score) { best = f; score = sc; }
  }
  return score > 0 ? best : null;
}

const ORIENT = { "9:16": "portrait", "4:5": "portrait", "1:1": "square", "16:9": "landscape" };

async function pexels(cfg, path) {
  const r = await fetch(`https://api.pexels.com${path}`, { headers: { Authorization: cfg.pexelsKey } });
  if (!r.ok) throw new Error(`Pexels → ${r.status}`);
  return r.json();
}

/** Plus petit fichier en 720p ou plus (sinon le plus grand disponible). */
function pickFile(v) {
  const files = (v.video_files || []).filter((f) => f.link && /mp4/i.test(f.file_type || "mp4") && f.width && f.height);
  const ok = files.filter((f) => Math.min(f.width, f.height) >= 720).sort((a, b) => a.width * a.height - b.width * b.height);
  return ok[0] || files.sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
}

/** Cache plafonné : supprime les plus anciens fichiers au-delà de `brollCacheGb` (1 Go par défaut). */
function trimCache(cfg) {
  const dir = cacheDir(cfg);
  const cap = (cfg.brollCacheGb ?? 1) * 1e9;
  const files = readdirSync(dir).filter((f) => VIDEO.test(f)).map((f) => ({ f: join(dir, f), ...statSync(join(dir, f)) })).sort((a, b) => b.mtimeMs - a.mtimeMs);
  let total = 0;
  for (const x of files) { total += x.size; if (total > cap) rmSync(x.f, { force: true }); }
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`téléchargement Pexels → ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file + ".part"));
  renameSync(file + ".part", file);
}

/** Vidéo Pexels en cache (téléchargée si besoin) ; `v` = objet vidéo de l'API si déjà connu ; `url` = fichier choisi dans la page (sans clé). */
async function pexelsFile(cfg, id, v, url) {
  const file = join(cacheDir(cfg), `pexels-${String(id).replace(/[^\w-]/g, "")}.mp4`);
  if (existsSync(file)) return file;
  if (url && /^https:\/\/videos\.pexels\.com\//.test(url)) {
    await download(url, file);
    trimCache(cfg);
    return file;
  }
  if (!cfg.pexelsKey) return null;
  v ||= await pexels(cfg, `/videos/videos/${encodeURIComponent(id)}`);
  const f = pickFile(v);
  if (!f) return null;
  await download(f.link, file);
  trimCache(cfg);
  return file;
}

/** Vidéo de la bibliothèque Metricove en cache (téléchargée une fois). */
async function libraryFile(cfg, id) {
  const file = join(cacheDir(cfg), `bibliotheque-${String(id).replace(/[^\w-]/g, "")}.mp4`);
  if (existsSync(file)) return file;
  if (!API) return null;
  const r = await API.req("GET", `/api/media/${encodeURIComponent(id)}/file`, { raw: true });
  if (!r.ok) throw new Error(`vidéo de la bibliothèque ${id} → ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file + ".part"));
  renameSync(file + ".part", file);
  trimCache(cfg);
  return file;
}

/** Fichier local d'un plan déjà trouvé (source + ref), ou null. */
export async function brollFile(cfg, shot) {
  if (shot.source === "mine" && shot.ref) {
    const f = join(brollDir(cfg), basename(shot.ref));
    return existsSync(f) ? f : null;
  }
  if (shot.source === "pexels" && shot.ref) return pexelsFile(cfg, shot.ref, null, shot.url).catch((e) => { log("B-roll Pexels :", e.message); return null; });
  if (shot.source === "library" && shot.ref) return libraryFile(cfg, shot.ref).catch((e) => { log("B-roll bibliothèque :", e.message); return null; });
  return null;
}

/** Le plan a-t-il du son ? (pour le mixer sous la voix) */
export async function hasAudio(file) {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]).catch(() => "");
  return String(out).trim().length > 0;
}

async function durationOf(file) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).catch(() => "");
  const d = parseFloat(out);
  return Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : undefined;
}

/**
 * Plans du dossier B-roll avec une petite image et leur durée, pour la page (worker 0.13.0). Les images sont gardées
 * dans broll-cache/vignettes.json ; au plus `budget` nouvelles par appel pour ne pas retarder la boucle.
 */
export async function macBrollList(cfg, budget = 12) {
  const idx = join(cacheDir(cfg), "vignettes.json");
  let cache = {};
  try { cache = JSON.parse(readFileSync(idx, "utf8")); } catch { /* première fois */ }
  const out = [], next = {};
  let made = 0, changed = false;
  for (const name of listBroll(cfg).slice(0, 300)) {
    const st = statSync(join(brollDir(cfg), name));
    let c = cache[name];
    if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
      if (made >= budget) { out.push({ name }); continue; }
      made++; changed = true;
      const file = join(brollDir(cfg), name);
      c = { mtime: st.mtimeMs, size: st.size, thumb: await thumbOf(file, [[96, 8], [72, 12]], 14000), dur: await durationOf(file) };
    }
    next[name] = c;
    out.push({ name, ...(c.thumb ? { thumb: c.thumb } : {}), ...(c.dur ? { dur: c.dur } : {}) });
  }
  if (changed || Object.keys(cache).length !== Object.keys(next).length) {
    try { writeFileSync(idx, JSON.stringify(next)); } catch { /* cache facultatif */ }
  }
  return { list: out, pending: made >= budget };
}

async function thumbOf(file, sizes = [[160, 6], [120, 10]], max = 40000, at = 0.5) {
  for (const [w, q] of sizes) {
    const buf = await run("ffmpeg", ["-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:-2`, "-q:v", String(q), "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { binary: true }).catch(() => null);
    // base64 grossit de 4/3 : la limite porte sur la data URL envoyée.
    if (buf && buf.length && buf.length * 1.34 + 23 <= max) return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }
  return undefined;
}

/**
 * Cherche les plans sans source : dossier d'abord, puis Pexels. Remplit source, ref, thumb.
 * Renvoie { broll, files, notes } : `broll` sans les plans introuvables, `files[i]` = fichier local du plan i.
 */
export async function resolveBroll(cfg, list = [], format = "9:16") {
  const out = [], files = [], notes = [], used = new Set();
  let noKey = false;
  for (const shot of list) {
    const s = { ...shot, mode: shot.mode === "pip" ? "pip" : "full" };
    let file = s.source ? await brollFile(cfg, s) : null;
    if (!file) {
      delete s.source; delete s.ref; delete s.thumb;
      const mine = matchMine(cfg, s.query);
      if (mine) { s.source = "mine"; s.ref = mine; file = join(brollDir(cfg), mine); }
      else if (cfg.pexelsKey) {
        try {
          const q = new URLSearchParams({ query: s.query, orientation: ORIENT[format] || "portrait", size: "medium", per_page: "10", locale: "fr-FR" });
          const res = await pexels(cfg, `/videos/search?${q}`);
          const v = (res.videos || []).find((x) => !used.has(String(x.id)) && x.duration >= Math.min(3, s.dur || 2) && pickFile(x));
          if (v) { s.source = "pexels"; s.ref = String(v.id); file = await pexelsFile(cfg, v.id, v); }
        } catch (e) { log(`B-roll « ${s.query} » :`, e.message); }
      } else noKey = true;
    }
    if (!file) { notes.push(`B-roll « ${s.query} » introuvable : plan retiré.`); continue; }
    used.add(String(s.ref));
    s.thumb ||= await thumbOf(file, undefined, undefined, (s.from || 0) + 0.5);
    out.push(s);
    files.push(file);
  }
  if (noKey) notes.push("Pas de clé Pexels dans config.json (pexelsKey) : seuls tes plans de ~/Movies/Metricove/broll sont utilisés.");
  if (out.length) log(`B-roll : ${out.map((s) => `${s.query} → ${s.source}`).join(", ")}`);
  return { broll: out, files, notes };
}
