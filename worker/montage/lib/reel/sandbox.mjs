// Bac à sable des « moments » (visuels HyperFrames sur mesure écrits par Claude) : le filtre statique, instantané,
// qui passe avant tout rendu (checkMoment). Il repart de proto/sandbox.mjs et des règles de cleanLayer (motion.mjs),
// en plus strict : le html et le css sont lus balise par balise et règle par règle, le js est découpé en jetons
// (chaînes, nombres, identifiants, ponctuation) et chaque identifiant libre doit faire partie d'une petite liste.
//
// Ce filtre n'est PAS la seule frontière : le moteur pose le code dans sa propre enveloppe (paramètres qui masquent
// les globaux, gsap.context limité au conteneur, piège MutationObserver), Chrome tourne hors ligne et
// `hyperframes check` exécute la page avant chaque rendu. Il refuse tôt, avec des raisons lisibles, ce qui n'a rien
// à faire dans un moment : réseau, accès au reste de la page, temps réel, rappels pendant la lecture, boucles sans fin,
// texte (le texte appartient au moteur).
import {
  BANNED_IDENTIFIERS, BANNED_METHODS, BEAT_ID, BANNED_PROPS, BANNED_PROP_PREFIXES, CODE, DATA_ATTR, MOMENT, MOMENT_ASSIGNABLE,
  MOMENT_ATTRS, MOMENT_BANNED_KEYS, MOMENT_CLASS, MOMENT_FONT_FAMILIES, MOMENT_FREE, MOMENT_FREE_CALLS, MOMENT_FREE_OWNERS,
  MOMENT_GSAP, MOMENT_ID, MOMENT_ITERATORS, MOMENT_METHODS, MOMENT_PROPS, MOMENT_TAGS, MOMENT_TWEEN_ATTRS, MOMENT_UTILS,
  MOMENT_DOM_NAMES, MOMENT_OBJECT_KEYS, MOMENT_TWEEN_KEYS,
} from "./vocab.mjs";

/** Copie superficielle d'un objet sans certaines clés. */
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const TAGS = new Set(MOMENT_TAGS.map((t) => t.toLowerCase()));
const ATTRS = new Set(MOMENT_ATTRS.map((a) => a.toLowerCase()));
const BANNED = new Set(BANNED_IDENTIFIERS);
const BANNED_CALLS = new Set(BANNED_METHODS);
const FREE = new Set(MOMENT_FREE);
const FREE_CALLS = new Set(MOMENT_FREE_CALLS);
const FREE_OWNERS = new Set(MOMENT_FREE_OWNERS);
const PARAMS = new Set(MOMENT.params);
const GSAP_OK = new Set(MOMENT_GSAP);
const UTILS = new Set(MOMENT_UTILS);
const METHODS = new Set(MOMENT_METHODS);
const PROPS = new Set(MOMENT_PROPS);
const ASSIGNABLE = new Set(MOMENT_ASSIGNABLE);
const ITERATORS = new Set(MOMENT_ITERATORS);
const BANNED_KEYS = new Set(MOMENT_BANNED_KEYS);
const TWEEN_ATTRS = new Set(MOMENT_TWEEN_ATTRS.map((a) => a.toLowerCase()));
/** Liste fermée des clés d'objet littéral (revue 2) : clés d'un tween, d'un stagger, de morphSVG, de keyframes, champs
 * des objets du moment. Les pourcentages de keyframes ("50%") en plus. */
const OBJECT_KEYS = new Set(MOMENT_OBJECT_KEYS);
const PERCENT_KEY = /^\d{1,3}(\.\d{1,2})?%$/;
/** Noms du DOM, du CSSOM et de GSAP qu'une chaîne ne porte jamais (défense en profondeur, revue 2). Un mot CSS
 * courant qui est aussi un global interdit (transformOrigin: "top") reste permis. */
const DOM_NAMES = new Set(MOMENT_DOM_NAMES);
const CSS_WORDS = new Set(["top"]);
const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??="]);
const ANIMATED = new Set(BANNED_PROPS);
/** Noms de propriétés ou d'attributs qu'une chaîne ne peut pas porter (gsap les écrirait tels quels). */
const BANNED_NAMES = /^(on[a-z]{3,}|innerhtml|outerhtml|srcdoc|src|href|xlink:href|action|formaction|style|textcontent|innertext|outertext|csstext|nodevalue)$/i;
const HANDLER = /^on[a-z]{3,}$/i;
const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "of", "in", "do", "break", "continue", "switch",
  "case", "default", "typeof", "instanceof", "void", "delete", "try", "catch", "finally", "throw", "true", "false",
  "null", "new", "this", "while", "with", "class", "extends", "super", "import", "export", "yield", "async", "await",
  "debugger",
]);
/** Après ces mots, une barre oblique ouvrirait une expression régulière (interdite). */
const BEFORE_EXPR = new Set(["return", "typeof", "case", "do", "else", "in", "of", "instanceof", "void", "delete", "throw", "new", "yield", "await"]);
const NAMED_COLORS = /\b(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|cyan|magenta|lime|navy|teal|olive|maroon|silver|gold|violet|indigo|beige|coral|crimson|salmon|tomato|turquoise)\b/i;

/** Raison de refus d'un moment (message en français, repris dans les notes et la relecture). */
class Refusal extends Error {}

// ─── JS : jetons ────────────────────────────────────────────────────────────────────────────────────────────────────

const PUNCT4 = [">>>="];
const PUNCT3 = ["===", "!==", "...", "**=", "<<=", ">>=", "&&=", "||=", "??=", ">>>"];
const PUNCT2 = ["=>", "++", "--", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "**", "<<", ">>", "&=", "|=", "^="];

/**
 * Découpe le js en jetons { t: "id"|"num"|"str"|"p", v, nl } (nl : un saut de ligne le précède). Les commentaires
 * sont retirés. Refuse les gabarits (accent grave), les expressions régulières et les chaînes non fermées.
 */
export function tokenize(js) {
  const toks = [];
  let i = 0, nl = false;
  const n = js.length;
  const last = () => toks[toks.length - 1];
  while (i < n) {
    const c = js[i];
    if (c === "\n") { nl = true; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && js[i + 1] === "/") { while (i < n && js[i] !== "\n") i++; continue; }
    if (c === "/" && js[i + 1] === "*") {
      const e = js.indexOf("*/", i + 2);
      if (e < 0) throw new Refusal("commentaire /* non fermé");
      if (js.slice(i, e).includes("\n")) nl = true;
      i = e + 2;
      continue;
    }
    const push = (t, v, extra = {}) => { toks.push({ t, v, nl, s: i, ...extra }); toks[toks.length - 1].e = i + (extra.len ?? v.length); nl = false; };
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && js[j] !== c && js[j] !== "\n") j++;
      if (js[j] !== c) throw new Refusal("chaîne non fermée");
      push("str", js.slice(i + 1, j), { len: j + 1 - i });
      i = j + 1;
      continue;
    }
    if (c === "`") throw new Refusal("gabarit (accent grave) interdit : utilise des guillemets");
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(js[j])) j++;
      push("id", js.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(js[i + 1] || ""))) {
      const m = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(js.slice(i));
      push("num", m[0], { n: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === "/") {
      const p = last();
      const value = p && ((p.t === "id" && !BEFORE_EXPR.has(p.v)) || p.t === "num" || p.t === "str" || (p.t === "p" && (p.v === ")" || p.v === "]" || p.v === "}")));
      if (!value) throw new Refusal("expression régulière interdite");
    }
    const four = js.slice(i, i + 4), three = js.slice(i, i + 3), two = js.slice(i, i + 2);
    const v = PUNCT4.includes(four) ? four : PUNCT3.includes(three) ? three : PUNCT2.includes(two) ? two : c;
    push("p", v);
    i += v.length;
  }
  return toks;
}

/** Indice du jeton qui ferme l'ouvrant en `i` ( ( [ { ), ou -1. */
function closing(toks, i) {
  const open = toks[i].v, close = { "(": ")", "[": "]", "{": "}" }[open];
  let d = 0;
  for (let k = i; k < toks.length; k++) {
    if (toks[k].t !== "p") continue;
    if (toks[k].v === open) d++;
    else if (toks[k].v === close && --d === 0) return k;
  }
  return -1;
}

const isP = (tok, v) => tok && tok.t === "p" && tok.v === v;
const isId = (tok, v) => tok && tok.t === "id" && (v === undefined || tok.v === v);

/** Le genre de chaque accolade ouvrante : objet littéral ("obj") ou bloc ("block"), d'après le jeton qui la précède. */
function braceKinds(toks) {
  const kind = new Map();
  for (let i = 0; i < toks.length; i++) {
    if (!isP(toks[i], "{")) continue;
    const p = toks[i - 1];
    let obj = false;
    if (p && p.t === "p") obj = ["(", ",", ":", "=", "[", "?", "||", "&&", "??", "+", "-", "*", "!", "...", "==", "===", "!=", "!==", "<", ">"].includes(p.v);
    else if (p && p.t === "id") obj = p.v === "return" || p.v === "typeof" || p.v === "case";
    kind.set(i, obj ? "obj" : "block");
  }
  return kind;
}

/** Pour chaque jeton : l'accolade ou la parenthèse qui le contient (indice de l'ouvrant, ou -1). */
function parents(toks) {
  const stack = [], par = new Array(toks.length);
  for (let i = 0; i < toks.length; i++) {
    par[i] = stack.length ? stack[stack.length - 1] : -1;
    const t = toks[i];
    if (t.t !== "p") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") stack.push(i);
    else if (t.v === ")" || t.v === "]" || t.v === "}") stack.pop();
  }
  return par;
}

/** Fin d'une expression d'affectation commencée en `i` (exclue) : `;` ou `,` au même niveau, ou nouvelle instruction. */
function exprEnd(toks, i) {
  let d = 0;
  for (let k = i; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === "p") {
      if (t.v === "(" || t.v === "[" || t.v === "{") d++;
      else if (t.v === ")" || t.v === "]" || t.v === "}") { if (d === 0) return k; d--; }
      else if (d === 0 && (t.v === ";" || t.v === ",")) return k;
    } else if (d === 0 && k > i && t.nl) {
      // Saut de ligne sans point-virgule : l'expression s'arrête si la ligne d'avant était complète.
      const p = toks[k - 1];
      const open = p.t === "p" && !["(", "[", "{", ")", "]", "}"].includes(p.v) && p.v !== "++" && p.v !== "--";
      if (!open && !(t.t === "p" && t.v !== "(" && t.v !== "[")) return k;
    }
  }
  return toks.length;
}

const NUMERIC_OPS = new Set(["+", "-", "*", "/", "%", "**", "(", ")", "?", ":", "<", ">", "<=", ">=", "==", "===", "!=", "!==", "&&", "||", "!", ",", "??"]);

/** Les jetons [a, b[ forment-ils une expression numérique (nombres, identifiants numériques, Math.*, x.length, zone.w) ? */
function numericExpr(toks, a, b, safe) {
  if (a >= b) return false;
  for (let k = a; k < b; k++) {
    const t = toks[k];
    if (t.t === "num") continue;
    if (t.t === "id") {
      const prevDot = isP(toks[k - 1], ".");
      if (prevDot) {
        const owner = toks[k - 2];
        if (t.v === "length") continue;
        if (isId(owner, "Math")) continue;
        if (isId(owner, "zone") && (t.v === "w" || t.v === "h")) continue;
        return false;
      }
      if (t.v === "Math" && isP(toks[k + 1], ".")) continue;
      if (t.v === "true" || t.v === "false") continue;
      if (safe.has(t.v) && !isP(toks[k + 1], "[") && !(isP(toks[k + 1], ".") && !isId(toks[k + 2], "length"))) continue;
      if (isP(toks[k + 1], ".") && isId(toks[k + 2], "length")) continue;
      return false;
    }
    if (t.t === "p" && (NUMERIC_OPS.has(t.v) || t.v === ".")) continue;
    return false;
  }
  return true;
}

/** Identifiants dont toutes les affectations sont numériques (plus grand point fixe), compteurs de boucle et index des rappels forEach/map. */
function numericIds(toks) {
  const assigns = new Map();
  const seeds = new Set(["D"]);
  const add = (name, a, b) => { if (!assigns.has(name)) assigns.set(name, []); assigns.get(name).push([a, b]); };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "id") continue;
    // for (let i = 0; …)
    if (t.v === "for" && isP(toks[i + 1], "(") && (isId(toks[i + 2], "let") || isId(toks[i + 2], "var")) && isId(toks[i + 3]) && isP(toks[i + 4], "=")) seeds.add(toks[i + 3].v);
    // .forEach((el, i) => …) / .map(function (el, i) { … })
    if (["forEach", "map", "filter", "some", "every"].includes(t.v) && isP(toks[i - 1], ".") && isP(toks[i + 1], "(")) {
      let k = i + 2;
      if (isId(toks[k], "function")) k++;
      if (isP(toks[k], "(") && isId(toks[k + 1]) && isP(toks[k + 2], ",") && isId(toks[k + 3]) && isP(toks[k + 4], ")")) seeds.add(toks[k + 3].v);
    }
    if (isP(toks[i - 1], ".")) continue;
    // const x = …, y = …
    if (["const", "let", "var"].includes(t.v)) {
      let k = i + 1;
      while (isId(toks[k]) && isP(toks[k + 1], "=")) {
        const e = exprEnd(toks, k + 2);
        add(toks[k].v, k + 2, e);
        if (!isP(toks[e], ",")) break;
        k = e + 1;
      }
      continue;
    }
    const nx = toks[i + 1];
    if (nx && nx.t === "p" && ["=", "+=", "-=", "*=", "/=", "%=", "**="].includes(nx.v) && !["let", "const", "var"].includes(toks[i - 1]?.v)) add(t.v, i + 2, exprEnd(toks, i + 2));
  }
  const safe = new Set([...assigns.keys(), ...seeds]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, list] of assigns) {
      if (!safe.has(name)) continue;
      if (seeds.has(name) && list.every(([a, b]) => numericExpr(toks, a, b, safe))) continue;
      if (!list.every(([a, b]) => numericExpr(toks, a, b, safe))) { safe.delete(name); changed = true; }
    }
  }
  return safe;
}

/** Noms déclarés par le code (const/let/var, fonctions, paramètres, catch, for…of), à peu près : une portée unique. */
function declaredIds(toks) {
  const decl = new Set();
  const pattern = (a, b) => {
    for (let k = a; k <= b; k++) if (isId(toks[k]) && !KEYWORDS.has(toks[k].v) && !isP(toks[k + 1], ":") && !isP(toks[k - 1], ".") && !isP(toks[k - 1], "=")) decl.add(toks[k].v);
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "id" && ["const", "let", "var"].includes(t.v) && !isP(toks[i - 1], ".")) {
      let k = i + 1;
      for (;;) {
        if (isId(toks[k])) decl.add(toks[k].v);
        else if (isP(toks[k], "{") || isP(toks[k], "[")) { const e = closing(toks, k); if (e < 0) break; pattern(k, e); k = e; }
        else break;
        if (!isP(toks[k + 1], "=")) break;
        const e = exprEnd(toks, k + 2);
        if (!isP(toks[e], ",")) break;
        k = e + 1;
      }
    }
    if (isId(t, "function")) {
      let k = i + 1;
      if (isId(toks[k])) decl.add(toks[k++].v);
      if (isP(toks[k], "(")) { const e = closing(toks, k); if (e > 0) pattern(k, e); }
    }
    if (isId(t, "catch") && isP(toks[i + 1], "(") && isId(toks[i + 2])) decl.add(toks[i + 2].v);
    if (isP(t, "=>")) {
      const p = toks[i - 1];
      if (isId(p)) decl.add(p.v);
      else if (isP(p, ")")) {
        let d = 0, k = i - 1;
        for (; k >= 0; k--) { if (isP(toks[k], ")")) d++; else if (isP(toks[k], "(") && --d === 0) break; }
        if (k >= 0) pattern(k, i - 1);
      }
    }
  }
  return decl;
}

/** Indice du jeton qui ouvre le fermant en `i` ( ) ] } ), ou -1. */
function opening(toks, i) {
  const close = toks[i].v, open = { ")": "(", "]": "[", "}": "{" }[close];
  let d = 0;
  for (let k = i; k >= 0; k--) {
    if (toks[k].t !== "p") continue;
    if (toks[k].v === close) d++;
    else if (toks[k].v === open && --d === 0) return k;
  }
  return -1;
}

/**
 * Les fonctions du code : { kind: "function"|"arrow", start (premier jeton), name?, params: [a, b] (jetons des
 * paramètres), open/close (accolades du corps) ou expr: [a, b[ (corps d'une flèche sans accolades), bad? }.
 */
function functionsOf(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (isId(t, "function") && !isP(toks[i - 1], ".")) {
      let k = i + 1, name = null;
      if (isId(toks[k])) name = toks[k++].v;
      const pc = isP(toks[k], "(") ? closing(toks, k) : -1;
      if (pc < 0 || !isP(toks[pc + 1], "{")) { out.push({ kind: "function", start: i, bad: true }); continue; }
      out.push({ kind: "function", start: i, name, params: [k, pc], open: pc + 1, close: closing(toks, pc + 1) });
    } else if (isP(t, "=>")) {
      const p = toks[i - 1];
      let start = -1;
      if (isId(p)) start = i - 1;
      else if (isP(p, ")")) start = opening(toks, i - 1);
      if (start < 0) { out.push({ kind: "arrow", start: i, bad: true }); continue; }
      const params = [start, i - 1];
      if (isP(toks[i + 1], "{")) out.push({ kind: "arrow", start, params, open: i + 1, close: closing(toks, i + 1) });
      else out.push({ kind: "arrow", start, params, expr: [i + 1, exprEnd(toks, i + 1)] });
    }
  }
  return out;
}

/** Où vit une fonction : déclarée (function nom), nommée (const nom = …), ou rappel d'une méthode de tableau. */
function fnContext(toks, f) {
  const p = toks[f.start - 1], t = toks[f.start];
  const statement = !p || isP(p, ";") || isP(p, "{") || isP(p, "}") || (t.nl && (p.t !== "p" || isP(p, ")") || isP(p, "]")));
  if (f.kind === "function" && f.name && statement) return { ok: true, name: f.name, site: f.start + 1 };
  if (isP(p, "=") && isId(toks[f.start - 2]) && !KEYWORDS.has(toks[f.start - 2].v) && !isP(toks[f.start - 3], ".") && !isP(toks[f.start - 3], "?.")) return { ok: true, name: toks[f.start - 2].v, site: f.start - 2 };
  if (isP(p, "(") && isId(toks[f.start - 2]) && ITERATORS.has(toks[f.start - 2].v) && isP(toks[f.start - 3], ".")) return { ok: true, name: null };
  return { ok: false };
}

const FN_VALUE = `js : une fonction ne sert que nommée (function nom (…) { … } ou const nom = (…) => …) puis appelée, ou en rappel de ${MOMENT_ITERATORS.join(", ")} : jamais comme valeur (gsap l'appellerait pendant la lecture, après le montage)`;
const MEMBERS_RULE = `js : ${MOMENT_API_RULE_SHORT()}`;
function MOMENT_API_RULE_SHORT() {
  return `après un point, seulement ${MOMENT_METHODS.join(" ")} (appelées) et ${MOMENT_PROPS.join(" ")} (lues) ; tes propres objets n'ont que les champs ${MOMENT_ASSIGNABLE.join(", ")}`;
}

/** Les règles du js d'un moment. Ajoute les raisons de refus à `why`. */
function checkJs(js, id, why) {
  if (!js.trim()) { why.push("js vide : un moment pose au moins un tween sur mt"); return; }
  if (/[^\x20-\x7e\n\r\t]/.test(js)) { why.push("js : seulement de l'ASCII imprimable (pas d'accents ni de caractères spéciaux dans le code)"); return; }
  if (js.includes("\\")) { why.push("js : antislash interdit"); return; }
  // <!-- et --> sont des commentaires pour Chrome (annexe B), pas pour ce filtre : on ne les laisse pas se contredire.
  if (/<!--|-->/.test(js)) { why.push("js : <!-- et --> interdits"); return; }
  let toks;
  try { toks = tokenize(js); } catch (e) { why.push(`js : ${e.message}`); return; }
  const say = new Set();
  const no = (m) => { if (!say.has(m)) { say.add(m); why.push(m); } };
  // Parenthèses, crochets et accolades équilibrés : le corps ne sort jamais de l'enveloppe du moteur.
  let depth = 0;
  for (const t of toks) {
    if (t.t !== "p") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
    else if ((t.v === ")" || t.v === "]" || t.v === "}") && --depth < 0) break;
  }
  if (depth !== 0) { why.push("js : parenthèses, crochets ou accolades mal équilibrés"); return; }
  const kinds = braceKinds(toks), par = parents(toks);
  const safe = numericIds(toks), decl = declaredIds(toks);

  // Fonctions : déclarées ou nommées puis appelées, ou rappels de tableau ; jamais des valeurs (gsap appelle une
  // fonction passée en valeur à chaque rendu : du code de Claude tournerait pendant la recherche).
  const fnNames = new Set(), fnSites = new Set();
  for (const f of functionsOf(toks)) {
    if (f.bad) { no("js : forme de fonction interdite (ni function*, ni flèche illisible)"); continue; }
    const c = fnContext(toks, f);
    if (!c.ok) { no(FN_VALUE); continue; }
    if (c.name) { fnNames.add(c.name); fnSites.add(c.site); }
    if (f.kind === "function" && f.name) { fnNames.add(f.name); fnSites.add(f.start + 1); }
    for (let k = f.params[0]; k <= f.params[1]; k++) if (isP(toks[k], "{")) { no("js : décomposition d'objet interdite dans les paramètres (lis les champs un par un)"); break; }
  }

  const keyPos = (i) => {
    // Un identifiant ou une chaîne suivi de « : » en position de clé d'un objet littéral.
    if (!isP(toks[i + 1], ":")) return false;
    const p = toks[i - 1];
    return (isP(p, "{") || isP(p, ",")) && kinds.get(par[i]) === "obj";
  };
  /** Le jeton `i` est-il dans la fente d'une clé d'objet littéral (après « { » ou « , ») ? */
  const slot = (i) => (isP(toks[i - 1], "{") || isP(toks[i - 1], ",")) && kinds.get(par[i]) === "obj";
  const assignAfter = (i) => { const n = toks[i + 1]; return !!n && n.t === "p" && (ASSIGN_OPS.has(n.v) || n.v === "++" || n.v === "--"); };
  const attrBraces = new Set();
  /** Règles d'une clé d'objet littéral (vars d'un tween) : noms qui écriraient sur l'élément, propriétés animées,
   * repeat, ease, attr, valeurs de fonction. */
  const keyRules = (name, i, quoted) => {
    if (attrBraces.has(par[i])) {
      if (!TWEEN_ATTRS.has(String(name).toLowerCase())) no(`js : attr : « ${name} » interdit (seulement la géométrie et la peinture SVG : x, y, width, height, r, d, points, opacity…)`);
      return;
    }
    if (quoted && (BANNED.has(name) || HANDLER.test(name))) no(`js : clé « ${name} » interdite`);
    if (/^_/.test(name)) no(`js : clé « ${name} » interdite (aucun nom ne commence par _)`);
    if (BANNED_KEYS.has(name) || BANNED_NAMES.test(name)) no(`js : clé « ${name} » interdite (gsap l'écrirait sur l'élément)`);
    else if (isAnimated(name)) no(`js : propriété « ${name} » interdite (anime x, y, scale, rotation, opacity, width ou height)`);
    else if (!OBJECT_KEYS.has(name) && !(quoted && PERCENT_KEY.test(name))) no(`js : clé « ${name} » interdite (clés d'un tween : ${MOMENT_TWEEN_KEYS.join(" ")} ; stagger : each amount from grid axis ease ; morphSVG : shape type origin shapeIndex map precision ; tes objets : ${MOMENT_ASSIGNABLE.join(" ")})`);
    if (name === "repeat") {
      const v = toks[i + 2];
      if (!(v && v.t === "num" && v.n >= 0 && v.n <= 20)) no("js : repeat doit être un nombre écrit en clair, de 0 à 20");
    }
    if (name === "ease" && !(toks[i + 2] && toks[i + 2].t === "str")) no("js : ease doit être un nom de courbe entre guillemets (\"expo.out\")");
    if (name === "attr") {
      if (isP(toks[i + 2], "{")) attrBraces.add(i + 2);
      else no("js : attr doit être un objet écrit en clair (attr: { y: 10, height: 40 })");
    }
  };

  const loops = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], prev = toks[i - 1], next = toks[i + 1];
    // Fente de clé : seulement clé: valeur, ou un nom seul ({ a }) ; ni méthode, ni get/set, ni « ... ».
    if (slot(i)) {
      if (isP(t, "...")) { no("js : « ... » interdit dans un objet (il recopierait des champs que le filtre ne voit pas)"); continue; }
      const pair = (t.t === "id" || t.t === "str" || t.t === "num") && isP(next, ":");
      const short = t.t === "id" && (isP(next, ",") || isP(next, "}"));
      if (short && !KEYWORDS.has(t.v)) keyRules(t.v, i, false);
      else if (isP(t, "[")) { no("js : clé calculée interdite dans un objet ({ [k]: … }) : écris la clé en clair"); continue; }
      else if (pair && t.t === "num") { no(`js : clé numérique interdite dans un objet (« ${t.v} ») : une liste s'écrit [ … ]`); continue; }
      else if (!pair && !isP(t, "}")) { no(`js : objet : seulement des paires clé: valeur (ni méthode, ni get/set, près de « ${t.v} »)`); continue; }
    }
    if (t.t === "str") {
      if (t.v.length > 80) no(`js : chaîne de plus de 80 caractères (« ${t.v.slice(0, 30)}… »)`);
      if (/<|:\/\/|url\s*\(/i.test(t.v)) no(`js : chaîne interdite (« ${t.v.slice(0, 40)} ») : ni <, ni adresse, ni url(`);
      if (BANNED_NAMES.test(t.v.trim())) no(`js : nom interdit dans une chaîne (« ${t.v} »)`);
      else if (DOM_NAMES.has(t.v.trim()) || (BANNED.has(t.v.trim()) && !CSS_WORDS.has(t.v.trim()))) no(`js : nom interdit dans une chaîne (« ${t.v} ») : une chaîne ne nomme ni le DOM, ni GSAP, ni un mot interdit`);
      // gsap tire au sort derrière "random(…)" et stagger from: "random" : deux rendus différeraient.
      if (/random|shuffle/i.test(t.v)) no(`js : chaîne « ${t.v.slice(0, 30)} » interdite : aucun hasard dans un moment (ni random, ni shuffle)`);
      if (keyPos(i)) keyRules(t.v, i, true);
      continue;
    }
    if (t.t === "num") continue;
    if (t.t === "p") {
      if (t.v === "[") checkIndex(toks, i, kinds, par, safe, no);
      if (t.v === "?." && (isP(next, "(") || isP(next, "["))) no("js : ?.( et ?.[ interdits");
      if ((t.v === "++" || t.v === "--") && isId(next) && isP(toks[i + 2], ".")) no("js : ++ et -- seulement sur une variable ou un champ x, y, w, h, t, d, v");
      if (t.v === "=" && isP(prev, "}")) no("js : affectation par décomposition interdite ({ … } = …)");
      if (t.v === "=" && isP(prev, "]")) {
        // a[i] = … (un élément de tableau) est permis ; [a.b, c] = … (décomposition) seulement en déclaration.
        const o = opening(toks, i - 1), before = toks[o - 1];
        const member = before && ((before.t === "id" && !KEYWORDS.has(before.v)) || isP(before, ")") || isP(before, "]"));
        if (!member && !(isId(before, "const") || isId(before, "let") || isId(before, "var"))) no("js : affectation par décomposition interdite ([a, b] = …)");
      }
      continue;
    }
    const name = t.v;
    const isProp = isP(prev, ".") || isP(prev, "?.");
    if (/^_/.test(name)) { no(`js : « ${name} » est interdit (aucun nom ne commence par _ : ce sont les internes de GSAP et du moteur)`); continue; }
    if (BANNED.has(name)) { no(`js : « ${name} » est interdit dans un moment`); continue; }
    if (HANDLER.test(name) && name !== "onAccent") { no(`js : « ${name} » est interdit (aucun gestionnaire d'événement)`); continue; }
    if (name === "do" && !isProp) { no("js : boucle do…while interdite"); continue; }
    if (isProp) {
      if (BANNED_CALLS.has(name) && isP(next, "(")) no(["repeat", "padStart", "padEnd"].includes(name) ? `js : .${name}() est interdit (il fabrique des chaînes géantes)` : `js : .${name}() est interdit (le moment ne pilote pas le temps de sa timeline)`);
      const owner = toks[i - 2];
      if (isId(owner, "gsap") && !GSAP_OK.has(name)) no(`js : gsap.${name} est interdit (seulement ${MOMENT_GSAP.map((x) => `gsap.${x}`).join(" et ")} ; les tweens passent par mt ; un moment ne mesure pas le DOM, il reçoit anchors)`);
      if (isId(owner, "utils") && isP(toks[i - 3], ".") && isId(toks[i - 4], "gsap") && !UTILS.has(name)) no(`js : gsap.utils.${name} est interdit (seulement ${MOMENT_UTILS.join(", ")})`);
      if (name === "random" && (isId(owner, "Math") || isP(next, "("))) no("js : random est interdit (rendu déterministe : pas de hasard dans un moment)");
      if (isId(owner, "CustomEase") && name !== "create") no(`js : CustomEase.${name} est interdit`);
      if (isId(owner, "CustomEase") && name === "create") {
        const arg = toks[i + 2];
        if (!(arg && arg.t === "str" && arg.v.startsWith(`m${id}-`))) no(`js : CustomEase.create("m${id}-nom", "…") : le nom d'une courbe commence par m${id}-`);
      }
      // Liste fermée des membres (revue 1) : tout autre nom, DOM ou GSAP, est refusé.
      if (METHODS.has(name)) { if (!isP(next, "(")) no(`js : .${name} s'appelle toujours (.${name}(…)), jamais lue comme valeur`); }
      else if (PROPS.has(name)) { if (assignAfter(i) && !ASSIGNABLE.has(name)) no(`js : .${name} est en lecture seule (seuls les champs ${MOMENT_ASSIGNABLE.join(", ")} de tes objets s'écrivent)`); }
      else if (!BANNED_CALLS.has(name) && name !== "random") { no(`js : « .${name} » n'est pas permis après un point`); no(MEMBERS_RULE); }
      continue;
    }
    if (keyPos(i)) { keyRules(name, i, false); continue; }
    if (name === "for") { const l = checkFor(toks, i, no); if (l) loops.push(l); continue; }
    if (KEYWORDS.has(name)) {
      if ((name === "const" || name === "let" || name === "var") && isP(next, "{")) no("js : décomposition d'objet interdite (const { a } = …) : lis les champs un par un");
      if (name === "catch" && isP(next, "(") && isP(toks[i + 2], "{")) no("js : décomposition d'objet interdite (catch ({ … }))");
      continue;
    }
    if (!decl.has(name) && !FREE.has(name)) { no(`js : « ${name} » n'existe pas dans un moment (seuls ${MOMENT.params.join(", ")}, Math et tes propres variables)`); continue; }
    if (!decl.has(name)) {
      // Les globaux permis : appelés, ou suivis d'un point ; jamais réaffectés (Math = … toucherait le moteur).
      if (FREE_CALLS.has(name) && !isP(next, "(") && !(name === "Number" && isP(next, "."))) no(`js : ${name} s'appelle toujours (${name}(…)), jamais passé comme valeur`);
      if (FREE_OWNERS.has(name) && !isP(next, ".")) no(`js : ${name} s'utilise toujours avec un point (${name}.…)`);
      if (!PARAMS.has(name) && (assignAfter(i) || isP(prev, "++") || isP(prev, "--"))) no(`js : ${name} ne se réaffecte pas`);
    }
    if (fnNames.has(name) && !fnSites.has(i) && !isP(next, "(")) no(`js : la fonction « ${name} » s'appelle toujours (${name}(…)), jamais passée comme valeur`);
  }
  // Boucles imbriquées : 2 niveaux au plus, 10 000 tours au plus pour les bornes écrites en chiffres.
  for (const l of loops) {
    const outer = loops.filter((o) => o !== l && o.open < l.open && o.close > l.close);
    if (outer.length >= 2) no("js : trois boucles for imbriquées : deux niveaux au plus");
    const n = [l, ...outer].reduce((p, o) => p * (o.count || 1), 1);
    if (n > 10000) no(`js : boucles imbriquées de ${n} tours (10 000 au plus)`);
  }
  // Le corps doit se lire seul, en mode strict, avec les paramètres de l'enveloppe du moteur, avec et sans le
  // garde-fou que le moteur pose dans chaque boucle et chaque fonction.
  try {
    new Function(...MOMENT.params, ...MOMENT.shadowed, `"use strict";\n${js}`);
  } catch (e) {
    no(`js illisible : ${String(e.message).slice(0, 160)}`);
    return;
  }
  if (why.length) return;
  try {
    new Function(...MOMENT.params, ...MOMENT.shadowed, `"use strict";\nvar __n = 0, __g = function () {};\n${guardJs(js)}`);
  } catch (e) {
    no(`js : le moteur ne peut pas poser son garde-fou (${String(e.message).slice(0, 80)}) : écris les corps de fonction et de boucle entre accolades`);
  }
}

const isAnimated = (name) => ANIMATED.has(name) || BANNED_PROP_PREFIXES.some((p) => name.startsWith(p));

/**
 * for (let i = n; i < N; i++) avec N ≤ 999 ou x.length (le pas va dans le sens de la comparaison), ou
 * for (const x of liste) ; toujours avec des accolades ; le compteur ne change pas dans la boucle et la liste
 * parcourue ne grandit pas. Renvoie { open, close, count } (count : tours si les bornes sont des nombres) ou null.
 */
function checkFor(toks, i, no) {
  const bad = () => { no("js : boucle for non bornée (seulement for (let i = 0; i < N; i++) avec N ≤ 999 ou x.length, ou for (const x of liste))"); return null; };
  if (!isP(toks[i + 1], "(")) return bad();
  const e = closing(toks, i + 1);
  if (e < 0) return bad();
  if (!isP(toks[e + 1], "{")) { no("js : une boucle for a toujours des accolades : for (…) { … }"); return null; }
  const open = e + 1, close = closing(toks, open);
  const h = toks.slice(i + 2, e);
  const vs = h.map((x) => x.v);
  let counter = null, list = null, count = 0;
  if ((vs[0] === "const" || vs[0] === "let") && h[1]?.t === "id" && vs[2] === "of") {
    // for (const x of liste) / for (let x of a.b)
    const rest = h.slice(3);
    if (!(rest.length && rest.every((x, k) => (k % 2 === 0 ? x.t === "id" : isP(x, "."))))) return bad();
    if (rest.length === 1) list = rest[0].v;
  } else {
    if (!(vs[0] === "let" || vs[0] === "var") || h[1]?.t !== "id" || vs[2] !== "=") return bad();
    const v = h[1].v;
    let k = 3, sign = 1;
    if (vs[k] === "-") { sign = -1; k++; }
    if (h[k]?.t !== "num") return bad();
    const n0 = sign * h[k].n;
    k++;
    if (vs[k] !== ";" || vs[k + 1] !== v || !["<", "<=", ">", ">="].includes(vs[k + 2])) return bad();
    const up = vs[k + 2] === "<" || vs[k + 2] === "<=";
    k += 3;
    let N = null;
    if (h[k]?.t === "num" && h[k].n <= 999) { N = h[k].n; k++; }
    else if (h[k]?.t === "id" && vs[k + 1] === "." && vs[k + 2] === "length") { list = h[k].v; k += 3; }
    else return bad();
    if (vs[k] !== ";") return bad();
    const step = vs.slice(k + 1).join(" ");
    let by = 0;
    if ([`${v} ++`, `++ ${v}`].includes(step)) by = 1;
    else if ([`${v} --`, `-- ${v}`].includes(step)) by = -1;
    else if (new RegExp(`^${v} [+-]= \\d+(\\.\\d+)?$`).test(step) && Number(step.split(" ")[2]) > 0) by = (step.split(" ")[1] === "+=" ? 1 : -1) * Number(step.split(" ")[2]);
    else return bad();
    // Le pas va vers la borne : i < N avec i++, i > N avec i-- (sinon la boucle ne finit jamais).
    if (up !== by > 0) return bad();
    if (N !== null) count = Math.max(0, Math.ceil(Math.abs(N - n0) / Math.abs(by)) + 1);
    counter = v;
  }
  for (let k = open + 1; k < close; k++) {
    const t = toks[k];
    if (t.t !== "id" || isP(toks[k - 1], ".") || isP(toks[k - 1], "?.")) continue;
    if (counter && t.v === counter) {
      const n = toks[k + 1], p = toks[k - 1];
      if ((n && n.t === "p" && (ASSIGN_OPS.has(n.v) || n.v === "++" || n.v === "--")) || isP(p, "++") || isP(p, "--")) no(`js : le compteur ${counter} ne se modifie pas dans sa boucle`);
    }
    if (list && t.v === list && isP(toks[k + 1], ".") && isId(toks[k + 2], "push")) no(`js : n'ajoute rien à ${list} pendant que tu le parcours`);
  }
  return { open, close, count };
}

/** Accès calculé x[…] ou clé calculée {[…]: …} : l'index est un nombre, un identifiant numérique, ou une petite somme. */
function checkIndex(toks, i, kinds, par, safe, no) {
  const p = toks[i - 1];
  const member = (p && ((p.t === "id" && !KEYWORDS.has(p.v)) || isP(p, ")") || isP(p, "]") || isP(p, "?.")));
  const computedKey = (isP(p, "{") || isP(p, ",")) && kinds.get(par[i]) === "obj";
  if (!member && !computedKey) return;
  const e = closing(toks, i);
  if (e < 0) return no("js : crochet non fermé");
  // anchors["accroche"] : une chaîne écrite en clair qui a la forme d'un id de temps fort, sur anchors seulement
  // (objet gelé sans prototype) : root["click"] ou el["id"] ne passent pas.
  if (e === i + 2 && toks[i + 1].t === "str" && isId(p, "anchors") && !isP(toks[i - 2], ".") && BEAT_ID.test(toks[i + 1].v)) return;
  // anchors[beats[i].id] : beats et anchors sont gelés par le moteur (anchors sans prototype) ; permis seulement si le
  // code ne les relie jamais à autre chose (chaque mention est suivie de [ ou de .).
  if (isId(p, "anchors") && !isP(toks[i - 2], ".") && readOnly(toks, "anchors") && readOnly(toks, "beats") && isId(toks[i + 1], "beats") && isP(toks[i + 2], "[")) {
    const c = closing(toks, i + 2);
    if (c > 0 && c + 3 === e && isP(toks[c + 1], ".") && isId(toks[c + 2], "id") && indexOk(toks, i + 2, c, safe)) return;
  }
  if (!indexOk(toks, i, e, safe)) no("js : accès calculé x[…] : l'index doit être un nombre, un compteur de boucle ou un index de forEach (± un nombre), jamais une chaîne");
}

/**
 * Le js tel que le moteur l'écrit dans assets/m-<id>.js : un appel __g() au début de chaque corps de boucle et de
 * fonction (et autour du corps d'une flèche sans accolades). __g compte les tours et lance une RangeError au-delà de
 * MOMENT.iterations : une boucle sans fin, une récursion ou une liste qui grandit est attribuée au moment, pas au
 * moteur. Le code de Claude ne peut ni lire ni masquer __g (aucun nom ne commence par _). Lance une erreur si le
 * code ne se découpe pas (checkMoment l'a refusé avant).
 */
export function guardJs(js) {
  const toks = tokenize(js);
  const ins = [];
  for (const f of functionsOf(toks)) {
    if (f.bad) throw new Error("fonction illisible");
    if (f.open !== undefined) ins.push([toks[f.open].e, " __g();"]);
    else {
      const [a, b] = f.expr;
      if (b <= a) throw new Error("flèche sans corps");
      ins.push([toks[a].s, "(__g(), "], [toks[b - 1].e, ")"]);
    }
  }
  for (let i = 0; i < toks.length; i++) {
    if (!isId(toks[i], "for") || isP(toks[i - 1], ".")) continue;
    const e = isP(toks[i + 1], "(") ? closing(toks, i + 1) : -1;
    if (e < 0 || !isP(toks[e + 1], "{")) throw new Error("boucle for sans accolades");
    ins.push([toks[e + 1].e, " __g();"]);
  }
  ins.sort((x, y) => y[0] - x[0]);
  let out = js;
  for (const [pos, text] of ins) out = out.slice(0, pos) + text + out.slice(pos);
  return out;
}

/** Un nom de l'enveloppe jamais relié : chaque mention (hors propriété) est suivie de [ ou de . */
const readOnly = (toks, name) => toks.every((t, k) => !isId(t, name) || isP(toks[k - 1], ".") || isP(toks[k - 1], "?.") || isP(toks[k + 1], "[") || isP(toks[k + 1], "."));

/** L'index entre les crochets ouvrant `i` et fermant `e` est numérique (nombres, compteurs, x.length, + - * % ( ) .). */
function indexOk(toks, i, e, safe) {
  for (let k = i + 1; k < e; k++) {
    const t = toks[k];
    if (t.t === "num") continue;
    if (t.t === "id" && safe.has(t.v) && !isP(toks[k - 1], ".")) continue;
    if (t.t === "id" && t.v === "length" && isP(toks[k - 1], ".") && isId(toks[k - 2])) continue;
    if (t.t === "id" && isP(toks[k + 1], ".") && isId(toks[k + 2], "length")) continue;
    if (t.t === "p" && ["+", "-", "*", "%", "(", ")", "."].includes(t.v)) continue;
    return false;
  }
  return true;
}

// ─── HTML ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const decode = (s) => s.replace(/&(amp|nbsp);/g, " ");

function checkHtml(html, id, why) {
  if (!html) { why.push("html vide"); return; }
  const bad = /\bon[a-z]+\s*=|javascript:|https?:|\/\/[a-z0-9]|<!--|<!|<\?|\bstyle\s*=|\bsrc\s*=|\bhref\s*=|xlink:/i.exec(html);
  if (bad) why.push(`html interdit près de « ${bad[0]} »`);
  for (const m of html.matchAll(/url\s*\(\s*([^)]*)\)/gi)) {
    if (!new RegExp(`^#m${id}-[a-z0-9-]{1,40}$`, "i").test(m[1].trim())) { why.push(`html : url(…) seulement vers un id du moment (url(#m${id}-…))`); break; }
  }
  let tags = 0, texts = 0, pos = 0;
  const textNode = (s) => {
    // Une entité (&lt;, &#60;…) donnerait un caractère que le filtre ne voit pas : seulement &amp; et &nbsp;.
    const ent = /&(?!(amp|nbsp);)[#a-z0-9]*;?/i.exec(s);
    if (ent) why.push(`html : entité « ${ent[0].slice(0, 12)} » interdite dans un texte (seulement &amp; et &nbsp;)`);
    const txt = decode(s).replace(/\s+/g, " ").trim();
    if (!txt) return;
    texts++;
    if (txt.length > CODE.textNode) why.push(`html : texte trop long (« ${txt.slice(0, 30)}… », ${CODE.textNode} caractères au plus : le texte appartient au moteur)`);
  };
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  for (;;) {
    const lt = html.indexOf("<", pos);
    if (lt < 0) { textNode(html.slice(pos)); break; }
    textNode(html.slice(pos, lt));
    re.lastIndex = lt;
    const m = re.exec(html);
    if (!m || m.index !== lt) { why.push(`html illisible près de « ${html.slice(lt, lt + 24)} »`); break; }
    const name = m[2].toLowerCase();
    if (!TAGS.has(name)) why.push(`balise interdite <${m[2]}>`);
    if (!m[1]) {
      tags++;
      for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) checkAttr(a[1], a[3] ?? a[4] ?? a[5] ?? "", id, why);
    } else if (m[3].trim()) why.push(`html : balise fermante </${m[2]}> avec attributs`);
    pos = m.index + m[0].length;
  }
  if (tags > CODE.tags) why.push(`html : ${tags} balises (${CODE.tags} au plus)`);
  if (texts > CODE.textNodes) why.push(`html : ${texts} textes (${CODE.textNodes} au plus, de ${CODE.textNode} caractères : le texte appartient au moteur)`);
}

function checkAttr(rawName, value, id, why) {
  const name = rawName.toLowerCase();
  if (!ATTRS.has(name) && !DATA_ATTR.test(name)) { why.push(`attribut interdit ${rawName}`); return; }
  if (/[<>`&\\]/.test(value)) { why.push(`attribut ${rawName} : caractère interdit dans la valeur`); return; }
  if (name === "id") {
    if (!new RegExp(`^m${id}-[a-z0-9-]{1,40}$`).test(value)) why.push(`id « ${value} » : les ids commencent par m${id}-`);
  } else if (name === "class") {
    if (!value.split(/\s+/).filter(Boolean).every((k) => MOMENT_CLASS.test(k))) why.push(`classe « ${value} » invalide (minuscules, chiffres et tirets)`);
  } else if (name === "fill" || name === "stroke") {
    if (!/^(none|currentcolor)$/i.test(value.trim())) why.push(`${rawName}="${value}" : seulement none ou currentColor (les couleurs passent par le css)`);
  }
}

// ─── CSS ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function checkCss(css, id, why, advice) {
  if (!css) return;
  if (/[^\x20-\x7e\n\r\t]/.test(css)) { why.push("css : seulement de l'ASCII imprimable"); return; }
  const bad = /@|<|\\|["']|\/\*|!\s*important|expression\s*\(|https?:|\/\/|\b(animation|transition)(-[a-z-]+)?\s*:|position\s*:\s*fixed|behavior|-moz-binding|(^|[;{\s])font\s*:/i.exec(css);
  if (bad) why.push(`css interdit près de « ${bad[0].trim()} »`);
  for (const m of css.matchAll(/url\s*\(\s*([^)]*)\)/gi)) {
    if (!new RegExp(`^#m${id}-[a-z0-9-]{1,40}$`).test(m[1].trim())) { why.push(`css : url(…) seulement vers un id du moment (url(#m${id}-…))`); break; }
  }
  // Accolades équilibrées, jamais en dessous de zéro : le css reste enfermé dans #m-<id>{…}.
  let d = 0, start = 0;
  for (let k = 0; k < css.length; k++) {
    const ch = css[k];
    if (ch === "{") {
      d++;
      const sel = css.slice(start, k).split(/[;}]/).pop().trim();
      if (/&|~|\+|:has\b|:root\b|:scope\b|:host\b|::?part\b|::?slotted\b|(^|[\s,>(])(html|body)\b/i.test(sel)) why.push(`css : sélecteur « ${sel.slice(0, 40)} » interdit (ni &, ~, +, :has, :root, html, body : il sortirait du moment)`);
      if (!sel) why.push("css : règle sans sélecteur");
      start = k + 1;
    } else if (ch === "}") {
      if (--d < 0) { why.push("css mal équilibré (accolade fermante en trop)"); break; }
      start = k + 1;
    } else if (ch === ";") start = k + 1;
  }
  if (d > 0) why.push("css mal équilibré (accolade non fermée)");
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]*)/gi)) {
    if (!MOMENT_FONT_FAMILIES.includes(m[1].trim().replace(/\s+/g, ""))) why.push(`css : font-family « ${m[1].trim()} » : seulement var(--font-display), var(--font-body) ou inherit`);
  }
  // Une couleur écrite en clair : un conseil pour la relecture, pas un refus.
  for (const m of css.matchAll(/:\s*([^;{}]*)/g)) {
    const v = m[1];
    const lit = /#[0-9a-f]{3,8}\b/i.exec(v) || /\b(rgba?|hsla?)\(\s*\d/i.exec(v) || NAMED_COLORS.exec(v);
    if (lit) advice.push(`couleur « ${lit[0]} » hors de la palette du projet (utilise var(--accent), var(--ink)…)`);
  }
}

// ─── Entrée ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Le filtre statique d'un moment. `m` = { html, css, js } (réponse de Claude) ou { code: { html, css, js } } (moment
 * gardé dans un plan). `id` = l'id du moment (préfixe de ses ids : m<id>-…). Renvoie { ok: true, code, advice? }
 * (code remis au propre : xmlns retirés, espaces des bords coupés) ou { ok: false, why: [raisons en français] }.
 */
export function checkMoment(m, { id } = {}) {
  id = String(id ?? m?.id ?? "");
  const c = m?.code && typeof m.code === "object" ? m.code : m || {};
  const why = [], advice = [];
  if (!MOMENT_ID.test(id)) return { ok: false, why: [`id de moment invalide « ${id.slice(0, 20)} »`] };
  if ([c.html, c.css, c.js].some((x) => x != null && typeof x !== "string")) return { ok: false, why: ["code illisible (html, css et js sont des chaînes)"] };
  // Un svg posé dans une page n'a pas besoin de son espace de noms, que les modèles ajoutent par habitude.
  const html = String(c.html ?? "").replace(/\s+xmlns(:[\w-]+)?\s*=\s*("[^"]*"|'[^']*')/gi, "").trim();
  const css = String(c.css ?? "").trim(), js = String(c.js ?? "").trim();
  if (html.length > CODE.html || css.length > CODE.css || js.length > CODE.js) {
    return { ok: false, why: [`code trop long (html ${html.length}/${CODE.html}, css ${css.length}/${CODE.css}, js ${js.length}/${CODE.js})`] };
  }
  checkHtml(html, id, why);
  checkCss(css, id, why, advice);
  checkJs(js, id, why);
  if (why.length) return { ok: false, why: [...new Set(why)].slice(0, 12) };
  return advice.length ? { ok: true, code: { html, css, js }, advice: [...new Set(advice)].slice(0, 6) } : { ok: true, code: { html, css, js } };
}

/**
 * Tous les moments d'un plan : checkMoment sur chacun, puis le budget commun (CODE.total caractères pour tous les
 * moments ; au-delà, les derniers sont refusés). Renvoie { kept: [moment avec code nettoyé], refused: [{ id, brief,
 * why }], advice: { [id]: string[] } }. Un moment sans code n'est ni gardé ni refusé (rien à construire).
 */
export function checkMoments(moments = []) {
  const kept = [], refused = [], advice = {};
  let total = 0;
  for (const m of Array.isArray(moments) ? moments : []) {
    if (!m || (!m.code && m.html == null && m.js == null)) continue;
    const r = checkMoment(m, { id: m.id });
    if (!r.ok) { refused.push({ id: m.id, brief: m.brief || "", why: r.why }); continue; }
    const size = r.code.html.length + r.code.css.length + r.code.js.length;
    if (total + size > CODE.total) { refused.push({ id: m.id, brief: m.brief || "", why: [`code des animations trop long (${CODE.total} caractères pour tous les moments)`] }); continue; }
    total += size;
    if (r.advice) advice[m.id] = r.advice;
    const rest = omit(m, ["html", "css", "js"]);
    kept.push({ ...rest, code: r.code });
  }
  return { kept, refused, advice };
}
