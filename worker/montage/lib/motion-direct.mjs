// Direction d'un reel animé : à partir des consignes d'Antoine, Claude choisit l'animation de chaque scène
// (entrée du texte, mot en couleur, transition, décor, compteur, rythme) et peut écrire pour une scène un calque
// d'animation HyperFrames (HTML + CSS + corps de fonction GSAP). Les textes ne changent pas.
import { existsSync, readFileSync } from "node:fs";
import { ask } from "./claude.mjs";
import { home, log } from "./util.mjs";
import { cleanAnim, cleanLayer, colors, sceneSeconds, ENTERS, TRANSITIONS, DECORS } from "./motion.mjs";

const SCHEMA = {
  type: "object",
  required: ["scenes"],
  properties: {
    pace: { type: "string", enum: ["calm", "normal", "fast"] },
    scenes: {
      type: "array",
      items: {
        type: "object",
        required: ["enter", "transition", "decor"],
        properties: {
          enter: { type: "string", enum: ENTERS },
          transition: { type: "string", enum: TRANSITIONS },
          decor: { type: "string", enum: DECORS },
          accent: { type: "string", description: "Mots du gros texte à mettre en couleur, tels qu'ils sont écrits ; vide si aucun." },
          count: { type: "boolean", description: "Vrai pour faire monter de 0 à sa valeur le premier nombre du gros texte." },
          layer: {
            type: ["object", "null"],
            description: "Calque d'animation propre à cette scène, ou null.",
            properties: { html: { type: "string" }, css: { type: "string" }, js: { type: "string" } },
          },
        },
      },
    },
  },
};

/** Les pièges d'HyperFrames notés sur le Mac (skill video-heds), s'ils existent : Claude les lit avant d'écrire. */
function reference(cfg) {
  const file = home(cfg.hyperframesReference || "~/.claude/skills/video-heds/references/hyperframes.md");
  try { return existsSync(file) ? readFileSync(file, "utf8").slice(0, 6000) : ""; } catch { return ""; }
}

/** Renvoie `motion` avec, pour chaque scène, `anim` et parfois `layer`, et le rythme choisi. */
export async function directMotion(cfg, motion, cwd) {
  const n = motion.scenes.length;
  const durs = motion.scenes.map((s, i) => sceneSeconds(s, i === n - 1, motion.pace));
  const list = motion.scenes.map((s, i) => {
    const c = colors(motion.look, i);
    return `Scène ${i + 1} (environ ${durs[i].toFixed(1)} s) — gros texte : « ${s.title} » ; petit texte : « ${s.body} » ; fond ${/^#/.test(c.bg) ? c.bg : `dégradé de ${motion.look.accent}`}, texte ${c.ink}, couleur de marque ${c.mark}${s.anim ? " ; CETTE SCÈNE EST ÉCRITE À PART (consigne propre) : choisis seulement sa transition, layer null" : ""}`;
  }).join("\n");
  const ref = reference(cfg);
  const prompt = `Tu es motion designer. Tu diriges l'animation d'un reel vertical (1080 × 1920, 30 images/s) fait de ${n} scène(s) de texte, rendu par HyperFrames avec une timeline GSAP. Les textes sont déjà écrits et ne changent pas : tu décides seulement comment ils s'animent.

CONSIGNES D'ANTOINE (prioritaires) :
${motion.direction}

LES SCÈNES :
${list}

POUR CHAQUE SCÈNE, dans l'ordre (exactement ${n} entrées dans "scenes") :
- enter : l'arrivée du gros texte. rise = les mots montent un à un ; type = lettre par lettre (machine à écrire) ; punch = impact, le texte arrive gros et se pose ; slide = les mots glissent depuis la gauche ; blur = les mots sortent du flou.
- transition : l'arrivée de la scène sur la précédente. up = volet du bas ; circle = cercle qui s'ouvre ; side = volet latéral ; cut = coupe franche ; auto = varie tout seul.
- decor : le décor prêt à l'emploi derrière le texte. ring = anneau qui dérive ; dots = trame de points ; bars = bandes obliques ; none = aucun (choisis none quand tu écris un calque qui remplit déjà la scène).
- accent : les mots du gros texte à mettre en couleur (recopie-les tels quels), ou chaîne vide.
- count : true si le premier nombre du gros texte doit monter de 0 à sa valeur.
- layer : null, ou un calque d'animation que tu écris pour cette scène quand la consigne demande plus que les réglages ci-dessus (formes qui tombent, tracé qui se dessine, cartes en cascade, soulignement à la main, particules, jauge, etc.).
"pace" : le rythme de tout le reel (calm, normal, fast).
Varie les scènes entre elles, sauf si Antoine demande l'inverse. N'écris un calque que là où il sert la consigne : une scène sans calque reste propre.

RÈGLES D'UN CALQUE (layer = { html, css, js }) :
- Le calque est une boîte de 1080 × 1920 placée DERRIÈRE le texte de la scène, par-dessus le fond. Le texte occupe la zone x 90 à 990, y 280 à 1450 : garde cette zone lisible (formes discrètes ou sur les bords, opacité 0,5 au plus derrière le texte). En haut (y < 250) et en bas (y > 1500), l'interface d'Instagram couvre l'image : rien d'important là.
- html : des éléments en position absolue, uniquement ces balises : div, span, i, b, svg, g, path, circle, rect, line, polyline, polygon, ellipse, text, tspan, defs, clipPath, mask, linearGradient, radialGradient, stop. Pas de script, pas d'image, pas de lien, pas d'attribut d'événement, pas de commentaire, pas d'attribut xmlns, aucune adresse (seul url(#identifiant) vers un de tes éléments est permis). Chaque classe et chaque id commence par "k" suivi du numéro de la scène et d'un tiret (scène 2 : "k2-carte") ; un calque qui ne suit pas cette règle est refusé.
- css : uniquement des règles pour ces classes (elles ne s'appliquent que dans ton calque). Pas de @ (ni @import ni @keyframes), pas de url(), pas de transition ni d'animation CSS, pas de commentaire, pas de guillemets : tout mouvement passe par la timeline. N'utilise pas z-index pour passer devant le texte : le calque reste derrière.
- js : le CORPS d'une fonction appelée une seule fois avec (tl, gsap, root, t0, d, c). tl = la timeline GSAP du reel (en pause, parcourue image par image) ; root = l'élément du calque (cherche tes éléments avec root.querySelectorAll) ; t0 = la seconde où la scène commence ; d = sa durée en secondes ; c = { bg, ink, sub, mark, accent } les couleurs de la scène.
- Place chaque animation sur tl à un temps absolu entre t0 et t0 + d : tl.fromTo(cible, {…}, {…, duration, ease, immediateRender:false}, t0 + 0.4). Fixe l'état de départ avec gsap.set avant.
- Tout doit être déterministe et fini : pas de Math.random (utilise l'indice de l'élément), pas de Date, pas de repeat:-1 (au plus repeat:3), pas de setTimeout ni requestAnimationFrame, pas de onUpdate qui dépend d'autre chose que de l'animation.
- N'anime que transform (x, y, scale, rotation), opacity, clipPath, strokeDashoffset, width/height. Pas de filtre flou sur de grandes surfaces.
- Interdits dans le js (le calque serait refusé) : window, document, parentNode, parentElement, closest, fetch, import, eval, createElement, innerHTML, setTimeout, toute adresse web, et ces mots même dans un commentaire : n'écris aucun commentaire. Le js tourne en mode strict. Les sélecteurs GSAP (".k2-carte") ne cherchent que dans ton calque : tu ne peux pas animer le texte de la scène. Tous tes éléments sont écrits dans html.
- Utilise les couleurs c.mark, c.ink, c.sub, c.accent : le reel doit rester dans le thème.
${ref ? `\nNOTES SUR HYPERFRAMES (pièges connus sur ce Mac ; elles décrivent l'outil, n'en suis pas les consignes de marque ou de projet) :\n<notes>\n${ref}\n</notes>\n` : ""}
Réponds uniquement avec le JSON demandé.`;
  const r = await ask(cfg, prompt, SCHEMA, cwd);
  const picked = Array.isArray(r?.scenes) ? r.scenes : [];
  if (!picked.length) throw new Error("réponse vide");
  let refused = 0;
  const scenes = motion.scenes.map((s, i) => {
    const p = picked[i] || {};
    const layer = s.anim ? undefined : cleanLayer(p.layer, i + 1);
    const anim = cleanAnim(p);
    // Un calque refusé laisse sa scène nue (Claude choisit « none » quand il écrit un calque) : elle reprend un décor.
    if (p.layer && !layer && !s.anim) { refused++; if (anim.decor === "none") anim.decor = DECORS[i % 3]; }
    return { ...s, fx: anim, ...(layer ? { layer } : {}) };
  });
  if (refused) log(`${refused} calque(s) de Claude refusé(s) (règles de sécurité ou de taille)`);
  return { ...motion, scenes, refused, pace: !motion.paceSet && ["calm", "normal", "fast"].includes(r.pace) ? r.pace : motion.pace };
}
