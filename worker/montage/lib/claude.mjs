// Propositions de Claude Code (abonnement du Mac) : choix des phrases, ordre, mots coupés, 3 accroches, fin, zooms,
// mots clés, emojis, musique ; textes de prompteur. Read reste permis : Claude lit les images des notes dessinées.
import { run, log } from "./util.mjs";

const wordRefs = (description) => ({
  type: "array", description,
  items: { type: "object", required: ["id", "words"], properties: { id: { type: "string" }, words: { type: "array", items: { type: "integer" } } } },
});

const PROPOSAL_SCHEMA = {
  type: "object",
  required: ["order", "notes", "hooks"],
  properties: {
    order: {
      type: "array",
      description: "Toutes les phrases, dans l'ordre du montage ; kept=false pour les coupées (raté, doublon, hors sujet…).",
      items: { type: "object", required: ["id", "kept"], properties: { id: { type: "string" }, kept: { type: "boolean" }, reason: { type: "string" } } },
    },
    cuts: wordRefs("Mots à retirer à l'intérieur des phrases gardées (« euh », bégaiement, mot répété, faux départ) : indices des mots dans la phrase."),
    highlights: wordRefs("Mots clés à mettre en couleur dans les sous-titres : indices des mots dans la phrase."),
    emojis: { type: "array", items: { type: "object", required: ["id", "word", "emoji"], properties: { id: { type: "string" }, word: { type: "integer" }, emoji: { type: "string" } } } },
    hooks: { type: "array", items: { type: "string" }, description: "3 accroches différentes (3 à 7 mots)." },
    title: { type: ["object", "null"], properties: { text: { type: "string" } }, description: "La meilleure des 3 accroches (ou null)." },
    endCard: { type: ["object", "null"], properties: { text: { type: "string" } } },
    zooms: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" }, scale: { type: "number" } } } },
    music: { type: "string", description: "Nom du fichier de musique choisi (si une liste est donnée)." },
    broll: {
      type: "array", description: "Plans d'illustration (B-roll) posés sur un mot de la phrase.",
      items: {
        type: "object", required: ["id", "word", "query", "mode"],
        properties: {
          id: { type: "string" }, word: { type: "integer", description: "indice du mot où le plan commence" },
          dur: { type: "number", description: "1,5 à 3 s" }, query: { type: "string", description: "ce que le plan montre, en français, 2 à 5 mots" },
          mode: { type: "string", enum: ["full", "pip"] }, file: { type: "string", description: "fichier choisi dans la liste de B-roll d'Antoine, sinon vide" },
        },
      },
    },
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
 * `cands` : phrases candidates [{ id, rush, in, out, text, words }] (toutes les prises de tous les rushes).
 * `marks` : notes dessinées [{ file, t, version, text, phrase?, said? }] (images à lire avec l'outil Read).
 * `tracks` : fichiers du dossier musique quand Claude doit en choisir un.
 */
export async function proposeEdit(cfg, { job, cands, previous, marks = [], captions, tracks = [], broll = null, cwd }) {
  const b = job.brief || {};
  const lines = cands.map((c) => `${c.id} | rush ${c.rushName} | ${fmtTime(c.in)}–${fmtTime(c.out)} s | ${c.words.map((w, i) => `${i}:${w.w}`).join(" ")}`).join("\n");
  const prev = previous
    ? `\nVERSION PRÉCÉDENTE (n°${previous.n}) — phrases gardées dans l'ordre : ${previous.kept.join(", ") || "aucune"}.\nAccroche : ${previous.title || "—"} · Fin : ${previous.endCard || "—"}\n`
    : "";
  const notes = marks.length
    ? `\nNOTES DESSINÉES PAR ANTOINE SUR LA VIDÉO (demandes précises, prioritaires sur tout sauf son retour écrit) :
${marks.map((m, i) => `${i + 1}. À ${fmtTime(m.t)} s de la version ${m.version}${m.phrase ? ` (phrase ${m.phrase}${m.said ? ` « ${m.said.slice(0, 120)} »` : ""})` : ""} : « ${m.text || "voir le dessin"} »${m.file ? `. Image avec son dessin : ${m.file} — lis-la avec l'outil Read avant de répondre.` : ""}`).join("\n")}\n`
    : "";
  const brollTxt = broll
    ? `\nB-ROLL : place 2 à 5 plans d'illustration sur des noms ou idées concrètes (id de la phrase + indice du mot où il commence, dur 1,5 à 3 s, query en français). mode full par défaut ; pip quand le visage ou l'émotion d'Antoine compte à ce moment. Jamais sur l'accroche d'ouverture ni sur deux phrases de suite.\n${broll.length ? `Plans d'Antoine (à préférer s'ils collent, mets le nom exact dans file) : ${broll.join(", ")}` : "Antoine n'a pas de plans à lui : laisse file vide, ils seront cherchés sur Pexels."}\n`
    : "";
  const music = tracks.length ? `\nMUSIQUE : choisis le morceau qui colle au ton (champ music) parmi : ${tracks.join(", ")}\n` : "";
  const prompt = `Tu es monteur vidéo pour les réseaux sociaux (Reels, TikTok, Shorts, LinkedIn). Tu montes à partir de la transcription.

BRIEF
- Format : ${b.format || "9:16"}
- Durée visée : ${b.seconds ? `${b.seconds} s environ` : "la plus courte qui garde le message"}
- Accroche souhaitée : ${b.hook || "à proposer"}
- Appel à l'action : ${b.cta || "à proposer si pertinent"}
- Consignes : ${b.instructions || "—"}
${job.script ? `\nTEXTE PRÉVU (prompteur) — sert à reconnaître les bonnes prises :\n${job.script}\n` : ""}${prev}${job.feedback ? `\nRETOUR D'ANTOINE SUR LA DERNIÈRE VERSION (prioritaire) : ${job.feedback}\n` : ""}${notes}${music}${brollTxt}
PHRASES DISPONIBLES (id | rush | temps | mots numérotés) :
${lines}

RÈGLES
- Pour chaque idée dite plusieurs fois, garde la meilleure prise (souvent la dernière complète, sans hésitation) et coupe les autres (reason « doublon » ou « raté »).
- Coupe les faux départs, phrases inachevées, hors-sujet (reason courte).
- Mots coupés (cuts) : dans les phrases gardées, retire les « euh », « hum », les bégaiements et les mots répétés par erreur (« je je » → retire le premier). Jamais un mot qui porte le sens.
- Garde un ordre logique : accroche forte en premier, puis le développement, puis l'appel à l'action.
- Respecte la durée visée en additionnant (out − in) des phrases gardées.
- N'invente aucun mot : on ne monte que ce qui a été dit.
- Accroches (hooks) : 3 propositions différentes de 3 à 7 mots percutants, affichées en ouverture ; title.text = la meilleure des 3 (null si inutile).
- Carton de fin (endCard.text) : l'appel à l'action en 2 à 6 mots ; null si aucun.
- Zooms : environ une coupe sur deux (le rendu alterne zoom avant et zoom arrière, dans l'ordre), plus les moments forts ; scale 1.06 à 1.15. Indique l'id de la phrase.
- Mots clés (highlights) : au plus 1 ou 2 mots par phrase gardée (chiffre, nom, verbe fort), affichés en couleur.
${captions?.on !== false && captions?.emoji ? "- Emojis : 2 à 4 au total sur des mots concrets (word = indice du mot), jamais deux dans la même phrase.\n" : "- Pas d'emojis (emojis vide).\n"}- order doit contenir TOUTES les phrases (gardées et coupées), une seule fois chacune.
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
