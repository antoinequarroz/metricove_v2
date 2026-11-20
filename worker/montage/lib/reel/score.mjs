// Partition d'un reel vidéo continu : normaliser ce que Claude (ou la page, ou la relecture) a écrit, caler les temps,
// relever ce qui mérite une relecture, ouvrir un passage pour une retouche et fusionner la retouche. JS pur, sans
// disque ni réseau, en quelques millisecondes. Les temps suivent exactement la formule de src/lib/montage.ts
// (reelBeatSeconds, videoTimeline) : la timeline de la page tombe sur les mêmes images que la vidéo.
import {
  ACTORS, BEAT_ID, BRIDGES, BUDGETS, CAMERAS, DEFAULTS, ENGINE_NEW, ENGINES, FIELDS, FINDING_CODES, FPB, FPB_RANGE, FPS,
  LAYOUTS, LIST_ITEMS, MOMENT, MOMENT_ID, PACES, QUANTUM, RULES, SCREENS, SHAPES, SIG_BRIDGES, SIG_LAYOUTS, SIG_MIN_BEATS,
  SIG_PACE_FPB, SOURCES, SURFACES, TARGETS, TIMING, VIDEO, ZONE_FRAMES, ZONES, INFO, beatSeconds, countWords, minSeconds,
  quantize, settleAt,
} from "./vocab.mjs";

/** Engine 2 : les images par temps de musique d'une vidéo (fpb), ou 0 pour engine 1. */
export const fpbOf = (video) => (Number(video?.engine) === 2 && Number.isInteger(video?.fpb) && video.fpb >= FPB_RANGE[0] && video.fpb <= FPB_RANGE[1] ? video.fpb : 0);
/** Engine 2 : les scènes qui ont besoin de leurs items (sinon une autre mise en page, avec une note). */
const NEEDS_ITEMS = { slot: "hero", cards: "stack", bubbles: "stack", wall: "hero" };
/** Engine 2 : la durée plancher d'une scène (en secondes), le temps que sa chorégraphie se joue. */
export function sigFloor(b, fpb) {
  const m = SIG_MIN_BEATS[b.layout] || SIG_MIN_BEATS.stack;
  const n = Array.isArray(b.items) ? b.items.length : 0;
  return Math.min(VIDEO.seconds[1], (Math.ceil(m[0] + m[1] * n) * fpb) / FPS);
}

/** Copie superficielle d'un objet sans certaines clés. */
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Un nombre de secondes à la française pour les notes d'Antoine : « 7,4 », « 15 ». */
export const frSec = (n) => { const s = (Math.round(Number(n) * 10) / 10).toFixed(1); return s.endsWith(".0") ? s.slice(0, -2) : s.replace(".", ","); };
const frNum = (n) => String(n).replace(".", ",");
const pick = (v, among) => (among.includes(v) ? v : undefined);
/** Pictogrammes (emoji) et sélecteurs de variante : jamais à l'écran (la police ne les a pas). */
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const EMOJI_ONE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/u;

/** Un texte d'une ligne : contrôles retirés, espaces regroupés (les espaces insécables restent), coupé à `max`. */
function line(v, max) {
  return String(v ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, "")
    .replace(/[\t\n\r ]+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
/** Un texte affiché à l'écran : comme line(), sans emoji. `fix` est appelé si des emoji ont été retirés. */
function screen(v, max, fix) {
  const raw = line(v, max * 2);
  const had = EMOJI_ONE.test(raw);
  const out = (had ? raw.replace(EMOJI, "").replace(/ {2,}/g, " ").trim() : raw).slice(0, max).trim();
  if (fix && had) fix();
  return out;
}

/** Un mot sans casse, accent ni ponctuation (pour comparer les mots de deux textes). */
export const bare = (w) => String(w).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
/** Les mots d'un texte (séparés par des espaces, insécables comprises), en forme nue, sans les vides. */
const bareWords = (s) => String(s ?? "").split(/[\s  ]+/).map(bare).filter(Boolean);

/** L'emphase est-elle une suite de mots de text (en forme nue) ? */
export function emphasisIn(text, emphasis) {
  const t = bareWords(text), e = bareWords(emphasis);
  if (!e.length) return false;
  for (let i = 0; i + e.length <= t.length; i++) if (e.every((w, k) => t[i + k] === w)) return true;
  return false;
}
/** Un nombre écrit dans le texte (layout number avec count). */
export const hasNumber = (text) => /\d/.test(String(text ?? ""));
/** Un mot commun (forme nue, au moins 3 lettres) entre deux textes : le mot porté par la liaison carry, ou null. */
export function commonWord(a, b) {
  const right = new Set(bareWords(b).filter((w) => w.length >= RULES.carryMinLetters));
  return bareWords(a).find((w) => w.length >= RULES.carryMinLetters && right.has(w)) ?? null;
}

/** Id d'un temps fort : minuscules sans accents, chiffres et tirets, commence par une lettre, 24 caractères au plus. */
function beatId(v, i) {
  const s = String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/^[^a-z]+/, "").replace(/-{2,}/g, "-")
    .slice(0, 24).replace(/-+$/, "");
  return BEAT_ID.test(s) ? s : `t${i + 1}`;
}
/** Id d'un moment : minuscules et chiffres, commence par une lettre, 12 caractères au plus. */
function momentId(v, i) {
  const s = String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").replace(/^[^a-z]+/, "").slice(0, 12);
  return MOMENT_ID.test(s) ? s : `m${i + 1}`;
}
/** Rend `id` unique dans `taken` (id-2, id-3… ; pour un moment, sans tiret). */
function unique(id, taken, dash = true, max = 24) {
  if (!taken.has(id)) { taken.add(id); return id; }
  for (let n = 2; ; n++) {
    const suffix = dash ? `-${n}` : String(n);
    const c = id.slice(0, max - suffix.length) + suffix;
    if (!taken.has(c)) { taken.add(c); return c; }
  }
}

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

/**
 * Un temps fort remis au propre (champs bornés, listes forcées). `fix` reçoit les corrections en français.
 * Renvoie null si le temps fort n'a pas de texte.
 */
function cleanBeat(b, i, fix, sig = false) {
  if (!b || typeof b !== "object") return null;
  const L = sig ? SIG_LAYOUTS : LAYOUTS;
  const label = line(b.title, FIELDS.beatTitle) || line(b.text, FIELDS.beatTitle) || `Temps fort ${i + 1}`;
  let emoji = false;
  const text = screen(b.text, FIELDS.text, () => (emoji = true));
  if (!text) { fix(`Temps fort « ${label} » sans texte : retiré.`); return null; }
  const out = { id: b.id, title: screen(b.title, FIELDS.beatTitle, () => (emoji = true)) || screen(text, FIELDS.beatTitle), text };
  const sub = screen(b.sub, FIELDS.sub, () => (emoji = true));
  let layout = pick(b.layout, L);
  if (!layout) { if (b.layout !== undefined) fix(`Temps fort « ${label} » : mise en page « ${line(b.layout, 20)} » inconnue, ${DEFAULTS.layout} à la place.`); layout = DEFAULTS.layout; }
  // Les items gardés, avec leur place d'origine : pick (engine 2) désigne un item de la liste écrite, vides compris.
  const keptItems = (Array.isArray(b.items) ? b.items : []).map((x, at) => ({ t: screen(x, FIELDS.item, () => (emoji = true)), at })).filter((x) => x.t).slice(0, LIST_ITEMS[1]);
  const items = keptItems.map((x) => x.t);
  if (layout === "list" && items.length < LIST_ITEMS[0]) { fix(`Temps fort « ${label} » : une liste a besoin de ${LIST_ITEMS[0]} éléments au moins, mise en page pile à la place.`); layout = "stack"; }
  if (sig && NEEDS_ITEMS[layout] && items.length < LIST_ITEMS[0]) { fix(`Temps fort « ${label} » : cette scène a besoin de ${LIST_ITEMS[0]} éléments au moins, une autre mise en page à la place.`); layout = NEEDS_ITEMS[layout]; }
  if (sig && layout === "number" && !hasNumber(text)) { fix(`Temps fort « ${label} » : aucun nombre dans le texte, mise en page héros à la place.`); layout = "hero"; }
  if (sub) out.sub = sub;
  if (layout === "list" || (sig && ["slot", "phone", "cards", "bubbles", "wall"].includes(layout) && items.length)) out.items = items;
  let emphasis = screen(b.emphasis, FIELDS.emphasis, () => (emoji = true));
  if (emphasis && !emphasisIn(text, emphasis)) { fix(`Temps fort « ${label} » : l'emphase « ${emphasis} » n'est pas dans le texte, retirée.`); emphasis = ""; }
  if (emphasis) out.emphasis = emphasis;
  if (b.count === true && layout === "number") {
    if (hasNumber(text)) out.count = true;
    else fix(`Temps fort « ${label} » : rien à compter dans le texte, le compteur est retiré.`);
  }
  out.layout = layout;
  for (const [k, among, def, word] of [["bridge", sig ? SIG_BRIDGES : BRIDGES, DEFAULTS.bridge, "liaison"], ["actor", ACTORS, DEFAULTS.actor, "forme"], ["camera", CAMERAS, DEFAULTS.camera, "caméra"]]) {
    const v = pick(b[k], among);
    if (!v && b[k] !== undefined) fix(`Temps fort « ${label} » : ${word} « ${line(b[k], 20)} » inconnue, ${def} à la place.`);
    out[k] = v ?? def;
  }
  if (sig) {
    // Engine 2 : la couleur de fond, l'écran du téléphone, l'option choisie, le mot du bouton, du tampon ou de la marque.
    out.surface = pick(b.surface, SURFACES) ?? "base";
    if (layout === "phone") out.screen = pick(b.screen, SCREENS) ?? (items.length ? "app" : "feed");
    const p = num(b.pick);
    const at = Number.isInteger(p) ? keptItems.findIndex((x) => x.at === p) : -1;
    if (layout === "phone" && out.screen === "app" && at >= 0) out.pick = at;
    const tag = screen(b.label, FIELDS.label, () => (emoji = true));
    if (tag && ["phone", "cards", "cta"].includes(layout)) out.label = tag;
  }
  const s = num(b.seconds);
  out.seconds = Number.isFinite(s) ? clamp(s, VIDEO.seconds[0], VIDEO.seconds[1]) : 0;
  // La phrase dite par la voix off (worker 0.19.0) : du texte simple, sans saut de ligne ni emoji, 300 caractères au plus.
  const say = typeof b.say === "string" ? b.say.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (say) out.say = say;
  // (avant fixed : fitVoice ajoute fixed après say, le JSON d'un temps fort reste le même d'une version à l'autre)
  if (b.fixed === true && Number.isFinite(s)) out.fixed = true;
  if (b.cut === true) out.cut = true;
  if (emoji) fix(`Temps fort « ${label} » : emoji retirés (jamais à l'écran).`);
  return out;
}

/**
 * Normalise une partition. `raw` = la réponse de Claude (SCORE_SCHEMA : moments avec html/css/js à plat) ou une
 * ReelVideo (moments avec code). Options : `target` (15|30|45|60 ; absent = celui de base ; null = aucune mise à
 * l'échelle, la cible de base reste dans l'en-tête), `pace` (rythme imposé), `base`
 * (la ReelVideo d'avant : relecture, retouche, édition), `seed` (uint32 calculé par l'appelant ; sinon celui de base),
 * `request`, `source`, `direction` (la demande du job, sinon celles de base).
 * Renvoie { video, pace, fixes, findings } : `pace` = rythme imposé, sinon celui de Claude, sinon normal.
 * Lève une Error (message en français) si la partition est inexploitable : moins de 3 temps forts valides écrits
 * (sans base) ou moins de 2 gardés.
 */
export function cleanScore(raw, { target, pace, base, seed, request, source, direction, engine, fpb: fpbIn } = {}) {
  const fixes = [];
  const fix = (s) => { if (!fixes.includes(s)) fixes.push(s); };
  raw = raw && typeof raw === "object" ? raw : {};
  const rhythm = pick(pace, PACES) ?? pick(raw.pace, PACES) ?? "normal";
  // Le moteur : celui de la base (relecture, retouche, édition), sinon celui demandé, sinon celui de la partition.
  const eng = [base?.engine, engine, raw.engine].map(Number).find((e) => ENGINES.includes(e)) ?? ENGINE_NEW;
  const sig = eng === 2;
  // Engine 2 : la grille du tempo (images par temps de musique), celle du rythme sauf si l'appelant en impose une.
  // Celle imposée par l'appelant, sinon celle de la base (relecture, retouche, édition), sinon celle de Claude.
  const okFpb = (v) => v !== null && v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) >= FPB_RANGE[0] && Number(v) <= FPB_RANGE[1];
  let fpb = sig ? Number([fpbIn, base?.fpb, raw.fpb].find(okFpb) ?? FPB[rhythm]) : 0;
  // Rythme imposé, partition neuve : la grille de Claude doit être une grille de ce rythme (sinon la lecture suivrait
  // le rythme imposé, la musique et les gestes un autre tempo). Une base garde sa grille : sa musique y est calée.
  const imposed = pick(pace, PACES);
  if (sig && imposed && !okFpb(fpbIn) && !okFpb(base?.fpb) && (fpb < SIG_PACE_FPB[imposed][0] || fpb > SIG_PACE_FPB[imposed][1])) {
    fix(`Rythme imposé (${INFO.paces[imposed].label.toLowerCase()}) : grille de ${fpb} images par temps hors de ce rythme, ${FPB[imposed]} à la place.`);
    fpb = FPB[imposed];
  }
  const goal = TARGETS.includes(Number(target)) ? Number(target) : TARGETS.includes(Number(base?.target)) && target === undefined ? Number(base.target) : undefined;

  // ── Temps forts ──
  let list = Array.isArray(raw.beats) ? raw.beats : [];
  if (list.length > VIDEO.beats[1]) { fix(`${list.length - VIDEO.beats[1]} temps fort(s) en trop retiré(s) (${VIDEO.beats[1]} au plus).`); list = list.slice(0, VIDEO.beats[1]); }
  const taken = new Set(), idMap = new Map();
  const beats = [];
  list.forEach((b, i) => {
    const c = cleanBeat(b, i, fix, sig);
    if (!c) return;
    const want = beatId(b.id, i);
    c.id = unique(want, taken);
    if (c.id !== String(b.id ?? "")) fix(`Temps fort « ${c.title} » : id « ${line(b.id, 30)} » remplacé par « ${c.id} ».`);
    if (!idMap.has(String(b.id ?? ""))) idMap.set(String(b.id ?? ""), c.id);
    beats.push(c);
  });
  if (!base && beats.length < VIDEO.beats[0]) throw new Error(`Claude n'a écrit que ${beats.length} temps fort(s) exploitable(s) (${VIDEO.beats[0]} au moins).`);
  const kept = () => beats.filter((b) => !b.cut);
  if (kept().length < VIDEO.keep) throw new Error("Garde au moins deux temps forts.");

  // ── Liaisons : la première est ignorée, coupes limitées, carry et zoom vérifiés sur le temps fort gardé d'avant ──
  let cuts = 0;
  kept().forEach((b, k, ks) => {
    if (k === 0) return;
    const prev = ks[k - 1];
    // Engine 2 : la liaison de remplacement entre deux fonds différents est un volet (plus bas), la note le dit.
    const soft = () => (sig && b.surface !== prev.surface ? ["wipe", "volet"] : ["morph", "métamorphose"]);
    if (b.bridge === "cut" && ++cuts > RULES.cutsMax) { const [k, w] = soft(); b.bridge = k; fix(`Temps fort « ${b.title} » : plus de ${RULES.cutsMax} coupes sèches, ${w} à la place.`); }
    if (b.bridge === "carry" && !commonWord(prev.text, b.text)) { const [k, w] = soft(); b.bridge = k; fix(`Temps fort « ${b.title} » : aucun mot commun avec le précédent à porter, ${w} à la place.`); }
    if (!sig && b.bridge === "zoom" && !prev.emphasis) { b.bridge = "rise"; fix(`Temps fort « ${b.title} » : la plongée a besoin d'une emphase sur le temps fort d'avant, montée à la place.`); }
    // Engine 2 : montée, métamorphose et mot porté gardent le même fond ; un fond qui change passe par un volet.
    if (sig && ["rise", "morph", "carry"].includes(b.bridge) && b.surface !== prev.surface) b.bridge = "wipe";
  });

  // ── Forme cachée au plus une fois sur deux (engine 1 ; en engine 2, « hidden » veut dire sans marque) ──
  const hiddenMax = Math.floor(kept().length * RULES.hiddenMax);
  let hidden = 0;
  if (!sig) for (const b of kept()) if (b.actor === "hidden" && ++hidden > hiddenMax) { b.actor = "rest"; fix(`Temps fort « ${b.title} » : forme cachée trop souvent, repos à la place.`); }

  // ── Moments ──
  // Les moments invalides sont écartés d'abord ; au-delà de MOMENT.max valides, les derniers partent.
  // Engine 2 : pas de moments (les scènes de la bibliothèque sont les visuels).
  const ms = sig ? [] : (Array.isArray(raw.moments) ? raw.moments : []).slice(0, 4 * MOMENT.max);
  const mTaken = new Set();
  const index = (id) => beats.findIndex((b) => b.id === id);
  let moments = [];
  ms.forEach((m, i) => {
    if (!m || typeof m !== "object") return;
    const brief = line(m.brief, FIELDS.brief) || "Animation sur mesure";
    const id = unique(momentId(m.id, i), mTaken, false, 12);
    let zone = pick(m.zone, ZONES);
    if (!zone) { fix(`Animation « ${brief} » : zone « ${line(m.zone, 20)} » inconnue, ${DEFAULTS.zone} à la place.`); zone = DEFAULTS.zone; }
    const from = idMap.get(String(m.from ?? "")) ?? String(m.from ?? ""), to = idMap.get(String(m.to ?? "")) ?? String(m.to ?? "");
    let a = index(from), z = index(to);
    if (a < 0 || z < 0 || z < a) { fix(`Animation « ${brief} » : temps forts de début ou de fin introuvables, retirée.`); return; }
    if (zone !== "behind" && z - a + 1 > MOMENT.span) { z = a + MOMENT.span - 1; fix(`Animation « ${brief} » : ${MOMENT.span} temps forts au plus, raccourcie.`); }
    const code = m.code && typeof m.code === "object" ? m.code : { html: m.html, css: m.css, js: m.js };
    const big = ["html", "css", "js"].some((k) => typeof code[k] === "string" && code[k].length > 100_000);
    const out = { id, brief, from: beats[a].id, to: beats[z].id, zone };
    if (!big && ["html", "css", "js"].some((k) => typeof code[k] === "string" && code[k])) out.code = { html: String(code.html ?? ""), css: String(code.css ?? ""), js: String(code.js ?? "") };
    else if (big) fix(`Animation « ${brief} » : code démesuré, retiré.`);
    if (m.custom === false) out.custom = false;
    moments.push(out);
  });
  // Au plus un moment devant (above, below, full) et un derrière (behind) par temps fort : le plus tardif est retiré.
  moments = moments
    .map((m, k) => ({ m, k, a: index(m.from), z: index(m.to) }))
    .sort((x, y) => x.a - y.a || x.k - y.k)
    .filter((x, k, all) => {
      const clash = all.slice(0, k).some((o) => o.keep !== false && (o.m.zone === "behind") === (x.m.zone === "behind") && o.a <= x.z && x.a <= o.z);
      if (clash) { fix(`Animation « ${x.m.brief} » : une autre animation occupe déjà ces temps forts, retirée.`); x.keep = false; }
      return !clash;
    })
    .sort((x, y) => x.k - y.k)
    .map((x) => x.m);
  if (moments.length > MOMENT.max) { fix(`${moments.length - MOMENT.max} animation(s) sur mesure en trop retirée(s) (${MOMENT.max} au plus).`); moments = moments.slice(0, MOMENT.max); }
  // Plein cadre : le texte devient un surtitre de 40 caractères au plus ; un texte plus long passe le moment au-dessus.
  for (const m of moments) {
    if (m.zone !== "full") continue;
    const covered = beats.slice(index(m.from), index(m.to) + 1);
    if (covered.some((b) => b.text.length > ZONE_FRAMES.full.maxChars)) { m.zone = "above"; fix(`Animation « ${m.brief} » : texte trop long pour un surtitre, placée au-dessus du texte.`); }
  }

  // ── Forme de marque ──
  let shape = pick(raw.shape, SHAPES) ?? pick(base?.shape, SHAPES);
  if (!shape) { if (raw.shape !== undefined) fix(`Forme « ${line(raw.shape, 20)} » inconnue, rond à la place.`); shape = DEFAULTS.shape; }
  const findings = [];
  if (shape === "none") {
    const carried = moments.some((m) => m.code && beats.slice(index(m.from), index(m.to) + 1).filter((b) => !b.cut).length >= RULES.noneNeedsMomentBeats);
    if (!carried) {
      shape = "orb";
      fix("Sans forme de marque, aucune animation ne relie au moins deux temps forts : le rond relie la vidéo.");
      findings.push({ code: "pas_de_continuite", severity: FINDING_CODES.pas_de_continuite, target: "engine", message: "Forme « aucune » sans animation qui couvre deux temps forts : le rond a été remis pour garder la continuité." });
    }
  }

  // ── Durées : lecture minimale, dernier ≥ 2,5 s, cible, total 15–60 s (engine 2 : plancher de la scène, grille) ──
  const BS = (b, last) => beatSeconds(b, last, rhythm, fpb);
  const readFloor = (b) => Math.max(minSeconds(b, rhythm, sig ? 2 : 1), sig ? sigFloor(b, fpb) : 0);
  if (sig) for (const b of beats) if (!b.fixed) b.seconds = Math.max(b.seconds, sigFloor(b, fpb));
  for (const b of beats) b.seconds = BS(b, false);
  const lastKept = () => kept()[kept().length - 1];
  const sum = () => kept().reduce((t, b, k, ks) => quantize(t + BS(b, k === ks.length - 1)), 0);
  lastKept().seconds = BS(lastKept(), true);
  const free = () => kept().filter((b) => !b.fixed);
  const mins = new Map(beats.map((b) => [b, clamp(readFloor(b), VIDEO.seconds[0], VIDEO.seconds[1])]));
  const floor = (b) => Math.max(mins.get(b), b === lastKept() ? VIDEO.last : 0);
  // La mise à l'échelle se fait une fois : sur la partition de Claude, ou quand la cible change. Déjà à ±15 % de la
  // cible, ou la même cible que la base (relecture, édition) : rien ne bouge, un second passage rend les mêmes temps.
  if (goal && !(base && Number(base.target) === goal) && Math.abs(sum() - goal) > goal * TIMING.tolerance) {
    const fixed = kept().filter((b) => b.fixed).reduce((t, b) => t + b.seconds, 0);
    const loose = free().reduce((t, b) => t + b.seconds, 0);
    if (loose > 0) {
      const want = (goal - fixed) / loose;
      const k = clamp(want, TIMING.scale[0], TIMING.scale[1]);
      const start = sum();
      for (const b of free()) {
        const s = clamp(Math.max(floor(b), b.seconds * k), VIDEO.seconds[0], VIDEO.seconds[1]);
        // Engine 2, à la baisse : au temps de grille le plus proche (BS arrondit au temps suivant : une scène de 6 temps
        // ou moins reprendrait sinon toute sa durée), jamais sous le plancher.
        b.seconds = quantize(sig && k < 1 ? Math.max(floor(b), (Math.round((s * FPS) / fpb) * fpb) / FPS) : s);
      }
      if (sig && k < 1) {
        // Puis un temps à la fois, à la scène qui a le plus de marge au-dessus de son plancher, tant que la vidéo dépasse
        // la cible de plus de 15 %, sans descendre sous ×0,85 de sa durée.
        const step = fpb / FPS, least = start * TIMING.scale[0];
        const at = (b) => BS(b, b === lastKept());
        for (let n = 0; n < 200 && sum() > goal * (1 + TIMING.tolerance) + 1e-9 && sum() - step >= least - 1e-9; n++) {
          const room = free().filter((b) => at(b) - step >= Math.max(floor(b), VIDEO.seconds[0]) - 1e-9).sort((x, y) => (at(y) - floor(y)) - (at(x) - floor(x)));
          if (!room.length) break;
          room[0].seconds = quantize(at(room[0]) - step);
        }
      }
      const got = sum();
      if (Math.abs(got - goal) > goal * TIMING.tolerance) {
        // La vraie raison, dite pour Antoine (les notes sont lues dans le Studio) : l'étirement plafonné (×1,35) ralentirait
        // la vidéo, 10 s au plus par temps fort ; plus longue, c'est toujours le temps de lire (réduction plafonnée à ×0,85).
        // Engine 2, plus longue : le temps de lire seulement si chaque scène libre est à son plancher ; sinon la
        // réduction plafonnée (×0,85).
        const atFloor = !sig || free().every((b) => BS(b, b === lastKept()) - fpb / FPS < Math.max(floor(b), VIDEO.seconds[0]) - 1e-9);
        const why = got < goal
          ? (want > TIMING.scale[1] ? "plus long, le rythme deviendrait lent : ajoute de la matière à la demande" : `${VIDEO.seconds[1]} s au plus par temps fort`)
          : atFloor ? "pour garder le temps de lire tous les textes" : `raccourcie de ${Math.round((1 - TIMING.scale[0]) * 100)} % au plus, pour garder le rythme de la partition`;
        // « seulement » pour une vidéo restée plus courte que la cible ; plus longue, elle « garde » sa durée.
        fix(got < goal ? `Durée visée ${goal} s : ${frSec(got)} s seulement (${why}).` : `Durée visée ${goal} s : la vidéo garde ${frSec(got)} s (${why}).`);
      }
    }
  }
  if (sum() < VIDEO.total[0]) {
    // Trop court : le dernier temps fort tient plus longtemps, puis les autres s'allongent ensemble.
    const before = sum();
    const last = lastKept();
    if (sig) {
      // Engine 2 : la fin (l'appel à l'action) prend d'abord au plus 2 s de plus, puis un temps à la fois va aux scènes
      // libres hors accroche (la fin comprise), les plus chargées d'abord : chacune reste sur la grille, total juste.
      // Une longue fin reste vivante (sig-stage : deux tapes, reflet tous les 2 temps).
      const step = fpb / FPS;
      if (!last.fixed) last.seconds = quantize(Math.min(VIDEO.seconds[1], last.seconds + Math.ceil(Math.min(2, VIDEO.total[0] - before) / step - 1e-6) * step));
      const hook = kept()[0];
      const order = free().filter((b) => b !== hook || kept().length === 1).sort((x, y) => mins.get(y) - mins.get(x));
      for (let n = 0; n < 400 && sum() < VIDEO.total[0] - 1e-9; n++) {
        const room = order.filter((b) => b.seconds + step <= VIDEO.seconds[1] + 1e-9);
        if (!room.length) break;
        const b = room[n % room.length];
        b.seconds = quantize(b.seconds + step);
      }
    } else if (!last.fixed) last.seconds = quantize(Math.min(VIDEO.seconds[1], last.seconds + (VIDEO.total[0] - before)));
    for (let pass = 0; pass < 4 && sum() < VIDEO.total[0]; pass++) {
      const room = free().filter((b) => b.seconds < VIDEO.seconds[1]);
      if (!room.length) break;
      const add = (VIDEO.total[0] - sum()) / room.length;
      for (const b of room) b.seconds = quantize(Math.min(VIDEO.seconds[1], b.seconds + add));
    }
    // L'arrondi à l'image peut laisser quelques images : une image de plus à la fois, sur les temps forts libres
    // (au plus 450 images, soit 15 s), pour tomber juste sur 15 s.
    for (let n = 0; n < 450 && sum() < VIDEO.total[0] - 1e-9; n++) {
      const room = free().filter((b) => b.seconds < VIDEO.seconds[1]);
      if (!room.length) break;
      const b = room[n % room.length];
      b.seconds = quantize(Math.min(VIDEO.seconds[1], b.seconds + QUANTUM));
    }
    // Engine 2 : un temps fort fixé va au temps de la grille le plus proche ; il prend donc des temps entiers (un
    // reste de moins d'un demi-temps serait perdu à l'arrondi et la vidéo resterait sous 15 s).
    const whole = (s) => (sig ? (Math.ceil((s * FPS) / fpb - 1e-6) * fpb) / FPS : s);
    if (sum() < VIDEO.total[0]) for (const b of kept()) if (b.fixed && sum() < VIDEO.total[0]) b.seconds = quantize(Math.min(VIDEO.seconds[1], b.seconds + whole(VIDEO.total[0] - sum())));
    fix(`Vidéo trop courte (${frSec(before)} s) : allongée à ${frSec(sum())} s.`);
  }
  // Les secondes écrites sont celles qui seront rendues : un recalcul sans cible redonne les mêmes temps.
  const written = () => kept().forEach((b, k, ks) => { b.seconds = BS(b, k === ks.length - 1); });
  // Engine 2 : la grille arrondit au temps suivant ; au-delà de 60 s, un temps de moins aux scènes qui ont le plus de
  // marge au-dessus de leur plancher.
  const gridTrim = () => {
    if (!sig) return;
    written();
    for (let n = 0; n < 200 && sum() > VIDEO.total[1] + 1e-9; n++) {
      const step = fpb / FPS;
      const room = free().filter((b) => b.seconds - step >= Math.max(floor(b), VIDEO.seconds[0]) - 1e-9).sort((x, y) => (y.seconds - floor(y)) - (x.seconds - floor(x)));
      if (!room.length) break;
      room[0].seconds = quantize(room[0].seconds - step);
      written();
    }
  };
  if (sum() > VIDEO.total[1]) {
    const before = sum();
    // Trop long : l'excès est pris sur la marge de chaque temps fort libre au-dessus de son temps de lecture, au
    // prorata (les intentions de rythme de Claude restent), jamais en dessous du temps de lecture.
    for (let pass = 0; pass < 8 && sum() > VIDEO.total[1] + 1e-9; pass++) {
      const room = free().filter((b) => b.seconds > floor(b) + 1e-9);
      const margin = room.reduce((t, b) => t + b.seconds - floor(b), 0);
      if (!room.length || margin <= 0) break;
      const over = sum() - VIDEO.total[1];
      for (const b of room) b.seconds = Math.max(floor(b), quantize(b.seconds - (over * (b.seconds - floor(b))) / margin - (pass ? 1 / 30 : 0)));
    }
    gridTrim();
    if (sum() > VIDEO.total[1]) {
      // Encore trop long au temps de lecture : les sous-textes partent, les plus longs d'abord (pas ceux des temps
      // forts fixés : leur durée ne dépend pas de la lecture, la vidéo n'en serait pas plus courte). Engine 2 : seulement
      // les sous-textes montrés (BUDGETS[layout].sub) ; les autres ne comptent pas dans la lecture.
      let gone = 0;
      for (const b of [...kept()].filter((x) => x.sub && x.layout !== "cta" && !x.fixed && (!sig || BUDGETS[x.layout]?.sub)).sort((x, y) => y.sub.length - x.sub.length)) {
        if (sum() <= VIDEO.total[1]) break;
        delete b.sub;
        gone++;
        mins.set(b, clamp(readFloor(b), VIDEO.seconds[0], VIDEO.seconds[1]));
        if (!b.fixed) b.seconds = quantize(floor(b));
      }
      if (gone) fix("Vidéo trop longue : des sous-textes ont été retirés pour tenir 60 s.");
      gridTrim();
    }
    fix(`Vidéo trop longue (${frSec(before)} s) : ramenée à ${frSec(sum())} s au rythme de lecture.`);
  }
  written();

  const video = {
    engine: eng,
    request: line(request ?? base?.request ?? raw.request, FIELDS.request),
    source: pick(source, SOURCES) ?? pick(base?.source, SOURCES) ?? pick(raw.source, SOURCES) ?? DEFAULTS.source,
    ...(goal ? { target: goal } : TARGETS.includes(Number(base?.target)) ? { target: Number(base.target) } : {}),
    ...((direction ?? base?.direction ?? raw.direction) ? { direction: line(direction ?? base?.direction ?? raw.direction, FIELDS.direction) } : {}),
    title: line(raw.title, FIELDS.title) || line(base?.title, FIELDS.title) || line(beats[0].text, FIELDS.title),
    shape,
    beats,
    moments,
  };
  const caption = String(raw.caption ?? base?.caption ?? "").replace(/\r/g, "").trim().slice(0, FIELDS.caption);
  if (caption) video.caption = caption;
  if (sig) {
    video.fpb = fpb;
    // La scène du moment fort (la musique y pose son « drop ») : celle de Claude, sinon celle de la base, si gardée.
    // (un drop absent ou vide n'est pas cherché dans idMap : l'id vide y désigne un temps fort écrit sans id)
    const keptIds = new Set(kept().map((b) => b.id));
    const wrote = typeof raw.drop === "string" && raw.drop ? raw.drop : null;
    const drop = [wrote && (idMap.get(wrote) ?? wrote), base?.drop].find((d) => typeof d === "string" && keptIds.has(d));
    if (drop) video.drop = drop;
  }
  const s = Number.isInteger(seed) ? seed : Number.isInteger(base?.seed) ? base.seed : Number.isInteger(raw.seed) ? raw.seed : 0;
  video.seed = s >>> 0;
  for (const k of ["captions", "voiceOver", "motionStyle"]) if (base?.[k] !== undefined) video[k] = base[k];
  findings.push(...lintScore(video, { pace: rhythm }));
  return { video, pace: rhythm, fixes, findings };
}

/**
 * Cale les temps : start/end sur les temps forts gardés (bout à bout, à l'image), duration = fin du dernier,
 * settle = l'instant où chaque temps fort gardé est posé. Les temps forts coupés n'ont ni start ni end.
 * Renvoie { video (copie), duration, settle }.
 */
export function timeScore(video, { pace = "normal" } = {}) {
  const kept = video.beats.filter((b) => !b.cut);
  const fpb = fpbOf(video);
  let t = 0;
  const settle = [];
  const times = new Map();
  kept.forEach((b, k) => {
    const start = t, end = quantize(t + beatSeconds(b, k === kept.length - 1, pace, fpb));
    times.set(b, [start, end]);
    settle.push(settleAt(start, end - start));
    t = end;
  });
  const beats = video.beats.map((b) => {
    const rest = omit(b, ["start", "end"]);
    const tt = times.get(b);
    return tt ? { ...rest, start: tt[0], end: tt[1] } : rest;
  });
  return { video: { ...video, beats }, duration: t, settle };
}

const finding = (code, target, message, fixHint) => ({ code, severity: FINDING_CODES[code] ?? "review", target, message, ...(fixHint ? { fixHint } : {}) });

/**
 * Ce qui mérite une relecture (severity review) ou une simple note : texte au-delà du budget de sa mise en page,
 * accroche trop longue, monotonie, appel à l'action absent, vidéo trop longue.
 */
export function lintScore(video, { pace = "normal" } = {}) {
  const out = [];
  const kept = (video?.beats || []).filter((b) => !b.cut);
  if (!kept.length) return out;
  for (const b of kept) {
    const budget = BUDGETS[b.layout] || BUDGETS.stack;
    const over = [];
    if (b.text.length > budget.text) over.push(`texte ${b.text.length}/${budget.text}`);
    if (b.sub && budget.sub && b.sub.length > budget.sub) over.push(`sous-texte ${b.sub.length}/${budget.sub}`);
    if (budget.item && (b.items || []).some((x) => x.length > budget.item)) over.push(`élément de liste > ${budget.item}`);
    if (over.length) out.push(finding("texte_trop_long", `beat:${b.id}`, `Temps fort « ${b.title} » : trop long pour la mise en page ${b.layout} (${over.join(", ")}) ; le moteur réduira la taille.`, "Raccourcis le texte ou choisis une mise en page plus grande (stack)."));
  }
  const hook = kept[0];
  const fpb = fpbOf(video);
  const hookSec = beatSeconds(hook, kept.length === 1, pace, fpb);
  // Engine 2 : la scène d'accroche dure au moins le temps de sa chorégraphie (sigFloor, sur la grille) ; ce plancher
  // ne compte pas comme une accroche trop longue (la relecture ne pourrait rien y faire).
  const hookMax = fpb ? Math.max(RULES.hookSeconds, sigFloor(hook, fpb)) : RULES.hookSeconds;
  if (countWords(hook.text) > RULES.hookWords || hookSec > hookMax + 1e-9) out.push(finding("accroche_trop_longue", `beat:${hook.id}`, `L'accroche « ${hook.text} » fait ${countWords(hook.text)} mots et ${frSec(hookSec)} s (${RULES.hookWords} mots et ${fpb ? frSec(hookMax) : frNum(RULES.hookSeconds)} s au plus).`, "Une accroche de 6 mots au plus, lisible avant 0,8 s."));
  for (let k = 0; k + RULES.monotoneLayout <= kept.length; k++) {
    const run = kept.slice(k, k + RULES.monotoneLayout);
    if (run.every((b) => b.layout === run[0].layout)) { out.push(finding("monotone", `beat:${run[0].id}`, `Mise en page « ${run[0].layout} » ${RULES.monotoneLayout} fois de suite : la vidéo risque de faire suite de cartes.`, "Varie les mises en page.")); break; }
  }
  for (let k = 1; k + RULES.monotoneBridge <= kept.length; k++) {
    const run = kept.slice(k, k + RULES.monotoneBridge);
    if (run.every((b) => b.bridge === run[0].bridge)) { out.push(finding("monotone", `beat:${run[0].id}`, `Liaison « ${run[0].bridge} » ${RULES.monotoneBridge} fois de suite.`, "Varie les liaisons (rise, morph, carry, zoom, cut).")); break; }
  }
  const last = kept[kept.length - 1];
  if (last.layout !== "cta") out.push(finding("appel_absent", `beat:${last.id}`, `Le dernier temps fort (« ${last.title} ») n'est pas un appel à l'action.`, "Finis par un temps fort cta avec la signature."));
  const total = kept.reduce((t, b, k) => quantize(t + beatSeconds(b, k === kept.length - 1, pace, fpb)), 0);
  if (total > VIDEO.total[1]) out.push(finding("trop_long", "engine", `La vidéo dure ${frSec(total)} s (${VIDEO.total[1]} s au plus).`, "Moins de temps forts ou des textes plus courts."));
  return out;
}

/** Les temps de chaque temps fort gardé : ceux écrits (start/end) s'ils sont tous là, sinon timeScore. */
function placedBeats(video, pace) {
  const kept = video.beats.filter((b) => !b.cut);
  if (kept.every((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)) return kept;
  return timeScore(video, { pace }).video.beats.filter((b) => !b.cut);
}

/**
 * Les temps forts ouverts à une retouche : ceux qui recoupent le passage `range` = [a, b] de plus de 0,15 s (ou celui
 * du milieu du passage), plus ceux qui contiennent l'instant d'une note dessinée (`marks` = [{ t }]). Sans passage ni
 * note : tous les temps forts gardés. Renvoie des ids, dans l'ordre de la vidéo.
 */
export function openBeats(video, { range, marks, pace = "normal" } = {}) {
  const placed = placedBeats(video, pace);
  const r = Array.isArray(range) && Number(range[1]) > Number(range[0]) ? [Number(range[0]), Number(range[1])] : null;
  const ms = (Array.isArray(marks) ? marks : []).map((m) => Number(m?.t)).filter(Number.isFinite);
  if (!r && !ms.length) return placed.map((b) => b.id);
  const open = new Set();
  const at = (t) => placed.find((b) => t >= b.start && t < b.end) ?? (t >= placed[placed.length - 1].end ? placed[placed.length - 1] : placed[0]);
  if (r) {
    for (const b of placed) if (Math.min(b.end, r[1]) - Math.max(b.start, r[0]) > 0.15) open.add(b.id);
    if (!open.size) open.add(at((r[0] + r[1]) / 2).id);
  }
  for (const t of ms) open.add(at(t).id);
  return placed.filter((b) => open.has(b.id)).map((b) => b.id);
}

const strip = (b) => omit(b, ["start", "end"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fusionne une retouche de Claude (REVISE_SCHEMA : { notes, beats: [remplacement de la plage ouverte, dans l'ordre],
 * moments: [{ id, action: keep|drop|replace|new, … }] }) dans la vidéo. `open` = ids ouverts (openBeats).
 * Les temps forts verrouillés gardent exactement leur JSON (start/end compris : timeScore les recalera). Chaque suite
 * de temps forts ouverts consécutifs est remplacée par les temps forts de la retouche qui lui reviennent (par id, un
 * nouvel id suit le précédent) ; ±2 temps forts au plus. Les moments remplacés ou nouveaux vont dans `fresh` (le
 * filet de rendu les retire en premier). Renvoie { video, changed, ignored: [lignes en français], fresh: Set }.
 * L'appelant repasse ensuite par cleanScore(video, { base }) puis timeScore.
 */
export function mergeRevision(video, rev, open) {
  const openSet = new Set(open || []);
  const ignored = [];
  const fresh = new Set();
  const beats = video.beats;
  const byId = new Map(beats.map((b) => [b.id, b]));
  // Les suites de temps forts ouverts consécutifs (les coupés entre deux ouverts en font partie).
  const runs = [];
  let cur = null;
  beats.forEach((b, i) => {
    if (openSet.has(b.id)) { if (!cur) runs.push((cur = { from: i, to: i, beats: [] })); else cur.to = i; }
    else if (!b.cut || !cur) cur = null;
  });
  const runOf = (id) => runs.find((r) => beats.slice(r.from, r.to + 1).some((b) => b.id === id));
  let last = runs[0];
  let added = 0;
  const limit = 2;
  for (const nb of Array.isArray(rev?.beats) ? rev.beats : []) {
    if (!nb || typeof nb !== "object") continue;
    const id = String(nb.id ?? "");
    if (byId.has(id) && !openSet.has(id)) { ignored.push(`Temps fort « ${byId.get(id).title} » hors du passage : modification de Claude ignorée.`); continue; }
    const run = byId.has(id) ? runOf(id) : last;
    if (!run) { ignored.push("Temps fort proposé hors du passage : ignoré."); continue; }
    if (!byId.has(id)) {
      if (added >= limit) { ignored.push(`Temps fort « ${line(nb.title || nb.text, 40)} » en trop (±${limit} au plus) : ignoré.`); continue; }
      added++;
    }
    run.beats.push(byId.has(id) ? { ...strip(byId.get(id)), ...nb, id } : nb);
    last = run;
  }
  // Un temps fort ouvert absent de la retouche est retiré ; le total change de ±2 au plus.
  const removed = runs.reduce((n, r) => n + beats.slice(r.from, r.to + 1).filter((b) => openSet.has(b.id) && !r.beats.some((x) => String(x.id) === b.id)).length, 0);
  const net = added - removed;
  const out = [];
  let keepBack = net < -limit ? -limit - net : 0;
  beats.forEach((b, i) => {
    const run = runs.find((r) => r.from === i);
    if (run) {
      const slice = beats.slice(run.from, run.to + 1);
      // Rien proposé pour cette suite : elle reste telle quelle.
      if (!run.beats.length && !Array.isArray(rev?.beats)) { out.push(...slice); return; }
      const proposed = run.beats.slice();
      for (const ob of slice) {
        if (!openSet.has(ob.id)) { if (!proposed.some((x) => String(x.id) === ob.id)) proposed.push(ob); continue; }
        if (!proposed.some((x) => String(x.id) === ob.id) && keepBack > 0) { proposed.push(ob); keepBack--; ignored.push(`Temps fort « ${ob.title} » gardé (±${limit} temps forts au plus).`); }
      }
      out.push(...proposed);
      return;
    }
    if (runs.some((r) => i > r.from && i <= r.to)) return;
    out.push(b);
  });
  if (out.filter((b) => !b.cut).length < VIDEO.keep) { ignored.push("La retouche laissait moins de deux temps forts : temps forts inchangés."); out.splice(0, out.length, ...beats); }
  if (out.length > VIDEO.beats[1]) out.splice(VIDEO.beats[1]);

  // Moments : seuls ceux qui touchent un temps fort ouvert peuvent changer.
  const span = (m) => { const a = beats.findIndex((b) => b.id === m.from), z = beats.findIndex((b) => b.id === m.to); return a < 0 || z < 0 ? [] : beats.slice(a, z + 1).map((b) => b.id); };
  const isOpen = (m) => span(m).some((id) => openSet.has(id));
  let moments = (video.moments || []).map((m) => ({ ...m }));
  for (const a of Array.isArray(rev?.moments) ? rev.moments : []) {
    if (!a || typeof a !== "object") continue;
    const id = String(a.id ?? "");
    const at = moments.findIndex((m) => m.id === id);
    const action = a.action;
    if (action === "keep") continue;
    if (action === "new") {
      if (at >= 0) { ignored.push(`Animation « ${id} » existe déjà : nouvelle animation ignorée.`); continue; }
      if (!byOpenSpan(a, out, openSet, byId)) { ignored.push(`Animation « ${line(a.brief, 60)} » hors du passage : ignorée.`); continue; }
      moments.push({ id, brief: a.brief, from: a.from, to: a.to, zone: a.zone, code: { html: a.html ?? "", css: a.css ?? "", js: a.js ?? "" } });
      fresh.add(id);
      continue;
    }
    if (at < 0) { ignored.push(`Animation « ${id} » inconnue : ignorée.`); continue; }
    if (!isOpen(moments[at])) { ignored.push(`Animation « ${moments[at].brief} » hors du passage : modification ignorée.`); continue; }
    if (action === "drop") { moments.splice(at, 1); continue; }
    if (action === "replace") {
      const m = moments[at];
      moments[at] = {
        ...m,
        ...(a.brief ? { brief: a.brief } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
        ...(a.zone ? { zone: a.zone } : {}),
        code: { html: a.html ?? m.code?.html ?? "", css: a.css ?? m.code?.css ?? "", js: a.js ?? m.code?.js ?? "" },
      };
      fresh.add(id);
    }
  }
  moments = moments.filter(Boolean);
  // Engine 2 : la retouche peut déplacer le moment fort (la musique y pose son drop), sur une scène gardée.
  const sigDrop = Number(video.engine) === 2 && typeof rev?.drop === "string" && rev.drop !== video.drop && out.some((b) => b && String(b.id) === rev.drop && !b.cut) ? rev.drop : null;
  const next = { ...video, beats: out, moments, ...(sigDrop ? { drop: sigDrop } : {}) };
  const changed = !same(video.beats.map(strip), out.map((b) => (b && typeof b === "object" ? strip(b) : b))) || !same(video.moments || [], moments) || !!sigDrop;
  return { video: next, changed, ignored, fresh };
}

/** Un nouveau moment doit toucher un temps fort ouvert ou un temps fort que la retouche vient d'ajouter. */
function byOpenSpan(a, beats, openSet, before) {
  const ids = beats.map((b) => String(b.id));
  const i = ids.indexOf(String(a.from)), j = ids.indexOf(String(a.to));
  if (i < 0 || j < 0 || j < i) return false;
  return ids.slice(i, j + 1).some((id) => openSet.has(id) || !before.has(id));
}

/**
 * Applique la correction de la relecture (REVIEW_SCHEMA : { ok, notes, beats: [{ id, text?, sub?, items?, emphasis?,
 * layout?, bridge?, actor?, camera?, seconds? }], moments: [{ id, action: keep|drop|replace, zone?, from?, to?, html?,
 * css?, js? }] }). Les ids inconnus sont ignorés. Renvoie { video, fresh: Set (moments remplacés) }. L'appelant
 * repasse ensuite par cleanScore(video, { base: la version d'avant }).
 */
export function applyReview(video, patch) {
  const fresh = new Set();
  // Engine 2 : la relecture peut aussi changer le fond, l'écran du téléphone, le choix tapé, le libellé et le moment fort.
  const sig = Number(video?.engine) === 2;
  const fields = ["text", "sub", "items", "emphasis", "layout", "bridge", "actor", "camera", "seconds", ...(sig ? ["surface", "screen", "pick", "label"] : [])];
  const beats = video.beats.map((b) => {
    const p = (Array.isArray(patch?.beats) ? patch.beats : []).find((x) => x && x.id === b.id);
    if (!p) return b;
    const out = { ...b };
    for (const k of fields) if (p[k] !== undefined && p[k] !== null) out[k] = p[k];
    // Une durée choisie par la relecture remplace la durée posée à la main ; un champ vidé disparaît.
    if (p.seconds !== undefined) delete out.fixed;
    for (const k of ["sub", "emphasis", ...(sig ? ["label"] : [])]) if (out[k] === "") delete out[k];
    return out;
  });
  let moments = (video.moments || []).map((m) => ({ ...m }));
  for (const a of Array.isArray(patch?.moments) ? patch.moments : []) {
    if (!a || typeof a !== "object") continue;
    const at = moments.findIndex((m) => m.id === a.id);
    if (at < 0) continue;
    if (a.action === "drop") { moments.splice(at, 1); continue; }
    if (a.action === "replace") {
      const m = moments[at];
      moments[at] = {
        ...m,
        ...(a.zone ? { zone: a.zone } : {}),
        ...(a.from ? { from: a.from } : {}),
        ...(a.to ? { to: a.to } : {}),
        code: { html: a.html ?? m.code?.html ?? "", css: a.css ?? m.code?.css ?? "", js: a.js ?? m.code?.js ?? "" },
      };
      fresh.add(a.id);
    }
  }
  const drop = sig && typeof patch?.drop === "string" && beats.some((b) => b.id === patch.drop && !b.cut) ? { drop: patch.drop } : {};
  return { video: { ...video, beats, moments, ...drop }, fresh };
}
