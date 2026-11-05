// B-roll : plans d'illustration posés par-dessus Antoine (sa voix continue).
// Recherche : d'abord les fichiers de `brollDir` (noms descriptifs), sinon Pexels (clé `pexelsKey` du config.json,
// jamais affichée). Les vidéos Pexels sont gardées dans `brollCache`, plafonné en taille (les plus anciennes partent).
import { existsSync, readdirSync, statSync, rmSync, renameSync, createWriteStream } from "node:fs";
import { join, basename, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { home, ensureDir, run, log } from "./util.mjs";

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
const STOP = new Set(["avec", "dans", "pour", "sans", "sous", "vers", "chez", "des", "les", "une", "sur", "par", "qui", "que", "aux", "the", "and"]);

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

/** Vidéo Pexels en cache (téléchargée si besoin) ; `v` = objet vidéo de l'API si déjà connu. */
async function pexelsFile(cfg, id, v) {
  const file = join(cacheDir(cfg), `pexels-${id}.mp4`);
  if (existsSync(file)) return file;
  if (!cfg.pexelsKey) return null;
  v ||= await pexels(cfg, `/videos/videos/${encodeURIComponent(id)}`);
  const f = pickFile(v);
  if (!f) return null;
  await download(f.link, file);
  trimCache(cfg);
  return file;
}

/** Fichier local d'un plan déjà trouvé (source + ref), ou null. */
export async function brollFile(cfg, shot) {
  if (shot.source === "mine" && shot.ref) {
    const f = join(brollDir(cfg), basename(shot.ref));
    return existsSync(f) ? f : null;
  }
  if (shot.source === "pexels" && shot.ref) return pexelsFile(cfg, shot.ref).catch((e) => { log("B-roll Pexels :", e.message); return null; });
  return null;
}

async function thumbOf(file) {
  for (const [w, q] of [[160, 6], [120, 10]]) {
    const buf = await run("ffmpeg", ["-v", "error", "-ss", "0.5", "-i", file, "-frames:v", "1", "-vf", `scale=${w}:-2`, "-q:v", String(q), "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { binary: true }).catch(() => null);
    if (buf && buf.length <= 40000) return `data:image/jpeg;base64,${buf.toString("base64")}`;
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
    s.thumb ||= await thumbOf(file);
    out.push(s);
    files.push(file);
  }
  if (noKey) notes.push("Pas de clé Pexels dans config.json (pexelsKey) : seuls tes plans de ~/Movies/Metricove/broll sont utilisés.");
  if (out.length) log(`B-roll : ${out.map((s) => `${s.query} → ${s.source}`).join(", ")}`);
  return { broll: out, files, notes };
}
