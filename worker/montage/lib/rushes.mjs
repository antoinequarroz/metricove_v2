// Rushes : inventaire du dossier surveillé et rapatriement des rushes envoyés au VPS.
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { run, log, ensureDir, assertSpace } from "./util.mjs";

const VIDEO = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

export async function probe(file) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate:stream_side_data=rotation", "-of", "json", file]);
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === "video") || {};
  const rot = Math.abs(Number(v.side_data_list?.[0]?.rotation || 0));
  const [w, h] = rot === 90 || rot === 270 ? [v.height, v.width] : [v.width, v.height];
  return { duration: Number(j.format?.duration || 0), width: w || 0, height: h || 0, hasAudio: (j.streams || []).some((s) => s.codec_type === "audio") };
}

async function thumb(file, duration) {
  const at = Math.min(1, duration / 2).toFixed(2);
  const buf = await run("ffmpeg", ["-v", "error", "-ss", at, "-i", file, "-frames:v", "1", "-vf", "scale=160:-2", "-q:v", "8", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { binary: true })
    .catch(() => null);
  return buf && buf.length < 30000 ? `data:image/jpeg;base64,${buf.toString("base64")}` : undefined;
}

/** Liste les vidéos du dossier (cache par chemin + date de modification). */
export async function listRushes(cfg) {
  ensureDir(cfg.rushesDir);
  const cacheFile = join(ensureDir(cfg.workDir), "rushes-cache.json");
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const out = [];
  for (const name of readdirSync(cfg.rushesDir).sort()) {
    if (name.startsWith(".") || !VIDEO.has(extname(name).toLowerCase())) continue;
    const path = join(cfg.rushesDir, name);
    const st = statSync(path);
    const key = `${path}|${st.mtimeMs}|${st.size}`;
    if (!cache[key]) {
      try {
        const p = await probe(path);
        cache[key] = { path, name, size: st.size, duration: p.duration, mtime: new Date(st.mtimeMs).toISOString(), thumb: await thumb(path, p.duration) };
      } catch (e) { log("rush illisible ignoré :", name, e.message); continue; }
    }
    out.push(cache[key]);
  }
  writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(out.map((r) => [`${r.path}|${new Date(r.mtime).getTime()}|${r.size}`, r]))));
  return out;
}

export async function scan(api, cfg, extra = []) {
  const list = await listRushes(cfg);
  for (const e of extra) { const r = list.find((x) => x.path === e.path); if (r) r.from = e.from; }
  await api.scan(list);
  return list;
}

/**
 * Donne le chemin local de chaque rush de la tâche. Les rushes « upload » sont téléchargés dans le dossier
 * surveillé, déclarés avec `from` (ils gardent leur id), puis libérés sur le VPS.
 */
export async function localRushes(api, cfg, rushes) {
  const map = {};
  const fetched = [];
  for (const r of rushes) {
    if (r.origin === "mac" && r.path && existsSync(r.path)) { map[r.id] = r.path; continue; }
    if (r.origin === "mac") throw new Error(`Rush introuvable sur le Mac : ${r.path || r.name}`);
    assertSpace(cfg, cfg.minFreeGb + (r.size || 0) / 1e9);
    let dest = join(ensureDir(cfg.rushesDir), safeName(r.name || `${r.id}.mp4`));
    if (existsSync(dest)) dest = dest.replace(/(\.\w+)?$/, `-${r.id.slice(0, 6)}$1`);
    log("rapatriement du rush", basename(dest));
    const tmp = dest + ".part";
    await api.downloadRush(r.id, tmp);
    renameSync(tmp, dest);
    map[r.id] = dest;
    fetched.push({ path: dest, from: r.id });
  }
  if (fetched.length) {
    await scan(api, cfg, fetched);
    for (const f of fetched) await api.freeRush(f.from).catch((e) => log("libération VPS échouée :", e.message));
  }
  return map;
}

const safeName = (n) => n.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 120);
