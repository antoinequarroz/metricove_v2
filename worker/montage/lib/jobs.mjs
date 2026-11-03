// Traitement d'une tâche réclamée : propose / preview / final / script (contrat docs/MONTAGE.md).
import { statSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { ensureDir, assertSpace, themeFor, log, round } from "./util.mjs";
import { localRushes } from "./rushes.mjs";
import { transcribe, sentences } from "./transcribe.mjs";
import { proposeEdit, writeScript } from "./claude.mjs";
import { renderEdl, timeline } from "./render.mjs";

export async function handle(api, cfg, { job, action, rushes = [] }) {
  const dir = ensureDir(join(cfg.workDir, "taches", job.id));
  const step = (s, p) => { log(`[${job.id.slice(0, 8)}] ${s}`); return api.step(job.id, s, p); };
  try {
    if (action === "script") {
      await step("Écriture du texte du prompteur…", 0.3);
      const script = await writeScript(cfg, job, dir);
      await api.patch(job.id, { script, status: "done" });
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
      const p = await proposeEdit(cfg, { job, cands, previous, cwd: dir });
      const edl = buildEdl(job, cands, p);
      await step("Rendu de l'aperçu…", 0.5);
      const r = await renderEdl(cfg, { edl, rushPaths, theme, quality: "preview", dir: join(dir, "apercu"), onStep: (s, x) => step(s, 0.5 + 0.45 * x) });
      const upload = await api.upload(r.video, `apercu-${job.id}.mp4`);
      await api.addVersion(job.id, { edl, notes: p.notes, upload });
      log(`[${job.id.slice(0, 8)}] proposition envoyée (${timeline(edl).length} phrases, ${r.duration.toFixed(1)} s)`);
      return;
    }

    if (action === "preview") {
      const v = job.versions[job.versions.length - 1];
      const r = await renderEdl(cfg, { edl: v.edl, rushPaths, theme, quality: "preview", dir: join(dir, "apercu"), onStep: step });
      const upload = await api.upload(r.video, `apercu-${job.id}-v${v.n}.mp4`);
      await api.setPreview(job.id, v.n, upload);
      return;
    }

    if (action === "final") {
      const v = job.versions.find((x) => x.n === job.approved);
      if (!v) throw new Error(`Version validée introuvable (${job.approved}).`);
      assertSpace(cfg, cfg.minFreeGb + 1);
      const r = await renderEdl(cfg, { edl: v.edl, rushPaths, theme, quality: "final", dir: join(dir, "final"), onStep: (s, x) => step(s, 0.05 + 0.85 * x) });
      await step("Envoi vers la bibliothèque…", 0.92);
      const upload = await api.upload(r.video, `${slug(job.title)}.mp4`);
      await api.final(job.id, upload, job.title);
      rmSync(join(dir, "apercu"), { recursive: true, force: true });
      log(`[${job.id.slice(0, 8)}] vidéo finale envoyée : ${r.video}`);
      return;
    }
    throw new Error(`Action inconnue : ${action}`);
  } catch (e) {
    log(`[${job.id.slice(0, 8)}] échec :`, e.message);
    await api.fail(job.id, e.message).catch(() => {});
  }
}

/** Transforme la réponse de Claude en EDL du contrat (temps des segments et des mots dans le rush). */
export function buildEdl(job, cands, p) {
  const byId = Object.fromEntries(cands.map((c) => [c.id, c]));
  const seen = new Set();
  const segments = [];
  for (const o of p.order || []) {
    const c = byId[o.id];
    if (!c || seen.has(o.id)) continue;
    seen.add(o.id);
    segments.push({ id: c.id, rush: c.rush, in: c.in, out: c.out, text: c.text, kept: !!o.kept, ...(o.kept ? {} : { reason: o.reason || "coupé" }), words: c.words });
  }
  for (const c of cands) if (!seen.has(c.id)) segments.push({ id: c.id, rush: c.rush, in: c.in, out: c.out, text: c.text, kept: false, reason: "non retenu", words: c.words });
  const edl = { format: job.brief?.format || "9:16", segments, title: p.title?.text ? { text: p.title.text, until: 0 } : null, endCard: p.endCard?.text ? { text: p.endCard.text } : null, crop: "face", zooms: [] };
  const tl = timeline(edl);
  if (edl.title) edl.title.until = round(Math.min(2.8, tl[0] ? tl[0].dur + 0.3 : 2.5));
  for (const z of (p.zooms || []).slice(0, 3)) {
    const s = tl.find((x) => x.id === z.id);
    if (s) edl.zooms.push({ at: s.start, dur: s.dur, scale: Math.min(1.2, Math.max(1.03, z.scale || 1.1)) });
  }
  return edl;
}

const slug = (s) => (s || "video").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "video";
