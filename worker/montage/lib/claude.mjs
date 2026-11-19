// Propositions de Claude Code (abonnement du Mac) : choix des phrases, ordre, mots coupés, 3 accroches, fin, zooms,
// mots clés, emojis, musique ; textes de prompteur. Read reste permis : Claude lit les images des notes dessinées.
import { AsyncLocalStorage } from "node:async_hooks";
import { run, log, sleep, fmtDelay } from "./util.mjs";
import { voiceRules } from "./voice.mjs";

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
    stages: {
      type: "array", description: "Temps forts mis en scène : la mise en page change le temps d'une idée.",
      items: {
        type: "object", required: ["id", "word", "kind", "title"],
        properties: {
          id: { type: "string" }, word: { type: "integer", description: "indice du mot où le temps fort commence" },
          dur: { type: "number", description: "2 à 5 s" },
          kind: { type: "string", enum: ["split", "card", "pip"] },
          title: { type: "string", description: "2 à 6 mots, repris de ce qui est dit" },
          body: { type: "string", description: "facultatif : 4 à 12 mots" },
          illustration: { type: "string", description: "nom exact d'une illustration de la liste, sinon vide" },
          anim: { type: "string", enum: ["rise", "slide", "pop", "wipe"] },
        },
      },
    },
    sfx: {
      type: "array", description: "Bruitages posés sur un mot.",
      items: { type: "object", required: ["id", "word", "name"], properties: { id: { type: "string" }, word: { type: "integer" }, name: { type: "string", description: "nom exact d'un bruitage de la liste" } } },
    },
    notes: { type: "string", description: "2-4 phrases en français pour Antoine : ce qui a été gardé, coupé, et pourquoi." },
  },
};

/** Le modèle choisi pour la tâche en cours (job.model, posé par withModel), sinon celui de config.json. */
const modelScope = new AsyncLocalStorage();
const MODEL_OK = /^[a-z][a-z0-9.\-]*(\[1m\])?$/i;
/** Lance `fn` avec le modèle Claude de la tâche (`claude --model`) : tous les appels faits dedans l'utilisent. */
export const withModel = (model, fn) => modelScope.run(typeof model === "string" && MODEL_OK.test(model) && model.length <= 60 ? model : "", fn);
export const modelOf = (cfg) => modelScope.getStore() || cfg.claude.model || "";
const modelArgs = (cfg) => (modelOf(cfg) ? ["--model", modelOf(cfg)] : []);

export async function ask(cfg, prompt, schema, cwd) {
  const args = ["-p", "--output-format", "json", "--disallowedTools", "Bash", "Edit", "Write", "WebFetch", "WebSearch", "NotebookEdit"];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  args.push(...modelArgs(cfg));
  let out;
  try {
    out = await run(cfg.claude.bin, args, { input: prompt, cwd });
  } catch (e) {
    throw badModel(cfg, e.message) || e;
  }
  const j = JSON.parse(out);
  if (j.is_error) throw badModel(cfg, j.result) || new Error(`Claude : ${j.result || "erreur"}`);
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
export async function proposeEdit(cfg, { job, cands, previous, marks = [], captions, tracks = [], broll = null, stage = null, cwd }) {
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
  // Mise en scène : les illustrations et bruitages du style du projet (job.assets), sinon les sons faits par le Mac.
  const tagged = (list) => list.map((x) => `${x.name}${x.tags?.length ? ` (${x.tags.join(", ")})` : ""}`).join(" · ");
  const stageTxt = stage
    ? `\nMISE EN SCÈNE (pour que la vidéo ne ressemble pas à toutes les autres) :
- Temps forts (stages) : environ un toutes les 10 à 15 s (2 à 4 pour 45 s), sur une idée clé, un chiffre, une liste, une comparaison, une promesse. id de la phrase + indice du mot où il commence, dur 2 à 5 s (jamais plus loin que la fin de la phrase suivante).
- kind : split = écran coupé en deux (carte en haut, visage en bas), pour expliquer en gardant le visage ; card = carte plein écran, pour un chiffre ou une phrase choc ; pip = carte plein écran avec le visage dans une pastille, pour une liste ou un exemple. Jamais deux fois le même kind de suite.
- title : 2 à 6 mots qui résument ce qui est dit à ce moment (chiffre, mot clé) ; body facultatif. N'invente aucun fait.
- anim : rise, slide, pop ou wipe, jamais deux fois la même de suite.
- Jamais sur la phrase d'accroche (la première gardée), ni sur un plan de B-roll, ni dans les 2 dernières secondes.
${stage.illustrations.length ? `- Illustrations disponibles (illustration = nom exact, ou vide si aucune ne colle) : ${tagged(stage.illustrations)}\n` : "- Pas d'illustration disponible : laisse illustration vide.\n"}- Bruitages (sfx) : 2 à 5 au total, à l'entrée d'un temps fort (whoosh, swoosh) ou sur un mot fort (pop, ding, impact), jamais deux à moins de 2 s. Noms possibles : ${stage.sfx.length ? tagged(stage.sfx) : stage.builtin.join(", ")}.
`
    : "";
  const music = tracks.length ? `\nMUSIQUE : choisis le morceau qui colle au ton (champ music) parmi : ${tracks.join(", ")}\n` : "";
  // Le profil du projet (ton écrit par Antoine, skills du Mac) : il guide ce que Claude écrit et choisit, pas ce qui a été dit.
  const project = job.voice?.tone || job.voice?.skill
    ? `\nPROFIL DU PROJET — à suivre pour ce que tu écris (accroches, carton de fin, notes) et ce que tu choisis (rythme, mots clés, emojis, musique, B-roll). Le brief, le retour et les notes d'Antoine passent avant ; les RÈGLES plus bas restent valables, et on ne monte toujours que ce qui a été dit :\n${voiceRules(job, "", { examples: false })}\n`
    : "";
  const prompt = `Tu es monteur vidéo pour les réseaux sociaux (Reels, TikTok, Shorts, LinkedIn). Tu montes à partir de la transcription.

BRIEF
- Format : ${b.format || "9:16"}
- Durée visée : ${b.seconds ? `${b.seconds} s environ` : "la plus courte qui garde le message"}
- Accroche souhaitée : ${b.hook || "à proposer"}
- Appel à l'action : ${b.cta || "à proposer si pertinent"}
- Consignes : ${b.instructions || "—"}
${job.script ? `\nTEXTE PRÉVU (prompteur) — sert à reconnaître les bonnes prises :\n${job.script}\n` : ""}${prev}${job.feedback ? `\nRETOUR D'ANTOINE SUR LA DERNIÈRE VERSION (prioritaire) : ${job.feedback}\n` : ""}${notes}${music}${brollTxt}${stageTxt}${project}
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
Structure : une accroche forte (1 phrase), 3 idées concrètes, un appel à l'action. Texte fait pour être dit à voix haute.
Ton et règles du projet :
${voiceRules(job, "- Ton direct, oral, tutoiement.")}
Une phrase courte par ligne (12 mots maximum), sans titres, sans puces, sans emojis, sans didascalies.
N'invente aucun fait (lieu, métier, chiffre, nom, expérience) qui n'est pas dans les consignes : reste sur ce qui est donné.
S'il manque une information indispensable, mets au plus deux trous à compléter, sous la forme [à compléter : …]. Rends uniquement le texte.`;
  return ask(cfg, prompt, null, cwd);
}

const BROLL_SCHEMA = {
  type: "object",
  required: ["shots", "notes"],
  properties: {
    shots: {
      type: "array",
      description: "1 à 3 plans d'illustration dans le passage.",
      items: {
        type: "object", required: ["at", "dur", "query", "mode"],
        properties: {
          at: { type: "number", description: "seconde de la timeline où le plan commence (dans le passage)" },
          dur: { type: "number", description: "1,2 à 4 s" },
          query: { type: "string", description: "ce que le plan montre, en français, 2 à 5 mots concrets (sert à chercher)" },
          mode: { type: "string", enum: ["full", "pip"] },
          file: { type: "string", description: "fichier choisi dans la liste des plans d'Antoine, sinon vide" },
        },
      },
    },
    notes: { type: "string", description: "1 ou 2 phrases en français pour Antoine : ce que montrent les plans et pourquoi." },
  },
};

/**
 * B-roll pour un seul passage de la vidéo montée (« Claude, propose du B-roll ici »).
 * `words` : [{ t, w }] mots dits dans le passage, en secondes de la timeline ; `mine` : fichiers du dossier B-roll.
 */
export async function proposeBroll(cfg, { job, range, words, mine = [], note, cwd }) {
  const [a, b] = range;
  const project = job.voice?.tone || job.voice?.skill ? `\nPROFIL DU PROJET (pour le choix des images) :\n${voiceRules(job, "", { examples: false })}\n` : "";
  const prompt = `Tu es monteur vidéo pour les réseaux sociaux. Dans une vidéo face caméra déjà montée (format ${job.brief?.format || "9:16"}), Antoine a choisi le passage de ${a.toFixed(1)} s à ${b.toFixed(1)} s et veut du B-roll (plans d'illustration posés par-dessus lui, sa voix continue).
${note ? `\nSA DEMANDE (prioritaire) : ${note}\n` : ""}
CE QUI EST DIT DANS LE PASSAGE (seconde de la timeline : mot) :
${words.map((x) => `${x.t.toFixed(2)} ${x.w}`).join("\n") || "(pas de parole : illustre le sujet de la vidéo)"}
${mine.length ? `\nPLANS D'ANTOINE (à préférer s'ils collent, mets le nom exact dans file) : ${mine.join(", ")}\n` : "\nAntoine n'a pas de plans à lui : laisse file vide, ils seront cherchés sur Pexels.\n"}${project}
RÈGLES
- 1 à 3 plans, entièrement dans le passage (at ≥ ${a.toFixed(1)}, at + dur ≤ ${b.toFixed(1)}), sans chevauchement, qui commencent sur le mot qu'ils illustrent.
- query : ce qu'on voit, en mots concrets et filmables (objet, lieu, geste), pas une idée abstraite.
- mode full par défaut ; pip quand le visage ou l'émotion d'Antoine compte à ce moment.
Réponds uniquement avec le JSON demandé.`;
  log("B-roll d'un passage demandé à Claude");
  return ask(cfg, prompt, BROLL_SCHEMA, cwd);
}

// ─── Reel vidéo : appels en flux, outils restreints, délais (worker 0.15.0) ─────────────────────────────────────────

/** Drapeaux lus par `claude --help`, par binaire : { f, until } (une lecture réussie vaut pour tout le processus). */
const flagsCache = new Map();
const FLAGS_RETRY_MS = 5 * 60_000;

/**
 * Ce que le `claude` du Mac sait faire, lu dans `claude --help` : --restricted, --tools, stream-json,
 * --include-partial-messages, --effort… `ok` = le chemin vidéo complet est possible (sinon : écriture par l'ancien
 * appel, sans relecture). `cfg.reel.restricted === false` (écrit par --setup-reel quand le mode restreint échoue à
 * l'authentification) force aussi l'ancien appel. Une lecture réussie est gardée pour tout le processus ; un échec
 * (délai, Claude Code en pleine mise à jour) est retenté une fois tout de suite, puis gardé 5 min seulement.
 */
export async function claudeFlags(cfg, { refresh = false, retryMs = 2000 } = {}) {
  const bin = cfg.claude.bin;
  const hit = flagsCache.get(bin);
  let f = !refresh && hit && hit.until > Date.now() ? hit.f : null;
  if (!f) {
    let help = "", gone = false;
    // Un binaire absent (ENOENT, EACCES) ne se répare pas en 2 s : pas de second essai.
    for (let k = 0; k < 2 && !help && !gone; k++) {
      if (k) await sleep(retryMs);
      try { help = await run(bin, ["--help"], { timeoutMs: 20_000 }); } catch (e) { help = ""; gone = !!binMissing(e); }
    }
    const has = (re) => re.test(help);
    f = {
      found: !!help, gone: !help && gone,
      restricted: has(/--restricted\b/), tools: has(/--tools\b/), stream: has(/stream-json/), partial: has(/--include-partial-messages/),
      effort: has(/--effort\b/), strictMcp: has(/--strict-mcp-config/), noSession: has(/--no-session-persistence/), schema: has(/--json-schema/),
    };
    f.missing = [!f.restricted && "--restricted", !f.tools && "--tools", !f.stream && "stream-json"].filter(Boolean);
    flagsCache.set(bin, { f, until: help ? Infinity : Date.now() + FLAGS_RETRY_MS });
    if (!help) log(gone ? `Claude Code introuvable (claude.bin = ${bin}) : les vidéos échoueront tant que config.json n'est pas corrigé (nouvel essai dans 5 min)` : "claude --help ne répond pas : les vidéos passent par l'ancien appel (nouvel essai dans 5 min)");
  }
  const refused = cfg.reel?.restricted === false;
  // why : pourquoi le chemin complet n'est pas possible ("absent" : --help ne répond pas ; "old" : Claude Code trop
  // ancien ; "restricted-refused" : --setup-reel a vu le mode restreint refusé à la connexion ; "" : tout va bien).
  const why = !f.found ? "absent" : f.missing.length ? "old" : refused ? "restricted-refused" : "";
  return { ...f, ok: f.restricted && f.tools && f.stream && !refused, why };
}

/** Pourquoi la relecture en images est désactivée, en clair pour Antoine (why de claudeFlags). */
export function flagsNote(why) {
  if (why === "restricted-refused") return "Relecture en images désactivée : Claude refuse le mode restreint sur ce Mac. Dans un Terminal, lance « claude » puis /login, puis node montage.mjs --setup-reel.";
  if (why === "absent") return "Relecture en images sautée : Claude Code ne répond pas sur le Mac (nouvel essai à la prochaine vidéo).";
  return "Relecture en images désactivée : mets Claude Code à jour sur le Mac.";
}

const TIMEOUT_TEXT = {
  write: (d) => `Claude n'a pas fini d'écrire la vidéo en ${d} et a été arrêté. Réessaie, ou raccourcis la demande.`,
  review: (d) => `Claude n'a pas fini de relire les images en ${d}.`,
  revise: (d) => `Claude n'a pas fini la retouche en ${d} et a été arrêté. Réessaie avec une demande plus précise.`,
};

/** Le modèle demandé est inconnu de ce Claude Code (ou pas permis par l'abonnement) : une erreur claire, sinon null. */
export function badModel(cfg, text) {
  const m = modelOf(cfg);
  const t = String(text || "");
  if (!m || !/model/i.test(t) || !/not.?found|invalid|unknown|not available|does not exist|not supported|no access|not_found_error|issue with the selected model/i.test(t)) return null;
  return Object.assign(new Error(`Le modèle Claude « ${m} » n'est pas disponible dans le Claude Code du Mac. Choisis-en un autre (Réglages → Modèle Claude des vidéos, ou dans la vidéo), ou mets Claude Code à jour.`), { code: "MODEL" });
}

/** Classe une erreur de Claude : connexion, limite de l'abonnement, erreur passagère (une nouvelle tentative) ou autre. */
function claudeTrouble(text, rate) {
  const t = String(text || "");
  if (/OAuth|authenticat|not logged|log ?in|\/login|invalid api key|401\b/i.test(t)) {
    return { kind: "auth", message: "Claude Code n'est plus connecté sur le Mac. Ouvre un Terminal, lance « claude » puis /login, puis réessaie." };
  }
  if (/rate.?limit|usage limit|limit reached|reached your|quota|429\b|weekly limit|5-hour limit/i.test(t) || rate?.status === "rejected") {
    const at = Number(rate?.resetsAt) > 0 ? new Date(rate.resetsAt * 1000).toLocaleString("fr-CH", { weekday: "long", hour: "2-digit", minute: "2-digit" }) : "";
    return { kind: "limit", message: `Limite de l'abonnement Claude atteinte${at ? ` (remise à zéro ${at})` : ""} : réessaie plus tard.` };
  }
  if (/overloaded|\b529\b|\b50[234]\b|timed? ?out|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(t)) return { kind: "transient", message: `Claude est momentanément indisponible (${t.slice(0, 160)}).` };
  return { kind: "other", message: `Claude : ${t.slice(0, 400) || "erreur inconnue"}` };
}

const err = (message, code, extra = {}) => Object.assign(new Error(message), { code }, extra);

/** Le lancement même de la commande a échoué (binaire absent ou non exécutable) : le code (ENOENT, EACCES), sinon null. */
const binMissing = (e) => (e && /^spawn\b/.test(String(e.syscall || "")) && ["ENOENT", "EACCES"].includes(e.code) ? e.code : null);

/** Le message clair quand Claude Code manque sur le Mac (au lieu de « spawn …/claude ENOENT »). */
export const claudeMissing = (cfg, code = "ENOENT") =>
  err(`Claude Code est introuvable sur le Mac (claude.bin = ${cfg.claude.bin}, ${code}) : corrige « claude.bin » dans config.json, puis lance node montage.mjs --check.`, "CLAUDE_MISSING");

/**
 * Appel de Claude Code pour le reel vidéo, en flux : `claude -p --output-format stream-json --verbose
 * --include-partial-messages --json-schema S --restricted --strict-mcp-config --no-session-persistence --tools T`.
 * Le prompt passe par stdin ; `cwd` = le dossier dédié de l'appel (seules ses entrées s'y trouvent : Read reste confiné).
 * - `tools` : "" (aucun outil) ou "Read" ;
 * - `timeoutMs`, `signal` : arrêt du groupe de processus ; `what` ("write" | "review" | "revise") choisit le message ;
 * - `onDelta(texte, total)` : chaque morceau de la réponse en cours d'écriture (avancement de la phase write) ;
 * - `effort` : --effort (cfg.reel.effort par défaut) ; `stats` : objet rempli avec { ms, chars, cost, degraded, retried }.
 * Renvoie structured_output. Une seule nouvelle tentative, 20 s plus tard, sur une erreur passagère. Erreurs : `code`
 * TIMEOUT, AUTH, LIMIT, BAD_OUTPUT (sortie illisible : l'appelant peut redemander une fois) ou CLAUDE.
 * Si le claude du Mac est trop ancien (claudeFlags().ok faux), passe par l'appel JSON d'origine (avec délai), sans flux.
 */
export async function askStream(cfg, prompt, schema, cwd, { tools = "", timeoutMs = 360_000, signal, onDelta, effort = cfg.reel?.effort, what = "write", stats = {}, retry = true, retryMs = 20_000 } = {}) {
  // Jamais sans délai : 0, NaN ou une valeur illisible (coquille de config.json) reprend 6 min.
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) timeoutMs = 360_000;
  if (typeof effort !== "string" || !/^[a-z]{1,12}$/.test(effort.trim())) effort = "";
  const f = await claudeFlags(cfg);
  const t0 = Date.now();
  if (!f.ok) {
    stats.degraded = true;
    return plainAsk(cfg, prompt, schema, cwd, { timeoutMs, signal, what, stats, t0, tools, f });
  }
  const args = ["-p", "--output-format", "stream-json", "--verbose", ...(f.partial ? ["--include-partial-messages"] : []),
    "--json-schema", JSON.stringify(schema), "--restricted", ...(f.strictMcp ? ["--strict-mcp-config"] : []), ...(f.noSession ? ["--no-session-persistence"] : [])];
  args.push(...modelArgs(cfg));
  if (effort && f.effort) args.push("--effort", effort.trim());
  args.push("--tools", tools);
  let result = null, rate = null, chars = 0;
  const onLine = (line, which) => {
    if (which !== "stdout" || line[0] !== "{") return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    if (j.type === "stream_event" && j.event?.type === "content_block_delta") {
      const d = j.event.delta || {};
      const t = typeof d.partial_json === "string" ? d.partial_json : typeof d.text === "string" ? d.text : "";
      if (t) { chars += t.length; onDelta?.(t, chars); }
    } else if (j.type === "result") result = j;
    else if (j.type === "rate_limit_event") rate = j.rate_limit_info || null;
  };
  let failure = null;
  try {
    await run(cfg.claude.bin, args, { input: prompt, cwd, timeoutMs, signal, onLine, keep: 64 * 1024 });
  } catch (e) {
    if (e.code === "TIMEOUT") throw err((TIMEOUT_TEXT[what] || TIMEOUT_TEXT.write)(fmtDelay(timeoutMs)), "TIMEOUT");
    if (signal?.aborted) throw e;
    if (binMissing(e)) throw claudeMissing(cfg, binMissing(e));
    failure = e;
  }
  stats.ms = Date.now() - t0; stats.chars = chars;
  if (result) { stats.cost = result.total_cost_usd; }
  const trouble = result?.is_error || !result ? claudeTrouble(result?.result || result?.subtype || failure?.stderr || failure?.message, rate) : null;
  if (trouble) {
    const bad = badModel(cfg, result?.result || failure?.stderr || failure?.message);
    if (bad) throw bad;
    if (trouble.kind === "transient" && retry) {
      log(`Claude indisponible (${trouble.message.slice(0, 120)}) : nouvel essai dans ${Math.round(retryMs / 1000)} s`);
      await sleep(retryMs);
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : err("Annulé.", "ABORT");
      stats.retried = true;
      return askStream(cfg, prompt, schema, cwd, { tools, timeoutMs, signal, onDelta, effort, what, stats, retry: false, retryMs });
    }
    if (trouble.kind === "auth") throw err(trouble.message, "AUTH");
    if (trouble.kind === "limit") throw err(trouble.message, "LIMIT");
    if (result && /structured|schema|max_turns/i.test(`${result.subtype} ${result.result}`)) throw err(`réponse hors du format demandé (${String(result.result || result.subtype).slice(0, 160)})`, "BAD_OUTPUT");
    throw err(trouble.message, "CLAUDE");
  }
  log(`Claude (${what}) : ${(stats.ms / 1000).toFixed(0)} s, ${chars} caractères${stats.cost ? `, ${stats.cost.toFixed(2)} $` : ""}`);
  return structured(result);
}

/** La réponse structurée d'un événement result (ou le premier objet JSON de son texte). */
function structured(result) {
  if (result?.structured_output && typeof result.structured_output === "object") return result.structured_output;
  const m = String(result?.result || "").match(/\{[\s\S]*\}/);
  if (!m) throw err("Claude n'a pas renvoyé de JSON.", "BAD_OUTPUT");
  try { return JSON.parse(m[0]); } catch (e) { throw err(`JSON illisible (${e.message.slice(0, 80)})`, "BAD_OUTPUT"); }
}

/**
 * L'appel d'origine (ask) avec un délai et une annulation : pour un claude trop ancien pour le mode restreint, ou
 * quand le mode restreint échoue à l'authentification (reel.restricted = false). Ce que le claude du Mac sait faire
 * sans --restricted est quand même pris : --tools (seuls les outils demandés, Read ou aucun), --strict-mcp-config
 * (aucun serveur MCP de l'utilisateur) et --no-session-persistence ; --disallowedTools reste en plus.
 */
async function plainAsk(cfg, prompt, schema, cwd, { timeoutMs, signal, what, stats, t0, tools = "", f = {} }) {
  const args = ["-p", "--output-format", "json", "--disallowedTools", "Bash", "Edit", "Write", "WebFetch", "WebSearch", "NotebookEdit", "--json-schema", JSON.stringify(schema)];
  if (f.tools) args.push("--tools", tools);
  if (f.strictMcp) args.push("--strict-mcp-config");
  if (f.noSession) args.push("--no-session-persistence");
  args.push(...modelArgs(cfg));
  let out;
  try {
    out = await run(cfg.claude.bin, args, { input: prompt, cwd, timeoutMs, signal });
  } catch (e) {
    if (e.code === "TIMEOUT") throw err((TIMEOUT_TEXT[what] || TIMEOUT_TEXT.write)(fmtDelay(timeoutMs)), "TIMEOUT");
    if (signal?.aborted) throw e;
    if (binMissing(e)) throw claudeMissing(cfg, binMissing(e));
    const bad = badModel(cfg, e.message);
    if (bad) throw bad;
    const t = claudeTrouble(e.message);
    throw err(t.message, t.kind === "auth" ? "AUTH" : t.kind === "limit" ? "LIMIT" : "CLAUDE");
  }
  stats.ms = Date.now() - t0;
  let j;
  try { j = JSON.parse(out); } catch { throw err("Claude n'a pas renvoyé de JSON.", "BAD_OUTPUT"); }
  if (j.is_error) { const bad = badModel(cfg, j.result); if (bad) throw bad; const t = claudeTrouble(j.result); throw err(t.message, t.kind === "auth" ? "AUTH" : t.kind === "limit" ? "LIMIT" : "CLAUDE"); }
  stats.cost = j.total_cost_usd;
  return structured(j);
}
