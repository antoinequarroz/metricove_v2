// Bac à sable des animations sur mesure (sandbox.mjs) : chaque attaque du corpus est refusée, chaque moment réel
// (DrawSVG, MorphSVG, anchors, beats) est accepté. `node --test test/reel-sandbox.test.mjs`
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkMoment, checkMoments, guardJs, tokenize } from "../lib/reel/sandbox.mjs";
import { CODE, MOMENT } from "../lib/reel/vocab.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/reel/${name}.json`, import.meta.url), "utf8"));
const corpus = fixture("evil-static-attacks");
const basic = fixture("score-basic");

/** Le moment de base des attaques : un rond qui apparaît. Il doit passer, sinon les refus ne prouvent rien. */
const base = { html: '<div class="dot"></div>', css: ".dot{position:absolute;left:400px;top:200px;width:100px;height:100px;border-radius:50%;background:var(--accent)}", js: 'const dot = root.querySelector(".dot");\nmt.fromTo(dot, { scale: 0 }, { scale: 1, duration: 0.6, ease: "expo.out", immediateRender: false }, 0.2);' };

test("le moment de base des attaques est accepté", () => {
  const r = checkMoment(base, { id: "evil" });
  assert.equal(r.ok, true, JSON.stringify(r.why));
});

test(`le corpus contient au moins 100 attaques, chacune refusée avec une raison en français`, () => {
  assert.ok(corpus.attacks.length >= 100, `${corpus.attacks.length} attaques`);
  const passed = [];
  for (const a of corpus.attacks) {
    let r;
    try { r = checkMoment(a.moment, { id: a.moment.id }); } catch (e) { passed.push(`${a.name} : exception ${e.message}`); continue; }
    if (r.ok) passed.push(a.name);
    else {
      assert.ok(Array.isArray(r.why) && r.why.length > 0, `${a.name} : why vide`);
      for (const w of r.why) assert.equal(typeof w, "string");
    }
  }
  assert.deepEqual(passed, [], `attaques acceptées : ${passed.join(" | ")}`);
});

// Les attaques nommées par le contrat (design, plan de test 1) : chacune doit être dans le corpus.
const REQUIRED = [
  'root["owner" + "Document"]', '["constr" + "uctor"]', "root[k]", "fetch", "`", "eval", "window.x", "this.constructor", "new Array(1e9)",
  "while (true)", "for (;;)", "for (const k in o)", '"ab".repeat(1e9)', "Date.now()", "Math.random()", "setTimeout", "requestAnimationFrame",
  "repeat: -1", "repeat: 50", "gsap.to(", "mt.add(", "mt.call(", "onUpdate", "mt.seek(2)", "tl", "getBoundingClientRect", "left:", "top:", "fontSize",
];
test("les attaques du contrat sont toutes dans le corpus", () => {
  const js = corpus.attacks.filter((a) => a.part === "js").map((a) => a.moment.js).join("\n");
  for (const s of REQUIRED) assert.ok(js.includes(s), `attaque absente : ${s}`);
  const html = corpus.attacks.filter((a) => a.part === "html").map((a) => a.moment.html).join("\n");
  for (const s of ["<img", "<script", "style=", "onload=", "<!--"]) assert.ok(html.includes(s), `attaque HTML absente : ${s}`);
  const css = corpus.attacks.filter((a) => a.part === "css").map((a) => a.moment.css).join("\n");
  for (const s of ["url(https://", "@import", "//cdn.", "/*", "position:fixed", "Poppins", "font:"]) assert.ok(css.includes(s), `attaque CSS absente : ${s}`);
});

test("les évasions vérifiées dans final-csp sont refusées pour la bonne raison", () => {
  const owner = checkMoment({ ...base, js: base.js + '\nconst d = root["owner" + "Document"];' }, { id: "evil" });
  assert.equal(owner.ok, false);
  assert.match(owner.why.join(" "), /index|calcul|crochet|\[/i);
  const ctor = checkMoment({ ...base, js: base.js + '\n({})["constr" + "uctor"]["constr" + "uctor"]("1")();' }, { id: "evil" });
  assert.equal(ctor.ok, false);
});

test("le corpus accepté passe (DrawSVG, MorphSVG, anchors, beats), le code rendu est celui qui sera écrit", () => {
  assert.ok(corpus.accepted.length >= 3);
  for (const m of corpus.accepted) {
    const r = checkMoment(m, { id: m.id });
    assert.equal(r.ok, true, `${m.id} : ${JSON.stringify(r.why)}`);
    assert.equal(typeof r.code.html, "string");
    assert.equal(typeof r.code.css, "string");
    assert.equal(r.code.js, m.js);
    assert.ok(!/xmlns/.test(r.code.html), "xmlns retiré");
  }
  const uses = corpus.accepted.map((m) => m.js).join("\n");
  for (const s of ["drawSVG", "morphSVG", "anchors", "beats["]) assert.ok(uses.includes(s), `le corpus accepté n'utilise pas ${s}`);
});

test("le moment de score-basic est accepté (forme ReelVideo : code)", () => {
  const m = basic.raw.moments[0];
  const r = checkMoment({ code: { html: m.html, css: m.css, js: m.js } }, { id: m.id });
  assert.equal(r.ok, true, JSON.stringify(r.why));
});

test("un xmlns SVG est retiré sans refus (http n'entre jamais dans la page)", () => {
  const r = checkMoment({ ...base, html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle class="c" cx="5" cy="5" r="4" fill="currentColor"/></svg>' }, { id: "ok" });
  assert.equal(r.ok, true, JSON.stringify(r.why));
  assert.ok(!r.code.html.includes("http"));
});

test("une couleur écrite en dur passe avec un conseil (tokens de la marque)", () => {
  const r = checkMoment({ ...base, css: base.css + ".dot{color:#ff0000}" }, { id: "ok" });
  assert.equal(r.ok, true, JSON.stringify(r.why));
  assert.ok((r.advice || []).length > 0);
});

test("un id invalide ou un id d'élément sans le préfixe du moment est refusé", () => {
  assert.equal(checkMoment(base, { id: "Pas-Bon" }).ok, false);
  assert.equal(checkMoment({ ...base, html: '<div id="dot" class="dot"></div>' }, { id: "ok" }).ok, false);
  assert.equal(checkMoment({ ...base, html: '<div id="mok-dot" class="dot"></div>' }, { id: "ok" }).ok, true);
});

test("tailles : chaque partie et le total sont bornés", () => {
  const big = "x".repeat(CODE.css + 1);
  assert.equal(checkMoment({ ...base, css: `.dot{--x:${big}}` }, { id: "ok" }).ok, false);
  // Le total de 60 000 caractères : les moments suivants sont refusés, pas le premier.
  const fat = (id) => ({ id, brief: id, html: base.html, css: base.css + `.dot{width:100px}`.repeat(Math.floor((CODE.css - base.css.length) / 18)), js: base.js });
  const ms = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(fat);
  const r = checkMoments(ms);
  const size = (m) => m.code.html.length + m.code.css.length + m.code.js.length;
  assert.ok(r.kept.reduce((t, m) => t + size(m), 0) <= CODE.total);
  assert.ok(r.refused.length > 0);
  assert.ok(r.refused.every((x) => x.why.length));
});

test("le paramétrage de l'enveloppe est celui du moteur (params, ombres)", () => {
  assert.deepEqual([...MOMENT.params], ["mt", "gsap", "root", "D", "zone", "pal", "beats", "anchors"]);
  for (const s of ["window", "document", "globalThis", "fetch", "Function", "setTimeout"]) assert.ok(MOMENT.shadowed.includes(s), s);
});

test("tokenize : chaînes, nombres, ponctuation ; refuse gabarit et expression régulière", () => {
  const t = tokenize('const a = "x"; a.b(1.5, -2); // fin');
  assert.deepEqual(t.map((x) => x.v), ["const", "a", "=", "x", ";", "a", ".", "b", "(", "1.5", ",", "-", "2", ")", ";"]);
  assert.equal(t[3].t, "str");
  assert.equal(t[9].n, 1.5);
  assert.throws(() => tokenize("const a = `x`;"), /gabarit/);
  assert.throws(() => tokenize("const a = /x/g;"), /expression régulière/);
  assert.throws(() => tokenize('const a = "x;'), /non fermée/);
  // Une division reste une division.
  assert.doesNotThrow(() => tokenize("const a = D / 2;"));
});

// ─── Revue 1 : évasions trouvées par la relecture indépendante ──────────────────────────────────────────────────────

test("revue 1 : chaque évasion de la relecture est dans le corpus et refusée pour la bonne raison", () => {
  const review = corpus.attacks.filter((a) => a.review === 1);
  assert.ok(review.length >= 80, `${review.length} attaques de la revue`);
  // Le nom de l'attaque (début) → ce que la raison doit dire.
  const reasons = [
    [/setHTMLUnsafe/, /setHTMLUnsafe|fromCharCode|String/], [/^revue 1 : click/, /\.click/], [/JSON\.parse/, /JSON|attr doit/],
    [/attr: variable/, /attr doit/], [/attr: \{ id \}/, /attr : « id »/], [/clé id/, /clé « id »/], [/_ts/, /_ts/],
    [/\.\.\.beats/, /«\s*\.\.\.\s*»/], [/index par chaîne|root\["click"\]/, /accès calculé/], [/décomposition\)|\(\{ x: el\.id \}/, /décomposition/],
    [/el\.id = |el\.title|a\.length = 4e9/, /lecture seule/], [/firstChild/, /décomposition/], [/Math = |String = /, /Math|String/],
    [/animate\(\)/, /\.animate/], [/focus|before|after/, /n'est pas permis après un point/], [/mt\._dp/, /_dp/], [/recent|mt\.vars/, /n'est pas permis/],
    [/random/, /hasard/], [/valeur de fonction|valeur fléchée|fonction rangée|fonction dans un tableau|renvoyée|renvoie une flèche/, /fonction/],
    [/passée comme valeur|nommée passée/, /s'appelle toujours/], [/accesseur|méthode raccourcie/, /paires clé: valeur/],
    [/mt\.to passé|querySelector passé|Math\.max passé/, /s'appelle toujours/], [/compteur/, /compteur/], [/sans fin/, /non bornée/],
    [/sans accolades/, /accolades/], [/push dans le tableau/, /n'ajoute rien/], [/imbriquées|999 × 999/, /imbriquées/],
    [/<!--|-->/, /<!--/], [/entité/, /entité/], [/!important/, /important/],
  ];
  for (const a of review) {
    const r = checkMoment(a.moment, { id: a.moment.id });
    assert.equal(r.ok, false, `${a.name} : accepté`);
    const rule = reasons.find(([n]) => n.test(a.name));
    if (rule) assert.match(r.why.join(" | "), rule[1], `${a.name} : ${r.why.join(" | ")}`);
  }
});

test("revue 1 : un moment ordinaire reste accepté (données en tableaux, fonctions nommées, rappels, attr écrit en clair)", () => {
  const js = [
    'const bars = gsap.utils.toArray(".bar");',
    "const peaks = [120, 210, 160];",
    "const pts = [{ x: 10, y: 20 }, { x: 30, y: 40 }];",
    "function at(i) { return 0.2 + i * 0.08; }",
    "const lift = (h) => Math.min(40, h * 0.5);",
    "bars.forEach(function (b, i) {",
    '  mt.fromTo(b, { attr: { y: 300, height: 0 } }, { attr: { y: 300 - peaks[i % 3], height: peaks[i % 3] }, duration: 0.8, ease: "expo.out", immediateRender: false }, at(i));',
    "});",
    "const total = peaks.reduce((s, v) => s + v, 0);",
    'for (const p of pts) { mt.to(bars, { x: p.x, y: lift(p.y), duration: 0.5, ease: "power2.out", stagger: 0.04 }, 1.2); }',
    "for (let i = 0; i < bars.length; i++) {",
    "  for (let j = 0; j < 3; j++) { mt.to(bars[i], { scale: 1 + j * 0.02, duration: 0.3, ease: \"sine.inOut\" }, 2 + j * 0.3); }",
    "}",
    "const o = { v: 0 };",
    "o.v = total;",
    "const w = zone.w - 40, a = anchors[beats[0].id].title;",
    'mt.to(root.querySelector(".lid"), { y: Math.max(0, a.y - 20), duration: Math.max(0.6, D - 2), ease: "sine.inOut" }, 1.5);',
  ].join("\n");
  const r = checkMoment({ html: '<svg viewBox="0 0 900 540"><rect class="bar" x="10" y="300" width="40" height="0" fill="currentColor"/><rect class="lid" x="0" y="0" width="900" height="20" fill="currentColor"/></svg>', css: ".bar{color:var(--accent)}.lid{color:var(--ink)}", js }, { id: "ordre" });
  assert.equal(r.ok, true, JSON.stringify(r.why));
});

/** Exécute un corps de moment comme le moteur l'écrit (enveloppe stricte + garde-fou), avec des doublures. */
function runGuarded(js, limit = MOMENT.iterations) {
  const guard = `var __n = 0, __g = function () { if (++__n > ${limit}) throw new RangeError("boucle trop longue (plus de ${limit} tours)"); };`;
  const fn = new Function(...MOMENT.params, ...MOMENT.shadowed, `"use strict";\n${guard}\n${guardJs(js)}`);
  const calls = [];
  const mt = { to: (...a) => { calls.push(a); return mt; }, fromTo: (...a) => { calls.push(a); return mt; }, set: (...a) => { calls.push(a); return mt; } };
  const gsap = { set: () => {}, utils: { toArray: () => [] } };
  const root = { querySelector: () => ({}), querySelectorAll: () => [] };
  fn(mt, gsap, root, 5, { w: 900, h: 540 }, {}, [{ id: "a", t: 0, d: 2 }], { a: { title: { x: 0, y: 0, w: 10, h: 10 } } });
  return calls;
}

test("garde-fou : une boucle sans fin, une récursion ou une liste qui grandit par un alias lance une RangeError du moment", () => {
  // Ces trois codes passent le filtre statique (rien ne les distingue d'un code juste) : le garde-fou les arrête.
  const loops = {
    "récursion exponentielle": "function f(n) { return n ? f(n - 1) + f(n - 1) : 0; }\nf(40);",
    "flèche récursive": "const f = (n) => n ? f(n - 1) + f(n - 1) : 0;\nf(40);",
    "liste qui grandit par un alias": "var a = [1];\nvar b = a;\nfor (const x of a) { b.push(x); }",
  };
  for (const [name, js] of Object.entries(loops)) {
    assert.equal(checkMoment({ html: '<div class="dot"></div>', css: "", js: base.js + "\n" + js }, { id: "boucle" }).ok, true, `${name} : refusé en statique, le test ne prouve rien`);
    assert.throws(() => runGuarded(js), (e) => e instanceof RangeError, name);
  }
  // Un code juste passe sous le garde-fou et fait ses tweens.
  for (const m of corpus.accepted) assert.doesNotThrow(() => new Function(...MOMENT.params, ...MOMENT.shadowed, `"use strict";\nvar __n = 0, __g = function () {};\n${guardJs(m.js)}`), m.id);
  assert.equal(runGuarded('for (let i = 0; i < 300; i++) { mt.to(root, { x: i, duration: 0.1 }, i * 0.01); }').length, 300);
});

test("guardJs : un __g() au début de chaque corps de boucle et de fonction, autour du corps d'une flèche", () => {
  const g = guardJs("const f = (n) => n * 2;\nfunction h(a) { return a; }\nfor (let i = 0; i < 3; i++) { h(i); }\n[1].map((x, i) => x + i, 0);");
  assert.equal(g, "const f = (n) => (__g(), n * 2);\nfunction h(a) { __g(); return a; }\nfor (let i = 0; i < 3; i++) { __g(); h(i); }\n[1].map((x, i) => (__g(), x + i), 0);");
});

test("evil-escape : le filtre statique refuse tlx et esc ; grow (alias) et cover passent, le second rideau les tient au rendu", () => {
  const ms = fixture("evil-escape").plan.video.moments;
  const r = checkMoments(ms);
  assert.deepEqual(r.refused.map((x) => x.id).sort(), ["esc", "tlx"]);
  const why = Object.fromEntries(r.refused.map((x) => [x.id, x.why.join(" ; ")]));
  assert.match(why.tlx, /_dp|_/);
  assert.match(why.esc, /setHTMLUnsafe|fromCharCode|click/);
  // grow : le tableau grandit par un alias (b = a), ce que l'analyse statique ne suit pas ; le compteur __g l'arrête au
  // rendu (RangeError, moment retiré). cover : sa CSS déplace sa propre racine, ce que la portée « #m-cover > .mroot » et
  // le cadre (overflow:hidden, contain:paint) contiennent. reel-render.mjs sur la fixture vérifie les deux.
  assert.deepEqual(r.kept.map((m) => m.id).sort(), ["cover", "grow"]);
});

// ─── Revue 2 : la façade gsap des moments et le piège, statiques puis dans un vrai Chromium avec le vrai GSAP ─────────

test("revue 2 : gsap.getProperty et parseEase n'existent plus ; une chaîne ne nomme ni le DOM ni GSAP", () => {
  const getprop = fixture("evil-getprop").plan.video.moments;
  for (const id of ["shift", "freeze"]) {
    const r = checkMoment(getprop.find((m) => m.id === id), { id });
    assert.equal(r.ok, false, id);
    assert.match(r.why.join(" | "), /gsap\.getProperty est interdit/, id);
    assert.match(r.why.join(" | "), /nom interdit dans une chaîne \(« ownerDocument »\)/, id);
  }
  const clock = fixture("evil-text-clock").plan.video.moments.find((m) => m.id === "horloge");
  assert.match(checkMoment(clock, { id: "horloge" }).why.join(" | "), /getProperty/);
  for (const js of ['gsap.parseEase("expo.out");', 'const k = "styleSheets";', 'const k = "selectorText";', 'mt.addLabel("defaultView");']) {
    const r = checkMoment({ ...base, js: `${base.js}\n${js}` }, { id: "evil" });
    assert.equal(r.ok, false, js);
  }
  // Un mot CSS courant qui est aussi un global interdit reste permis.
  assert.equal(checkMoment({ ...base, js: `${base.js}\ngsap.set(dot, { transformOrigin: "top" });` }, { id: "ok" }).ok, true);
});

test("revue 2 : les clés d'objet sont une liste fermée (after, before, toggleAttribute, animate… refusées)", () => {
  const texte = fixture("evil-text-clock").plan.video.moments.find((m) => m.id === "texte");
  const why = checkMoment(texte, { id: "texte" }).why.join(" | ");
  assert.match(why, /clé « after » interdite/);
  assert.match(why, /clé « before » interdite/);
  for (const k of ["toggleAttribute", "animate", "remove", "click", "scrollTo", "selectorText", "disabled", "timeScale", "overwrite", "callbackScope", "startAt", "data"]) {
    const r = checkMoment({ ...base, js: `${base.js}\nmt.to(dot, { ${k}: 1, duration: 1 }, 1);` }, { id: "evil" });
    assert.equal(r.ok, false, k);
    assert.match(r.why.join(" | "), new RegExp(`clé « ${k} » interdite`), k);
  }
  assert.equal(checkMoment({ ...base, js: `${base.js}\nmt.set(dot, { ["after"]: "x" });` }, { id: "evil" }).ok, false, "clé calculée");
  assert.equal(checkMoment({ ...base, js: `${base.js}\nmt.set(dot, { 0: "x" });` }, { id: "evil" }).ok, false, "clé numérique");
  // Les clés d'un moment ordinaire passent : stagger et keyframes en objet, morphSVG en objet, pourcentages, tes objets.
  const ok = [
    'mt.to(dot, { x: 10, y: 4, scale: 1.1, rotation: 8, autoAlpha: 1, transformOrigin: "50% 50%", duration: 0.6, ease: "expo.out", stagger: { each: 0.05, from: "center" } }, 1);',
    'mt.to(dot, { keyframes: { "0%": { y: 0 }, "50%": { y: -20 }, "100%": { y: 0 }, easeEach: "sine.inOut" }, duration: 1.2 }, 2);',
    'mt.to(dot, { keyframes: [{ x: 10, duration: 0.3 }, { x: 0, duration: 0.3 }] }, 3);',
    "const o = { v: 0, t: 1 };",
  ].join("\n");
  const r = checkMoment({ ...base, js: `${base.js}\n${ok}` }, { id: "ok" });
  assert.equal(r.ok, true, JSON.stringify(r.why));
});

/** Playwright (installé avec npm i -g playwright) : absent sur le Mac d'Antoine, le test est alors sauté. */
async function playwright() {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  try { return require("playwright"); } catch { /* pas dans les chemins du worker */ }
  try {
    const { execFileSync } = await import("node:child_process");
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8", timeout: 10_000 }).trim();
    return require(`${root}/playwright`);
  } catch { return null; }
}

/** Réglages du moteur pour stagePage : config.json du worker, ou GSAP_DIR / FONTS_DIR. */
async function engineCfg() {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { loadConfig, home } = await import("../lib/util.mjs");
  let cfg = {};
  try { cfg = loadConfig(); } catch { cfg = {}; }
  const gsapDir = process.env.GSAP_DIR || home(cfg.gsapDir || "");
  if (!gsapDir || !existsSync(join(gsapDir, "gsap.min.js"))) return null;
  return { ...cfg, gsapDir, gsapFile: "", fontsDir: process.env.FONTS_DIR || cfg.fontsDir };
}

/**
 * Monte un plan (stagePage, sans filtre statique), le sert sur 127.0.0.1 et l'ouvre dans Chromium : le vrai GSAP, la
 * vraie façade, le vrai piège. Renvoie { errors (console.error et erreurs de page), hidden (ids des moments retirés),
 * page, close }.
 */
async function openStage(browser, cfg, plan) {
  const { mkdtempSync, readFileSync, rmSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, extname, normalize } = await import("node:path");
  const { createServer } = await import("node:http");
  const { stagePage } = await import("../lib/reel/stage.mjs");
  const dir = mkdtempSync(join(tmpdir(), "reel-runtime-"));
  await stagePage(cfg, plan, dir, { notes: [] });
  const types = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2", ".png": "image/png" };
  const srv = createServer((q, r) => {
    const path = decodeURIComponent(q.url.split("?")[0]);
    const p = normalize(join(dir, path === "/" ? "index.html" : path));
    if (!p.startsWith(dir) || !existsSync(p)) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    r.end(readFileSync(p));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`page : ${e.message}`));
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`);
  await page.waitForFunction(() => !!(window.__timelines && window.__timelines.main), null, { timeout: 20_000, polling: 100 });
  const hidden = await page.evaluate(() => [...document.querySelectorAll(".mframe")].filter((f) => f.style.display === "none").map((f) => f.id.slice(2)));
  /** Recherche comme HyperFrames : la timeline puis l'événement hf-seek (que le piège écoute). */
  const seek = (t) => page.evaluate((time) => {
    window.__timelines.main.seek(time, false);
    window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time, waitUntil() {} } }));
  }, t);
  const close = async () => { await page.close(); srv.close(); rmSync(dir, { recursive: true, force: true }); };
  return { errors, hidden, page, seek, close };
}

test("revue 2 : second rideau dans Chromium, vrai GSAP — chaque évasion est retirée, les moments justes restent", async (t) => {
  const pw = await playwright();
  if (!pw) return t.skip("Playwright absent (npm i -g playwright) : le rideau d'exécution est éprouvé par reel-render.mjs");
  const cfg = await engineCfg();
  if (!cfg) return t.skip("GSAP absent (lance --setup-reel ou donne GSAP_DIR)");
  const browser = await pw.chromium.launch();
  try {
    // 1. Les fixtures d'évasion (filtre statique coupé) : chaque moment attendu est retiré, pour la raison attendue.
    for (const name of ["evil-getprop", "evil-text-clock", "evil-facade"]) {
      await t.test(name, async () => {
        const fx = fixture(name);
        const s = await openStage(browser, cfg, fx.plan);
        try {
          assert.deepEqual(s.hidden.sort(), [...fx.expect.dropped].sort(), s.errors.join(" | "));
          for (const [id, re] of Object.entries(fx.expect.why || {})) assert.ok(s.errors.some((e) => e.startsWith(`moment ${id}:`) && new RegExp(re).test(e)), `${id} : ${s.errors.join(" | ")}`);
          for (const id of fx.expect.built || []) assert.ok(!s.errors.some((e) => e.startsWith(`moment ${id}:`)), `${id} : ${s.errors.join(" | ")}`);
          // Chaque erreur est attribuée à un moment (check retire le moment, jamais tout le rendu).
          for (const e of s.errors) assert.match(e, /^moment [a-z0-9-]+: /, e);
        } finally { await s.close(); }
      });
    }

    // 2. Les moments réels (DrawSVG, MorphSVG avec une forme élément, stagger, svgOrigin, anchors) passent la façade
    //    durcie sans une erreur, restent visibles, bougent, et la lecture ne réveille pas le piège.
    for (const name of ["score-basic", "score-moments", "score-60s"]) {
      await t.test(`${name} : moments construits sans erreur`, async () => {
        const plan = fixture(name).plan;
        const s = await openStage(browser, cfg, plan);
        try {
          assert.deepEqual(s.errors, []);
          assert.deepEqual(s.hidden, []);
          for (let k = 0; k <= 40; k++) await s.seek((k * plan.duration) / 40);
          assert.deepEqual(s.errors, [], "le piège s'est réveillé pendant la lecture");
        } finally { await s.close(); }
      });
    }

    // 3. Les idiomes GSAP qu'un moment écrit souvent passent la façade à l'exécution (wrap en valeur, stagger et
    //    keyframes en objet, pourcentages, objet compteur), et deux chargements donnent les mêmes positions.
    await t.test("idiomes permis et déterminisme", async () => {
      const plan = JSON.parse(JSON.stringify(basic.plan));
      const m = plan.video.moments[0];
      m.code = {
        html: '<div class="row"><i class="d"></i><i class="d"></i><i class="d"></i><i class="d"></i><i class="d"></i></div><svg viewBox="0 0 100 100"><path class="w" d="M10 50 L90 50" fill="none" stroke="currentColor"/><path class="to" d="M10 20 L90 80" fill="none" stroke="none"/></svg>',
        css: ".row{display:flex;gap:40px;padding:200px 0 0 120px}.d{display:block;width:60px;height:60px;border-radius:30px;background:var(--accent)}svg{position:absolute;left:0;top:0;width:300px;height:300px;color:var(--ink)}",
        js: [
          'const dots = root.querySelectorAll(".d");',
          'gsap.set(dots, { scale: 0, transformOrigin: "50% 50%" });',
          'mt.to(dots, { scale: 1, y: gsap.utils.wrap([-24, 24]), duration: 0.6, ease: "back.out(1.6)", stagger: { each: 0.06, from: "center" } }, 0.2);',
          'mt.to(dots, { keyframes: { "50%": { y: -30 }, "100%": { y: 0 }, easeEach: "sine.inOut" }, duration: 1.2 }, 1.2);',
          'mt.to(".w", { keyframes: [{ drawSVG: "0% 40%", duration: 0.4 }, { drawSVG: "0% 100%", duration: 0.4 }] }, 0.4);',
          'mt.to(".w", { morphSVG: ".to", duration: 0.8, ease: "expo.inOut" }, 1.4);',
          "const o = { v: 0 };",
          "mt.to(o, { v: 100, duration: 1 }, 0.5);",
          'mt.addLabel("fin", 2.4);',
          'mt.to(dots, { x: gsap.utils.mapRange(0, 4, -10, 10), duration: 0.5, ease: "power2.inOut" }, "fin");',
        ].join("\n"),
      };
      const pos = async () => {
        const s = await openStage(browser, cfg, plan);
        try {
          assert.deepEqual(s.errors, []);
          assert.deepEqual(s.hidden, []);
          const read = () => s.page.evaluate(() => [...document.querySelectorAll("#m-egaliseur .d")].map((d) => getComputedStyle(d).transform).join(";"));
          await s.seek(0);
          const before = await read();
          await s.seek(plan.duration / 2);
          const mid = await read();
          for (let k = 0; k <= 20; k++) await s.seek((k * plan.duration) / 20);
          assert.deepEqual(s.errors, []);
          return { before, mid };
        } finally { await s.close(); }
      };
      const a = await pos(), b = await pos();
      assert.notEqual(a.before, a.mid, "les points n'ont pas bougé : les tweens ont été perdus");
      assert.equal(a.mid, b.mid, "deux chargements, deux positions");
    });

    // 4. Le piège relit les feuilles de style : une règle réécrite sans la façade (ni textContent changé) est vue.
    await t.test("piège : une feuille de style réécrite pendant la lecture désigne les moments", async () => {
      const s = await openStage(browser, cfg, fixture("score-basic").plan);
      try {
        await s.seek(1);
        // Une règle à sélecteur de la feuille du moteur (la première règle est un @font-face) : son texte ne change pas.
        const changed = await s.page.evaluate(() => {
          const rule = [...document.styleSheets[0].cssRules].find((r) => r.selectorText && r.selectorText !== "#type");
          rule.selectorText = "#type";
          return rule.selectorText === "#type" && document.styleSheets[0].ownerNode.textContent.indexOf("#type{") < 0;
        });
        assert.ok(changed, "la règle n'a pas changé : le test ne prouve rien");
        await s.seek(2);
        assert.ok(s.errors.some((e) => /^moment egaliseur: la page a changé pendant la lecture/.test(e)), s.errors.join(" | "));
      } finally { await s.close(); }
    });
  } finally {
    await browser.close();
  }
});
