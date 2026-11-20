// Partition du reel vidéo (score.mjs) et page écrite par le moteur (stage.mjs). `node --test test/reel-score.test.mjs`
// cleanScore prend le moteur de la base, sinon celui demandé (options), sinon celui de la partition, sinon ENGINE_NEW (2,
// Signature) : les tests d'engine 1 (Plateau) le demandent explicitement (E1) ; ceux d'engine 2 ont leur section.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyReview, cleanScore, commonWord, emphasisIn, fpbOf, lintScore, mergeRevision, openBeats, sigFloor, timeScore } from "../lib/reel/score.mjs";
import { ACTORS, BEAT_ID, BRIDGES, CAMERAS, ENGINES, FIELDS, LAYOUTS, LIST_ITEMS, MOMENT_ID, SCREENS, SHAPES, SIG_BRIDGES, SIG_LAYOUTS, SURFACES, VIDEO, ZONES, beatSeconds, seedOf } from "../lib/reel/vocab.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/reel/${name}.json`, import.meta.url), "utf8"));
const basic = fixture("score-basic");
const copy = (x) => JSON.parse(JSON.stringify(x));
const total = (video, pace = "normal") => timeScore(video, { pace }).duration;
const onFrame = (s) => Math.abs(s * 30 - Math.round(s * 30)) < 1e-6;
/** Un temps fort minimal (les champs absents prennent les valeurs par défaut). */
const beat = (id, text, extra = {}) => ({ id, title: id, text, ...extra });
/** Le moteur Plateau (engine 1) demandé, comme index.mjs avec la config reel.engine = 1. */
const E1 = Object.freeze({ engine: 1 });
/** cleanScore avec le moteur Signature (engine 2) demandé. */
const sig = (raw, opts = {}) => cleanScore(raw, { engine: 2, ...opts });
/** Engine 2 : une durée est-elle un nombre entier de temps de musique (fpb images à 30 images/s) ? */
const onBeats = (s, fpb) => Math.abs(s - Math.round((s * 30) / fpb) * (fpb / 30)) < 1e-9;

// ─── score-basic : le contrat partagé avec le paquet B ──────────────────────────────────────────────────────────────

test("score-basic : cleanScore rend exactement la vidéo propre, sans correction ni constat", () => {
  // La fixture est une vidéo engine 1 : le moteur est demandé dans les options, comme index.mjs (reel.engine = 1).
  const r = cleanScore(copy(basic.raw), { ...basic.options, ...E1 });
  assert.deepEqual(r, basic.clean);
  assert.equal(r.video.seed, seedOf(basic.job.id));
});

test("score-basic : timeScore donne la durée, les instants posés et les start/end du plan", () => {
  const t = timeScore(basic.clean.video, { pace: basic.clean.pace });
  assert.equal(t.duration, basic.timed.duration);
  assert.deepEqual(t.settle, basic.timed.settle);
  assert.deepEqual(t.video.beats.map((b) => [b.id, b.start, b.end]), basic.plan.video.beats.map((b) => [b.id, b.start, b.end]));
  assert.deepEqual(basic.stage.marks, t.video.beats.map((b) => ({ id: b.id, title: b.title, start: b.start, end: b.end })));
});

test("cleanScore est idempotent (relecture, édition : une vidéo propre ne change pas)", () => {
  const v = basic.clean.video;
  const r = cleanScore(copy(v), { base: v });
  assert.deepEqual(r.video, v);
  assert.deepEqual(r.fixes, []);
  // Le plan stocké (avec start/end, tools) repasse aussi sans correction.
  const p = cleanScore(copy(basic.plan.video), { base: basic.plan.video, pace: basic.plan.pace, target: null });
  assert.deepEqual(p.fixes, []);
  assert.deepEqual(p.video.beats, v.beats);
});

// ─── Entrée hostile ─────────────────────────────────────────────────────────────────────────────────────────────────

test("entrée hostile : sortie bornée, champs connus, ids propres et uniques", () => {
  const evil = {
    title: "</script><img src=x onerror=alert(1)>".repeat(20),
    shape: "triangle",
    pace: "warp",
    caption: "x".repeat(10_000),
    beats: Array.from({ length: 40 }, (_, i) => ({
      id: i % 3 ? "dup" : "</script>",
      title: "<img onerror=x>".repeat(10),
      text: `</script><img src=x onerror=alert(${i})> 🚀 texte ${i} ${"long ".repeat(60)}`,
      sub: { toString: () => "objet" },
      seconds: i % 2 ? NaN : "abc",
      layout: "diagonal", bridge: "teleport", actor: "ghost", camera: "dolly",
      emphasis: "pas là", count: true, items: [1, 2, null, "x".repeat(500)],
    })),
    moments: [
      { id: "</x>", from: "nope", to: "dup", zone: "nowhere", html: "<img>" },
      { id: "ok", from: "dup", to: "dup", zone: "above", html: "<i></i>", css: "", js: "mt.to(root,{x:1},0)" },
      { id: "ok", from: "dup-2", to: "dup-8", zone: "full", html: "<i></i>", css: "", js: "" },
      { id: "big", from: "script", to: "script", zone: "below", html: "x".repeat(200_000) },
      null, "chaîne",
    ],
  };
  // Engine 1 : les moments sont gardés et vérifiés (engine 2 n'en a pas : voir « engine 2 : entrée hostile »).
  const r = cleanScore(evil, { seed: 7, ...E1 });
  const v = r.video;
  assert.equal(v.engine, 1);
  assert.ok(v.beats.length <= VIDEO.beats[1]);
  assert.ok(v.title.length <= FIELDS.title);
  assert.ok((v.caption || "").length <= FIELDS.caption);
  assert.ok(SHAPES.includes(v.shape));
  assert.equal(r.pace, "normal");
  const ids = v.beats.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of v.beats) {
    assert.match(b.id, BEAT_ID);
    assert.ok(b.text.length <= FIELDS.text && b.title.length <= FIELDS.beatTitle);
    assert.ok(!/\p{Extended_Pictographic}/u.test(b.text), "emoji retiré");
    assert.ok(LAYOUTS.includes(b.layout) && BRIDGES.includes(b.bridge) && ACTORS.includes(b.actor) && CAMERAS.includes(b.camera));
    assert.ok(Number.isFinite(b.seconds) && b.seconds >= VIDEO.seconds[0] && b.seconds <= VIDEO.seconds[1]);
    assert.equal(b.emphasis, undefined);
    assert.equal(b.count, undefined);
  }
  assert.ok(v.moments.length <= VIDEO.moments);
  for (const m of v.moments) {
    assert.match(m.id, MOMENT_ID);
    assert.ok(ZONES.includes(m.zone));
    assert.ok(ids.includes(m.from) && ids.includes(m.to));
  }
  assert.equal(new Set(v.moments.map((m) => m.id)).size, v.moments.length);
  assert.ok(!v.moments.some((m) => m.id === "big" && m.code), "code démesuré retiré");
  assert.ok(r.fixes.length > 0 && r.fixes.every((s) => typeof s === "string"));
  assert.ok(JSON.stringify(v).length < 60_000, "taille bornée");
  const t = timeScore(v, { pace: r.pace });
  assert.ok(t.duration >= VIDEO.total[0] && Number.isFinite(t.duration));
});

test("entrée inexploitable : erreur claire en français", () => {
  assert.throws(() => cleanScore(null), /temps fort/);
  assert.throws(() => cleanScore({ beats: [beat("a", "Un"), beat("b", "")] }), /Claude n'a écrit que 1 temps fort/);
  assert.throws(() => cleanScore({ beats: [beat("a", "Un", { cut: true }), beat("b", "Deux", { cut: true }), beat("c", "Trois")] }), /deux temps forts/);
});

// ─── Temps ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test("temps : tout tombe sur une image, le dernier fait au moins 2,5 s, le total entre 15 et 60 s", () => {
  // Une règle des deux moteurs : engine 1 et engine 2 (la grille du tempo tombe aussi sur des images).
  for (const engine of ENGINES) {
    const short = cleanScore({ beats: [beat("a", "Un"), beat("b", "Deux"), beat("c", "Trois", { seconds: 1.5 })] }, { engine });
    assert.equal(short.video.engine, engine);
    const kept = short.video.beats;
    for (const b of kept) assert.ok(onFrame(b.seconds), `engine ${engine} : ${b.id} ${b.seconds}`);
    assert.ok(kept[kept.length - 1].seconds >= VIDEO.last, `engine ${engine}`);
    assert.ok(total(short.video) >= VIDEO.total[0], `engine ${engine} : trop court : ${total(short.video)}`);
    assert.ok(short.fixes.some((s) => /trop courte/.test(s)), `engine ${engine}`);
    const t = timeScore(short.video, {});
    assert.ok(t.settle.every(onFrame), `engine ${engine}`);
    assert.ok(onFrame(t.duration), `engine ${engine}`);
  }
});

test("temps : une vidéo trop longue perd ses sous-textes puis reçoit le constat trop_long", () => {
  // Une règle des deux moteurs (engine 2 : temps de lecture Signature et plancher des scènes).
  const words = "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit";
  for (const engine of ENGINES) {
    const long = cleanScore({ beats: Array.from({ length: 12 }, (_, i) => beat(`b${i}`, `${words} ${i}`, { sub: "un sous-texte assez long pour compter beaucoup de mots ici", seconds: 9 })) }, { engine });
    assert.equal(long.video.engine, engine);
    assert.ok(long.fixes.some((s) => /sous-textes/.test(s)), `engine ${engine}`);
    assert.ok(long.video.beats.every((b) => !b.sub), `engine ${engine}`);
    const d = total(long.video);
    if (d > VIDEO.total[1]) assert.ok(long.findings.some((f) => f.code === "trop_long"), `engine ${engine}`);
    // Au rythme de lecture : chaque temps fort garde le temps de se lire.
    const medium = cleanScore({ beats: Array.from({ length: 10 }, (_, i) => beat(`m${i}`, `Une phrase courte numéro ${i}`, { sub: "Un sous-texte", seconds: 10 })) }, { engine });
    assert.ok(total(medium.video) <= VIDEO.total[1], `engine ${engine}`);
  }
});

test("temps : la cible est tenue à ±15 %, sans passer sous le temps de lecture, les temps forts fixés gardés", () => {
  // Engine 1 (temps de lecture Plateau, à l'image) ; engine 2 : « engine 2 : la cible… » plus bas.
  const raw = { beats: [beat("a", "Une accroche", { seconds: 2 }), beat("b", "Deux idées simples", { seconds: 3 }), beat("c", "Trois", { seconds: 4, fixed: true }), beat("d", "Quatre mots ici là", { seconds: 3 }), beat("e", "Abonne-toi pour la suite", { layout: "cta", seconds: 3 })] };
  for (const target of [15, 30, 45]) {
    const r = cleanScore(copy(raw), { target, ...E1 });
    assert.equal(r.video.engine, 1);
    const d = total(r.video);
    assert.ok(Math.abs(d - target) <= target * 0.15 + 1e-9 || r.fixes.some((s) => /Durée visée/.test(s)), `cible ${target} : ${d}`);
    assert.equal(r.video.target, target);
    const c = r.video.beats.find((b) => b.id === "c");
    assert.equal(c.seconds, 4);
    assert.equal(c.fixed, true);
    for (const b of r.video.beats) assert.ok(b.fixed || b.seconds + 1e-9 >= Math.min(VIDEO.seconds[1], beatSeconds({ ...b, seconds: 0 }, false)), `${b.id} sous la lecture`);
    // Un recalcul sans cible (la page, timeScore) donne les mêmes temps ; un second passage ne bouge plus.
    assert.deepEqual(cleanScore(copy(r.video), { base: r.video, target: null }).video.beats, r.video.beats);
    assert.deepEqual(cleanScore(copy(r.video), { base: r.video }).video.beats, r.video.beats);
  }
});

test("notes pour Antoine : virgule décimale, la vraie raison, une vidéo trop courte allongée à 15 s tout juste", () => {
  // Engine 1 : « 15 s tout juste » (engine 2 tombe sur le temps de musique suivant, voir plus bas).
  const raw = { beats: [beat("a", "Un deux trois", { seconds: 2 }), beat("b", "Quatre cinq", { seconds: 2 }), beat("c", "Abonne-toi", { layout: "cta", seconds: 2 })] };
  const r = cleanScore(copy(raw), { target: 45, ...E1 });
  assert.equal(total(r.video), 15);
  for (const f of r.fixes) assert.ok(!/\d\.\d/.test(f), `point décimal : ${f}`);
  assert.ok(r.fixes.some((f) => /^Durée visée 45 s : \d+(,\d)? s seulement \(plus long, le rythme deviendrait lent : ajoute de la matière à la demande\)\.$/.test(f)), r.fixes.join(" | "));
  assert.ok(r.fixes.some((f) => /^Vidéo trop courte \(\d+(,\d)? s\) : allongée à 15 s\.$/.test(f)), r.fixes.join(" | "));
  assert.ok(!r.fixes.some((f) => /pour garder le temps de lire/.test(f)), "mauvaise raison");
  // Trop long pour la cible à cause du temps de lecture : la raison est la lecture.
  const long = { beats: Array.from({ length: 8 }, (_, i) => beat(`b${i}`, "Une phrase assez longue pour demander du temps de lecture ici", { seconds: 6 })) };
  const l = cleanScore(copy(long), { target: 15, ...E1 });
  // Plus longue que la cible : jamais « seulement » (revue 2), la vidéo « garde » sa durée.
  assert.ok(l.fixes.some((f) => /^Durée visée 15 s : la vidéo garde \d+(,\d)? s \(pour garder le temps de lire tous les textes\)\.$/.test(f)), l.fixes.join(" | "));
  assert.ok(!l.fixes.some((f) => /seulement/.test(f)), l.fixes.join(" | "));
});

test("temps : un temps fort fixé garde sa durée, sauf le dernier qui fait au moins 2,5 s", () => {
  // Engine 1 (engine 2 : au temps de musique le plus proche, voir « engine 2 : un temps fort fixé… »).
  const r = cleanScore({ beats: [beat("a", "Un", { seconds: 1.5, fixed: true }), beat("b", "Deux", { seconds: 6 }), beat("c", "Trois", { seconds: 6 }), beat("d", "Quatre", { seconds: 1.5, fixed: true })] }, E1);
  assert.equal(r.video.engine, 1);
  assert.equal(r.video.beats[0].seconds, 1.5);
  assert.equal(r.video.beats[0].fixed, true);
  assert.ok(r.video.beats[3].seconds >= VIDEO.last);
});

// ─── Liaisons, forme, moments ───────────────────────────────────────────────────────────────────────────────────────

test("liaisons : carry sans mot commun → morph, carry avec mot commun gardé, zoom sans emphase → rise, au plus 2 coupes", () => {
  // Engine 1 (engine 2 garde la plongée sans emphase : voir « engine 2 : liaisons »).
  const r = cleanScore({
    beats: [
      beat("a", "La régularité paie", { bridge: "cut" }),
      beat("b", "Sans rien en commun", { bridge: "carry" }),
      beat("c", "Publier chaque semaine", { bridge: "cut", emphasis: "chaque semaine" }),
      beat("d", "Une semaine suffit", { bridge: "carry" }),
      beat("e", "Plonger dedans", { bridge: "zoom" }),
      beat("f", "Encore", { bridge: "cut" }),
      beat("g", "Encore une", { bridge: "cut" }),
      beat("h", "Et encore", { bridge: "cut" }),
    ],
  }, E1);
  assert.equal(r.video.engine, 1);
  const by = Object.fromEntries(r.video.beats.map((b) => [b.id, b.bridge]));
  assert.equal(by.a, "cut", "la liaison du premier temps fort est ignorée, pas comptée");
  assert.equal(by.b, "morph");
  assert.equal(by.d, "carry");
  assert.equal(commonWord("Publier chaque semaine", "Une semaine suffit"), "semaine");
  assert.equal(by.e, "rise");
  assert.deepEqual([by.c, by.f, by.g, by.h], ["cut", "cut", "morph", "morph"]);
  assert.ok(r.fixes.some((s) => /coupes/.test(s)) && r.fixes.some((s) => /mot commun/.test(s)) && r.fixes.some((s) => /plongée/.test(s)));
  const z = cleanScore({ beats: [beat("a", "Le mot clé", { emphasis: "mot clé" }), beat("b", "Plongée", { bridge: "zoom" }), beat("c", "Fin")] }, E1);
  assert.equal(z.video.beats[1].bridge, "zoom");
});

test("forme : none sans moment sur deux temps forts → orb avec le constat pas_de_continuite ; gardée sinon", () => {
  // Engine 1 : la forme de marque et les moments n'existent que là.
  const raw = { shape: "none", beats: [beat("a", "Un"), beat("b", "Deux"), beat("c", "Trois")] };
  const r = cleanScore(copy(raw), E1);
  assert.equal(r.video.engine, 1);
  assert.equal(r.video.shape, "orb");
  assert.ok(r.findings.some((f) => f.code === "pas_de_continuite"));
  const withMoment = { ...copy(raw), moments: [{ id: "fil", brief: "Un fil", from: "a", to: "b", zone: "behind", html: "<i></i>", css: "", js: "mt.to(root,{x:1},0)" }] };
  assert.equal(cleanScore(withMoment, E1).video.shape, "none");
});

test("forme cachée au plus une fois sur deux", () => {
  // Engine 1 (engine 2 : « hidden » = sans marque, sans limite ; voir « engine 2 : marque cachée… »).
  const r = cleanScore({ beats: ["a", "b", "c", "d"].map((id) => beat(id, `Texte ${id}`, { actor: "hidden" })) }, E1);
  assert.equal(r.video.engine, 1);
  assert.equal(r.video.beats.filter((b) => b.actor === "hidden").length, 2);
});

test("moments : hors de portée retiré, plus de 3 temps forts raccourci (sauf behind), un seul devant par temps fort, full → above si texte long", () => {
  // Engine 1 : engine 2 n'a pas de moments.
  const js = "mt.to(root,{x:1},0)";
  const beats = ["a", "b", "c", "d", "e"].map((id) => beat(id, `Texte ${id}`));
  beats[4].text = "Un texte bien trop long pour tenir dans un surtitre de quarante caractères";
  const r = cleanScore({
    beats,
    moments: [
      { id: "loin", from: "zz", to: "a", zone: "above", js },
      { id: "envers", from: "c", to: "a", zone: "above", js },
      { id: "long", from: "a", to: "e", zone: "below", js },
      { id: "fond", from: "a", to: "e", zone: "behind", js },
      { id: "plein", from: "e", to: "e", zone: "full", js },
    ],
  }, E1);
  assert.equal(r.video.engine, 1);
  const by = Object.fromEntries(r.video.moments.map((m) => [m.id, m]));
  assert.equal(by.loin, undefined);
  assert.equal(by.envers, undefined);
  assert.deepEqual([by.long.from, by.long.to], ["a", "c"]);
  assert.deepEqual([by.fond.from, by.fond.to], ["a", "e"]);
  assert.equal(by.plein.zone, "above");
  const clash = cleanScore({ beats: beats.slice(0, 4), moments: [{ id: "un", from: "a", to: "b", zone: "above", js }, { id: "deux", from: "b", to: "c", zone: "below", js }] }, E1);
  assert.deepEqual(clash.video.moments.map((m) => m.id), ["un"]);
});

// ─── Constats ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("lintScore : texte trop long, accroche trop longue, monotonie, appel absent", () => {
  const v = cleanScore({ beats: [beat("a", "Une accroche beaucoup trop longue pour être lue d'un seul coup d'œil", { layout: "hero" }), beat("b", "Deux", { bridge: "rise" }), beat("c", "Trois", { bridge: "rise" }), beat("d", "Quatre", { bridge: "rise" })] }, E1).video;
  assert.equal(v.engine, 1);
  const codes = lintScore(v).map((f) => f.code);
  for (const c of ["texte_trop_long", "accroche_trop_longue", "monotone", "appel_absent"]) assert.ok(codes.includes(c), c);
  for (const f of lintScore(v)) assert.ok(["review", "note", "block"].includes(f.severity) && /^(engine|beat:|moment:)/.test(f.target));
  assert.deepEqual(lintScore(basic.clean.video), []);
  assert.equal(emphasisIn("Erreur 2 : tout miser sur le son", "LE SON"), true);
  assert.equal(emphasisIn("Erreur 2", "le son"), false);
});

// ─── Retouche ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("openBeats : passage, note dessinée, rien = tout", () => {
  const v = basic.plan.video;
  assert.deepEqual(openBeats(v, { range: [5.6, 8.4] }), ["intro"]);
  assert.deepEqual(openBeats(v, { range: [5, 9] }), ["erreurs", "intro", "son"]);
  assert.deepEqual(openBeats(v, { range: [8.38, 8.5] }), ["son"]);
  assert.deepEqual(openBeats(v, { marks: [{ t: 13 }] }), ["plan"]);
  assert.equal(openBeats(v, {}).length, 6);
});

test("mergeRevision : les temps forts verrouillés gardent leur JSON à l'octet, ±2 temps forts, hors passage ignoré", () => {
  const v = basic.plan.video;
  const open = openBeats(v, { range: [5.6, 8.4] });
  const rev = {
    notes: "x",
    beats: [
      { id: "intro", title: "Erreur 1", text: "Erreur 1 : parler de toi", layout: "hero", bridge: "rise", actor: "underline", camera: "drift", seconds: 2.8 },
      { id: "bonus", title: "Bonus", text: "Un bonus en plus", layout: "stack", bridge: "morph", actor: "rest", camera: "still", seconds: 2 },
      { id: "bonus2", title: "Bonus 2", text: "Encore un", seconds: 2 },
      { id: "bonus3", title: "Bonus 3", text: "Un de trop", seconds: 2 },
      { id: "son", title: "Piratage", text: "Changé hors du passage" },
    ],
    moments: [{ id: "egaliseur", action: "drop" }, { id: "neuf", action: "new", from: "bonus", to: "bonus", zone: "above", html: "<i></i>", css: "", js: "mt.to(root,{x:1},0)" }],
  };
  const m = mergeRevision(v, copy(rev), open);
  assert.equal(m.changed, true);
  const before = new Map(v.beats.map((b) => [b.id, JSON.stringify(b)]));
  for (const b of m.video.beats) if (!open.includes(b.id) && before.has(b.id)) assert.equal(JSON.stringify(b), before.get(b.id), b.id);
  assert.deepEqual(m.video.beats.map((b) => b.id), ["accroche", "erreurs", "intro", "bonus", "bonus2", "son", "plan", "abonne"]);
  assert.ok(m.ignored.some((s) => /hors du passage/.test(s)) && m.ignored.some((s) => /en trop/.test(s)));
  assert.deepEqual(m.video.moments.map((x) => x.id), ["egaliseur", "neuf"], "le moment hors passage reste, le nouveau entre");
  assert.deepEqual([...m.fresh], ["neuf"]);
  // Puis cleanScore (base, sans remise à l'échelle) : les verrouillés ne changent toujours pas (hors start/end).
  const c = cleanScore(m.video, { base: v, target: null });
  const strip = (b) => { const o = { ...b }; delete o.start; delete o.end; return JSON.stringify(o); };
  const locked = new Map(v.beats.filter((b) => !open.includes(b.id)).map((b) => [b.id, strip(b)]));
  for (const b of c.video.beats) if (locked.has(b.id)) assert.equal(JSON.stringify(b), locked.get(b.id), b.id);
  // Une retouche vide ne change rien.
  assert.equal(mergeRevision(v, { notes: "rien" }, open).changed, false);
});

test("applyReview : champs connus seulement, ids inconnus ignorés, moment remplacé = frais", () => {
  const v = basic.clean.video;
  const r = applyReview(v, { ok: false, notes: "", beats: [{ id: "intro", text: "Erreur 1 : te présenter trop tôt", seconds: 3, title: "pirate" }, { id: "zzz", text: "x" }], moments: [{ id: "egaliseur", action: "replace", js: "mt.to(root,{x:2},0)" }, { id: "inconnu", action: "drop" }] });
  const intro = r.video.beats.find((b) => b.id === "intro");
  assert.equal(intro.text, "Erreur 1 : te présenter trop tôt");
  assert.equal(intro.title, "Erreur 1");
  assert.equal(intro.seconds, 3);
  assert.deepEqual([...r.fresh], ["egaliseur"]);
  assert.equal(r.video.moments[0].code.js, "mt.to(root,{x:2},0)");
  assert.equal(r.video.moments[0].code.html, v.moments[0].code.html);
  assert.equal(r.video.beats.length, v.beats.length);
});

// ─── Engine 2 (Signature) : la bibliothèque de scènes calées sur le tempo ───────────────────────────────────────────
// Valeurs attendues calculées à la main : grille FPB (calm 18, normal 15, fast 14 images par temps), plancher des
// scènes SIG_MIN_BEATS en temps ([base, par item], arrondi au temps suivant), lecture SIG_READ (0,8 s + 0,2 par mot
// du texte + 0,15 par mot du sous-texte + 0,12 par mot des items lus + 0,25 par item lu, × 0,88 en vif).

/**
 * Engine 2 : vérifie la vidéo telle que timeScore la rend et la renvoie. Chaque scène gardée dure un nombre entier de
 * temps de musique, la durée écrite (seconds) est celle rendue, une scène non fixée dure au moins son plancher, la
 * dernière au moins 2,5 s, le tout entre 15 et 60 s.
 */
function sigTimed(r, msg = "") {
  const fpb = r.video.fpb;
  assert.equal(fpbOf(r.video), fpb, `${msg} : fpb ${fpb}`);
  const t = timeScore(r.video, { pace: r.pace });
  const kept = t.video.beats.filter((b) => !b.cut);
  for (const b of kept) {
    const d = b.end - b.start;
    assert.ok(onBeats(d, fpb), `${msg} : ${b.id} dure ${d} s, pas un nombre entier de temps de ${fpb} images`);
    assert.ok(Math.abs(d - b.seconds) < 1e-9, `${msg} : ${b.id} écrit ${b.seconds} s, rendu ${d} s`);
    if (!b.fixed) assert.ok(d >= sigFloor(b, fpb) - 1e-9, `${msg} : ${b.id} dure ${d} s, sous son plancher ${sigFloor(b, fpb)} s`);
  }
  const last = kept[kept.length - 1];
  assert.ok(last.end - last.start >= VIDEO.last - 1e-9, `${msg} : la dernière scène dure ${last.end - last.start} s`);
  assert.ok(t.duration >= VIDEO.total[0] - 1e-9 && t.duration <= VIDEO.total[1] + 1e-9, `${msg} : ${t.duration} s`);
  assert.ok(t.settle.every(onFrame), msg);
  return t;
}

/** Les onze scènes de la bibliothèque (hero deux fois) : un chiffre et le mot « les » dans chaque texte, `n` items. */
const LIBRARY = ["hero", "stack", "number", "list", "slot", "phone", "cards", "bubbles", "wall", "hero", "cta"];
const libraryBeats = (n, extra = () => ({})) => LIBRARY.map((layout, i) => beat(`s${i + 1}`, `Les 3 temps de la scène ${i + 1}`, { layout, items: ["Un essai", "Deux essais", "Trois essais", "Quatre essais"].slice(0, n), ...extra(i) }));

test("engine 2 : les dix scènes et les dix transitions passent telles quelles, chaque scène à son plancher ou à sa lecture", () => {
  // Chaque transition une fois à partir de la deuxième scène (celle de la première est ignorée), un seul fond, deux
  // items partout, un mot commun pour carry, une seule coupe : aucune règle ne corrige rien.
  const bridges = ["rise", "rise", "morph", "carry", "zoom", "cut", "flood", "wipe", "whip", "push", "flip"];
  assert.deepEqual([...new Set(LIBRARY)].sort(), [...SIG_LAYOUTS].sort());
  assert.deepEqual(bridges.slice(1).sort(), [...SIG_BRIDGES].sort());
  const r = sig({ beats: libraryBeats(2, (i) => ({ bridge: bridges[i] })) });
  assert.equal(r.video.engine, 2);
  assert.deepEqual(r.fixes, []);
  assert.deepEqual(r.video.beats.map((b) => b.layout), LIBRARY);
  assert.deepEqual(r.video.beats.map((b) => b.bridge), bridges);
  assert.ok(r.video.beats.every((b) => b.surface === "base"));
  // Les items restent sur la liste et les scènes qui s'en servent ; un téléphone avec items montre l'app.
  for (const b of r.video.beats) assert.equal(Array.isArray(b.items), ["list", "slot", "phone", "cards", "bubbles", "wall"].includes(b.layout), b.id);
  assert.equal(r.video.beats[5].screen, "app");
  // Rythme normal, 15 images par temps (0,5 s). Lecture : 0,8 + 0,2 × 7 mots = 2,2 s ; plus 0,12 × 4 mots + 0,25 × 2
  // items = 3,18 s pour list, phone et bubbles (tous les items lus) ; 2,44 s pour slot et cards (le dernier seul) ;
  // 2,2 s pour wall (aucun). Plancher : hero et stack 4 temps (2 s), number 6 (3 s), list et slot ⌈2,5 + 2⌉ = 5 (2,5 s),
  // phone ⌈3,5 + 2⌉ = 6 (3 s), cards ⌈5,5 + 2⌉ = 8 (4 s), bubbles ⌈3 + 1⌉ = 4 (2 s), wall et cta 6 (3 s). Le plus long
  // des deux, au temps suivant.
  assert.deepEqual(r.video.beats.map((b) => b.seconds), [2.5, 2.5, 3, 3.5, 2.5, 3.5, 4, 3.5, 3, 2.5, 3]);
  assert.equal(sigTimed(r, "bibliothèque").duration, 33.5);
});

test("engine 2 : une scène ou une transition inconnue prend la valeur par défaut avec une note ; celles d'engine 2 sont inconnues d'engine 1", () => {
  const r = sig({ beats: [beat("a", "Un début", { layout: "grille" }), beat("b", "La suite", { bridge: "teleport" }), beat("c", "Abonne-toi", { layout: "cta", bridge: "fondu" })] });
  assert.deepEqual(r.video.beats.map((b) => [b.layout, b.bridge]), [["stack", "morph"], ["stack", "morph"], ["cta", "morph"]]);
  for (const note of ["Temps fort « a » : mise en page « grille » inconnue, stack à la place.", "Temps fort « b » : liaison « teleport » inconnue, morph à la place.", "Temps fort « c » : liaison « fondu » inconnue, morph à la place."]) assert.ok(r.fixes.includes(note), `${note} absente de : ${r.fixes.join(" | ")}`);
  const e1 = cleanScore({ beats: [beat("a", "Un début", { layout: "phone" }), beat("b", "La suite", { bridge: "wipe" }), beat("c", "Abonne-toi", { layout: "cta", bridge: "flip" })] }, E1);
  assert.deepEqual(e1.video.beats.map((b) => [b.layout, b.bridge]), [["stack", "morph"], ["stack", "morph"], ["cta", "morph"]]);
  for (const note of ["Temps fort « a » : mise en page « phone » inconnue, stack à la place.", "Temps fort « b » : liaison « wipe » inconnue, morph à la place.", "Temps fort « c » : liaison « flip » inconnue, morph à la place."]) assert.ok(e1.fixes.includes(note), `${note} absente de : ${e1.fixes.join(" | ")}`);
});

test("engine 2 : fond (base par défaut), écran du téléphone, choix tapé et libellé, chacun là où la scène s'en sert", () => {
  const r = sig({
    beats: [
      beat("accroche", "Tes stats mentent", { layout: "hero", surface: "accent", label: "Ignoré", screen: "app", pick: 0 }),
      beat("fond", "Un fond inconnu", { surface: "néon" }),
      beat("fil", "Le fil défile", { layout: "phone" }),
      beat("tele", "Un écran inconnu", { layout: "phone", screen: "tv" }),
      beat("appli", "Une seule app", { layout: "phone", items: ["Reels", "Posts", "Stories"], pick: 1, label: "  Voir  " }),
      beat("chat", "Une conversation", { layout: "phone", screen: "chat", items: ["Salut", "Coucou"], pick: 0 }),
      beat("hors", "Un choix hors liste", { layout: "phone", screen: "app", items: ["Un", "Deux"], pick: 2 }),
      beat("texte", "Un choix écrit en texte", { layout: "phone", items: ["Un", "Deux"], pick: "1" }),
      beat("demi", "Un choix à virgule", { layout: "phone", items: ["Un", "Deux"], pick: 0.5 }),
      beat("match", "Quel format gagne ?", { layout: "cards", items: ["Posts", "Reels"], label: "MATCH", screen: "app" }),
      beat("fin", "Abonne-toi", { layout: "cta", surface: "ink", label: "Essaie gratuitement dès aujourd'hui" }),
    ],
  });
  const col = (k) => r.video.beats.map((b) => (k in b ? b[k] : "-"));
  // Le fond écrit s'il existe, sinon base.
  assert.deepEqual(col("surface"), ["accent", "base", "base", "base", "base", "base", "base", "base", "base", "base", "ink"]);
  // L'écran : téléphone seulement ; sans écran connu, app s'il a des items, feed sinon.
  assert.deepEqual(col("screen"), ["-", "-", "feed", "feed", "app", "chat", "app", "app", "app", "-", "-"]);
  // Le choix tapé : téléphone sur l'app avec items, un index entier de la liste (« 1 » écrit en texte compte).
  assert.deepEqual(col("pick"), ["-", "-", "-", "-", 1, "-", "-", 1, "-", "-", "-"]);
  // Le libellé : téléphone, cartes et appel seulement, espaces retirés, 24 caractères au plus (« Essaie gratuitement
  // dès » + espace, puis l'espace du bout retiré).
  assert.deepEqual(col("label"), ["-", "-", "-", "-", "Voir", "-", "-", "-", "-", "MATCH", "Essaie gratuitement dès"]);
  assert.ok(r.video.beats.every((b) => !b.label || b.label.length <= FIELDS.label));
  // Un téléphone sans items n'en a pas.
  assert.deepEqual(col("items").slice(2, 5), ["-", "-", ["Reels", "Posts", "Stories"]]);
});

test("engine 2 : une scène sans ses items prend une autre mise en page (slot et wall → hero, cards et bubbles → stack), un chiffre sans nombre → hero, avec une note", () => {
  const r = sig({
    beats: [
      beat("slot", "Trop de", { layout: "slot", items: ["réunions"] }),
      beat("cartes", "Quel format ?", { layout: "cards", label: "MATCH" }),
      beat("bulles", "Ils disent", { layout: "bubbles", items: ["Top", "", "   ", null] }),
      beat("mur", "Tout gratuit", { layout: "wall", items: [] }),
      beat("liste", "Une liste", { layout: "list", items: ["Seul"] }),
      beat("chiffre", "Beaucoup de temps gagné", { layout: "number", count: true }),
      beat("vrai", "2 h gagnées", { layout: "number", count: true }),
      beat("fin", "Abonne-toi", { layout: "cta" }),
    ],
  });
  assert.deepEqual(r.video.beats.map((b) => b.layout), ["hero", "stack", "stack", "hero", "stack", "hero", "number", "cta"]);
  // Les items et le libellé partent avec la scène qui s'en servait ; le compteur reste au seul vrai chiffre.
  assert.ok(r.video.beats.every((b) => !("items" in b) && !("label" in b)));
  assert.deepEqual(r.video.beats.map((b) => b.count === true), [false, false, false, false, false, false, true, false]);
  const need = (id) => `Temps fort « ${id} » : cette scène a besoin de 2 éléments au moins, une autre mise en page à la place.`;
  for (const note of [need("slot"), need("cartes"), need("bulles"), need("mur"), "Temps fort « liste » : une liste a besoin de 2 éléments au moins, mise en page pile à la place.", "Temps fort « chiffre » : aucun nombre dans le texte, mise en page héros à la place."]) assert.ok(r.fixes.includes(note), `${note} absente de : ${r.fixes.join(" | ")}`);
  assert.ok(!r.fixes.some((f) => f.includes("« vrai »")), r.fixes.join(" | "));
});

test("engine 2 : liaisons — un changement de fond passe montée, métamorphose et mot porté en volet ; plongée sans emphase gardée ; mot commun et coupes vérifiés", () => {
  const r = sig({
    beats: [
      beat("a", "Le mot juste", { surface: "accent" }),
      beat("b", "Un autre mot", { bridge: "rise" }), // accent → base : volet
      beat("c", "Le mot porté", { bridge: "carry" }), // « mot » en commun, même fond : gardé
      beat("d", "Sans lien", { bridge: "carry" }), // aucun mot commun : métamorphose (même fond)
      beat("e", "Plongée", { bridge: "zoom" }), // sans emphase avant : gardée en engine 2
      beat("f", "Fond encre", { bridge: "morph", surface: "ink" }), // base → ink : volet
      beat("g", "Toujours rien", { bridge: "carry", surface: "alt" }), // pas de mot commun → morph, puis ink → alt : volet
      beat("h", "Choc", { bridge: "cut", surface: "alt" }),
      beat("i", "Choc encore", { bridge: "cut", surface: "alt" }),
      beat("j", "Troisième choc", { bridge: "cut" }), // 3e coupe → morph, puis alt → base : volet
      beat("k", "Abonne-toi", { layout: "cta", bridge: "whip", surface: "accent" }), // une transition franche passe d'un fond à l'autre
    ],
  });
  assert.deepEqual(r.video.beats.map((b) => b.bridge), ["morph", "wipe", "carry", "morph", "zoom", "wipe", "wipe", "cut", "cut", "wipe", "whip"]);
  for (const note of ["Temps fort « d » : aucun mot commun avec le précédent à porter, métamorphose à la place.", "Temps fort « g » : aucun mot commun avec le précédent à porter, métamorphose à la place.", "Temps fort « j » : plus de 2 coupes sèches, métamorphose à la place."]) assert.ok(r.fixes.includes(note), `${note} absente de : ${r.fixes.join(" | ")}`);
  assert.ok(!r.fixes.some((f) => /plongée/.test(f)), r.fixes.join(" | "));
  // Le fond comparé est celui de la scène gardée d'avant : une scène coupée entre les deux ne compte pas.
  const s = sig({ beats: [beat("x", "Premier fond", { surface: "accent" }), beat("y", "Coupée au montage", { cut: true }), beat("z", "Retour au même fond", { bridge: "rise", surface: "accent" }), beat("w", "Abonne-toi", { layout: "cta", surface: "accent" })] });
  assert.deepEqual(s.video.beats.map((b) => b.bridge), ["morph", "morph", "rise", "morph"]);
});

test("engine 2 : marque cachée sans limite (« sans marque »), aucun moment ; la même partition en engine 1 limite la forme cachée et garde le moment", () => {
  const raw = { beats: ["a", "b", "c", "d"].map((id) => beat(id, `Texte ${id}`, { actor: "hidden" })), moments: [{ id: "fil", brief: "Un fil", from: "a", to: "c", zone: "behind", html: "<i></i>", css: "", js: "mt.to(root,{x:1},0)" }] };
  const r = sig(copy(raw));
  assert.deepEqual(r.video.beats.map((b) => b.actor), ["hidden", "hidden", "hidden", "hidden"]);
  assert.ok(!r.fixes.some((f) => /cachée/.test(f)), r.fixes.join(" | "));
  assert.deepEqual(r.video.moments, []);
  const e1 = cleanScore(copy(raw), E1);
  assert.deepEqual(e1.video.beats.map((b) => b.actor), ["hidden", "hidden", "rest", "rest"]);
  assert.deepEqual(e1.video.moments.map((m) => [m.id, m.from, m.to, m.zone]), [["fil", "a", "c", "behind"]]);
});

test("engine 2 : fpb — une grille entière de 12 à 20 images est gardée, sinon celle du rythme ; l'appelant, puis la base, puis Claude", () => {
  const raw = (extra = {}) => ({ beats: [beat("a", "Un"), beat("b", "Deux"), beat("c", "Trois", { layout: "cta" })], ...extra });
  for (const [fpb, want] of [[12, 12], [16, 16], [20, 20], ["17", 17]]) assert.equal(sig(raw({ fpb })).video.fpb, want, `fpb ${fpb}`);
  for (const bad of [11, 21, 24, 16.5, "abc", "", null, true, undefined]) assert.equal(sig(raw({ fpb: bad })).video.fpb, 15, `fpb ${bad}`);
  // Hors grille : celle du rythme (calme 18, normal 15, vif 14), imposé ou écrit par Claude.
  assert.equal(sig(raw({ fpb: 24 }), { pace: "calm" }).video.fpb, 18);
  assert.equal(sig(raw({ fpb: 30, pace: "fast" })).video.fpb, 14);
  assert.equal(sig(raw({ pace: "calm" })).video.fpb, 18);
  // L'appelant impose la sienne ; sinon celle de la base (relecture, retouche, édition) ; sinon celle de Claude.
  assert.equal(sig(raw({ fpb: 18 }), { fpb: 12 }).video.fpb, 12);
  const base = sig(raw({ fpb: 16 })).video;
  assert.equal(sig({ ...copy(base), fpb: 18 }, { base }).video.fpb, 16);
  assert.equal(sig({ ...copy(base), fpb: 18 }, { base, fpb: 13 }).video.fpb, 13);
  assert.equal(sig({ ...copy(base), fpb: 18 }, { base, fpb: 99 }).video.fpb, 16);
  // Engine 1 : pas de grille.
  const e1 = cleanScore(raw({ fpb: 16 }), E1).video;
  assert.ok(!("fpb" in e1));
  // fpbOf : engine 2 et une grille entière de FPB_RANGE, sinon 0 (engine 1 : à l'image).
  assert.equal(fpbOf(e1), 0);
  assert.equal(fpbOf({ engine: 2, fpb: 16 }), 16);
  assert.equal(fpbOf({ engine: "2", fpb: 12 }), 12);
  assert.equal(fpbOf({ engine: 2, fpb: 21 }), 0);
  assert.equal(fpbOf({ engine: 2, fpb: "16" }), 0);
  assert.equal(fpbOf({ engine: 1, fpb: 16 }), 0);
  assert.equal(fpbOf({ engine: 2 }), 0);
  assert.equal(fpbOf(null), 0);
});

test("engine 2 : sigFloor, le plancher d'une scène en temps de musique, arrondi au temps suivant", () => {
  assert.equal(sigFloor({ layout: "hero" }, 15), 2); // 4 temps de 15 images
  assert.equal(sigFloor({ layout: "stack", items: ["a", "b"] }, 15), 2); // 4 temps, les items ne comptent pas
  assert.equal(sigFloor({ layout: "number" }, 15), 3); // 6 temps
  assert.equal(sigFloor({ layout: "cta" }, 14), 2.8); // 6 × 14 = 84 images
  assert.equal(sigFloor({ layout: "list", items: ["a", "b"] }, 14), 70 / 30); // ⌈2,5 + 2⌉ = 5 temps = 70 images
  assert.equal(sigFloor({ layout: "slot", items: ["a", "b", "c", "d"] }, 12), 2.8); // ⌈2,5 + 4⌉ = 7 temps = 84 images
  assert.equal(sigFloor({ layout: "phone" }, 20), 80 / 30); // ⌈3,5⌉ = 4 temps = 80 images
  assert.equal(sigFloor({ layout: "phone", items: ["a"] }, 15), 2.5); // ⌈3,5 + 1⌉ = 5 temps
  assert.equal(sigFloor({ layout: "cards", items: ["a", "b", "c"] }, 15), 4.5); // ⌈5,5 + 3⌉ = 9 temps
  assert.equal(sigFloor({ layout: "bubbles", items: ["a", "b", "c"] }, 18), 3); // ⌈3 + 1,5⌉ = 5 temps = 90 images
  assert.equal(sigFloor({ layout: "wall", items: ["a", "b", "c", "d"] }, 16), 3.2); // 6 temps = 96 images
  assert.equal(sigFloor({ layout: "inconnue" }, 15), 2); // comme stack
});

test("engine 2 : durées calculées à la main (plancher, lecture, grille du rythme, vidéo trop courte allongée au temps suivant)", () => {
  const raw = () => ({
    beats: [
      beat("a", "Tes stats mentent", { layout: "hero", seconds: 1.87 }),
      beat("b", "Trois raisons", { layout: "list", items: ["Plus clair", "Plus rapide", "Moins cher"], seconds: 2 }),
      beat("c", "Quel format gagne ?", { layout: "cards", items: ["Posts", "Reels"], seconds: 3.1 }),
      beat("d", "Abonne-toi", { layout: "cta" }),
    ],
  });
  // Normal (15 images, 0,5 s par temps). a : plancher hero 4 temps = 2 s (> 1,87 s et > lecture 1,4 s). b : plancher
  // ⌈2,5 + 3⌉ = 6 temps = 3 s (> lecture 0,8 + 0,4 + 0,72 + 0,75 = 2,67 s). c : plancher ⌈5,5 + 2⌉ = 8 temps = 4 s.
  // d : plancher 6 temps = 3 s. Total 12 s < 15 s : la dernière scène prend 2 s (4 temps), puis un temps à la fois
  // aux scènes hors accroche, les plus chargées d'abord : c (plancher 4 s) puis b (3 s). Jamais une fin figée.
  const n = sig(raw());
  assert.equal(n.video.fpb, 15);
  assert.deepEqual(n.video.beats.map((b) => b.seconds), [2, 3.5, 4.5, 5]);
  assert.deepEqual(n.fixes, ["Vidéo trop courte (12 s) : allongée à 15 s."]);
  const t = timeScore(n.video, { pace: n.pace });
  assert.deepEqual(t.video.beats.map((b) => [b.start, b.end]), [[0, 2], [2, 5.5], [5.5, 10], [10, 15]]);
  assert.deepEqual(t.settle, [1.2, 3.2, 6.7, 11.2]);
  assert.equal(t.duration, 15);
  // Vif (14 images) : a 1,87 s → 56 images = 4 temps tout juste, son plancher (4 × 14 = 56 images), b 6 temps = 84,
  // c 8 temps = 112, d 6 temps = 84 : 336 images = 11,2 s. La dernière reçoit 2 s arrondies au temps suivant (5 temps
  // = 70 images : 154), puis c, b, d, c un temps chacun : 462 images = 15,4 s et non 15 s (450 images ne font pas un
  // nombre entier de temps de 14 images).
  const f = sig(raw(), { pace: "fast" });
  assert.equal(f.video.fpb, 14);
  assert.deepEqual(f.video.beats.map((b) => Math.round(b.seconds * 30)), [56, 98, 140, 168]);
  assert.deepEqual(f.fixes, ["Vidéo trop courte (11,2 s) : allongée à 15,4 s."]);
  assert.equal(timeScore(f.video, { pace: f.pace }).duration, 15.4);
  sigTimed(n, "normal");
  sigTimed(f, "vif");
});

test("engine 2 : sur toutes les grilles, chaque scène dure un nombre entier de temps et au moins son plancher ; la dernière au moins 2,5 s, sur la grille", () => {
  for (const [opts, fpb] of [[{ pace: "calm" }, 18], [{ pace: "normal" }, 15], [{ pace: "fast" }, 14], [{ fpb: 12 }, 12], [{ fpb: 13 }, 13], [{ pace: "fast", fpb: 19 }, 19], [{ fpb: 20 }, 20]]) {
    const r = sig({ beats: libraryBeats(3, (i) => ({ seconds: [1.6, 2.2, 3.1, 0, 4.4][i % 5] })) }, opts);
    assert.equal(r.video.fpb, fpb);
    sigTimed(r, JSON.stringify(opts));
  }
  // Une dernière scène fixée à 1,5 s : 2,5 s au moins, au temps qui suit (75 images = 5 temps de 15 ; 6 temps de 14 =
  // 84 images ; 5 temps de 18 = 90 images).
  for (const [pace, frames] of [["normal", 75], ["fast", 84], ["calm", 90]]) {
    const r = sig({ beats: [beat("a", "Un"), beat("b", "Deux"), beat("c", "Fin", { seconds: 1.5, fixed: true })] }, { pace });
    assert.equal(Math.round(r.video.beats[2].seconds * 30), frames, pace);
    sigTimed(r, pace);
  }
});

test("engine 2 : au plus 60 s, même avec douze scènes longues, et la boucle de la grille retire un temps quand l'arrondi dépasse", () => {
  for (const [pace, fpb] of [["calm", 18], ["normal", 15], ["fast", 14]]) {
    const r = sig({ beats: Array.from({ length: 12 }, (_, i) => beat(`b${i + 1}`, `Une phrase assez longue numéro ${i + 1} pour lire`, { layout: i === 11 ? "cta" : "stack", sub: "Un sous-texte de six mots ici", seconds: 10 })) }, { pace });
    assert.equal(r.video.fpb, fpb);
    const t = sigTimed(r, pace);
    assert.ok(t.duration <= VIDEO.total[1], `${pace} : ${t.duration} s`);
    assert.ok(r.fixes.some((f) => /^Vidéo trop longue \(\d+(,\d)? s\) : ramenée à \d+(,\d)? s au rythme de lecture\.$/.test(f)), r.fixes.join(" | "));
    assert.ok(!r.findings.some((f) => f.code === "trop_long"), pace);
  }
  // Une musique à 17 images par temps (105,9 BPM) : 60 s ne tombent pas sur la grille (1800 = 105 × 17 + 15). Dix
  // scènes de 5,1 s (9 temps = 153 images) et deux de 4,5 s (8 temps = 136 images) : 106 temps = 1802 images. La
  // réduction au prorata ôte moins d'une demi-image par passe à chaque scène, plus une image à partir de la deuxième
  // passe : 7 images en 8 passes, moins qu'un temps, et la grille remonte chaque scène au même temps. Reste la boucle
  // de la grille : un temps de moins à la scène qui a le plus de marge (la première, à égalité) → 105 temps = 59,5 s.
  const beats = [...Array.from({ length: 10 }, (_, i) => beat(`s${i + 1}`, `Idée numéro ${i + 1}`, { seconds: 5.1 })), beat("s11", "Idée numéro 11", { seconds: 4.5 }), beat("fin", "Abonne-toi", { layout: "cta", seconds: 4.5 })];
  const r = sig({ beats }, { fpb: 17 });
  assert.equal(r.video.fpb, 17);
  assert.deepEqual(r.video.beats.map((b) => Math.round(b.seconds * 30)), [136, 153, 153, 153, 153, 153, 153, 153, 153, 153, 136, 136]);
  assert.equal(sigTimed(r, "fpb 17").duration, 59.5);
  assert.ok(!r.findings.some((f) => f.code === "trop_long"));
});

test("engine 2 : un temps fort fixé va au temps le plus proche, même sous le plancher de sa scène ; le dernier fait au moins 2,5 s", () => {
  const raw = () => ({
    beats: [
      beat("a", "Un", { layout: "hero", seconds: 1.6, fixed: true }),
      beat("b", "Deux", { seconds: 1.8, fixed: true }),
      beat("c", "Trois", { seconds: 6 }),
      beat("d", "Quatre", { seconds: 6 }),
      beat("e", "Fin", { layout: "hero", seconds: 1.5, fixed: true }),
    ],
  });
  // Normal (15 images) : a 48 images = 3,2 temps → 3 temps = 1,5 s, sous le plancher hero de 2 s (la main l'emporte) ;
  // b 54 images = 3,6 temps → 4 temps = 2 s ; e, la dernière : 2,5 s = 75 images = 5 temps.
  const n = sig(raw());
  assert.deepEqual(n.video.beats.map((b) => b.seconds), [1.5, 2, 6, 6, 2.5]);
  assert.deepEqual(n.video.beats.map((b) => b.fixed === true), [true, true, false, false, true]);
  // Vif (14 images) : a 48 images → 3 temps = 42 images, sous 1,5 s → 4 temps = 56 ; b 54 → 4 temps = 56 ; c et d
  // 180 images → 13 temps = 182 ; e 75 images → 5 temps = 70, sous 2,5 s → 6 temps = 84.
  const f = sig(raw(), { pace: "fast" });
  assert.deepEqual(f.video.beats.map((b) => Math.round(b.seconds * 30)), [56, 56, 182, 182, 84]);
  sigTimed(n, "normal");
  sigTimed(f, "vif");
});

test("engine 2 : la cible est tenue à ±15 % ou expliquée, sur la grille, le fixé gardé ; un second passage ne bouge plus", () => {
  const raw = { beats: [beat("a", "Une accroche", { layout: "hero", seconds: 2 }), beat("b", "Deux idées simples", { seconds: 3 }), beat("c", "Trois", { seconds: 4, fixed: true }), beat("d", "Quatre mots ici là", { seconds: 3 }), beat("e", "Abonne-toi pour la suite", { layout: "cta", seconds: 3 })] };
  // 2 + 3 + 4 + 3 + 3 = 15 s sur la grille de 15 images. Cible 15 : rien ne bouge. Cible 30 ou 45 : étirement plafonné
  // à × 1,35 (a 2,7 s → 6 temps = 3 s ; b, d et e 4,05 s → 9 temps = 4,5 s ; c fixé, 4 s = 8 temps) : 20,5 s.
  const want = { 15: [2, 3, 4, 3, 3], 30: [3, 4.5, 4, 4.5, 4.5], 45: [3, 4.5, 4, 4.5, 4.5] };
  for (const target of [15, 30, 45]) {
    const r = sig(copy(raw), { target });
    assert.equal(r.video.target, target);
    assert.deepEqual(r.video.beats.map((b) => b.seconds), want[target], `cible ${target}`);
    assert.equal(r.video.beats[2].fixed, true);
    const t = sigTimed(r, `cible ${target}`);
    if (target === 15) assert.deepEqual(r.fixes, []);
    else assert.ok(r.fixes.includes(`Durée visée ${target} s : 20,5 s seulement (plus long, le rythme deviendrait lent : ajoute de la matière à la demande).`), r.fixes.join(" | "));
    assert.ok(Math.abs(t.duration - target) <= target * 0.15 + 1e-9 || r.fixes.some((s) => /Durée visée/.test(s)), `cible ${target} : ${t.duration}`);
    // Un recalcul sans cible (la page) et un second passage avec la même cible rendent les mêmes temps.
    assert.deepEqual(sig(copy(r.video), { base: r.video, target: null }).video.beats, r.video.beats);
    assert.deepEqual(sig(copy(r.video), { base: r.video }).video.beats, r.video.beats);
  }
  // À la baisse (× 0,85 au plus), jamais sous le plancher d'une scène : 2 + 5 + 4 + 4 + 3 = 18 s pour une cible de 15 s.
  // Les cartes (4 items : ⌈5,5 + 4⌉ = 10 temps = 5 s) restent à 5 s au lieu de 4,25 s ; les piles, 4 × 0,85 = 3,4 s →
  // 7 temps = 3,5 s ; l'appel reste à son plancher de 3 s : 17 s, à ±15 % de 15 s, sans note.
  const down = sig({ beats: [beat("a", "Trop de stats", { layout: "hero", seconds: 2 }), beat("b", "Quel format gagne ?", { layout: "cards", items: ["Posts", "Reels", "Stories", "Lives"], seconds: 5 }), beat("c", "Deux idées simples", { seconds: 4 }), beat("d", "Trois mots ici", { seconds: 4 }), beat("e", "Abonne-toi", { layout: "cta", seconds: 3 })] }, { target: 15 });
  assert.deepEqual(down.video.beats.map((b) => b.seconds), [2, 5, 3.5, 3.5, 3]);
  assert.deepEqual(down.fixes, []);
  assert.equal(sigTimed(down, "cible 15 à la baisse").duration, 17);
});

test("engine 2 : le moment fort (drop) est gardé s'il nomme une scène gardée, même après la remise au propre des ids ; hérité de la base", () => {
  const beats = () => [
    beat("accroche", "Tes stats mentent", { layout: "hero" }),
    beat("match", "Quel format gagne ?", { layout: "cards", items: ["Posts", "Reels"], label: "MATCH" }),
    beat("coupe", "Une scène coupée", { cut: true }),
    beat("fin", "Abonne-toi", { layout: "cta" }),
  ];
  assert.equal(sig({ beats: beats(), drop: "match" }).video.drop, "match");
  for (const drop of ["coupe", "inconnu", "", 3, null, undefined]) assert.ok(!("drop" in sig({ beats: beats(), drop }).video), `drop ${drop}`);
  // Un id remis au propre (« Le Match » → le-match) : le moment fort suit sa scène.
  const m = sig({ drop: "Le Match", beats: [beat("accroche", "Un début"), { id: "Le Match", title: "Le match", text: "Quel format ?" }, beat("fin", "Abonne-toi", { layout: "cta" })] });
  assert.deepEqual(m.video.beats.map((b) => b.id), ["accroche", "le-match", "fin"]);
  assert.equal(m.video.drop, "le-match");
  // Des doublons : « Accroche » devient accroche, puis « accroche » devient accroche-2. Le moment fort « accroche » de
  // Claude est la scène qu'il a écrite avec cet id : la seconde.
  const d = sig({ drop: "accroche", beats: [{ id: "Accroche", title: "Un", text: "Un début" }, { id: "accroche", title: "Deux", text: "La suite" }, beat("fin", "Abonne-toi", { layout: "cta" })] });
  assert.deepEqual(d.video.beats.map((b) => b.id), ["accroche", "accroche-2", "fin"]);
  assert.equal(d.video.drop, "accroche-2");
  // Relecture, retouche, édition : celui de la base si Claude n'en écrit pas, ou en écrit un qui n'existe pas.
  const base = sig({ beats: beats(), drop: "match" }).video;
  const rev = copy(base);
  delete rev.drop;
  assert.equal(sig(rev, { base }).video.drop, "match");
  assert.equal(sig({ ...copy(base), drop: "zzz" }, { base }).video.drop, "match");
  assert.equal(sig({ ...copy(base), drop: "accroche" }, { base }).video.drop, "accroche");
  // La scène du moment fort coupée : plus de moment fort.
  rev.beats.find((b) => b.id === "match").cut = true;
  assert.ok(!("drop" in sig(rev, { base }).video));
  // Engine 1 : jamais de moment fort.
  assert.ok(!("drop" in cleanScore({ beats: beats(), drop: "match" }, E1).video));
});

test("engine 2 : le moteur vient de la base, sinon des options, sinon de la partition, sinon engine 2 ; une base engine 1 garde les règles d'engine 1", () => {
  const raw = (extra = {}) => ({ beats: [beat("a", "Un début", { layout: "phone", surface: "accent" }), beat("b", "La suite", { bridge: "zoom" }), beat("c", "Abonne-toi", { layout: "cta" })], ...extra });
  assert.equal(cleanScore(raw()).video.engine, 2);
  assert.equal(cleanScore(raw({ engine: 1 })).video.engine, 1);
  assert.equal(cleanScore(raw(), { engine: 1 }).video.engine, 1);
  assert.equal(cleanScore(raw(), { engine: "1" }).video.engine, 1);
  assert.equal(cleanScore(raw({ engine: 1 }), { engine: 2 }).video.engine, 2);
  assert.equal(cleanScore(raw({ engine: 2 }), { engine: 1 }).video.engine, 1);
  assert.equal(cleanScore(raw({ engine: 1 }), { engine: 3 }).video.engine, 1);
  assert.equal(cleanScore(raw({ engine: 9 })).video.engine, 2);
  // Une base engine 2 l'emporte sur les options et la partition : rien ne change.
  const base2 = sig(raw()).video;
  const again = cleanScore({ ...copy(base2), engine: 1 }, { base: base2, engine: 1 });
  assert.equal(again.video.engine, 2);
  assert.equal(again.video.fpb, 15);
  assert.deepEqual(again.video.beats, base2.beats);
  assert.deepEqual(again.fixes, []);
  assert.deepEqual([base2.beats[0].layout, base2.beats[0].surface, base2.beats[1].bridge], ["phone", "accent", "zoom"]);
  // Une base engine 1 (retouche d'une ancienne vidéo) : engine 1 même si la partition et les options disent 2.
  const base1 = cleanScore({ beats: [beat("a", "Le mot clé", { emphasis: "mot clé" }), beat("b", "Deux"), beat("c", "Trois"), beat("d", "Abonne-toi", { layout: "cta" })] }, E1).video;
  const r = cleanScore({
    ...copy(base1), engine: 2, fpb: 16, drop: "b",
    beats: [
      beat("a", "Le mot clé", { emphasis: "mot clé", actor: "hidden", surface: "accent" }),
      beat("b", "Une seule app", { layout: "phone", screen: "app", items: ["Un", "Deux"], pick: 1, label: "Voir", bridge: "wipe", actor: "hidden" }),
      beat("c", "Trois", { bridge: "zoom", actor: "hidden" }),
      beat("d", "Abonne-toi", { layout: "cta", label: "Metricove", actor: "hidden" }),
    ],
    moments: [{ id: "fil", brief: "Un fil", from: "a", to: "b", zone: "above", html: "<i></i>", css: "", js: "mt.to(root,{x:1},0)" }],
  }, { base: base1, engine: 2 });
  const v = r.video;
  assert.equal(v.engine, 1);
  // phone et wipe inconnus, plongée sans emphase → montée, forme cachée une fois sur deux au plus.
  assert.deepEqual(v.beats.map((b) => [b.layout, b.bridge, b.actor]), [["stack", "morph", "hidden"], ["stack", "morph", "hidden"], ["stack", "rise", "rest"], ["cta", "morph", "rest"]]);
  for (const note of ["Temps fort « b » : mise en page « phone » inconnue, stack à la place.", "Temps fort « b » : liaison « wipe » inconnue, morph à la place.", "Temps fort « c » : la plongée a besoin d'une emphase sur le temps fort d'avant, montée à la place.", "Temps fort « c » : forme cachée trop souvent, repos à la place."]) assert.ok(r.fixes.includes(note), `${note} absente de : ${r.fixes.join(" | ")}`);
  for (const k of ["surface", "screen", "pick", "label", "items"]) assert.ok(v.beats.every((b) => !(k in b)), k);
  assert.ok(!("fpb" in v) && !("drop" in v));
  assert.deepEqual(v.moments.map((m) => m.id), ["fil"]);
});

test("engine 2 : les storyboards Signature des fixtures passent sans correction, sur la grille, et une vidéo propre ne change plus", () => {
  for (const name of ["signature-couverture", "signature-livrematch"]) {
    const f = fixture(name);
    const r = cleanScore(copy(f.raw), f.options);
    assert.equal(r.video.engine, 2, name);
    assert.equal(r.video.fpb, 15, name);
    assert.deepEqual(r.fixes, [], name);
    assert.deepEqual(r.video.moments, [], name);
    assert.deepEqual(r.video.beats.map((b) => [b.id, b.layout, b.bridge, b.surface, b.screen, b.pick, b.label]), f.raw.beats.map((b) => [b.id, b.layout, b.bridge, b.surface, b.screen, b.pick, b.label]), name);
    const t = sigTimed(r, name);
    // Relecture ou édition (base = la vidéo) : rien ne bouge ; le plan stocké (avec start/end) non plus.
    const again = cleanScore(copy(r.video), { base: r.video });
    assert.deepEqual(again.video, r.video, name);
    assert.deepEqual(again.fixes, [], name);
    const stored = cleanScore(copy(t.video), { base: r.video, pace: r.pace, target: null });
    assert.deepEqual(stored.fixes, [], name);
    assert.deepEqual(stored.video.beats, r.video.beats, name);
  }
});

test("engine 2 : lintScore compte les durées sur la grille et connaît les budgets des nouvelles scènes", () => {
  // Douze scènes de 5 s : 60 s tout juste à l'image (engine 1) ; sur une grille de 17 images, 150 images montent à
  // 9 temps = 153 images (5,1 s) : 1836 images = 61,2 s.
  const beats = Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, title: `Scène ${i + 1}`, text: `Idée ${i + 1}`, layout: i === 11 ? "cta" : i % 2 ? "stack" : "hero", bridge: ["rise", "morph", "cut", "push"][i % 4], actor: "rest", camera: "drift", surface: "base", seconds: 5 }));
  const v2 = { engine: 2, fpb: 17, title: "Douze scènes", shape: "orb", beats, moments: [] };
  const v1 = { ...v2, engine: 1 };
  assert.equal(timeScore(v1).duration, 60);
  assert.equal(timeScore(v2).duration, 61.2);
  assert.ok(!lintScore(v1).some((f) => f.code === "trop_long"));
  assert.deepEqual(lintScore(v2).filter((f) => f.code === "trop_long").map((f) => [f.target, f.message]), [["engine", "La vidéo dure 61,2 s (60 s au plus)."]]);
  // Budgets : slot, un item de 22 caractères au plus (34 ici).
  const slot = { engine: 2, fpb: 15, beats: [{ id: "slot", title: "Slot", text: "Fini les", layout: "slot", items: ["tableurs", "exports interminables chaque lundi"], bridge: "rise", actor: "rest", camera: "drift", surface: "base", seconds: 2.5 }, { id: "fin", title: "Fin", text: "Abonne-toi", layout: "cta", bridge: "rise", actor: "rest", camera: "drift", surface: "base", seconds: 3 }], moments: [] };
  const long = lintScore(slot).filter((f) => f.code === "texte_trop_long");
  assert.deepEqual(long.map((f) => f.target), ["beat:slot"]);
  assert.match(long[0].message, /\(élément de liste > 22\)/);
});

test("engine 2 : relecture et retouche changent fond, écran, choix, libellé et moment fort ; engine 1 les ignore", () => {
  const v = sig({
    drop: "match",
    beats: [
      beat("accroche", "Tes stats mentent", { layout: "hero" }),
      beat("appli", "Une seule app", { layout: "phone", items: ["Reels", "Posts"], pick: 0, label: "Voir" }),
      beat("match", "Quel format gagne ?", { layout: "cards", items: ["Posts", "Reels"], label: "MATCH" }),
      beat("fin", "Abonne-toi", { layout: "cta" }),
    ],
  }).video;
  assert.deepEqual([v.beats[1].screen, v.beats[1].pick, v.beats[1].label, v.drop], ["app", 0, "Voir", "match"]);
  const r = applyReview(v, { ok: false, notes: "", beats: [{ id: "appli", surface: "ink", screen: "chat", pick: 1, label: "" }], drop: "accroche" });
  const appli = r.video.beats.find((b) => b.id === "appli");
  assert.deepEqual([appli.surface, appli.screen, appli.pick, "label" in appli], ["ink", "chat", 1, false]);
  assert.equal(r.video.drop, "accroche");
  assert.equal(applyReview(v, { beats: [], drop: "zzz" }).video.drop, "match");
  // Puis cleanScore (base) : un écran de messages n'a pas de choix tapé ; le nouveau fond passe par un volet.
  const c = cleanScore(r.video, { base: v });
  const ca = c.video.beats.find((b) => b.id === "appli");
  assert.deepEqual([ca.surface, ca.screen, "pick" in ca, ca.bridge, c.video.drop], ["ink", "chat", false, "wipe", "accroche"]);
  // Retouche : le moment fort se déplace sur une scène gardée, même hors du passage ouvert.
  const open = openBeats(v, { range: [0, 0.5] });
  assert.deepEqual(open, ["accroche"]);
  const m = mergeRevision(v, { notes: "Moment fort sur l'accroche.", drop: "accroche" }, open);
  assert.equal(m.changed, true);
  assert.equal(m.video.drop, "accroche");
  assert.equal(mergeRevision(v, { notes: "", drop: "match" }, open).changed, false);
  assert.equal(mergeRevision(v, { notes: "", drop: "zzz" }, open).video.drop, "match");
  // Engine 1 : ces champs n'existent pas.
  const e1 = basic.clean.video;
  const r1 = applyReview(e1, { beats: [{ id: "son", surface: "ink", label: "X" }], drop: "son" });
  const son = r1.video.beats.find((b) => b.id === "son");
  assert.ok(!("surface" in son) && !("label" in son) && !("drop" in r1.video));
  const m1 = mergeRevision(basic.plan.video, { notes: "", drop: "son" }, openBeats(basic.plan.video, { range: [5.6, 8.4] }));
  assert.ok(!m1.changed && !("drop" in m1.video));
});

test("engine 2 : entrée hostile — sortie bornée, scènes, transitions, fonds, écrans, choix et libellés connus, grille tenue", () => {
  const evil = {
    fpb: "beaucoup", pace: "warp", drop: { toString: () => "x" }, shape: "triangle",
    beats: Array.from({ length: 14 }, (_, i) => ({
      id: i % 3 ? "dup" : "</script>",
      title: "<img onerror=x>".repeat(10),
      text: `</script> 🚀 ${i} ${"mot ".repeat(6)}`,
      layout: ["diagonal", "phone", "cards", "slot", "wall", "bubbles", "number"][i % 7],
      bridge: ["teleport", "wipe", "flip", "whip", "flood", "push", "zoom"][i % 7],
      surface: ["néon", "accent", { x: 1 }, "ink"][i % 4],
      screen: ["tv", "chat", null, "app"][i % 4],
      pick: [NaN, -1, "2", 99, 1.5][i % 5],
      label: `🎉 ${"très long libellé ".repeat(5)}`,
      items: [1, "", null, "x".repeat(500), "🚀", "Un vrai item"],
      seconds: i % 2 ? Infinity : "abc",
    })),
    moments: [{ id: "m", from: "dup", to: "dup", zone: "above", js: "mt.to(root,{x:1},0)" }],
  };
  const r = sig(evil, { seed: 7 });
  const v = r.video;
  assert.equal(v.engine, 2);
  assert.equal(v.fpb, 15);
  assert.equal(r.pace, "normal");
  assert.ok(!("drop" in v));
  assert.deepEqual(v.moments, []);
  assert.ok(v.beats.length <= VIDEO.beats[1]);
  const ids = v.beats.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of v.beats) {
    assert.match(b.id, BEAT_ID);
    assert.ok(b.text.length <= FIELDS.text && b.title.length <= FIELDS.beatTitle);
    assert.ok(!/\p{Extended_Pictographic}/u.test(b.text + (b.label || "") + (b.items || []).join("")), "emoji retiré");
    assert.ok(SIG_LAYOUTS.includes(b.layout) && SIG_BRIDGES.includes(b.bridge) && ACTORS.includes(b.actor) && CAMERAS.includes(b.camera) && SURFACES.includes(b.surface), b.id);
    assert.equal("screen" in b, b.layout === "phone", b.id);
    if (b.screen) assert.ok(SCREENS.includes(b.screen));
    if ("pick" in b) assert.ok(b.layout === "phone" && b.screen === "app" && Number.isInteger(b.pick) && b.pick >= 0 && b.pick < b.items.length, b.id);
    if ("label" in b) assert.ok(["phone", "cards", "cta"].includes(b.layout) && b.label.length <= FIELDS.label && b.label === b.label.trim(), b.id);
    if (b.items) assert.ok(b.items.length >= 1 && b.items.length <= LIST_ITEMS[1] && b.items.every((x) => typeof x === "string" && x && x.length <= FIELDS.item), b.id);
  }
  assert.ok(r.fixes.length > 0 && r.fixes.every((s) => typeof s === "string"));
  const fpb = v.fpb;
  const t = timeScore(v, { pace: r.pace });
  for (const b of t.video.beats.filter((x) => !x.cut)) assert.ok(onBeats(b.end - b.start, fpb), b.id);
  assert.ok(t.duration >= VIDEO.total[0] && (t.duration <= VIDEO.total[1] || r.findings.some((f) => f.code === "trop_long")), `${t.duration} s`);
});

// ─── Bogues corrigés de score.mjs (engine 2) ────────────────────────────────────────────────────────────────────────

test("engine 2 : sans moment fort écrit, un temps fort sans id ne devient pas le moment fort (ni n'écrase celui de la base)", () => {
  const raw = () => ({ beats: [beat("accroche", "Un début"), { title: "Sans id", text: "La suite" }, beat("fin", "Abonne-toi", { layout: "cta" })] });
  const r = sig(raw());
  assert.equal(r.video.beats[1].id, "t2");
  assert.ok(!("drop" in r.video), `drop inventé : ${r.video.drop}`);
  assert.equal(sig(raw(), { base: { engine: 2, fpb: 15, drop: "fin", beats: [] } }).video.drop, "fin");
});

test("engine 2 : la note « trop longue » donne la durée après la grille et ne parle pas de sous-textes absents", () => {
  const beats = [...Array.from({ length: 10 }, (_, i) => beat(`s${i + 1}`, `Idée numéro ${i + 1}`, { seconds: 5.1 })), beat("s11", "Idée numéro 11", { seconds: 4.5 }), beat("fin", "Abonne-toi", { layout: "cta", seconds: 4.5 })];
  const r = sig({ beats }, { fpb: 17 });
  assert.ok(!r.fixes.some((f) => /sous-textes/.test(f)), r.fixes.join(" | "));
  assert.ok(r.fixes.includes("Vidéo trop longue (60,1 s) : ramenée à 59,5 s au rythme de lecture."), r.fixes.join(" | "));
});

test("engine 2 : une vidéo aux durées toutes fixées atteint 15 s", () => {
  const r = sig({ beats: [beat("a", "Un", { seconds: 5.6, fixed: true }), beat("b", "Deux", { seconds: 5.6, fixed: true }), beat("c", "Trois", { layout: "cta", seconds: 3.3, fixed: true })] }, { pace: "fast" });
  const d = timeScore(r.video, { pace: r.pace }).duration;
  assert.ok(d >= VIDEO.total[0], `${d} s ; ${r.fixes.join(" | ")}`);
});

test("engine 2 : l'accroche qui dure le plancher de sa scène n'est pas « trop longue » ; plus longue, si", () => {
  const hookFinding = (r) => r.findings.find((f) => f.code === "accroche_trop_longue");
  // (une vidéo de plus de 15 s : rien n'est allongé)
  const rest = [beat("suite", "La suite", { seconds: 6 }), beat("milieu", "Le milieu", { seconds: 6 }), beat("fin", "Abonne-toi", { layout: "cta", seconds: 4 })];
  // Slot de 3 items à fpb 14 : plancher 6 temps = 2,8 s ; héros à fpb 20 : plancher 4 temps = 2,67 s.
  const slot = sig({ beats: [beat("accroche", "Fini les", { layout: "slot", items: ["tableurs", "exports", "relances"] }), ...rest] }, { fpb: 14 });
  assert.equal(slot.video.beats[0].seconds, 2.8);
  assert.equal(hookFinding(slot), undefined, JSON.stringify(slot.findings));
  const hero = sig({ beats: [beat("accroche", "Tes stats mentent", { layout: "hero" }), ...rest] }, { fpb: 20 });
  assert.equal(Math.round(hero.video.beats[0].seconds * 30), 80);
  assert.equal(hookFinding(hero), undefined, JSON.stringify(hero.findings));
  // Au-delà du plancher (seconds écrit à 4 s), la relecture le voit, avec la limite de la scène.
  const long = sig({ beats: [beat("accroche", "Fini les", { layout: "slot", items: ["tableurs", "exports", "relances"], seconds: 4 }), ...rest] }, { fpb: 14 });
  const f = hookFinding(long);
  assert.ok(f, JSON.stringify(long.findings));
  assert.match(f.message, /\(6 mots et 2,8 s au plus\)\.$/);
  // Engine 1 : la limite reste 2,5 s.
  const e1 = cleanScore({ beats: [beat("accroche", "Tes stats mentent", { seconds: 2.8 }), ...rest] }, E1);
  assert.match(hookFinding(e1).message, /\(6 mots et 2,5 s au plus\)\.$/);
});

test("engine 2 : trop longue même au plancher, les sous-textes des scènes libres partent, la note le dit et donne la durée rendue", () => {
  // 9 scènes fixées (5,5 s), 2 libres avec un sous-texte de 17 mots (lecture 3,95 s, 4 s sur la grille), l'appel :
  // 65,5 s. Au plancher : 60,5 s ; le sous-texte d'une scène libre part (jamais celui d'une scène fixée : sa durée
  // n'en dépend pas), 58,5 s.
  const sub = "Une précision vraiment très longue pour bien compter dans le temps de lecture de cette scène ici";
  const beats = [...Array.from({ length: 11 }, (_, i) => beat(`s${i + 1}`, `Idée numéro ${i + 1}`, { seconds: 5.5, fixed: i < 9, sub })), beat("fin", "Abonne-toi", { layout: "cta", seconds: 5 })];
  const r = sig({ beats }, { fpb: 15 });
  assert.deepEqual(r.video.beats.filter((b) => b.id !== "fin" && !b.sub).map((b) => b.id), ["s10"]);
  assert.ok(r.fixes.includes("Vidéo trop longue : des sous-textes ont été retirés pour tenir 60 s."), r.fixes.join(" | "));
  assert.ok(r.fixes.includes("Vidéo trop longue (65,5 s) : ramenée à 58,5 s au rythme de lecture."), r.fixes.join(" | "));
  const t = timeScore(r.video, { pace: r.pace });
  assert.equal(t.duration, 58.5);
  for (const b of t.video.beats) assert.ok(onBeats(b.end - b.start, 15), b.id);
});

// ─── Page écrite par le moteur ──────────────────────────────────────────────────────────────────────────────────────

/** Les fichiers texte d'un dossier de projet, par nom relatif. */
function files(dir, base = dir, out = {}) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, base, out);
    else out[p.slice(base.length + 1)] = readFileSync(p);
  }
  return out;
}

/** Réglages du moteur pour les tests : config.json du worker, ou GSAP_DIR et FONTS_DIR. null si GSAP manque. */
async function engineCfg() {
  const { loadConfig, home } = await import("../lib/util.mjs");
  let cfg = {};
  try { cfg = loadConfig(); } catch { cfg = {}; }
  const gsapDir = process.env.GSAP_DIR || home(cfg.gsapDir || "");
  if (!gsapDir || !existsSync(join(gsapDir, "gsap.min.js"))) return null;
  return { ...cfg, gsapDir, gsapFile: "", fontsDir: process.env.FONTS_DIR || cfg.fontsDir };
}

test("stagePage : la page de score-basic rend la durée, les instants posés, les repères et les moments du contrat", async (t) => {
  const cfg = await engineCfg();
  if (!cfg) return t.skip("GSAP absent (lance --setup-reel ou donne GSAP_DIR)");
  const { stagePage } = await import("../lib/reel/stage.mjs");
  const tmp = mkdtempSync(join(tmpdir(), "reel-stage-"));
  try {
    const r = await stagePage(cfg, copy(basic.plan), tmp, { notes: [] });
    assert.equal(r.duration, basic.stage.duration);
    assert.deepEqual(r.settle, basic.stage.settle);
    assert.deepEqual(r.marks, basic.stage.marks);
    assert.deepEqual(r.momentIds, basic.stage.momentIds);
    const score = readFileSync(join(tmp, "assets", "score.js"), "utf8");
    const S = JSON.parse(score.slice(score.indexOf("{"), score.lastIndexOf("}") + 1));
    for (const span of basic.stage.momentSpans) {
      const m = S.moments.find((x) => x.id === span.id);
      assert.ok(m, span.id);
      assert.deepEqual([m.zone, m.start, m.end, m.D, m.frame], [span.zone, span.start, span.end, span.D, span.frame]);
    }
    const files = readdirSync(tmp).sort();
    assert.deepEqual(files, ["assets", "hyperframes.json", "index.html", "index.motion.json", "package.json"]);
    const motion = JSON.parse(readFileSync(join(tmp, "index.motion.json"), "utf8"));
    assert.equal(motion.duration, basic.stage.duration);
    assert.deepEqual(motion.assertions.map((a) => a.kind), ["appearsBy", "keepsMoving"]);
    const html = readFileSync(join(tmp, "index.html"), "utf8");
    assert.match(html, /Content-Security-Policy/);
    assert.ok(!/unsafe-eval/.test(html));
    assert.match(html, /window\.__timelines = window\.__timelines \|\| \{\}/);
    assert.ok(readFileSync(join(tmp, "assets", "m-egaliseur.js"), "utf8").includes('"use strict"'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("stagePage : aucune chaîne du plan ne passe en HTML, et deux écritures donnent les mêmes fichiers", async (t) => {
  const cfg = await engineCfg();
  if (!cfg) return t.skip("GSAP absent (lance --setup-reel ou donne GSAP_DIR)");
  const { stagePage } = await import("../lib/reel/stage.mjs");
  const plan = copy(basic.plan);
  plan.video.title = "</script><img src=x onerror=alert(1)>";
  plan.video.beats[0].text = "</script><img src=x onerror=alert(1)> https://evil.example";
  plan.video.beats[1].sub = "<svg onload=alert(2)>";
  plan.video.beats[2].title = "<script>alert(5)</script>";
  plan.look.handle = "</script><script>alert(3)</script>";
  plan.texts = [{ text: "<img src=x onerror=alert(4)> http://x.example", start: 0, end: 2, x: 0.5, y: 0.3, size: "m" }];
  const tmp = mkdtempSync(join(tmpdir(), "reel-stage-"));
  try {
    const a = join(tmp, "a"), b = join(tmp, "b");
    const ra = await stagePage(cfg, copy(plan), a, { notes: [] });
    const rb = await stagePage(cfg, copy(plan), b, { notes: [] });
    assert.deepEqual(ra, rb);
    const fa = files(a), fb = files(b);
    assert.deepEqual(Object.keys(fa).sort(), Object.keys(fb).sort());
    for (const k of Object.keys(fa)) assert.ok(fa[k].equals(fb[k]), `${k} diffère entre deux écritures`);
    const vendor = /^assets\/(gsap|CustomEase|DrawSVGPlugin|MorphSVGPlugin)\.min\.js$|\.(woff2|png|jpg|webp)$/;
    for (const [k, buf] of Object.entries(fa)) {
      if (vendor.test(k)) continue;
      const s = buf.toString("utf8");
      assert.ok(!/<img/i.test(s), `${k} contient <img`);
      assert.ok(!/\bon(error|load)\s*=/i.test(s), `${k} contient un gestionnaire`);
      assert.ok(!/https?:/i.test(s), `${k} contient une adresse`);
      assert.ok(!/<script>alert|<\/script><|<svg onload/i.test(s), `${k} : < non échappé venu du plan`);
    }
    // Les chaînes du plan sont bien là, en données : elles reviennent intactes au JSON.parse.
    const score = fa["assets/score.js"].toString("utf8");
    const S = JSON.parse(score.slice(score.indexOf("{"), score.lastIndexOf("}") + 1));
    assert.equal(S.beats[0].words[0].t, "</script><img");
    assert.equal(S.chrome.handle, plan.look.handle);
    assert.equal(S.texts[0].text, plan.texts[0].text);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("stagePage : forme « aucune » sans moment construit → la forme revient (mode sûr, moment retiré), avec une note", async (t) => {
  const cfg = await engineCfg();
  if (!cfg) return t.skip("GSAP absent (lance --setup-reel ou donne GSAP_DIR)");
  const { stagePage } = await import("../lib/reel/stage.mjs");
  const plan = copy(basic.plan);
  plan.video.shape = "none";
  const tmp = mkdtempSync(join(tmpdir(), "reel-stage-"));
  const shapeOf = (dir) => { const sc = readFileSync(join(dir, "assets", "score.js"), "utf8"); return JSON.parse(sc.slice(sc.indexOf("{"), sc.lastIndexOf("}") + 1)); };
  try {
    // Mode sûr : aucun moment, donc la forme revient sur tous les temps forts.
    const notes = [];
    await stagePage(cfg, copy(plan), join(tmp, "safe"), { safe: true, notes });
    const S = shapeOf(join(tmp, "safe"));
    assert.equal(S.shape, "orb");
    assert.ok(S.beats.every((b) => b.actor !== "hidden"), "un temps fort sans forme");
    assert.ok(notes.some((n) => /Forme remise/.test(n)), notes.join(" | "));
    // Sans moment (refusé ou retiré après check) : pareil.
    const none = copy(plan);
    none.video.moments = [];
    const n2 = [];
    await stagePage(cfg, none, join(tmp, "none"), { notes: n2 });
    assert.equal(shapeOf(join(tmp, "none")).shape, "orb");
    // Avec le moment de score-basic construit sur 2 temps forts ou plus : « aucune » est gardée.
    const keep = [];
    const r = await stagePage(cfg, copy(plan), join(tmp, "keep"), { notes: keep });
    const S3 = shapeOf(join(tmp, "keep"));
    if (S3.moments.some((m) => m.beats.length >= 2)) {
      assert.equal(S3.shape, "none");
      assert.ok(!keep.some((n) => /Forme remise/.test(n)));
    }
    assert.ok(r.momentIds.length >= 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("stagePage : le code d'un moment est écrit avec le garde-fou du moteur (boucles et fonctions bornées)", async (t) => {
  const cfg = await engineCfg();
  if (!cfg) return t.skip("GSAP absent (lance --setup-reel ou donne GSAP_DIR)");
  const { stagePage } = await import("../lib/reel/stage.mjs");
  const { MOMENT } = await import("../lib/reel/vocab.mjs");
  const plan = copy(basic.plan);
  const m = plan.video.moments[0];
  m.code.js += "\nfor (let i = 0; i < 3; i++) { mt.to(root, { x: i, duration: 0.1 }, i); }";
  const tmp = mkdtempSync(join(tmpdir(), "reel-stage-"));
  try {
    await stagePage(cfg, plan, tmp, { notes: [] });
    const f = readFileSync(join(tmp, "assets", `m-${m.id}.js`), "utf8");
    assert.ok(f.includes(`if (++__n > ${MOMENT.iterations}) throw new RangeError(`), "garde-fou absent");
    assert.match(f, /for \(let i = 0; i < 3; i\+\+\) \{ __g\(\);/);
    assert.ok(f.indexOf('"use strict"') < f.indexOf("var __n"), "use strict doit rester la première instruction");
    // Le fichier se lit comme un script.
    assert.doesNotThrow(() => new Function(f));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
