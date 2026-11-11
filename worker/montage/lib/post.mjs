// Post entier écrit par Claude (action "post") : à partir d'une idée, le texte de chaque visuel
// (carrousel ou image seule) et la description du post. Les visuels sont dessinés dans Metricove.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE } from "./util.mjs";
import { ask } from "./claude.mjs";
import { isLivreMatch } from "./caption.mjs";
import { voiceRules } from "./voice.mjs";

const LIMITS = { x: 280, twitter: 280, instagram: 2200, tiktok: 2200, linkedin: 3000, facebook: 5000, youtube: 5000 };
const NAMES = { x: "X (Twitter)", instagram: "Instagram", tiktok: "TikTok", linkedin: "LinkedIn", facebook: "Facebook", youtube: "YouTube" };

export async function writePost(cfg, job, step) {
  const p = job.post || {};
  const n = Math.min(10, Math.max(1, Math.round(p.slides || 5)));
  const networks = [...new Set((p.networks || []).map((x) => String(x).toLowerCase()))];
  const max = Math.min(...networks.map((x) => LIMITS[x] || 2200), 2200);
  const lm = isLivreMatch(p);
  const examples = lm && existsSync(join(HERE, "prompts", "livrematch-legendes.txt")) ? readFileSync(join(HERE, "prompts", "livrematch-legendes.txt"), "utf8") : "";

  const prompt = `Écris un post complet en français pour Antoine Quarroz, à partir de son idée : ${n > 1 ? `un carrousel de ${n} visuels` : "une seule image avec du texte"}, et la description qui l'accompagne.

IDÉE D'ANTOINE (sujet et consignes) :
${p.idea || job.title}

RÉSEAUX : ${networks.map((x) => NAMES[x] || x).join(", ") || "Instagram"} — comptes : ${(p.accounts || []).map((a) => `@${a.handle} (${a.network})`).join(", ") || "—"}
PROJET : ${p.project || (lm ? "LivreMatch" : "Perso")}

LES VISUELS (slides) : exactement ${n}, dans l'ordre.
- Chaque visuel a un "title" (le gros texte : 2 à 8 mots, 60 caractères au plus) et un "body" (le petit texte : 0 à 2 phrases courtes, 160 caractères au plus ; chaîne vide si le titre suffit).
${n > 1
  ? `- Visuel 1 : une accroche qui donne envie de faire défiler (promesse, question ou chiffre de l'idée). Pas de « Dans ce carrousel ».
- Visuels du milieu : une seule idée concrète par visuel, dans un ordre logique.
- Dernier visuel : la conclusion ou l'appel à l'action (commenter, enregistrer, suivre, lien en bio).`
  : `- Une phrase forte qui se comprend seule.`}
- Pas d'emojis dans les visuels, pas de hashtags, pas de numéros de page, pas de guillemets autour du texte.

LA DESCRIPTION ("caption") : ${max} caractères au plus, hashtags compris${max <= 280 ? " (X : vise 240 caractères au plus)" : ""}. Elle complète les visuels sans les recopier, et se termine par 3 à 5 hashtags pertinents.

TON ET RÈGLES
${voiceRules(job, lm
  ? `- LivreMatch : lecture et recommandations de livres (romantasy, fantasy). Tutoiement, ton chaleureux et accrocheur.
- Ni prix, ni note, ni Amazon. Aucun spoiler au-delà de la 4e de couverture. Invitation au quiz sur livrematch.fr dans la description.`
  : `- Perso : Antoine parle de développement et d'IA (outils, automatisation, retours d'expérience). Ton direct, concret, à la première personne, sans jargon inutile.`)}
${examples ? `- Descriptions déjà publiées (imite le ton, ne recopie pas) :\n${examples}\n` : ""}- N'invente AUCUN fait (chiffre, client, lieu, parcours, citation) : uniquement ce qui est dans l'idée. S'il manque une information indispensable, écris [à compléter].`;

  await step("Claude écrit le post…", 0.4);
  const schema = {
    type: "object",
    required: ["slides", "caption"],
    properties: {
      slides: { type: "array", items: { type: "object", required: ["title", "body"], properties: { title: { type: "string" }, body: { type: "string" } } } },
      caption: { type: "string" },
    },
  };
  let r = await ask(cfg, prompt, schema, cfg.workDir);
  if ((r.caption || "").length > max) {
    await step("Raccourcissement de la description…", 0.8);
    r = await ask(cfg, `${prompt}\n\nTa version précédente avait une description de ${r.caption.length} caractères, au-delà de la limite de ${max}. Garde les mêmes visuels et raccourcis la description sous ${max} caractères :\n${JSON.stringify(r)}`, schema, cfg.workDir);
  }
  const slides = (Array.isArray(r.slides) ? r.slides : [])
    .map((s) => ({ title: String(s?.title || "").trim().slice(0, 200), body: String(s?.body || "").trim().slice(0, 600) }))
    .filter((s) => s.title || s.body)
    .slice(0, 10);
  if (!slides.length) throw new Error("Claude n'a écrit aucun visuel.");
  return { slides, caption: String(r.caption || "").trim().slice(0, max) };
}
