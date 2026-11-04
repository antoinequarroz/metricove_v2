// Description de post écrite par Claude (action "caption") : transcription rapide de la vidéo, puis une
// seule description adaptée aux réseaux cochés et au projet, dans le ton d'Antoine.
import { existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HERE, ensureDir, log } from "./util.mjs";
import { transcribe } from "./transcribe.mjs";
import { ask } from "./claude.mjs";

const LIMITS = { x: 280, twitter: 280, instagram: 2200, tiktok: 2200, linkedin: 3000, facebook: 5000, youtube: 5000 };
const NAMES = { x: "X (Twitter)", instagram: "Instagram", tiktok: "TikTok", linkedin: "LinkedIn", facebook: "Facebook", youtube: "YouTube" };

export const isLivreMatch = (c) =>
  /livre ?match/i.test(c.project || "") || (c.accounts || []).some((a) => /livrematch/i.test(a.handle || ""));

/** Télécharge la vidéo du post (avec le jeton) et la transcrit ; renvoie le texte dit, ou "" si muette. */
async function videoText(api, cfg, media, step) {
  if (!media?.url) return "";
  const dir = ensureDir(join(cfg.workDir, "descriptions"));
  const file = join(dir, `${media.id}.mp4`);
  if (!existsSync(file)) {
    await step("Récupération de la vidéo…", 0.1);
    const r = await api.req("GET", media.url, { raw: true });
    if (!r.ok) throw new Error(`téléchargement de la vidéo → ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(file + ".part"));
    renameSync(file + ".part", file);
  }
  await step("Transcription de la vidéo…", 0.25);
  try {
    const words = await transcribe(cfg, file, statSync(file));
    return words.map((w) => w.w).join(" ");
  } finally {
    rmSync(file, { force: true }); // la transcription est en cache, la vidéo n'est plus utile
  }
}

export async function writeCaption(api, cfg, { job, media }, step) {
  const c = job.caption || {};
  const networks = [...new Set((c.networks || []).map((n) => String(n).toLowerCase()))];
  const max = Math.min(...networks.map((n) => LIMITS[n] || 2200), 2200);
  const lm = isLivreMatch(c);
  const spoken = await videoText(api, cfg, media, step).catch((e) => { log("transcription impossible :", e.message); return ""; });
  const examples = lm && existsSync(join(HERE, "prompts", "livrematch-legendes.txt")) ? readFileSync(join(HERE, "prompts", "livrematch-legendes.txt"), "utf8") : "";

  const prompt = `Écris UNE description de post en français pour Antoine Quarroz, prête à publier.

RÉSEAUX : ${networks.map((n) => NAMES[n] || n).join(", ") || "Instagram"} — comptes : ${(c.accounts || []).map((a) => `@${a.handle} (${a.network})`).join(", ") || "—"}
PROJET : ${c.project || (lm ? "LivreMatch" : "Perso")}
LONGUEUR MAXIMALE : ${max} caractères, hashtags compris${max <= 280 ? " (X : vise 240 caractères au plus)" : ""}.
${media ? `VIDÉO : « ${media.title} » (${Math.round(media.duration || 0)} s, ${media.aspect || "?"})` : "Pas de vidéo."}
${spoken ? `TEXTE DIT DANS LA VIDÉO (transcription) :\n${spoken.slice(0, 4000)}` : ""}
${c.draft ? `CE QU'ANTOINE A DÉJÀ ÉCRIT (brouillon à réécrire en gardant son sens, OU consigne à suivre si c'est une instruction) :\n${c.draft}` : ""}

TON ET RÈGLES
${lm
  ? `- LivreMatch : lecture et recommandations de livres (romantasy, fantasy). Tutoiement, ton chaleureux et accrocheur.
- Structure des légendes LivreMatch : accroche d'une ligne avec un emoji, 2-3 lignes de contexte, « … pourrait te plaire si tu aimes : » avec 3-4 tirets, invitation au quiz sur livrematch.fr.
- Ni prix, ni note, ni Amazon. Aucun spoiler au-delà de la 4e de couverture.
${examples ? `- Modèles déjà publiés (imite le ton et la structure, ne recopie pas) :\n${examples}` : ""}`
  : `- Perso : Antoine parle de développement et d'IA (outils, automatisation, retours d'expérience). Ton direct, concret, à la première personne, sans jargon inutile.
- LinkedIn : une accroche forte en première ligne, des paragraphes courts, une question ou un appel à l'action à la fin.`}
- N'invente AUCUN fait sur Antoine (parcours, chiffres, clients, lieux) : uniquement ce qui est dans la vidéo, le brouillon ou le titre.
- Termine par 3 à 5 hashtags pertinents.
- Pas de guillemets autour du texte, pas de titre, pas de commentaire : uniquement la description.
${c.youtube ? "- Donne aussi youtubeTitle : un titre YouTube accrocheur de 100 caractères maximum." : "- youtubeTitle : chaîne vide."}`;

  await step("Claude écrit la description…", 0.6);
  const schema = { type: "object", required: ["caption", "youtubeTitle"], properties: { caption: { type: "string" }, youtubeTitle: { type: "string" } } };
  let r = await ask(cfg, prompt, schema, join(cfg.workDir));
  if (r.caption.length > max) {
    await step("Raccourcissement…", 0.85);
    r = await ask(cfg, `${prompt}\n\nTa version précédente faisait ${r.caption.length} caractères, au-delà de la limite de ${max}. Raccourcis-la sous ${max} caractères en gardant l'accroche et les hashtags :\n${r.caption}`, schema, cfg.workDir);
  }
  const caption = r.caption.trim().slice(0, max);
  const youtubeTitle = c.youtube ? (r.youtubeTitle || media?.title || "").trim().slice(0, 100) : undefined;
  return { caption, youtubeTitle };
}
