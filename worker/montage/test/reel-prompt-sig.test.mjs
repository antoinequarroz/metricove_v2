// Le prompt du moteur Signature (engine 2) dans lib/reel/prompt.mjs : la bibliothèque, le tempo et le moment fort dans
// l'écriture, la relecture et la retouche ; des schémas valides dont les listes sont celles de vocab.mjs et les champs
// ceux que cleanScore garde ; et le prompt engine 1 inchangé à l'octet (empreintes sha256 prises avant l'ajout
// d'engine 2 : elles dépendent aussi de prompts/reel-video.md et de la grammaire engine 1 de vocab.mjs ; un changement
// voulu de ces textes met à jour GOLDEN, le message d'échec donne la nouvelle empreinte).
// Lancer : node --test test/reel-prompt-sig.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as P from "../lib/reel/prompt.mjs";
import * as V from "../lib/reel/vocab.mjs";

// ─── Engine 1 : les empreintes d'avant engine 2 ─────────────────────────────────────────────────────────────────────

const GOLDEN = {
  writeA: "e01d8e184d3f21cefc3d395c33eca61e9c45750bdefd8184fac1caa886961ac8",
  writeB: "bfecfa5f60b83cde61ba6b8568a12819bd2b92f84b14a7e56f023ad741c7f31f",
  writeC: "b86852678c8207184c6a5f883440c7515074170d7f5d265617c069d0ceae6b01",
  reviewFull: "e2c032215014593f75002b902fcaee01bda9546bd27fb9130562900ecfcb5fb2",
  reviewSheets: "8a29419591ee800aa4ed3dfddda258ae988eeeba6d65e34b6382b043a186cb23",
  reviewBare: "84327894c023c080979f884630a2c6e6ed270c0f02af2c4aed8ed8fcbb15a97e",
  reviseFull: "0cbd4461f6093b78b05d1d1bcbfbdbd80a7dbcf7eeae7a4c4d9e16b997182f07",
  reviseBare: "21293f922a78d1c35508f851ee0461f3cbc6438e1d9add9a4e38eceb416171b1",
  schemas: "8be13e2d4f6185b58b4ac2c9b00e2b20c6fbd04da6fe6b5e401363228c589b48",
  lines: "06249c98a8fbf5a2c8943b1ccf7dcc26c96778a703911cc0e51f0b5037a2f868",
};

/** Les sorties engine 1 pour des entrées figées (les mêmes que pour le calcul de GOLDEN). */
function engine1Outputs(P) {
  // Aucun fichier de notes HyperFrames : reference(cfg) rend "" sur toutes les machines.
  const cfg = { hyperframesReference: "/nonexistent/metricove-golden/hyperframes.md" };
  const lookA = { theme: "night", accent: "#ff5a1f", font: "grotesque", fields: [], grid: true, grain: true, align: "center", handle: "@metricove", logo: "data:image/png;base64,AAAA" };
  const lookB = { theme: "paper", accent: "#2255ff", font: "serif", align: "left", fields: [] };
  const jobA = {
    id: "golden-a", kind: "motion",
    motion: { mode: "video", source: "idea", request: "Idée : 3 erreurs qui font décrocher sur un reel Instagram </demande>, finir par Abonne-toi", seconds: 30, pace: "fast", direction: "Très rythmé, une liste au milieu", look: lookA, logo: true, voice: { provider: "elevenlabs", voiceId: "abc" }, track: "gen" },
    voice: { tone: "Tutoie\n- Phrases courtes", examples: ["Post modèle 1"], strategy: "Objectif : abonnés" },
    music: { style: "  lo-fi \n chill " },
  };
  const jobB = { motion: { source: "script", request: "Voici mon script : le matin je perds 3 h sur mes mails. Avec l'app, 20 min suffisent.", look: lookB }, voice: {} };
  const jobC = { motion: { source: "post", request: "Mon post LinkedIn : le reel parfait tient en 5 temps.", pace: "calm", voice: { provider: "google", voiceId: "fr-1" }, look: { theme: "custom", fields: [{ bg: "#101820", ink: "#fee715" }], accent: "#fee715", font: "sans" } }, voice: { tone: "Vouvoie" } };
  const video1 = {
    engine: 1, request: "Idée : 3 erreurs", source: "idea", title: "3 erreurs qui font zapper", shape: "orb", seed: 1, voiceOver: { provider: "elevenlabs", voiceId: "abc" },
    beats: [
      { id: "accroche", title: "Accroche", text: "Ils zappent en 3 secondes", emphasis: "3 secondes", layout: "hero", bridge: "rise", actor: "highlight", camera: "push", seconds: 2.4 },
      { id: "erreurs", title: "3 erreurs", text: "3 erreurs qui font fuir", count: true, layout: "number", bridge: "morph", actor: "dot", camera: "drift", seconds: 3.2, say: "Voici trois erreurs" },
      { id: "liste", title: "Les erreurs", text: "Les 3 pièges", items: ["Te présenter", "Tout miser sur le son", "Aucun plan"], layout: "list", bridge: "cut", actor: "rest", camera: "still", seconds: 4.5, cut: true },
      { id: "son", title: "Erreur 2", text: "Erreur 2 : tout miser sur le son", sub: "Écris l’essentiel à l’écran.", emphasis: "le son", layout: "stack", bridge: "carry", actor: "underline", camera: "drift", seconds: 4.2 },
      { id: "abonne", title: "Abonne-toi", text: "Abonne-toi pour la suite", sub: "Abonne-toi", layout: "cta", bridge: "zoom", actor: "bar", camera: "still", seconds: 3.2 },
    ],
    moments: [
      { id: "jauge", brief: "Une jauge qui se vide", from: "erreurs", to: "son", zone: "above", code: { html: "<div class=\"g\"></div>", css: ".g{width:10px}", js: "mt.to(root, { opacity: 1 }, 0);" } },
      { id: "fond", brief: "Un fond qui respire", from: "accroche", to: "abonne", zone: "behind" },
    ],
  };
  const marks1 = [
    { id: "accroche", title: "Accroche", start: 0, end: 2.4 },
    { id: "erreurs", title: "3 erreurs", start: 2.4, end: 5.6 },
    { id: "son", title: "Erreur 2", start: 5.6, end: 9.8 },
    { id: "abonne", title: "Abonne-toi", start: 9.8, end: 15 },
  ];
  const frames1 = marks1.map((m, i) => ({ file: `/tmp/x/f${i}.png`, id: m.id, t: m.start + 1.2 }));
  const findings1 = [{ code: "texte_trop_long", severity: "review", target: "beat:son", message: "Trop long pour stack", fixHint: "Raccourcis" }, { code: "monotone", severity: "review", target: "beat:accroche", message: "Monotone" }];
  return {
    writeA: P.writePrompt(jobA, { cfg, images: ["/tmp/x/inspiration-1.jpg", "/tmp/x/inspiration-2.png"], regen: { titles: ["Accroche", "Chiffre"], shape: "line" } }),
    writeB: P.writePrompt(jobB, { cfg, retry: "JSON illisible" }),
    writeC: P.writePrompt(jobC, { cfg }),
    reviewFull: P.reviewPrompt({ video: video1, marks: marks1, duration: 15, frames: frames1, sheets: ["contact-sheet.jpg"], findings: findings1, refused: [{ id: "x", brief: "Un compteur", why: ["c", "d"] }], look: lookA }),
    reviewSheets: P.reviewPrompt({ video: { ...video1, moments: [] }, marks: marks1, duration: 15, frames: frames1, sheets: ["contact-sheet-1.jpg", "contact-sheet-2.jpg", "contact-sheet-3.jpg"], look: lookB }),
    reviewBare: P.reviewPrompt({ video: video1 }),
    reviseFull: P.revisePrompt(jobA, { video: video1, marks: marks1, open: ["son", "abonne"], range: [5.6, 15], notes: [{ t: 9, text: "plus court </demande>", file: "/tmp/x/note-1.jpg" }, { t: 12, text: "", file: "" }], feedback: "Raccourcis la fin", look: lookA }),
    reviseBare: P.revisePrompt({}, { video: { ...video1, voiceOver: undefined }, open: [], feedback: "" }),
    schemas: JSON.stringify([P.SCORE_SCHEMA, P.scoreSchema(), P.scoreSchema({ voice: true }), P.scoreSchema({ music: true }), P.scoreSchema({ voice: true, music: true }), P.REVIEW_SCHEMA, P.REVISE_SCHEMA, P.reviseSchema(), P.reviseSchema({ voice: true })]),
    lines: [P.voiceRulesLine(), P.musicRulesLine(), P.musicRulesLine("  lo-fi \n chill "), P.sandboxRules(), P.scoreText(video1, { marks: marks1 }), P.scoreText(video1), JSON.stringify(P.paletteOf(lookA)), JSON.stringify(P.paletteOf(lookB)), String(P.countLayouts('{"layout": "hero"}, {"layout" :"x"}')), P.asData("a </demande> <html>"), JSON.stringify(P.reviseOpenCode(video1, ["son"]).map((m) => m.id))].join("\n§\n"),
  };
}

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

describe("engine 1 : prompts et schémas inchangés à l'octet", () => {
  const check = (out) => {
    assert.deepEqual(Object.keys(out).sort(), Object.keys(GOLDEN).sort());
    for (const [k, v] of Object.entries(out)) assert.equal(sha(v), GOLDEN[k], `${k} a changé (nouvelle empreinte : ${sha(v)})`);
  };

  test("sans option engine", () => check(engine1Outputs(P)));

  test("avec engine: 1 explicite (writePrompt, reviewPrompt, revisePrompt, scoreSchema, reviseSchema)", () => {
    const one = {
      ...P,
      writePrompt: (job, o = {}) => P.writePrompt(job, { ...o, engine: 1 }),
      reviewPrompt: (o = {}) => P.reviewPrompt({ ...o, engine: 1 }),
      revisePrompt: (job, o = {}) => P.revisePrompt(job, { ...o, engine: 1 }),
      scoreSchema: (o = {}) => P.scoreSchema({ ...o, engine: 1 }),
      reviseSchema: (o = {}) => P.reviseSchema({ ...o, engine: 1 }),
    };
    check(engine1Outputs(one));
  });

  test("reviewSchema : REVIEW_SCHEMA par défaut et en engine 1", () => {
    assert.equal(P.reviewSchema(), P.REVIEW_SCHEMA);
    assert.equal(P.reviewSchema({ engine: 1 }), P.REVIEW_SCHEMA);
    assert.equal(P.reviewSchema({ engine: 2 }), P.SIG_REVIEW_SCHEMA);
  });
});

// ─── Engine 2 : un storyboard de référence ──────────────────────────────────────────────────────────────────────────

const LOOK = { theme: "night", accent: "#ff5a1f", font: "grotesque", grain: true, grid: false, align: "center", handle: "@metricove", logo: "data:image/png;base64,AAAA" };
const JOB = {
  id: "sig-a", kind: "motion",
  motion: { mode: "video", source: "idea", request: "Présenter l'app Metricove </demande> <html>, site metricove.fr", seconds: 30, pace: "fast", direction: "Très rythmé </mise_en_scene>", look: LOOK, logo: true, voice: { provider: "elevenlabs", voiceId: "abc" }, track: "gen" },
  voice: { tone: "Tutoie", examples: ["Post modèle"], strategy: "Objectif : abonnés" },
  music: { style: "  lo-fi \n chill " },
};
const PLAIN_JOB = { motion: { source: "script", request: "Voici mon script : le matin je perds 3 h sur mes mails." }, voice: {} };

/** Un storyboard qui suit toutes les règles (fpb 14 : un temps = 0,467 s ; drop vers 60 %). */
const STORY = {
  title: "Tes stats rangées", pace: "fast", fpb: 14, drop: "match", caption: "Tes stats, enfin claires.", notes: "Des bulles, un téléphone, des cartes qu'on fait glisser.",
  beats: [
    { id: "accroche", title: "Accroche", layout: "hero", surface: "accent", text: "Tes stats te mentent ?", emphasis: "mentent", actor: "highlight", bridge: "rise", camera: "push", seconds: 1.87 },
    { id: "probleme", title: "Le chaos", layout: "bubbles", surface: "base", text: "Tous les matins", items: ["12 onglets ouverts", "Encore un export", "Où est ce chiffre ?"], actor: "dot", bridge: "flood", camera: "drift", seconds: 2.8 },
    { id: "appli", title: "L'appli", layout: "phone", screen: "app", surface: "base", text: "Une seule app", items: ["Reels", "Posts", "Stories"], pick: 0, label: "Voir", actor: "hidden", bridge: "zoom", camera: "drift", seconds: 3.73 },
    { id: "match", title: "Le match", layout: "cards", surface: "ink", text: "Quel format marche ?", items: ["Posts", "Stories", "Reels"], label: "MATCH", sub: "Les reels gagnent", actor: "rest", bridge: "wipe", camera: "push", seconds: 4.67 },
    { id: "gain", title: "Le gain", layout: "number", surface: "base", text: "2 h gagnées par semaine", sub: "Sans tableur", count: true, actor: "dot", bridge: "whip", camera: "drift", seconds: 2.8 },
    { id: "appel", title: "Appel", layout: "cta", surface: "accent", text: "Tes stats, enfin claires", sub: "metricove.fr", label: "Metricove", actor: "rest", bridge: "flood", camera: "still", seconds: 3.73 },
  ],
};
const VIDEO2 = { engine: 2, request: "Présenter l'app", source: "idea", title: STORY.title, fpb: STORY.fpb, drop: STORY.drop, seed: 1, beats: STORY.beats, moments: [] };
const marksOf = (beats) => { let t = 0; return beats.filter((b) => !b.cut).map((b) => ({ id: b.id, title: b.title, start: t, end: (t += b.seconds) })); };
const MARKS = marksOf(STORY.beats);
const clone = (x) => JSON.parse(JSON.stringify(x));
/** Le storyboard modifié par `edit(beats, video)`. */
const variant = (edit) => { const v = clone(VIDEO2); edit(v.beats, v); return v; };

// ─── Engine 2 : écriture ────────────────────────────────────────────────────────────────────────────────────────────

describe("engine 2 : prompt d'écriture", () => {
  const full = P.writePrompt(JOB, { engine: 2, images: ["/tmp/x/inspiration-1.jpg"], regen: { titles: ["Accroche", "Chiffre"], layouts: ["hero", "number"] } });
  const plain = P.writePrompt(PLAIN_JOB, { engine: 2, retry: "JSON illisible" });

  test("writePrompt({ engine: 2 }) est sigWritePrompt ; engine 1 reste l'ancien prompt", () => {
    assert.equal(full, P.sigWritePrompt(JOB, { images: ["/tmp/x/inspiration-1.jpg"], regen: { titles: ["Accroche", "Chiffre"], layouts: ["hero", "number"] } }));
    assert.equal(P.writePrompt(PLAIN_JOB, { engine: "2" }), P.sigWritePrompt(PLAIN_JOB));
    assert.notEqual(P.writePrompt(PLAIN_JOB, { cfg: { hyperframesReference: "/nonexistent/x.md" } }), P.sigWritePrompt(PLAIN_JOB));
  });

  test("toute la bibliothèque : scènes, transitions, marques, caméras, fonds, écrans", () => {
    for (const k of [...V.SIG_LAYOUTS, ...V.SIG_BRIDGES, ...V.ACTORS, ...V.CAMERAS, ...V.SURFACES, ...V.SCREENS]) assert.ok(full.includes(`\n- ${k} (`), `« ${k} » absent du prompt`);
    for (const k of ["layout", "surface", "screen", "pick", "label", "emphasis", "actor", "bridge", "camera", "seconds", "items", "sub", "count"]) assert.ok(full.includes(k), k);
    assert.ok(full.includes("BIBLIOTHÈQUE SIGNATURE"));
    for (const line of V.sigGrammarLines()) assert.ok(full.includes(line), line);
  });

  test("le tempo (fpb) et le moment fort (drop)", () => {
    assert.match(full, /\bfpb\b/);
    assert.match(full, /\bdrop\b/);
    assert.ok(full.includes(`fpb ${V.FPB.calm} = calme (100 BPM`), "fpb calme");
    assert.ok(full.includes(`${V.FPB.normal} = normal (120 BPM`), "fpb normal");
    assert.ok(full.includes(`${V.FPB.fast} = vif (128,6 BPM`), "fpb vif");
    assert.ok(full.includes(`un autre entier de ${V.FPB_RANGE[0]} à ${V.FPB_RANGE[1]}`));
    assert.ok(full.includes('TEMPO : vif (imposé : pace = "fast") : fpb 14 (128,6 BPM)'));
    assert.ok(plain.includes("TEMPO : choisis pace (calm, normal ou fast) et fpb"));
    assert.ok(full.includes("seconds = nombre de temps × fpb ÷ 30"));
    assert.ok(full.includes("drop : l'id de la scène du moment fort, cards ou number de préférence, vers 45 à 65 % de la durée"));
    assert.ok(full.includes("drop : l'id de la scène du moment fort. Aucun moment, aucun code, aucune forme de marque (shape)"));
  });

  test("les règles du storyboard, des transitions, des marques, des fonds et des textes", () => {
    for (const s of [
      "accroche (hero ou slot)", "problème ou tension (bubbles, phone feed, slot)", "solution (phone app, chat ou notifs, list)", "moment fort (cards ou number)", "preuve ou abondance (wall, list, bubbles)",
      "appel (cta), toujours la dernière scène : label = le nom de la marque, text = la promesse, sub = le texte du bouton",
      "5 à 9 scènes pour 15 à 30 s", "Une scène cards au plus et une scène wall au plus", "au moins une scène phone", "Deux scènes phone de suite partagent le même téléphone",
      "rise, morph et carry seulement entre deux scènes sur le même fond (surface) : sinon le moteur joue wipe", "un mot commun", `cut : ${V.RULES.cutsMax} au plus par vidéo`,
      "zoom plonge dans la marque, l'emphase ou le téléphone de la scène d'avant", "flood grandit depuis la marque highlight ou dot de la scène d'avant, ou depuis la tape du doigt",
      "Un wall n'a pas de marque : un flood qui le suit part du bas de l'écran", "pas de marque (actor et emphasis n'y changent rien)", "jamais depuis un number",
      "emphasis, les mots EXACTS de text", "jamais le même fond plus de 3 scènes de suite", "accent pour le moment fort ou l'accroche", "ink pour un contraste fort",
      "N'invente aucun fait : ni chiffre, ni statistique, ni prix, ni nom", "En français, sauf si la demande dit une autre langue", "Ni emoji ni hashtag à l'écran (le moteur retire les emoji)",
    ]) assert.ok(full.includes(s), s);
  });

  test("les données d'Antoine restent des données ; ni bac à sable, ni moments, ni savoir-faire", () => {
    assert.ok(full.includes("‹/demande> ‹html>"));
    assert.equal(full.split("</demande>").length, 2);
    assert.ok(full.includes("Très rythmé ‹/mise_en_scene>"));
    assert.equal(full.split("</mise_en_scene>").length, 2);
    assert.ok(full.includes("@compte « @metricove »"));
    assert.ok(!full.includes(P.sandboxRules()));
    assert.ok(!/<savoir_faire|<notes_hyperframes|MOMENTS/.test(full));
  });

  test("voix off, musique, version précédente et réponse inexploitable : seulement quand c'est demandé", () => {
    assert.ok(full.includes(P.sigVoiceRulesLine()));
    assert.ok(full.includes(P.sigMusicRulesLine(JOB.music.style)));
    assert.ok(full.includes("« lo-fi chill »"));
    assert.ok(full.includes("VERSION PRÉCÉDENTE : scènes « Accroche » (hero), « Chiffre » (number)"));
    assert.ok(full.includes("inspiration-1.jpg"));
    assert.ok(!plain.includes("VOIX OFF") && !plain.includes("MUSIQUE :") && !plain.includes("VERSION PRÉCÉDENTE"));
    assert.ok(plain.includes("TA RÉPONSE PRÉCÉDENTE ÉTAIT INEXPLOITABLE (JSON illisible)"));
    assert.ok(plain.includes("C'est un script : garde les mots d'Antoine"));
    assert.ok(P.sigMusicRulesLine("</demande>").includes("‹/demande>"));
  });

  test("les quatre fonds du style : les couleurs que le moteur peint (surfacesOf de sig-stage.mjs)", async () => {
    const { surfacesOf } = await import("../lib/reel/sig-stage.mjs");
    const styleOf = (look) => P.writePrompt({ motion: { request: "Une idée", look } }, { engine: 2 }).split("\n").find((l) => l.startsWith("- Les quatre fonds (surface)"));
    const looks = [
      LOOK,
      { theme: "paper", accent: "#2255ff" },
      { theme: "accent", accent: "#ff5a1f" },
      { theme: "gradient", accent: "#7b2ff7" },
      { theme: "custom", accent: "#fee715", fields: [{ bg: "#101820", ink: "#fee715" }, { bg: "#F2F2F2", ink: "#101820" }] },
      { theme: "custom", accent: "#5456fa", fields: [{ bg: "#f7f5ed", ink: "#15161f" }, { bg: "#f3f45b", ink: "#15161f" }, { bg: "#15161f", ink: "#f7f5ed" }] },
      { theme: "night", accent: "#222222" },
    ];
    for (const look of looks) {
      const line = styleOf(look), s = surfacesOf(look).surfaces;
      for (const k of ["accent", "ink", "alt"]) assert.match(line, new RegExp(`\\b${k} = (le négatif, )?${s[k].bg}( \\([^)]*\\))?( en plein écran)? avec le texte ${s[k].ink}\\b`), `${JSON.stringify(look)} : ${k}`);
      assert.ok(line.includes(look.theme === "gradient" ? `base = un dégradé autour de ${look.accent}` : `base = ${s.base.bg} avec le texte ${s.base.ink}`), `${look.theme} : base (${line})`);
    }
    const night = surfacesOf(LOOK).surfaces;
    assert.ok(full.includes(`accent = #ff5a1f en plein écran avec le texte ${night.accent.ink}`));
    assert.ok(full.includes(`alt = ${night.alt.bg} avec le texte ${night.alt.ink} (une teinte profonde de l'accent)`));
    // Thème accent : le fond accent est l'accent éclairci ou assombri (jamais le blanc de la marque d'engine 1).
    assert.match(styleOf(looks[2]), /accent = #[0-9a-f]{6} \(l'accent (éclairci|assombri) pour se détacher du fond\) en plein écran/);
    assert.ok(!styleOf(looks[2]).includes("accent = #ffffff"));
    // Un deuxième champ trop proche de l'accent (#f2f2f2 contre #fee715) est écarté par le moteur : alt est une teinte de l'accent.
    assert.ok(!styleOf(looks[4]).includes("#f2f2f2") && styleOf(looks[4]).includes("(une teinte profonde de l'accent)"));
    const accepted = styleOf({ theme: "custom", accent: "#fee715", fields: [{ bg: "#101820", ink: "#fee715" }, { bg: "#2B59C3", ink: "#FFFFFF" }] });
    assert.ok(accepted.includes("alt = #2b59c3 avec le texte #ffffff (un autre fond du style)"), accepted);
    // LivreMatch : le jaune est trop proche du fond, alt prend le troisième champ, le négatif du premier : la même couleur que ink.
    assert.ok(styleOf(looks[5]).includes("alt = #15161f avec le texte #f7f5ed (un autre fond du style, la même couleur que le fond ink)"));
  });
});

// ─── Engine 2 : schémas ─────────────────────────────────────────────────────────────────────────────────────────────

const KEYWORDS = new Set(["type", "enum", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "maxLength", "pattern", "minimum", "maximum"]);
/** Les défauts de structure d'un schéma (mots-clés connus, objets fermés, required dans properties, bornes sensées). */
function schemaErrors(s, path = "$") {
  const out = [];
  if (!s || typeof s !== "object") return [`${path} : pas un objet`];
  for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) out.push(`${path} : mot-clé inconnu ${k}`);
  if (!["object", "array", "string", "number", "integer", "boolean"].includes(s.type)) out.push(`${path} : type ${s.type}`);
  if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || new Set(s.enum).size !== s.enum.length || s.enum.some((x) => typeof x !== "string"))) out.push(`${path} : enum`);
  if (s.pattern !== undefined) { try { new RegExp(s.pattern); } catch { out.push(`${path} : pattern`); } }
  if (s.maxLength !== undefined && !(Number.isInteger(s.maxLength) && s.maxLength > 0)) out.push(`${path} : maxLength`);
  if (s.minimum !== undefined && s.maximum !== undefined && !(s.minimum <= s.maximum)) out.push(`${path} : bornes`);
  if (s.minItems !== undefined && s.maxItems !== undefined && !(s.minItems <= s.maxItems)) out.push(`${path} : minItems > maxItems`);
  if (s.type === "object") {
    if (s.additionalProperties !== false) out.push(`${path} : objet ouvert`);
    if (!s.properties || typeof s.properties !== "object") out.push(`${path} : sans properties`);
    for (const r of s.required || []) if (!s.properties?.[r]) out.push(`${path} : required ${r} absent de properties`);
    if (new Set(s.required || []).size !== (s.required || []).length) out.push(`${path} : required en double`);
    for (const [k, v] of Object.entries(s.properties || {})) out.push(...schemaErrors(v, `${path}.${k}`));
  }
  if (s.type === "array") {
    if (!s.items) out.push(`${path} : tableau sans items`);
    else out.push(...schemaErrors(s.items, `${path}[]`));
  }
  return out;
}

/** Un petit validateur (le sous-ensemble de JSON Schema des schémas du prompt) : la liste des erreurs. */
function validate(s, v, path = "$") {
  const out = [];
  const type = Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v;
  const ok = s.type === type || (s.type === "number" && type === "integer");
  if (!ok) return [`${path} : ${type} au lieu de ${s.type}`];
  if (s.enum && !s.enum.includes(v)) out.push(`${path} : ${v} hors enum`);
  if (s.type === "string") {
    if (s.maxLength !== undefined && v.length > s.maxLength) out.push(`${path} : trop long`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${path} : pattern`);
  }
  if ((s.type === "number" || s.type === "integer") && ((s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum))) out.push(`${path} : hors bornes`);
  if (s.type === "array") {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path} : trop court`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${path} : trop long`);
    v.forEach((x, i) => out.push(...validate(s.items, x, `${path}[${i}]`)));
  }
  if (s.type === "object") {
    for (const r of s.required || []) if (!(r in v)) out.push(`${path} : ${r} manque`);
    for (const [k, x] of Object.entries(v)) {
      if (!s.properties[k]) { if (s.additionalProperties === false) out.push(`${path} : ${k} en trop`); continue; }
      out.push(...validate(s.properties[k], x, `${path}.${k}`));
    }
  }
  return out;
}

const beatSchema = (schema) => schema.properties.beats.items;
const enumOf = (schema, k) => beatSchema(schema).properties[k].enum;

describe("engine 2 : schémas", () => {
  const all = {
    SIG_SCORE_SCHEMA: P.SIG_SCORE_SCHEMA, voice: P.scoreSchema({ voice: true, engine: 2 }), music: P.scoreSchema({ music: true, engine: 2 }), both: P.scoreSchema({ voice: true, music: true, engine: 2 }),
    SIG_REVIEW_SCHEMA: P.SIG_REVIEW_SCHEMA, SIG_REVISE_SCHEMA: P.SIG_REVISE_SCHEMA, reviseVoice: P.reviseSchema({ voice: true, engine: 2 }),
  };

  test("valides (structure fermée, mots-clés connus, required dans properties)", () => {
    for (const [name, s] of Object.entries(all)) assert.deepEqual(schemaErrors(s), [], name);
  });

  test("les listes sont celles de vocab.mjs", () => {
    for (const s of [P.SIG_SCORE_SCHEMA, P.SIG_REVISE_SCHEMA, P.SIG_REVIEW_SCHEMA]) {
      assert.deepEqual(enumOf(s, "layout"), [...V.SIG_LAYOUTS]);
      assert.deepEqual(enumOf(s, "bridge"), [...V.SIG_BRIDGES]);
      assert.deepEqual(enumOf(s, "actor"), [...V.ACTORS]);
      assert.deepEqual(enumOf(s, "camera"), [...V.CAMERAS]);
      assert.deepEqual(enumOf(s, "surface"), [...V.SURFACES]);
      assert.deepEqual(enumOf(s, "screen"), [...V.SCREENS]);
    }
    assert.deepEqual(P.SIG_SCORE_SCHEMA.properties.pace.enum, [...V.PACES]);
    const fpb = P.SIG_SCORE_SCHEMA.properties.fpb;
    assert.deepEqual([fpb.type, fpb.minimum, fpb.maximum], ["integer", V.FPB_RANGE[0], V.FPB_RANGE[1]]);
    const pick = beatSchema(P.SIG_SCORE_SCHEMA).properties.pick;
    assert.deepEqual([pick.type, pick.minimum, pick.maximum], ["integer", 0, V.FIELDS.items - 1]);
    assert.equal(beatSchema(P.SIG_SCORE_SCHEMA).properties.label.maxLength, V.FIELDS.label);
  });

  test("storyboard : fpb et drop exigés, ni shape ni moments ; dispatch par engine", () => {
    const S = P.SIG_SCORE_SCHEMA;
    for (const k of ["title", "pace", "fpb", "beats", "drop", "caption", "notes"]) assert.ok(S.required.includes(k), k);
    assert.ok(!S.properties.shape && !S.properties.moments);
    assert.deepEqual(beatSchema(S).required, ["id", "title", "layout", "surface", "text", "actor", "bridge", "camera", "seconds"]);
    assert.equal(P.scoreSchema({ engine: 2 }), S);
    assert.equal(P.sigScoreSchema(), S);
    assert.deepEqual(P.scoreSchema({ voice: true, music: true, engine: 2 }), P.sigScoreSchema({ voice: true, music: true }));
    assert.notDeepEqual(P.scoreSchema({ engine: 1 }), S);
  });

  test("voix off et musique : say exigé sur chaque scène, music à la racine, sans toucher au schéma de base", () => {
    const before = JSON.stringify(P.SIG_SCORE_SCHEMA);
    const voice = P.sigScoreSchema({ voice: true }), music = P.sigScoreSchema({ music: true }), both = P.sigScoreSchema({ voice: true, music: true });
    assert.ok(beatSchema(voice).required.includes("say") && beatSchema(voice).properties.say.maxLength === P.SAY_MAX);
    assert.ok(!voice.required.includes("music") && !voice.properties.music);
    assert.ok(music.required.includes("music") && music.properties.music.type === "string");
    assert.ok(!beatSchema(music).required.includes("say"));
    assert.ok(both.required.includes("music") && beatSchema(both).required.includes("say"));
    assert.equal(JSON.stringify(P.SIG_SCORE_SCHEMA), before);
  });

  test("relecture et retouche : les champs d'une scène Signature, drop facultatif", () => {
    const R = P.SIG_REVIEW_SCHEMA;
    assert.deepEqual(Object.keys(beatSchema(R).properties), ["id", ...P.SIG_REVIEW_FIELDS]);
    assert.deepEqual(beatSchema(R).required, ["id"]);
    for (const k of ["surface", "screen", "pick", "label"]) assert.ok(P.SIG_REVIEW_FIELDS.includes(k), k);
    assert.ok(R.properties.drop && !R.required.includes("drop") && !R.properties.moments);
    const X = P.SIG_REVISE_SCHEMA;
    assert.ok(X.properties.drop && !X.required.includes("drop") && !X.properties.moments);
    assert.equal(X.properties.beats.minItems, 1);
    assert.equal(P.reviseSchema({ engine: 2 }), X);
    assert.ok(beatSchema(P.reviseSchema({ voice: true, engine: 2 })).required.includes("say"));
    assert.ok(!beatSchema(X).required.includes("say"));
  });

  test("le storyboard de référence passe le schéma ; une scène inconnue, un fpb hors grille ou un champ en trop non", () => {
    assert.deepEqual(validate(P.SIG_SCORE_SCHEMA, STORY), []);
    assert.deepEqual(validate(P.sigScoreSchema({ voice: true, music: true }), { ...clone(STORY), music: "Upbeat electro, 129 BPM", beats: STORY.beats.map((b) => ({ ...b, say: "Une phrase dite" })) }), []);
    assert.ok(validate(P.SIG_SCORE_SCHEMA, { ...clone(STORY), fpb: 24 }).length);
    assert.ok(validate(P.SIG_SCORE_SCHEMA, variant((b) => { b[0].layout = "grid"; })).length);
    assert.ok(validate(P.SIG_SCORE_SCHEMA, { ...clone(STORY), shape: "orb" }).length);
    const { fpb, ...noFpb } = clone(STORY);
    assert.ok(fpb && validate(P.SIG_SCORE_SCHEMA, noFpb).some((e) => e.includes("fpb manque")));
    assert.deepEqual(validate(P.SIG_REVIEW_SCHEMA, { ok: false, notes: "Accroche raccourcie.", beats: [{ id: "accroche", text: "Tes stats mentent", surface: "ink" }], drop: "match" }), []);
    assert.deepEqual(validate(P.SIG_REVISE_SCHEMA, { notes: "Cartes plus lisibles.", beats: [STORY.beats[3]] }), []);
  });

  test("cleanScore (engine 2) garde chaque champ du schéma, et rien que le schéma ne connaît pas", async () => {
    const { cleanScore } = await import("../lib/reel/score.mjs");
    const c = cleanScore(clone(STORY), { engine: 2, pace: "fast", seed: 1 });
    assert.equal(c.video.engine, 2);
    assert.equal(c.video.fpb, STORY.fpb);
    assert.equal(c.video.drop, STORY.drop);
    const props = beatSchema(P.SIG_SCORE_SCHEMA).properties;
    const seen = new Set();
    for (const raw of STORY.beats) {
      const got = c.video.beats.find((b) => b.id === raw.id);
      assert.ok(got, raw.id);
      for (const k of Object.keys(raw)) if (k !== "seconds") assert.deepEqual(got[k], raw[k], `${raw.id}.${k}`);
      for (const k of Object.keys(got)) { seen.add(k); assert.ok(props[k] || ["cut", "fixed"].includes(k), `${raw.id}.${k} n'est pas dans le schéma`); }
    }
    for (const k of Object.keys(props)) assert.ok(seen.has(k), `${k} : jamais gardé par cleanScore`);
  });
});

// ─── Engine 2 : bibliothèque (vocab.mjs) ────────────────────────────────────────────────────────────────────────────

describe("engine 2 : sigGrammarLines", () => {
  const lines = V.sigGrammarLines();

  test("une ligne par scène avec ses budgets et sa durée plancher en temps", () => {
    assert.ok(lines.every((l) => typeof l === "string" && l.length));
    for (const k of V.SIG_LAYOUTS) {
      const l = lines.find((x) => x.startsWith(`- ${k} (`));
      assert.ok(l, k);
      assert.ok(l.includes(`text ≤ ${V.BUDGETS[k].text}`), `${k} : budget text`);
      if (V.BUDGETS[k].sub) assert.ok(l.includes(`sub ≤ ${V.BUDGETS[k].sub}`), `${k} : budget sub`);
      if (V.BUDGETS[k].item) assert.ok(l.includes(`de ≤ ${V.BUDGETS[k].item}`), `${k} : budget items`);
      if (["phone", "cards", "cta"].includes(k)) assert.ok(l.includes(`label ≤ ${V.FIELDS.label}`), `${k} : label`);
      const [base, per] = V.SIG_MIN_BEATS[k];
      if (per) assert.ok(l.includes(`${V.LIST_ITEMS[1]} items : ${Math.ceil(base + per * V.LIST_ITEMS[1])} temps`), `${k} : plancher`);
      else assert.ok(l.includes(`Durée : ${base} temps au moins.`), `${k} : plancher`);
    }
    assert.ok(lines.some((l) => l.startsWith("- list (") && l.includes("2 items : 5 temps")));
  });

  test("une ligne par transition, marque, caméra, fond et écran", () => {
    for (const k of [...V.SIG_BRIDGES, ...V.ACTORS, ...V.CAMERAS, ...V.SURFACES, ...V.SCREENS]) assert.ok(lines.some((l) => l.startsWith(`- ${k} (`)), k);
    for (const head of ["Transitions (bridge", "Marque (actor", "Caméra (camera)", "Fond (surface", "Écran du téléphone (screen"]) assert.ok(lines.some((l) => l.startsWith(head)), head);
  });

  test("SIG_PACE_FPB : chaque rythme contient sa grille FPB, les trois couvrent FPB_RANGE sans se chevaucher", () => {
    const seen = [];
    for (const p of V.PACES) {
      const [lo, hi] = P.SIG_PACE_FPB[p];
      assert.ok(lo <= V.FPB[p] && V.FPB[p] <= hi, p);
      for (let f = lo; f <= hi; f++) seen.push(f);
    }
    seen.sort((a, b) => a - b);
    assert.deepEqual(seen, Array.from({ length: V.FPB_RANGE[1] - V.FPB_RANGE[0] + 1 }, (_, i) => V.FPB_RANGE[0] + i));
  });
});

// ─── Engine 2 : relecture ───────────────────────────────────────────────────────────────────────────────────────────

describe("engine 2 : contrôles du storyboard (sigChecks)", () => {
  const has = (v, s, o = {}) => { const c = P.sigChecks(v, { marks: marksOf(v.beats), ...o }); assert.ok(c.some((x) => x.includes(s)), `« ${s} » absent de ${JSON.stringify(c)}`); };

  test("le storyboard de référence : rien à signaler", () => {
    assert.deepEqual(P.sigChecks(VIDEO2, { marks: MARKS }), []);
    assert.deepEqual(P.sigChecks(VIDEO2), []);
    assert.deepEqual(P.sigChecks({ beats: [] }), []);
  });

  test("accroche, appel final, moment fort", () => {
    has(variant((b) => { b[0].layout = "stack"; }), "L'accroche [accroche] est une scène stack");
    has(variant((b) => { b[0].text = "Tes stats Instagram te mentent tous les jours ?"; }), "fait 8 mots");
    has(variant((b) => { b[5].layout = "stack"; }), "La dernière scène [appel] n'est pas l'appel (cta)");
    has(variant((b, v) => { delete v.drop; }), "Aucun moment fort (drop)");
    has(variant((b, v) => { v.drop = "appli"; }), "Le moment fort [appli] tombe à 24 % de la durée");
    has(variant((b, v) => { v.drop = "appli"; }), "Le moment fort [appli] est une scène phone");
    has(VIDEO2, "tombe à 10 %", { dropAt: 1.96 });
    assert.deepEqual(P.sigChecks(VIDEO2, { marks: MARKS, dropAt: 11.5 }), []);
  });

  test("scènes et fonds répétés", () => {
    has(variant((b) => { b[4].layout = "cards"; b[4].items = ["A", "B"]; }), "2 scènes cards : une seule par vidéo");
    has(variant((b) => { b[1].layout = "hero"; }), "Deux scènes hero de suite ([accroche], [probleme])");
    has(variant((b) => { b[3].surface = "base"; }), "Même fond « base » 4 scènes de suite (de [probleme] à [gain])");
    const phones = variant((b) => { b[1] = { ...b[2], id: "fil", screen: "feed", items: [] }; });
    assert.ok(!P.sigChecks(phones, { marks: marksOf(phones.beats) }).some((x) => x.includes("Deux scènes phone")));
  });

  test("transitions qui ne peuvent pas se jouer comme écrites", () => {
    has(variant((b) => { b[0].actor = "rest"; }), "flood vers [probleme] : [accroche] n'a ni surligné");
    has(variant((b) => { b[4].text = "2 h gagnées par semaine."; }), "flood vers [appel] : [gain]");
    has(variant((b) => { b[1].actor = "rest"; }), "zoom vers [appli] : [probleme] n'a aucune marque visible");
    has(variant((b) => { b[2].bridge = "carry"; }), "carry vers [appli]");
    // Une tape du doigt dans l'app lance le remplissage ; entre deux téléphones, la transition écrite ne compte pas.
    const tap = variant((b) => { b[3].bridge = "flood"; });
    assert.ok(!P.sigChecks(variant((b) => { b[4] = { ...b[2], id: "app2" }; b[5].bridge = "flood"; }), {}).some((x) => x.includes("flood")));
    assert.ok(!P.sigChecks(tap).some((x) => x.includes("flood vers [match]")));
    // Un fil (feed) ne tape pas : un flood vers une autre scène le signale, pas vers le même téléphone.
    const feedThen = (layout) => variant((b) => { b[1] = { ...b[2], id: "fil", screen: "feed", items: [], label: undefined, pick: undefined }; b[2] = { ...b[2], layout, bridge: "flood" }; });
    assert.ok(P.sigChecks(feedThen("stack")).some((x) => x.includes("flood vers [appli] : [fil]")));
    assert.ok(!P.sigChecks(feedThen("phone")).some((x) => x.includes("flood vers [appli]")));
    // Deux téléphones sur deux fonds : le remplissage se joue en plus du retournement, et un fil ne le lance pas.
    const feedAlt = variant((b) => { b[1] = { ...b[2], id: "fil", screen: "feed", items: [], label: undefined, pick: undefined, surface: "alt" }; b[2] = { ...b[2], bridge: "flood" }; });
    has(feedAlt, "flood vers [appli] : [fil]");
    // Un mur de mots n'a pas de marque (sig-runtime ne lui en fait pas) : un surligné n'y lance pas de remplissage.
    has(variant((b) => { b[4] = { ...b[4], layout: "wall", items: ["Reels", "Posts"], actor: "highlight", emphasis: "gagnées" }; }), "flood vers [appel] : [gain] n'a ni surligné sur une emphase, ni point au bout du texte, ni tape du doigt dans une app (un mur de mots n'a pas de marque)");
    assert.ok(!P.sigChecks(variant((b) => { b[4] = { ...b[4], layout: "stack", actor: "highlight", emphasis: "gagnées" }; })).some((x) => x.includes("flood vers [appel]")));
    // Depuis un chiffre, sig-stage joue toujours morph : le mot ne se porte pas.
    has(variant((b) => { b[5].bridge = "carry"; }), "carry vers [appel] : un mot ne se porte jamais depuis un chiffre");
    assert.ok(!P.sigChecks(variant((b) => { b[4] = { ...b[4], layout: "stack" }; b[5].bridge = "carry"; })).some((x) => x.includes("carry vers")));
  });

  test("une scène coupée ne compte pas", () => {
    const v = variant((b) => { b.splice(1, 0, { ...b[0], id: "coupee", layout: "wall", cut: true }); });
    assert.deepEqual(P.sigChecks(v), []);
  });
});

describe("engine 2 : prompt de relecture", () => {
  const frames = [];
  MARKS.forEach((m, i) => { if (i) frames.push({ id: m.id, t: m.start + 0.1, kind: "bridge" }); frames.push({ id: m.id, t: m.start + 0.8 }); });
  const input = { video: VIDEO2, marks: MARKS, duration: MARKS.at(-1).end, frames, sheets: ["contact-sheet-1.jpg", "contact-sheet-2.jpg"], findings: [], look: LOOK, dropAt: 11.5 };
  const text = P.reviewPrompt({ ...input, engine: 2 });

  test("reviewPrompt({ engine: 2 }) est sigReviewPrompt", () => {
    assert.equal(text, P.sigReviewPrompt(input));
    assert.equal(P.reviewPrompt({ video: VIDEO2, engine: 2 }), P.sigReviewPrompt({ video: VIDEO2 }));
  });

  test("sans constat, la relecture a encore de quoi regarder et répondre « rien à changer »", () => {
    for (const s of ["REGARDE CHAQUE IMAGE, MÊME SANS CONSTAT", "CORRIGE CE QUI NE VA PAS", "CONTRÔLES DU STORYBOARD (calculés par le moteur) :\n- rien à signaler", "CONSTATS AUTOMATIQUES :\n- aucun", "ok: true et beats vide : c'est la bonne réponse", "tu ne peux ni ajouter, ni retirer, ni déplacer une scène", "drop : seulement si le moment fort change", "BIBLIOTHÈQUE (rappel)", "TRANSITIONS, MARQUES ET FONDS (rappel)", "La grille de cette vidéo est fixée : fpb 14"]) assert.ok(text.includes(s), s);
    for (const b of STORY.beats) assert.ok(text.includes(`[${b.id}]`), b.id);
    assert.ok(text.includes("grille fpb 14 (128,6 BPM, un temps = 0,47 s) · moment fort (drop) : [match]"));
    assert.ok(text.includes("[appli] 4,7–8,4 s (8 temps) « L'appli » — phone (écran app), fond base, transition zoom, marque hidden, caméra drift"));
    assert.ok(text.includes("label « Voir » · pick 0 (« Reels »)"));
    assert.ok(!text.includes("moments :") && !text.includes(P.sandboxRules()));
  });

  test("les images posées et le milieu des transitions, dans l'ordre des fichiers", () => {
    assert.ok(text.includes("l'image posée de chaque scène et le milieu de chaque transition"));
    assert.ok(text.includes("frame-00.png = scène « accroche » posée à 0,80 s"));
    assert.ok(text.includes("frame-01.png = milieu de la transition flood vers la scène « probleme » à 1,97 s"));
    assert.ok(text.includes("contact-sheet-1.jpg et contact-sheet-2.jpg"));
    // La transition jouée (stage.mids) peut différer de celle écrite.
    const mids = P.sigReviewPrompt({ ...input, frames: [{ id: "accroche", t: 0.8 }, { id: "probleme", t: 1.9, kind: "wipe" }] });
    assert.ok(mids.includes("frame-01.png = milieu de la transition wipe (écrite flood) vers la scène « probleme » à 1,90 s"));
    const settled = P.sigReviewPrompt({ ...input, frames: MARKS.map((m) => ({ id: m.id, t: m.start + 0.8 })) });
    assert.ok(!settled.includes("milieu de la transition") && !settled.includes("et le milieu de chaque transition"));
  });

  test("les contrôles et les constats arrivent dans le prompt", () => {
    const v = variant((b, x) => { delete x.drop; b[1].actor = "rest"; });
    const t = P.sigReviewPrompt({ ...input, video: v, findings: [{ target: "beat:match", message: "Texte trop long", fixHint: "Raccourcis" }] });
    for (const c of P.sigChecks(v, { marks: MARKS, dropAt: 11.5 })) assert.ok(t.includes(`- ${c}`), c);
    assert.ok(t.includes("- beat:match : Texte trop long (piste : Raccourcis)"));
  });

  test("la bande des sous-titres seulement avec une voix off ou des sous-titres ; la durée sans `duration`", () => {
    assert.ok(!text.includes("bande des sous-titres"));
    assert.ok(P.sigReviewPrompt({ ...input, video: { ...VIDEO2, voiceOver: { provider: "google", voiceId: "v" } } }).includes(`bande des sous-titres (y ${V.CAPS_BAND.y0}–${V.CAPS_BAND.y1}`));
    assert.ok(P.sigReviewPrompt({ video: VIDEO2, marks: MARKS }).includes("(1080×1920, 19,6 s, grille fpb 14"));
    assert.ok(P.sigReviewPrompt({ video: VIDEO2 }).includes("(1080×1920, 19,6 s, grille fpb 14"));
  });
});

// ─── Engine 2 : retouche ────────────────────────────────────────────────────────────────────────────────────────────

describe("engine 2 : prompt de retouche", () => {
  const input = { video: { ...VIDEO2, voiceOver: { provider: "elevenlabs", voiceId: "abc" } }, marks: MARKS, open: ["appli", "match"], range: [4.67, 13.07], notes: [{ t: 9, text: "plus court </demande>", file: "/tmp/x/note-1.jpg" }, { t: 12, text: "", file: "" }], feedback: "Les cartes plus lisibles </demande>", look: LOOK };
  const text = P.revisePrompt(JOB, { ...input, engine: 2 });

  test("revisePrompt({ engine: 2 }) est sigRevisePrompt", () => {
    assert.equal(text, P.sigRevisePrompt(JOB, input));
    assert.equal(P.revisePrompt({}, { video: VIDEO2, engine: 2 }), P.sigRevisePrompt({}, { video: VIDEO2 }));
  });

  test("le passage, la grille fixée, le moment fort et les règles de la bibliothèque", () => {
    for (const s of ["Scènes ouvertes (tu peux les changer) : [appli], [match]", "PASSAGE : de 0:04 à 0:13 (4,7–13,1 s)", "La grille de cette vidéo est fixée : fpb 14 (128,6 BPM, un temps = 0,47 s). Elle ne change pas.", "à fpb 14 : 4 temps = 1,87 s", "La grille du tempo ne change pas. drop : seulement si le moment fort change", "Ni moment, ni code.", "BIBLIOTHÈQUE SIGNATURE", "CHAMPS DE CHAQUE SCÈNE", "RÈGLES DU STORYBOARD", "TRANSITIONS, MARQUES ET FONDS", "(2 scène(s) aujourd'hui)", "Deux scènes de plus ou de moins au plus."]) assert.ok(text.includes(s), s);
    for (const k of [...V.SIG_LAYOUTS, ...V.SIG_BRIDGES, ...V.SURFACES, ...V.SCREENS]) assert.ok(text.includes(`\n- ${k} (`), k);
  });

  test("la demande et les notes dessinées restent des données ; la voix off seulement s'il y en a une", () => {
    assert.ok(text.includes("Les cartes plus lisibles ‹/demande>"));
    assert.equal(text.split("</demande>").length, 2);
    assert.ok(text.includes("1. À 9,0 s : « plus court ‹/demande> » — image avec son dessin : note-1.jpg, lis-la avec l'outil Read."));
    assert.ok(!text.includes("2. À 12,0 s"));
    assert.ok(text.includes(`- ${P.sigVoiceRulesLine()} Garde la phrase dite`));
    const bare = P.sigRevisePrompt({}, { video: VIDEO2 });
    assert.ok(!bare.includes("VOIX OFF") && bare.includes("Scènes ouvertes (tu peux les changer) : aucune") && bare.includes("PASSAGE : toute la vidéo"));
    assert.ok(P.sigRevisePrompt({}, { video: { ...VIDEO2, fpb: undefined } }).includes(`fixée : fpb ${V.FPB.normal}`));
  });
});
