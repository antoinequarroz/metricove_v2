// Rendu d'une EDL : découpe des phrases gardées, recadrage sur le visage, zooms lents, carton de fin,
// surcouche HyperFrames (karaoké + accroche + fin), son normalisé (-14 LUFS en final), couverture et .srt.
import { writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, ensureDir, log, round } from "./util.mjs";
import { probe } from "./rushes.mjs";
import { overlayPage, renderOverlay } from "./hf.mjs";

const FPS = 30;
const SIZES = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080] };
const FACES = join(dirname(fileURLToPath(import.meta.url)), "faces.swift");

export function sizeFor(format, quality) {
  const [w, h] = SIZES[format] || SIZES["9:16"];
  return quality === "final" ? [w, h] : [w / 2, h / 2];
}

/** Segments gardés, dans l'ordre, avec leur position sur la timeline. */
export function timeline(edl) {
  let t = 0;
  return edl.segments.filter((s) => s.kept && s.out > s.in).map((s) => {
    const seg = { ...s, start: round(t), dur: round(s.out - s.in) };
    t += seg.dur;
    return seg;
  });
}

/** Mots des sous-titres en temps de timeline. */
export function timelineWords(segs) {
  const out = [];
  segs.forEach((s, i) => {
    for (const w of s.words || []) {
      if (w.t1 < s.in - 0.05 || w.t0 > s.out + 0.05) continue;
      out.push({ w: w.w, s: round(s.start + Math.max(0, w.t0 - s.in)), e: round(s.start + Math.min(s.dur, w.t1 - s.in)), seg: i });
    }
  });
  return out;
}

/** Centre du visage par rush (médiane sur une image par segment) ; 0,5 / 0,4 si aucun visage. */
async function faceCenters(segs, rushPaths, dir, mode) {
  const centers = {};
  if (mode === "center") return centers;
  const imgs = ensureDir(join(dir, "visages"));
  const files = [];
  for (const [i, s] of segs.entries()) {
    const f = join(imgs, `${s.rush}__${i}.jpg`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String((s.in + s.out) / 2), "-i", rushPaths[s.rush], "-frames:v", "1", "-vf", "scale=480:-2", f]).then(() => files.push(f)).catch(() => {});
  }
  if (!files.length) return centers;
  const out = await run("swift", [FACES, ...files]).catch((e) => { log("détection des visages indisponible :", e.message); return ""; });
  const by = {};
  for (const line of out.split("\n").filter(Boolean)) {
    const j = JSON.parse(line);
    if (j.cx == null) continue;
    const rush = j.file.split("/").pop().split("__")[0];
    (by[rush] ||= []).push(j);
  }
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  for (const [rush, a] of Object.entries(by)) centers[rush] = { cx: med(a.map((x) => x.cx)), cy: med(a.map((x) => x.cy)) };
  rmSync(imgs, { recursive: true, force: true });
  return centers;
}

function cropFilter(src, W, H, c) {
  const ta = W / H, sa = src.width / src.height;
  if (Math.abs(sa - ta) < 0.01) return `scale=${W}:${H}`;
  if (sa > ta) { // source plus large : on garde toute la hauteur, on centre sur le visage en x
    const cw = `trunc(ih*${W}/${H}/2)*2`;
    return `crop=${cw}:ih:'max(0,min(iw-${cw},${c.cx}*iw-${cw}/2))':0,scale=${W}:${H}`;
  }
  const ch = `trunc(iw*${H}/${W}/2)*2`; // source plus haute : visage au tiers supérieur
  return `crop=iw:${ch}:0:'max(0,min(ih-${ch},${c.cy}*ih-${ch}*0.38))',scale=${W}:${H}`;
}

export async function renderEdl(cfg, { edl, rushPaths, theme, quality, dir, onStep = () => {} }) {
  ensureDir(dir);
  const [W, H] = sizeFor(edl.format, quality);
  const final = quality === "final";
  const vbit = final ? "12M" : "2M";
  const segs = timeline(edl);
  if (!segs.length) throw new Error("Aucune phrase gardée : rien à monter.");
  const speechEnd = segs[segs.length - 1].start + segs[segs.length - 1].dur;
  const endSec = edl.endCard?.text ? theme.endCardSeconds || 2.5 : 0;
  const total = round(speechEnd + endSec);

  onStep("Cadrage sur le visage…", 0.05);
  const centers = await faceCenters(segs, rushPaths, dir, edl.crop || "face");
  const srcInfo = {};
  for (const s of segs) srcInfo[s.rush] ||= await probe(rushPaths[s.rush]);

  const parts = [];
  for (const [i, s] of segs.entries()) {
    onStep(`Découpe ${i + 1}/${segs.length}…`, 0.1 + 0.4 * (i / segs.length));
    const src = srcInfo[s.rush];
    const c = centers[s.rush] || { cx: 0.5, cy: 0.4 };
    let vf = cropFilter(src, W, H, c);
    const z = (edl.zooms || []).find((zz) => zz.at >= s.start - 0.05 && zz.at < s.start + s.dur);
    if (z) { // zoom lent sur toute la phrase (d'un changement de plan au suivant)
      const S = z.scale || 1.1, D = s.dur;
      vf += `,scale=w='trunc(${W}*(1+${S - 1}*t/${D})/2)*2':h='trunc(${H}*(1+${S - 1}*t/${D})/2)*2':eval=frame,crop=${W}:${H}`;
    }
    vf += `,fps=${FPS},setsar=1,format=yuv420p`;
    const p = join(dir, `part${String(i).padStart(3, "0")}.mp4`);
    const args = ["-v", "error", "-y", "-ss", String(s.in), "-t", String(s.dur), "-i", rushPaths[s.rush]];
    if (src.hasAudio) {
      args.push("-map", "0:v:0", "-map", "0:a:0", "-af", `aresample=48000,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, s.dur - 0.03).toFixed(3)}:d=0.03`);
    } else { // rush muet : piste silencieuse pour que la concaténation reste homogène
      args.push("-f", "lavfi", "-t", String(s.dur), "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a:0");
    }
    await run("ffmpeg", [...args, "-vf", vf, "-c:v", "h264_videotoolbox", "-b:v", vbit, "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000", p]);
    parts.push(p);
  }
  if (endSec) {
    const p = join(dir, "part999.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${theme.dark.replace("#", "0x")}:s=${W}x${H}:r=${FPS}:d=${endSec}`,
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(endSec), "-vf", "format=yuv420p,setsar=1",
      "-c:v", "h264_videotoolbox", "-b:v", vbit, "-c:a", "aac", "-b:a", "160k", p]);
    parts.push(p);
  }
  writeFileSync(join(dir, "parts.txt"), parts.map((p) => `file '${p}'`).join("\n"));
  const base = join(dir, "base.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "parts.txt"), "-c", "copy", base]);

  onStep("Sous-titres et cartons…", 0.55);
  const words = timelineWords(segs);
  const titleUntil = edl.title?.until || Math.min(2.8, speechEnd);
  let overlay = null;
  if (words.length || edl.title?.text || endSec) {
    const html = overlayPage({ W, H, fps: FPS, dur: total, speechEnd, words, title: edl.title && { ...edl.title, until: titleUntil }, endCard: edl.endCard, theme, format: edl.format });
    overlay = await renderOverlay(cfg, ensureDir(join(dir, "hf")), html, join(dir, "overlay.mov"), { fps: FPS, theme });
  }

  onStep(final ? "Rendu final…" : "Rendu de l'aperçu…", 0.8);
  const out = join(dir, final ? "final.mp4" : "apercu.mp4");
  const af = final ? ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : ["-c:a", "copy"];
  if (overlay) {
    await run("ffmpeg", ["-v", "error", "-y", "-i", base, "-i", overlay, "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]",
      "-map", "[v]", "-map", "0:a", "-c:v", "h264_videotoolbox", "-b:v", vbit, ...af, "-movflags", "+faststart", out]);
  } else {
    await run("ffmpeg", ["-v", "error", "-y", "-i", base, "-c:v", "copy", ...af, "-movflags", "+faststart", out]);
  }
  const cover = join(dir, final ? "couverture.jpg" : "apercu.jpg");
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(titleUntil * 0.6, total / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", cover]).catch(() => {});
  writeFileSync(join(dir, "sous-titres.srt"), srt(words));

  for (const f of readdirSync(dir)) if (/^part\d+\.mp4$|^base\.mp4$|^overlay\.mov$|^parts\.txt$/.test(f)) rmSync(join(dir, f), { force: true });
  rmSync(join(dir, "hf"), { recursive: true, force: true });
  return { video: out, cover, srt: join(dir, "sous-titres.srt"), duration: total };
}

function srt(words) {
  const ts = (t) => { const ms = Math.round(t * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  const blocks = []; let cur = [];
  for (const w of words) {
    if (cur.length && (cur.length >= 7 || w.s - cur[cur.length - 1].e > 0.35 || w.seg !== cur[cur.length - 1].seg)) { blocks.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) blocks.push(cur);
  return blocks.map((b, i) => {
    const end = Math.min(b[b.length - 1].e + 0.2, i + 1 < blocks.length ? blocks[i + 1][0].s - 0.02 : Infinity);
    return `${i + 1}\n${ts(b[0].s)} --> ${ts(Math.max(end, b[0].s + 0.3))}\n${b.map((w) => w.w).join(" ")}\n`;
  }).join("\n");
}
