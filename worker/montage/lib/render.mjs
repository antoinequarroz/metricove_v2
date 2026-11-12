// Rendu d'une EDL : phrases gardées sans les mots coupés ni les silences (selon audio.silences), recadrage sur le visage,
// zooms (un sur deux avant, un sur deux arrière), B-roll par-dessus (plein écran ou fenêtre), surcouche HyperFrames
// (sous-titres + accroche + fin, toujours au-dessus),
// son débruité + musique + loudnorm −14 LUFS, couverture et .srt.
import { writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, ensureDir, log, round } from "./util.mjs";
import { probe } from "./rushes.mjs";
import { overlayPage, renderOverlay } from "./hf.mjs";
import { renderPlan, toOutput, outputWords, audioOf, captionsOf } from "./edl.mjs";
import { buildAudio } from "./audio.mjs";
import { brollFile, hasAudio } from "./broll.mjs";
import { cleanTexts } from "./texts.mjs";

// Encodeur vidéo : celui du Mac. MONTAGE_ENCODER=libx264 pour essayer le rendu sur une autre machine.
const ENCODER = process.env.MONTAGE_ENCODER || "h264_videotoolbox";

export { timeline } from "./edl.mjs";

const FPS = 30;
const SIZES = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080] };
const FACES = join(dirname(fileURLToPath(import.meta.url)), "faces.swift");

export function sizeFor(format, quality) {
  const [w, h] = SIZES[format] || SIZES["9:16"];
  return quality === "final" ? [w, h] : [w / 2, h / 2];
}

/** Visage par segment (une image au milieu du segment) : { [i]: { cx, cy, h } } en fraction de l'image du rush. */
async function detectFaces(plan, rushPaths, dir) {
  const imgs = ensureDir(join(dir, "visages"));
  const files = [];
  for (const s of plan) {
    const f = join(imgs, `${s.i}.jpg`);
    const mid = s.pieces[Math.floor(s.pieces.length / 2)];
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String((mid[0] + mid[1]) / 2), "-i", rushPaths[s.rush], "-frames:v", "1", "-vf", "scale=480:-2", f]).then(() => files.push(f)).catch(() => {});
  }
  const out = {};
  if (files.length) {
    const txt = await run("swift", [FACES, ...files]).catch((e) => { log("détection des visages indisponible :", e.message); return ""; });
    for (const line of txt.split("\n").filter(Boolean)) {
      const j = JSON.parse(line);
      if (j.cx != null) out[Number(j.file.split("/").pop().split(".")[0])] = { cx: j.cx, cy: j.cy, h: j.h };
    }
  }
  rmSync(imgs, { recursive: true, force: true });
  return out;
}

const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

/** Haut de la zone recadrée (fraction de la hauteur du rush) quand le rush est plus haut que le format. */
const cropTop = (src, W, H, c) => {
  const ch = (src.width * H) / W / src.height;
  return Math.max(0, Math.min(1 - ch, c.cy - ch * 0.38));
};

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

/** Visage du segment dans l'image rendue (haut et bas, 0..1), pour placer les sous-titres en « auto ». */
function faceInFrame(src, W, H, c, fc) {
  const sa = src.width / src.height, ta = W / H;
  if (Math.abs(sa - ta) < 0.01) return { y0: fc.cy - fc.h / 2, y1: fc.cy + fc.h / 2, cx: fc.cx };
  if (sa > ta) { // recadrage en largeur
    const cw = (src.height * W) / H / src.width, left = Math.max(0, Math.min(1 - cw, c.cx - cw / 2));
    return { y0: fc.cy - fc.h / 2, y1: fc.cy + fc.h / 2, cx: (fc.cx - left) / cw };
  }
  const ch = (src.width * H) / W / src.height, top = cropTop(src, W, H, c);
  return { y0: (fc.cy - fc.h / 2 - top) / ch, y1: (fc.cy + fc.h / 2 - top) / ch, cx: fc.cx };
}

/**
 * Filtres du B-roll : chaque plan entre à son temps rendu, plein écran (recadré au format) ou en fenêtre arrondie
 * (~40 % de la largeur, dans le coin du haut opposé au visage). La voix continue ; le son du plan est muet, sauf
 * `sound` (0 à 1) : il passe alors sous la voix (`audio` : étiquettes à mélanger avec le son du montage).
 * `from` : seconde du plan où il commence.
 */
async function brollLayers(cfg, edl, plan, faces, W, H, firstInput) {
  const inputs = [], filters = [], overlays = [], audio = [];
  for (const shot of edl.broll || []) {
    const file = await brollFile(cfg, shot);
    if (!file) { log(`B-roll « ${shot.query} » sans fichier : ignoré`); continue; }
    const a = toOutput(plan, shot.at), b = toOutput(plan, shot.at + shot.dur), d = b - a;
    if (d < 0.3) continue;
    const k = firstInput + inputs.length / 8, L = `br${overlays.length}`;
    const from = Math.max(0, Number(shot.from) || 0);
    inputs.push("-ss", from.toFixed(3), "-stream_loop", "-1", "-t", d.toFixed(3), "-i", file);
    const vol = Math.min(1, Math.max(0, Number(shot.sound) || 0));
    if (vol > 0 && await hasAudio(file)) {
      const A = `ba${audio.length}`, ms = Math.round(a * 1000), fo = Math.max(0, d - 0.25).toFixed(3);
      filters.push(`[${k}:a]atrim=duration=${d.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${vol.toFixed(2)},afade=t=in:d=0.15,afade=t=out:st=${fo}:d=0.25,adelay=${ms}|${ms}[${A}]`);
      audio.push(A);
    }
    const fade = `fade=t=in:st=${a.toFixed(3)}:d=0.12:alpha=1,fade=t=out:st=${Math.max(a, b - 0.12).toFixed(3)}:d=0.12:alpha=1`;
    const head = `[${k}:v]trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS+${a.toFixed(3)}/TB,fps=${FPS}`;
    if (shot.mode === "pip") {
      const portrait = H >= W;
      const pw = Math.round((W * (portrait ? 0.4 : 0.32)) / 2) * 2, ph = Math.round((pw * (portrait ? 1.25 : 0.5625)) / 2) * 2;
      const R = Math.round(pw * 0.08);
      const corner = `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(gt(abs(X-W/2),W/2-${R})*gt(abs(Y-H/2),H/2-${R}),if(lte(hypot(abs(X-W/2)-(W/2-${R}),abs(Y-H/2)-(H/2-${R})),${R}),255,0),255)'`;
      filters.push(`${head},scale=${pw}:${ph}:force_original_aspect_ratio=increase,crop=${pw}:${ph},setsar=1,format=yuva420p,${corner},${fade}[${L}]`);
      const seg = plan.find((s) => a < s.oStart + s.oDur) || plan[plan.length - 1];
      const fx = faces[seg.i]?.cx ?? 0.5, m = Math.round(W * 0.05);
      overlays.push({ L, x: fx < 0.5 ? W - pw - m : m, y: Math.round(H * (portrait ? 0.07 : 0.06)), a, b });
    } else {
      filters.push(`${head},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuva420p,${fade}[${L}]`);
      overlays.push({ L, x: 0, y: 0, a, b });
    }
  }
  return { inputs, filters, overlays, audio };
}

/**
 * Un segment rendu : ses morceaux de rush mis bout à bout (image + son brut en PCM pour ne pas décaler le son).
 * Temps remis à 0 après chaque -ss (vidéos de téléphone à fréquence d'image variable). L'image est lue à part et
 * prolongée (dernière image figée) : certains rushes ont moins d'image que de son.
 */
async function renderPart(s, rush, src, vf, vbit, out) {
  const n = s.pieces.length;
  const len = s.out - s.in;
  const vSeek = Math.max(0, Math.min(s.in, (src.videoDuration || Infinity) - 1));
  const off = s.in - vSeek;
  const rv = (t) => Math.max(0, t - s.in + off).toFixed(3);
  const ra = (t) => Math.max(0, t - s.in).toFixed(3);
  const fc = [`[0:v]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${(len + off + 1).toFixed(2)},split=${n}${s.pieces.map((_, k) => `[vi${k}]`).join("")}`];
  if (src.hasAudio) fc.push(`[1:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,asplit=${n}${s.pieces.map((_, k) => `[ai${k}]`).join("")}`);
  s.pieces.forEach(([a, b], k) => {
    // Vitesse du plan : image accélérée ou ralentie, son au même tempo (sans changer la hauteur de la voix).
    const sp = s.speed || 1;
    fc.push(`[vi${k}]trim=start=${rv(a)}:end=${rv(b)},setpts=${sp === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${sp}`}[v${k}]`);
    if (src.hasAudio) fc.push(`[ai${k}]atrim=start=${ra(a)}:end=${ra(b)},asetpts=PTS-STARTPTS,${sp === 1 ? "" : `atempo=${sp},`}afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, (b - a) / sp - 0.015).toFixed(3)}:d=0.015[a${k}]`);
  });
  const ins = s.pieces.map((_, k) => (src.hasAudio ? `[v${k}][a${k}]` : `[v${k}]`)).join("");
  fc.push(`${ins}concat=n=${n}:v=1:a=${src.hasAudio ? 1 : 0}[cv]${src.hasAudio ? "[ca]" : ""}`, `[cv]${vf}[v]`);
  const args = ["-v", "error", "-y", "-ss", String(round(vSeek)), "-t", String(round(len + off + 0.05)), "-i", rush];
  if (src.hasAudio) args.push("-ss", String(s.in), "-t", String(round(len + 0.05)), "-i", rush);
  else args.push("-f", "lavfi", "-t", String(s.oDur), "-i", "anullsrc=r=48000:cl=stereo");
  args.push("-filter_complex", fc.join(";"), "-map", "[v]", "-map", src.hasAudio ? "[ca]" : "1:a:0");
  await run("ffmpeg", [...args, "-c:v", ENCODER, "-b:v", vbit, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-shortest", out]);
}

/**
 * Rend l'EDL. `style` = job.style (sous-titres du projet quand l'EDL n'en a pas).
 * Renvoie { video, cover, srt, duration, notes } ; `notes` = remarques pour Antoine (musique absente…).
 */
export async function renderEdl(cfg, { edl, rushPaths, theme, quality, dir, style, onStep = () => {} }) {
  ensureDir(dir);
  const [W, H] = sizeFor(edl.format, quality);
  const final = quality === "final";
  const vbit = final ? "12M" : "2M";
  const audio = audioOf(edl);
  const captions = captionsOf(edl, style);
  const notes = [];

  const rushes = [...new Set(edl.segments.filter((s) => s.kept).map((s) => s.rush))];
  // Mêmes coupes que la timeline de l'éditeur (removedSpans) : les temps des zooms, du B-roll et des notes tombent juste.
  const plan = renderPlan(edl, FPS);
  if (!plan.length) throw new Error("Aucune phrase gardée : rien à monter.");
  const speechEnd = round(plan[plan.length - 1].oStart + plan[plan.length - 1].oDur);
  const endSec = edl.endCard?.text ? theme.endCardSeconds || 2.5 : 0;
  const total = round(speechEnd + endSec);

  onStep("Cadrage sur le visage…", 0.05);
  const srcInfo = {};
  for (const r of rushes) {
    srcInfo[r] = await probe(rushPaths[r]);
    const { videoDuration: vd, duration: d } = srcInfo[r];
    if (vd && d - vd > 0.5 && plan.some((s) => s.rush === r && s.out > vd + 0.1)) {
      notes.push(`Le rush « ${rushPaths[r].split("/").pop()} » n'a d'image que jusqu'à ${vd.toFixed(1)} s (son jusqu'à ${d.toFixed(1)} s) : image figée après.`);
    }
  }
  const needFaces = (edl.crop || "face") === "face" || (captions.on !== false && captions.position === "auto");
  const faces = needFaces ? await detectFaces(plan, rushPaths, dir) : {};
  const centers = {};
  if ((edl.crop || "face") === "face") {
    for (const r of rushes) {
      const f = plan.filter((s) => s.rush === r && faces[s.i]).map((s) => faces[s.i]);
      if (f.length) centers[r] = { cx: med(f.map((x) => x.cx)), cy: med(f.map((x) => x.cy)) };
    }
  }
  const capFaces = {};
  for (const s of plan) if (faces[s.i]) capFaces[s.i] = faceInFrame(srcInfo[s.rush], W, H, centers[s.rush] || { cx: 0.5, cy: 0.4 }, faces[s.i]);

  const parts = [];
  for (const s of plan) {
    onStep(`Découpe ${s.i + 1}/${plan.length}…`, 0.1 + 0.35 * (s.i / plan.length));
    const src = srcInfo[s.rush];
    const vf = `${cropFilter(src, W, H, centers[s.rush] || { cx: 0.5, cy: 0.4 })},fps=${FPS},setsar=1,format=yuv420p`;
    const p = join(dir, `part${String(s.i).padStart(3, "0")}.mov`);
    await renderPart(s, rushPaths[s.rush], src, vf, vbit, p);
    parts.push(p);
  }
  if (endSec) {
    const p = join(dir, "part999.mov");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${theme.dark.replace("#", "0x")}:s=${W}x${H}:r=${FPS}:d=${endSec}`,
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(endSec), "-vf", "format=yuv420p,setsar=1",
      "-c:v", ENCODER, "-b:v", vbit, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", p]);
    parts.push(p);
  }
  writeFileSync(join(dir, "parts.txt"), parts.map((p) => `file '${p}'`).join("\n"));
  const base = join(dir, "base.mov");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "parts.txt"), "-c", "copy", base]);

  onStep("Son : débruitage, musique, volume…", 0.48);
  const sound = await buildAudio(cfg, { base, dir, audio, final, total, notes });

  onStep("Sous-titres et cartons…", 0.55);
  const words = outputWords(plan);
  const titleUntil = edl.title?.text ? Math.min(toOutput(plan, edl.title.until || 2.8), speechEnd) : Math.min(2.8, speechEnd);
  let overlay = null;
  const showWords = captions.on !== false && words.length;
  // Textes libres : posés en secondes de la timeline de l'éditeur, comme l'accroche et les zooms.
  const texts = cleanTexts(edl.texts).filter((t) => t.start < plan[plan.length - 1].start + plan[plan.length - 1].dur - 0.2)
    .map((t) => ({ ...t, start: toOutput(plan, t.start), end: Math.max(toOutput(plan, t.start) + 0.3, toOutput(plan, t.end)) }));
  if (showWords || edl.title?.text || endSec || texts.length) {
    const html = overlayPage({ W, H, fps: FPS, dur: total, speechEnd, words, title: edl.title && { ...edl.title, until: titleUntil }, endCard: edl.endCard, theme, format: edl.format, captions, faces: capFaces, texts });
    overlay = await renderOverlay(cfg, ensureDir(join(dir, "hf")), html, join(dir, "overlay.mov"), { fps: FPS, theme });
  }

  // Zooms (temps de la timeline de l'éditeur → temps rendu) : pairs = zoom avant, impairs = zoom arrière.
  const terms = [];
  // Les plans serrés fixes ne comptent pas dans l'alternance avant / arrière des zooms qui bougent.
  let k = -1;
  [...(edl.zooms || [])].sort((a, b) => a.at - b.at).forEach((z) => {
    const a = toOutput(plan, z.at), b = toOutput(plan, z.at + z.dur);
    const S = Math.min(z.hold ? 2 : 1.4, Math.max(1.02, Number(z.scale) || 1.1));
    if (b - a < 0.2) return;
    // Plan serré fixe (recadrage) : le même grossissement tout le passage, sans mouvement.
    if (z.hold) return void terms.push(`between(t,${a.toFixed(3)},${b.toFixed(3)})*${(S - 1).toFixed(3)}`);
    k++;
    const p = `(t-${a.toFixed(3)})/${(b - a).toFixed(3)}`;
    terms.push(`between(t,${a.toFixed(3)},${b.toFixed(3)})*${(S - 1).toFixed(3)}*${k % 2 ? `(1-${p})` : p}`);
  });
  const Z = terms.join("+");
  const zoom = Z ? `scale=w='trunc(${W}*(1+${Z})/2)*2':h='trunc(${H}*(1+${Z})/2)*2':eval=frame,crop=${W}:${H}:'(in_w-${W})/2':'(in_h-${H})*0.4',` : "";

  onStep(final ? "Rendu final…" : "Rendu de l'aperçu…", 0.8);
  const out = join(dir, final ? "final.mp4" : "apercu.mp4");
  const inputs = ["-i", base, "-i", sound, ...(overlay ? ["-i", overlay] : [])];
  const br = await brollLayers(cfg, edl, plan, capFaces, W, H, overlay ? 3 : 2);
  inputs.push(...br.inputs);
  const chain = [`[0:v]${zoom}setsar=1,format=yuv420p[s0]`, ...br.filters];
  let cur = "s0";
  br.overlays.forEach((o, i) => {
    chain.push(`[${cur}][${o.L}]overlay=${o.x}:${o.y}:format=auto:eof_action=pass:enable='between(t,${o.a.toFixed(3)},${o.b.toFixed(3)})'[s${i + 1}]`);
    cur = `s${i + 1}`;
  });
  chain.push(overlay ? `[${cur}][2:v]overlay=0:0:format=auto,format=yuv420p[v]` : `[${cur}]format=yuv420p[v]`);
  // Son des plans de B-roll gardé : mélangé sous la voix (et la musique), sans changer leur niveau.
  if (br.audio.length) chain.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo[vx];[vx]${br.audio.map((x) => `[${x}]`).join("")}amix=inputs=${br.audio.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`);
  const fc = chain.join(";");
  await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", fc, "-map", "[v]", "-map", br.audio.length ? "[a]" : "1:a",
    "-c:v", ENCODER, "-b:v", vbit, "-c:a", "aac", "-b:a", final ? "192k" : "128k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out]);
  const cover = join(dir, final ? "couverture.jpg" : "apercu.jpg");
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(titleUntil * 0.6, total / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", cover]).catch(() => {});
  writeFileSync(join(dir, "sous-titres.srt"), srt(words));

  for (const f of readdirSync(dir)) if (/^part\d+\.mov$|^base\.mov$|^overlay\.mov$|^parts\.txt$|\.wav$/.test(f)) rmSync(join(dir, f), { force: true });
  rmSync(join(dir, "hf"), { recursive: true, force: true });
  rmSync(join(dir, "df"), { recursive: true, force: true });
  for (const n of notes) log("note :", n);
  return { video: out, cover, srt: join(dir, "sous-titres.srt"), duration: total, notes };
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
