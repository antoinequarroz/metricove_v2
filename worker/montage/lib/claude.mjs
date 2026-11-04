// Propositions de Claude Code (abonnement du Mac) : choix des phrases, ordre, accroche, fin, zooms ; textes de prompteur.
import { run, log } from "./util.mjs";

const PROPOSAL_SCHEMA = {
  type: "object",
  required: ["order", "notes"],
  properties: {
    order: {
      type: "array",
      description: "Toutes les phrases, dans l'ordre du montage ; kept=false pour les coupées (raté, doublon, hors sujet…).",
      items: { type: "object", required: ["id", "kept"], properties: { id: { type: "string" }, kept: { type: "boolean" }, reason: { type: "string" } } },
    },
    title: { type: ["object", "null"], properties: { text: { type: "string" } } },
    endCard: { type: ["object", "null"], properties: { text: { type: "string" } } },
    zooms: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" }, scale: { type: "number" } } } },
    notes: { type: "string", description: "2-4 phrases en français pour Antoine : ce qui a été gardé, coupé, et pourquoi." },
  },
};

export async function ask(cfg, prompt, schema, cwd) {
  const args = ["-p", "--output-format", "json", "--disallowedTools", "Bash", "Edit", "Write", "WebFetch", "WebSearch", "NotebookEdit"];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  if (cfg.claude.model) args.push("--model", cfg.claude.model);
  const out = await run(cfg.claude.bin, args, { input: prompt, cwd });
  const j = JSON.parse(out);
  if (j.is_error) throw new Error(`Claude : ${j.result || "erreur"}`);
  if (!schema) return String(j.result || "").trim();
  if (j.structured_output) return j.structured_output;
  const m = String(j.result || "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude n'a pas renvoyé de JSON exploitable.");
  return JSON.parse(m[0]);
}

const fmtTime = (s) => s.toFixed(1);

/**
 * Demande à Claude une liste de montage.
 * `cands` : phrases candidates [{ id, rush, in, out, text }] (toutes les prises de tous les rushes).
 */
export async function proposeEdit(cfg, { job, cands, previous, cwd }) {
  const b = job.brief || {};
  const lines = cands.map((c) => `${c.id} | rush ${c.rushName} | ${fmtTime(c.in)}–${fmtTime(c.out)} s | ${c.text}`).join("\n");
  const prev = previous
    ? `\nVERSION PRÉCÉDENTE (n°${previous.n}) — phrases gardées dans l'ordre : ${previous.kept.join(", ") || "aucune"}.\nAccroche : ${previous.title || "—"} · Fin : ${previous.endCard || "—"}\n`
    : "";
  const prompt = `Tu es monteur vidéo pour les réseaux sociaux (Reels, TikTok, Shorts, LinkedIn). Tu montes à partir de la transcription.

BRIEF
- Format : ${b.format || "9:16"}
- Durée visée : ${b.seconds ? `${b.seconds} s environ` : "la plus courte qui garde le message"}
- Accroche souhaitée : ${b.hook || "à proposer"}
- Appel à l'action : ${b.cta || "à proposer si pertinent"}
- Consignes : ${b.instructions || "—"}
${job.script ? `\nTEXTE PRÉVU (prompteur) — sert à reconnaître les bonnes prises :\n${job.script}\n` : ""}${prev}${job.feedback ? `\nRETOUR D'ANTOINE SUR LA DERNIÈRE VERSION (prioritaire) : ${job.feedback}\n` : ""}
PHRASES DISPONIBLES (id | rush | temps | texte) :
${lines}

RÈGLES
- Pour chaque idée dite plusieurs fois, garde la meilleure prise (souvent la dernière complète, sans hésitation) et coupe les autres (reason « doublon » ou « raté »).
- Coupe les faux départs, phrases inachevées, « euh », hors-sujet (reason courte).
- Garde un ordre logique : accroche forte en premier, puis le développement, puis l'appel à l'action.
- Respecte la durée visée en additionnant (out − in) des phrases gardées.
- N'invente aucun mot : on ne monte que ce qui a été dit.
- Accroche (title.text) : 3 à 7 mots percutants affichés en ouverture ; null si inutile.
- Carton de fin (endCard.text) : l'appel à l'action en 2 à 6 mots ; null si aucun.
- Zooms : 2 ou 3 phrases maximum où un zoom lent renforce le propos (scale 1.08 à 1.15), jamais deux phrases consécutives.
- order doit contenir TOUTES les phrases (gardées et coupées), une seule fois chacune.
Réponds uniquement avec le JSON demandé.`;
  log("proposition de montage demandée à Claude");
  return ask(cfg, prompt, PROPOSAL_SCHEMA, cwd);
}

/** Texte de prompteur : phrases courtes, une par ligne. */
export async function writeScript(cfg, job, cwd) {
  const b = job.brief || {};
  const prompt = `Écris un texte de prompteur en français pour une vidéo face caméra (${b.format || "9:16"}, ${b.seconds || 45} s environ).
Sujet et consignes : ${b.instructions || job.title}
${b.hook ? `Accroche imposée : ${b.hook}\n` : ""}${b.cta ? `Appel à l'action : ${b.cta}\n` : ""}
Structure : une accroche forte (1 phrase), 3 idées concrètes, un appel à l'action. Ton direct, oral, tutoiement.
Une phrase courte par ligne (12 mots maximum), sans titres, sans puces, sans emojis, sans didascalies.
N'invente aucun fait (lieu, métier, chiffre, nom, expérience) qui n'est pas dans les consignes : reste sur ce qui est donné.
S'il manque une information indispensable, mets au plus deux trous à compléter, sous la forme [à compléter : …]. Rends uniquement le texte.`;
  return ask(cfg, prompt, null, cwd);
}
