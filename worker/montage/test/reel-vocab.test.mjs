// Le vocabulaire du moteur (lib/reel/vocab.mjs) recopie des listes de src/lib/montage.ts : ce test vérifie que les
// deux côtés disent la même chose (TS_MIRROR), ainsi que les constantes de la formule de lecture et du « posé ».
// Lancer : node --test test/reel-vocab.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as V from "../lib/reel/vocab.mjs";

const TS_PATH = fileURLToPath(new URL("../../../src/lib/montage.ts", import.meta.url));
const ts = readFileSync(TS_PATH, "utf8");

/** Le littéral d'une constante exportée de montage.ts (sans « as const » ni « satisfies »), ou null. */
function literalOf(name) {
  const m = new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*([\\s\\S]*?)(?:\\s+as const)?(?:\\s+satisfies[^;]*)?;\\n`).exec(ts);
  if (!m) return null;
  return m[1].replace(/\s+as const\b[\s\S]*$/, "");
}

/** Évalue un littéral TS simple (tableaux, objets, nombres, chaînes, regex) : du texte du dépôt, pas une entrée. */
function evalLiteral(src) {
  return new Function(`"use strict"; return (${src});`)();
}

const same = (got, want) =>
  want instanceof RegExp
    ? got instanceof RegExp && got.source === want.source && got.flags === want.flags
    : isDeepStrictEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(want)));

test("TS_MIRROR : chaque constante existe dans montage.ts avec la même valeur", () => {
  const names = Object.keys(V.TS_MIRROR);
  assert.ok(names.length >= 16, "le miroir couvre au moins les 16 constantes du contrat");
  const diffs = [];
  for (const name of names) {
    const lit = literalOf(name);
    if (lit === null) {
      diffs.push(`${name} : absente de src/lib/montage.ts`);
      continue;
    }
    let got;
    try {
      got = evalLiteral(lit);
    } catch (e) {
      diffs.push(`${name} : littéral illisible (${e.message})`);
      continue;
    }
    if (!same(got, V.TS_MIRROR[name])) diffs.push(`${name} : ${JSON.stringify(String(got instanceof RegExp ? got : JSON.stringify(got)))} ≠ ${JSON.stringify(String(V.TS_MIRROR[name] instanceof RegExp ? V.TS_MIRROR[name] : JSON.stringify(V.TS_MIRROR[name])))}`);
  }
  assert.deepEqual(diffs, [], `écarts entre vocab.mjs et montage.ts :\n${diffs.join("\n")}`);
});

test("formule de lecture : mêmes constantes que reelReadSeconds", () => {
  const m = /return \(([\d.]+) \+ ([\d.]+) \* words \+ \(b\.count \? ([\d.]+) : 0\) \+ ([\d.]+) \* items\.length\) \* \(READ_PACE\[pace\] \?\? 1\);/.exec(ts);
  assert.ok(m, "reelReadSeconds a changé de forme dans montage.ts : mettre à jour READ (vocab.mjs) et ce test");
  assert.deepEqual(m.slice(1).map(Number), [V.READ.base, V.READ.perWord, V.READ.count, V.READ.perItem]);
});

test("posé : mêmes constantes que reelSettle", () => {
  const m = /reelSettle = \(p: \{ start: number; end: number \}\) => p\.start \+ Math\.min\(([\d.]+), ([\d.]+) \* \(p\.end - p\.start\)\)/.exec(ts);
  assert.ok(m, "reelSettle a changé de forme dans montage.ts");
  assert.deepEqual([Number(m[1]), Number(m[2])], [V.TIMING.settle.max, V.TIMING.settle.frac]);
});

test("durées : beatSeconds suit les règles du contrat", () => {
  const b = (o) => ({ id: "a", text: "un deux trois", ...o });
  // Lecture : 0,9 + 0,28 × 3 = 1,74 s → quantifié à l'image.
  assert.equal(V.beatSeconds(b({}), false), V.quantize(1.74));
  // Bornes 1,5–10 s, dernier temps fort ≥ 2,5 s même fixé.
  assert.equal(V.beatSeconds(b({ seconds: 30 }), false), 10);
  assert.equal(V.beatSeconds(b({ seconds: 0.2, fixed: true }), false), 1.5);
  assert.equal(V.beatSeconds(b({ seconds: 1.6, fixed: true }), true), 2.5);
  // fixed garde la valeur même sous la lecture ; sinon la lecture gagne.
  assert.equal(V.beatSeconds(b({ text: "un deux trois quatre cinq six sept huit", seconds: 2, fixed: true }), false), 2);
  assert.ok(V.beatSeconds(b({ text: "un deux trois quatre cinq six sept huit", seconds: 2 }), false) > 2);
  // Rythme calme : plus long.
  assert.ok(V.minSeconds(b({}), "calm") > V.minSeconds(b({}), "normal"));
  // Mots : la ponctuation seule ne compte pas, l'espace insécable sépare.
  assert.equal(V.countWords("Bonjour ! 3 erreurs —"), 3);
  // Tout tombe sur l'image.
  for (const s of [1.51, 2.333, 7.77]) assert.equal(Math.round(V.quantize(s) * 30), V.quantize(s) * 30);
});

test("graine : FNV-1a stable, différente par version", () => {
  assert.equal(V.seedOf("job-1"), V.seedOf("job-1"));
  assert.notEqual(V.seedOf("job-1"), V.seedOf("job-1", 2));
  assert.ok(Number.isInteger(V.seedOf("x")) && V.seedOf("x") >= 0 && V.seedOf("x") < 2 ** 32);
  assert.equal(V.seedOf(""), 0x811c9dc5);
});

test("vocabulaire gelé et cohérent", () => {
  assert.ok(Object.isFrozen(V.LAYOUTS) && Object.isFrozen(V.VIDEO) && Object.isFrozen(V.MOMENT));
  assert.throws(() => {
    "use strict";
    V.LAYOUTS.push("x");
  });
  for (const k of ["layout", "bridge", "actor", "camera", "shape", "pace", "source"]) assert.ok(k in V.DEFAULTS, `défaut ${k}`);
  assert.ok(V.LAYOUTS.includes(V.DEFAULTS.layout) && V.BRIDGES.includes(V.DEFAULTS.bridge) && V.ACTORS.includes(V.DEFAULTS.actor));
  assert.ok(V.CAMERAS.includes(V.DEFAULTS.camera) && V.SHAPES.includes(V.DEFAULTS.shape) && V.PACES.includes(V.DEFAULTS.pace));
  // Les zones de texte restent dans la zone sûre.
  const S = V.SAFE;
  for (const [name, f] of Object.entries(V.ZONE_FRAMES)) {
    const t = f.text || f;
    if (!t || typeof t.x !== "number") continue;
    assert.ok(t.x >= S.x && t.x + t.w <= S.x + S.w && t.y >= S.y && t.y + t.h <= S.y + S.h, `zone ${name} hors de la zone sûre`);
  }
  // Grammaire : une ligne par verbe, rien de vide.
  const g = V.grammarLines();
  assert.ok(Array.isArray(g) && g.length >= 5 && g.every((l) => typeof l === "string" && l.length));
});

test("revue 2 : façade des moments — ni getProperty ni parseEase, clés de tween en liste fermée sans méthode d'élément", () => {
  assert.deepEqual([...V.MOMENT_GSAP], ["set", "utils"]);
  for (const m of ["getProperty", "parseEase"]) assert.ok(!V.MOMENT_METHODS.includes(m), m);
  // Aucune clé permise n'est une propriété interdite, un nom d'API d'élément ni un nom interdit.
  const methods = ["after", "before", "append", "prepend", "remove", "animate", "click", "focus", "blur", "toggleAttribute", "replaceWith", "scrollTo", "translate", "hidden", "id", "className", "style", "innerHTML", "textContent"];
  for (const k of V.MOMENT_OBJECT_KEYS) {
    assert.ok(!methods.includes(k), k);
    assert.ok(!V.BANNED_PROPS.includes(k) && !V.BANNED_PROP_PREFIXES.some((p) => k.startsWith(p)), k);
    assert.ok(!V.BANNED_IDENTIFIERS.includes(k), k);
    assert.ok(!/^on[a-z]/.test(k) && !k.startsWith("_"), k);
  }
  // Les clés dont se servent les moments réels sont permises.
  for (const k of ["x", "y", "xPercent", "yPercent", "scale", "rotation", "opacity", "autoAlpha", "width", "height", "transformOrigin", "svgOrigin", "attr", "drawSVG", "morphSVG", "strokeDashoffset", "duration", "ease", "stagger", "repeat", "yoyo", "immediateRender", "keyframes"]) assert.ok(V.MOMENT_TWEEN_KEYS.includes(k), k);
  assert.deepEqual(Object.keys(V.MOMENT_KEYS).sort(), ["attr", "fields", "keyframe", "morph", "stagger", "tween"]);
  assert.ok(V.MOMENT.targetTweens >= 1000 && V.MOMENT.targetTweens <= 10000);
  assert.ok(Object.isFrozen(V.MOMENT_KEYS) && Object.isFrozen(V.MOMENT_TWEEN_KEYS));
});
