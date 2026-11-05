// Traitement d'une tâche réclamée : propose / preview / final / script / caption / cover (contrat docs/MONTAGE.md).
import { statSync, rmSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { ensureDir, assertSpace, themeFor, log, round } from "./util.mjs";
import { localRushes } from "./rushes.mjs";
import { transcribe, sentences } from "./transcribe.mjs";
import { proposeEdit, writeScript } from "./claude.mjs";
import { renderEdl } from "./render.mjs";
import { timeline, toRush, toTimeline, FILLER, captionsOf, audioOf } from "./edl.mjs";
import { listTracks } from "./audio.mjs";
import { listBroll, resolveBroll } from "./broll.mjs";
import { writeCaption } from "./caption.mjs";
import { makeCover } from "./cover.mjs";

export async function handle(api, cfg, { job, action, rushes = [], media }) {
  const dir = ensureDir(join(cfg.workDir, "taches", job.id));
  // Metricove redonne une tâche sans nouvelles depuis 15 min : on renvoie la dernière étape chaque minute.
  let last = { s: "Démarrage…", p: 0 };
  const step = (s, p) => { last = { s, p }; log(`[${job.id.slice(0, 8)}] ${s}`); return api.step(job.id, s, p); };
  const beat = setInterval(() => api.step(job.id, last.s, last.p), 60_000);
  try {
    if (action === "script") {
      await step("Écriture du texte du prompteur…", 0.3);
      const script = await writeScript(cfg, job, dir);
      await api.patch(job.id, { script, status: "done" });
      return;
    }
    if (action === "caption") {
      const t0 = Date.now();
      const { caption, youtubeTitle } = await writeCaption(api, cfg, { job, media }, step);
      await api.patch(job.id, { status: "done", caption, ...(youtubeTitle ? { youtubeTitle } : {}) });
      log(`[${job.id.slice(0, 8)}] description envoyée (${caption.length} car., ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    if (action === "cover") {
      await makeCover(api, cfg, { job, media }, step);
      await api.patch(job.id, { status: "done" });
      return;
    }
    assertSpace(cfg);
    const theme = themeFor(cfg, job);
    await step("Récupération des rushes…", 0.02);
    const rushPaths = await localRushes(api, cfg, rushes.filter((r) => job.rushIds.includes(r.id)));

    if (action === "propose") {
      const cands = [];
      for (const [i, id] of job.rushIds.entries()) {
        await step(`Transcription ${i + 1}/${job.rushIds.length}…`, 0.05 + 0.25 * (i / job.rushIds.length));
        const words = await transcribe(cfg, rushPaths[id], statSync(rushPaths[id]));
        for (const s of sentences(id, words)) cands.push({ ...s, id: `p${cands.length + 1}`, rushName: basename(rushPaths[id]) });
      }
      if (!cands.length) throw new Error("Aucune parole détectée dans les rushes.");
      await step("Claude prépare le montage…", 0.35);
      const last = job.versions?.[job.versions.length - 1];
      const previous = last && {
        n: last.n,
        kept: last.edl.segments.filter((s) => s.kept).map((s) => cands.find((c) => c.rush === s.rush && Math.abs(c.in - s.in) < 0.3)?.id).filter(Boolean),
        title: last.edl.title?.text, endCard: last.edl.endCard?.text,
      };
      // Réglages choisis par Antoine sur la dernière version : on les garde.
      const settings = last ? { captions: last.edl.captions, audio: last.edl.audio, exports: last.edl.exports, crop: last.edl.crop, brollAuto: last.edl.brollAuto } : {};
      const captions = captionsOf(settings, job.style);
      const audio = audioOf(settings);
      const tracks = audio.music.on && !audio.music.track ? listTracks(cfg) : [];
      const marks = writeMarks(job, cands, dir);
      const brollAuto = settings.brollAuto !== false;
      const p = await proposeEdit(cfg, { job, cands, previous, marks, captions, tracks, broll: brollAuto ? listBroll(cfg) : null, cwd: dir });
      const edl = buildEdl(job, cands, p, { settings, captions, tracks });
      const bnotes = [];
      if (edl.broll?.length) {
        await step("Recherche du B-roll…", 0.45);
        const b = await resolveBroll(cfg, edl.broll, edl.format);
        edl.broll = b.broll; bnotes.push(...b.notes);
      }
      await step("Rendu de l'aperçu…", 0.5);
      const r = await renderEdl(cfg, { edl, rushPaths, theme, quality: "preview", style: job.style, dir: join(dir, "apercu"), onStep: (s, x) => step(s, 0.5 + 0.45 * x) });
      const upload = await api.upload(r.video, `apercu-${job.id}.mp4`);
      const notes = [p.notes, ...bnotes, ...r.notes].filter(Boolean).join("\n");
      await api.addVersion(job.id, { edl, notes, upload });
      log(`[${job.id.slice(0, 8)}] proposition envoyée (${timeline(edl).length} phrases, ${r.duration.toFixed(1)} s)`);
      return;
    }

    if (action === "preview") {
      const v = job.versions[job.versions.length - 1];
      await withBroll(cfg, v.edl, step);
      const r = await renderEdl(cfg, { edl: v.edl, rushPaths, theme, quality: "preview", style: job.style, dir: join(dir, "apercu"), onStep: step });
      const upload = await api.upload(r.video, `apercu-${job.id}-v${v.n}.mp4`);
      await api.setPreview(job.id, v.n, upload, v.edl.broll);
      return;
    }

    if (action === "final") {
      const v = job.versions.find((x) => x.n === job.approved);
      if (!v) throw new Error(`Version validée introuvable (${job.approved}).`);
      await withBroll(cfg, v.edl, step);
      assertSpace(cfg, cfg.minFreeGb + 1);
      const exports = [...new Set(v.edl.exports || [])].filter((f) => f !== v.edl.format);
      const share = 0.8 / (1 + exports.length);
      const r = await renderEdl(cfg, { edl: v.edl, rushPaths, theme, quality: "final", style: job.style, dir: join(dir, "final"), onStep: (s, x) => step(s, 0.05 + share * x) });
      await step("Envoi vers la bibliothèque…", 0.05 + share);
      const upload = await api.upload(r.video, `${slug(job.title)}.mp4`);
      const res = await api.final(job.id, upload, job.title);
      rmSync(join(dir, "apercu"), { recursive: true, force: true });
      log(`[${job.id.slice(0, 8)}] vidéo finale envoyée : ${r.video}`);
      // Formats en plus : même montage recadré, chacun entre dans la bibliothèque comme sa propre vidéo.
      for (const [k, fmt] of exports.entries()) {
        assertSpace(cfg, cfg.minFreeGb + 0.5);
        const at = 0.05 + share * (k + 1);
        const fdir = join(dir, `final-${fmt.replace(":", "x")}`);
        try {
          const e = await renderEdl(cfg, { edl: { ...v.edl, format: fmt }, rushPaths, theme, quality: "final", style: job.style, dir: fdir, onStep: (s, x) => step(`${fmt} · ${s}`, at + share * x) });
          const up = await api.upload(e.video, `${slug(job.title)}-${fmt.replace(":", "x")}.mp4`);
          await api.addMedia(up, `${job.title} (${fmt})`);
          log(`[${job.id.slice(0, 8)}] format ${fmt} envoyé`);
        } catch (e) { log(`[${job.id.slice(0, 8)}] format ${fmt} non rendu :`, e.message); }
        finally { rmSync(fdir, { recursive: true, force: true }); }
      }
      // Couverture du feed faite avec le montage (même travail que l'action « cover »).
      const media = res?.media;
      if (media?.id) {
        try {
          await makeCover(api, cfg, { job: { ...job, cover: { mediaId: media.id, project: job.projectName || job.projectId } }, media: { ...media, title: media.title || job.title, duration: r.duration }, localVideo: r.video },
            async (s) => log(`[${job.id.slice(0, 8)}] couverture : ${s}`));
        } catch (e) { log(`[${job.id.slice(0, 8)}] couverture non faite :`, e.message); }
      }
      return;
    }
    throw new Error(`Action inconnue : ${action}`);
  } catch (e) {
    log(`[${job.id.slice(0, 8)}] échec :`, e.message);
    await api.fail(job.id, e.message).catch(() => {});
  } finally {
    clearInterval(beat);
  }
}

/** Plans de B-roll sans source (ajoutés ou changés à la main) : cherchés avant le rendu. */
async function withBroll(cfg, edl, step) {
  if (!edl.broll?.some((s) => !s.source)) return;
  await step("Recherche du B-roll…", 0.03);
  const b = await resolveBroll(cfg, edl.broll, edl.format);
  edl.broll = b.broll;
  for (const n of b.notes) log("note :", n);
}

/** Écrit les images des notes dessinées dans le dossier de travail (mark-<id>.jpg) et situe chaque note dans les phrases. */
function writeMarks(job, cands, dir) {
  return (job.marks || []).slice(0, 8).map((m) => {
    let file;
    const data = String(m.image || "").match(/^data:image\/(?:jpeg|jpg|png);base64,(.+)$/);
    if (data) {
      file = join(dir, `mark-${String(m.id).replace(/[^\w-]/g, "").slice(0, 40) || "note"}.jpg`);
      writeFileSync(file, Buffer.from(data[1], "base64"));
    }
    const v = job.versions?.find((x) => x.n === m.version);
    const seg = v && timeline(v.edl).find((s) => m.t < s.start + s.dur) ;
    const rt = seg ? toRush(seg, m.t) : null;
    const c = seg && cands.find((x) => x.rush === seg.rush && rt >= x.in - 0.1 && rt <= x.out + 0.1);
    return { file, t: Number(m.t) || 0, version: m.version, text: m.text, phrase: c?.id, said: seg?.text };
  });
}

/** Transforme la réponse de Claude en EDL du contrat (temps des segments et des mots dans le rush). */
export function buildEdl(job, cands, p, { settings = {}, captions = {}, tracks = [] } = {}) {
  const byId = Object.fromEntries(cands.map((c) => [c.id, c]));
  const refs = (list) => {
    const m = {};
    for (const r of list || []) for (const i of r.words || []) (m[r.id] ||= new Set()).add(i);
    return m;
  };
  const cuts = refs(p.cuts), hls = refs(p.highlights);
  const emo = {};
  if (captions.on !== false && captions.emoji) for (const e of p.emojis || []) if (e.emoji) (emo[e.id] ||= {})[e.word] = String(e.emoji).slice(0, 8);
  const wordsOf = (c) => {
    const ws = c.words.map((w, i) => ({
      ...w,
      ...(cuts[c.id]?.has(i) || FILLER.test(w.w) ? { cut: true } : {}),
      ...(hls[c.id]?.has(i) ? { hl: true } : {}),
      ...(emo[c.id]?.[i] ? { emoji: emo[c.id][i] } : {}),
    }));
    if (ws.every((w) => w.cut)) ws.forEach((w) => delete w.cut); // une phrase n'est jamais vidée par les mots coupés
    return ws;
  };
  const seen = new Set();
  const segments = [];
  for (const o of p.order || []) {
    const c = byId[o.id];
    if (!c || seen.has(o.id)) continue;
    seen.add(o.id);
    segments.push({ id: c.id, rush: c.rush, in: c.in, out: c.out, text: c.text, kept: !!o.kept, ...(o.kept ? {} : { reason: o.reason || "coupé" }), words: wordsOf(c) });
  }
  for (const c of cands) if (!seen.has(c.id)) segments.push({ id: c.id, rush: c.rush, in: c.in, out: c.out, text: c.text, kept: false, reason: "non retenu", words: wordsOf(c) });
  const hooks = [...new Set([p.title?.text, ...(p.hooks || [])].map((h) => String(h || "").trim()).filter(Boolean))].slice(0, 3);
  const titleText = p.title === null ? "" : p.title?.text?.trim() || hooks[0] || "";
  const edl = {
    format: job.brief?.format || "9:16", segments,
    title: titleText ? { text: titleText, until: 0 } : null,
    endCard: p.endCard?.text ? { text: p.endCard.text } : null,
    crop: settings.crop || "face", zooms: [],
    ...(hooks.length ? { hooks } : {}),
    ...(settings.captions ? { captions: settings.captions } : {}),
    ...(settings.audio ? { audio: structuredClone(settings.audio) } : {}),
    ...(settings.exports?.length ? { exports: settings.exports } : {}),
  };
  if (edl.audio?.music?.on && !edl.audio.music.track && tracks.includes(p.music)) edl.audio.music.track = p.music;
  if (settings.brollAuto === false) edl.brollAuto = false;
  const tl = timeline(edl);
  // B-roll : du mot choisi par Claude au temps de la timeline (1,5 à 3 s, sans chevauchement, hors accroche).
  if (settings.brollAuto !== false) {
    const total = tl.length ? tl[tl.length - 1].start + tl[tl.length - 1].dur : 0;
    const shots = [];
    for (const x of p.broll || []) {
      const s = tl.find((y) => y.id === x.id);
      const w = s?.words?.[x.word];
      if (!s || !w || !String(x.query || "").trim()) continue;
      const at = round(toTimeline(s, w.t0));
      const dur = round(Math.min(3, Math.max(1.5, Number(x.dur) || 2), total - at));
      if (dur < 1 || shots.some((o) => at < o.at + o.dur && o.at < at + dur)) continue;
      shots.push({ at, dur, query: String(x.query).trim().slice(0, 80), mode: x.mode === "pip" ? "pip" : "full", ...(x.file ? { source: "mine", ref: String(x.file) } : {}) });
    }
    edl.broll = shots.sort((a, b) => a.at - b.at).slice(0, 5);
  }
  if (edl.title) edl.title.until = round(Math.min(2.8, tl[0] ? tl[0].dur + 0.3 : 2.5));
  const maxZooms = Math.max(3, Math.ceil(tl.length / 2) + 1);
  for (const z of (p.zooms || []).slice(0, maxZooms)) {
    const s = tl.find((x) => x.id === z.id);
    if (s && s.dur > 0.4 && !edl.zooms.some((y) => y.at === s.start)) edl.zooms.push({ at: s.start, dur: s.dur, scale: round(Math.min(1.2, Math.max(1.04, z.scale || 1.1)), 2) });
  }
  edl.zooms.sort((a, b) => a.at - b.at);
  return edl;
}

const slug = (s) => (s || "video").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "video";
