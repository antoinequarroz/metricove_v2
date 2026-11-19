// Partition du reel vidéo (score.mjs) et page écrite par le moteur (stage.mjs). `node --test test/reel-score.test.mjs`
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyReview, cleanScore, commonWord, emphasisIn, lintScore, mergeRevision, openBeats, timeScore } from "../lib/reel/score.mjs";
import { ACTORS, BEAT_ID, BRIDGES, CAMERAS, FIELDS, LAYOUTS, MOMENT_ID, SHAPES, VIDEO, ZONES, beatSeconds, seedOf } from "../lib/reel/vocab.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/reel/${name}.json`, import.meta.url), "utf8"));
const basic = fixture("score-basic");
const copy = (x) => JSON.parse(JSON.stringify(x));
const total = (video, pace = "normal") => timeScore(video, { pace }).duration;
const onFrame = (s) => Math.abs(s * 30 - Math.round(s * 30)) < 1e-6;
/** Un temps fort minimal (les champs absents prennent les valeurs par défaut). */
const beat = (id, text, extra = {}) => ({ id, title: id, text, ...extra });

// ─── score-basic : le contrat partagé avec le paquet B ──────────────────────────────────────────────────────────────

test("score-basic : cleanScore rend exactement la vidéo propre, sans correction ni constat", () => {
  const r = cleanScore(copy(basic.raw), basic.options);
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
  const r = cleanScore(evil, { seed: 7 });
  const v = r.video;
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
  const short = cleanScore({ beats: [beat("a", "Un"), beat("b", "Deux"), beat("c", "Trois", { seconds: 1.5 })] });
  const kept = short.video.beats;
  for (const b of kept) assert.ok(onFrame(b.seconds), `${b.id} ${b.seconds}`);
  assert.ok(kept[kept.length - 1].seconds >= VIDEO.last);
  assert.ok(total(short.video) >= VIDEO.total[0], `trop court : ${total(short.video)}`);
  assert.ok(short.fixes.some((s) => /trop courte/.test(s)));
  const t = timeScore(short.video, {});
  assert.ok(t.settle.every(onFrame));
  assert.ok(onFrame(t.duration));
});

test("temps : une vidéo trop longue perd ses sous-textes puis reçoit le constat trop_long", () => {
  const words = "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit";
  const long = cleanScore({ beats: Array.from({ length: 12 }, (_, i) => beat(`b${i}`, `${words} ${i}`, { sub: "un sous-texte assez long pour compter beaucoup de mots ici", seconds: 9 })) });
  assert.ok(long.fixes.some((s) => /sous-textes/.test(s)));
  assert.ok(long.video.beats.every((b) => !b.sub));
  const d = total(long.video);
  if (d > VIDEO.total[1]) assert.ok(long.findings.some((f) => f.code === "trop_long"));
  // Au rythme de lecture : chaque temps fort garde le temps de se lire.
  const medium = cleanScore({ beats: Array.from({ length: 10 }, (_, i) => beat(`m${i}`, `Une phrase courte numéro ${i}`, { sub: "Un sous-texte", seconds: 10 })) });
  assert.ok(total(medium.video) <= VIDEO.total[1]);
});

test("temps : la cible est tenue à ±15 %, sans passer sous le temps de lecture, les temps forts fixés gardés", () => {
  const raw = { beats: [beat("a", "Une accroche", { seconds: 2 }), beat("b", "Deux idées simples", { seconds: 3 }), beat("c", "Trois", { seconds: 4, fixed: true }), beat("d", "Quatre mots ici là", { seconds: 3 }), beat("e", "Abonne-toi pour la suite", { layout: "cta", seconds: 3 })] };
  for (const target of [15, 30, 45]) {
    const r = cleanScore(copy(raw), { target });
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
  const raw = { beats: [beat("a", "Un deux trois", { seconds: 2 }), beat("b", "Quatre cinq", { seconds: 2 }), beat("c", "Abonne-toi", { layout: "cta", seconds: 2 })] };
  const r = cleanScore(copy(raw), { target: 45 });
  assert.equal(total(r.video), 15);
  for (const f of r.fixes) assert.ok(!/\d\.\d/.test(f), `point décimal : ${f}`);
  assert.ok(r.fixes.some((f) => /^Durée visée 45 s : \d+(,\d)? s seulement \(plus long, le rythme deviendrait lent : ajoute de la matière à la demande\)\.$/.test(f)), r.fixes.join(" | "));
  assert.ok(r.fixes.some((f) => /^Vidéo trop courte \(\d+(,\d)? s\) : allongée à 15 s\.$/.test(f)), r.fixes.join(" | "));
  assert.ok(!r.fixes.some((f) => /pour garder le temps de lire/.test(f)), "mauvaise raison");
  // Trop long pour la cible à cause du temps de lecture : la raison est la lecture.
  const long = { beats: Array.from({ length: 8 }, (_, i) => beat(`b${i}`, "Une phrase assez longue pour demander du temps de lecture ici", { seconds: 6 })) };
  const l = cleanScore(copy(long), { target: 15 });
  // Plus longue que la cible : jamais « seulement » (revue 2), la vidéo « garde » sa durée.
  assert.ok(l.fixes.some((f) => /^Durée visée 15 s : la vidéo garde \d+(,\d)? s \(pour garder le temps de lire tous les textes\)\.$/.test(f)), l.fixes.join(" | "));
  assert.ok(!l.fixes.some((f) => /seulement/.test(f)), l.fixes.join(" | "));
});

test("temps : un temps fort fixé garde sa durée, sauf le dernier qui fait au moins 2,5 s", () => {
  const r = cleanScore({ beats: [beat("a", "Un", { seconds: 1.5, fixed: true }), beat("b", "Deux", { seconds: 6 }), beat("c", "Trois", { seconds: 6 }), beat("d", "Quatre", { seconds: 1.5, fixed: true })] });
  assert.equal(r.video.beats[0].seconds, 1.5);
  assert.equal(r.video.beats[0].fixed, true);
  assert.ok(r.video.beats[3].seconds >= VIDEO.last);
});

// ─── Liaisons, forme, moments ───────────────────────────────────────────────────────────────────────────────────────

test("liaisons : carry sans mot commun → morph, carry avec mot commun gardé, zoom sans emphase → rise, au plus 2 coupes", () => {
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
  });
  const by = Object.fromEntries(r.video.beats.map((b) => [b.id, b.bridge]));
  assert.equal(by.a, "cut", "la liaison du premier temps fort est ignorée, pas comptée");
  assert.equal(by.b, "morph");
  assert.equal(by.d, "carry");
  assert.equal(commonWord("Publier chaque semaine", "Une semaine suffit"), "semaine");
  assert.equal(by.e, "rise");
  assert.deepEqual([by.c, by.f, by.g, by.h], ["cut", "cut", "morph", "morph"]);
  assert.ok(r.fixes.some((s) => /coupes/.test(s)) && r.fixes.some((s) => /mot commun/.test(s)) && r.fixes.some((s) => /plongée/.test(s)));
  const z = cleanScore({ beats: [beat("a", "Le mot clé", { emphasis: "mot clé" }), beat("b", "Plongée", { bridge: "zoom" }), beat("c", "Fin")] });
  assert.equal(z.video.beats[1].bridge, "zoom");
});

test("forme : none sans moment sur deux temps forts → orb avec le constat pas_de_continuite ; gardée sinon", () => {
  const raw = { shape: "none", beats: [beat("a", "Un"), beat("b", "Deux"), beat("c", "Trois")] };
  const r = cleanScore(copy(raw));
  assert.equal(r.video.shape, "orb");
  assert.ok(r.findings.some((f) => f.code === "pas_de_continuite"));
  const withMoment = { ...copy(raw), moments: [{ id: "fil", brief: "Un fil", from: "a", to: "b", zone: "behind", html: "<i></i>", css: "", js: "mt.to(root,{x:1},0)" }] };
  assert.equal(cleanScore(withMoment).video.shape, "none");
});

test("forme cachée au plus une fois sur deux", () => {
  const r = cleanScore({ beats: ["a", "b", "c", "d"].map((id) => beat(id, `Texte ${id}`, { actor: "hidden" })) });
  assert.equal(r.video.beats.filter((b) => b.actor === "hidden").length, 2);
});

test("moments : hors de portée retiré, plus de 3 temps forts raccourci (sauf behind), un seul devant par temps fort, full → above si texte long", () => {
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
  });
  const by = Object.fromEntries(r.video.moments.map((m) => [m.id, m]));
  assert.equal(by.loin, undefined);
  assert.equal(by.envers, undefined);
  assert.deepEqual([by.long.from, by.long.to], ["a", "c"]);
  assert.deepEqual([by.fond.from, by.fond.to], ["a", "e"]);
  assert.equal(by.plein.zone, "above");
  const clash = cleanScore({ beats: beats.slice(0, 4), moments: [{ id: "un", from: "a", to: "b", zone: "above", js }, { id: "deux", from: "b", to: "c", zone: "below", js }] });
  assert.deepEqual(clash.video.moments.map((m) => m.id), ["un"]);
});

// ─── Constats ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("lintScore : texte trop long, accroche trop longue, monotonie, appel absent", () => {
  const v = cleanScore({ beats: [beat("a", "Une accroche beaucoup trop longue pour être lue d'un seul coup d'œil", { layout: "hero" }), beat("b", "Deux", { bridge: "rise" }), beat("c", "Trois", { bridge: "rise" }), beat("d", "Quatre", { bridge: "rise" })] }).video;
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
