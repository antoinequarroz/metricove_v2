// Scènes libres du reel animé : pour une scène qui porte une consigne d'animation (`anim`), Claude écrit lui-même
// la scène HyperFrames (HTML, CSS et timeline GSAP). Le worker vérifie ce code avant de l'assembler dans la page,
// et toute scène refusée ou qui plante retombe sur l'animation standard.
import vm from "node:vm";
import { ask } from "./claude.mjs";
import { log } from "./util.mjs";

const MAX_HTML = 20_000, MAX_CSS = 12_000, MAX_JS = 15_000;

const SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          html: { type: "string" },
          css: { type: "string" },
          js: { type: "string" },
        },
        required: ["index", "html", "css", "js"],
      },
    },
  },
  required: ["scenes"],
};

/**
 * Vérifie le code d'une scène libre. Renvoie { html, css, js } ou une chaîne qui dit pourquoi il est refusé.
 * Le code doit rester dans sa scène (#sN), ne rien charger du réseau et être déterministe (rendu image par image).
 */
export function checkArt(art, i) {
  // Les attributs xmlns du SVG ne chargent rien : ils sont retirés avant la vérification des liens.
  const html = String(art?.html || "").replace(/\sxmlns(:[\w-]+)?\s*=\s*("[^"]*"|'[^']*')/g, "").trim(), css = String(art?.css || "").trim(), js = String(art?.js || "").trim();
  if (!html && !js) return "scène vide";
  if (html.length > MAX_HTML || css.length > MAX_CSS || js.length > MAX_JS) return "code trop long";
  if (/<\s*(script|iframe|object|embed|link|meta|style|base|form)\b|\bon[a-z]+\s*=|javascript:|https?:|\/\/[a-z0-9-]+\.[a-z]/i.test(html)) return "HTML interdit (script, lien externe ou gestionnaire d'événement)";
  if (/@|https?:|expression\s*\(|<\/?\s*(style|script)|\b(animation|transition)\s*:|url\(\s*["']?(?!data:)/i.test(css)) return "CSS interdit (@règle, lien externe, animation CSS)";
  const scope = new RegExp(`^#s${i}(?![\\w-])`);
  for (const rule of css.split("}")) {
    const sel = rule.split("{")[0].trim();
    if (!rule.includes("{")) { if (sel) return "CSS mal formé"; continue; }
    if (!sel || sel.split(",").some((x) => !scope.test(x.trim()))) return `CSS qui sort de la scène (${sel.slice(0, 60)})`;
  }
  if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|import|eval|Function|setTimeout|setInterval|requestAnimationFrame|Date|localStorage|sessionStorage|indexedDB|navigator|location|cookie)\b|Math\.random|https?:|window\s*\.|document\.(?!create(Element|ElementNS|TextNode)\b)/.test(js)) return "JS interdit (réseau, minuterie, hasard ou accès hors de la scène)";
  if (/<\/\s*script/i.test(js)) return "JS interdit (balise script)";
  try {
    new vm.Script(`(function(tl,root,T,D,gsap){\n${js}\n})`);
  } catch (e) {
    return `JS invalide (${e.message})`;
  }
  return { html, css, js };
}

/** Contexte donné à Claude pour une scène : place, couleurs, police, minutage. */
function brief(s, i, ctx) {
  const c = ctx.colors(i);
  return `SCÈNE ${i} (conteneur #s${i} .art)
- Texte : gros texte « ${s.title || "(aucun)"} » ; petit texte « ${s.body || "(aucun)"} ».
- Consigne d'animation d'Antoine : ${s.anim}
- Couleurs de cette scène : fond ${c.bgLabel} (déjà peint), texte ${c.ink}, texte secondaire ${c.sub}, couleur de marque ${c.mark}.
- Timeline : la scène est révélée à T (la transition d'entrée couvre T-0,3 → T+0,3) et reste D = ${ctx.durs[i].toFixed(2)} s. Toutes tes animations se jouent entre T et T+D-0,45 ; ${i < ctx.n - 1 ? "à T+D-0,42 le worker efface .art avant la scène suivante." : "c'est la dernière scène : laisse un état final propre, il reste à l'écran."}`;
}

/**
 * Demande à Claude le code des scènes libres. `ctx` : { look, fonts: { display, body }, colors(i), durs, n }.
 * Renvoie { [index]: { html, css, js } } avec seulement les scènes acceptées, et des notes pour Antoine.
 */
export async function writeArts(cfg, motion, ctx, cwd) {
  const wanted = motion.scenes.map((s, i) => (s.anim ? i : -1)).filter((i) => i >= 0);
  const arts = {}, notes = [];
  if (!wanted.length) return { arts, notes };
  const palette = ctx.look.fields?.length ? ` Autres couleurs du projet, si besoin : ${ctx.look.fields.map((x) => `${x.bg}/${x.ink}`).join(", ")}.` : "";
  const prompt = `Tu es motion designer. Tu écris des scènes animées pour un reel vertical 1080 × 1920 px à 30 i/s, rendu par HyperFrames : une page HTML dont une timeline GSAP 3 (en pause) est parcourue image par image. Écris le code des scènes ci-dessous en suivant la consigne d'animation de chacune.

CE QUE LE WORKER FAIT DÉJÀ (ne le refais pas) : le fond de la scène, la transition d'entrée, la barre de progression en haut (y 170 px), la signature/logo en bas (vers y 1500 px), l'effacement de sortie. Ta scène vit dans un conteneur vide <div class="art"> en position absolue sur toute la scène (0,0 → 1080,1920), au-dessus du fond.

RÈGLES DE CONTENU
- Le gros texte et le petit texte de la scène doivent apparaître tels quels (sans faute, sans ajout), lisibles, sauf si la consigne dit clairement autre chose. Le gros texte est grand (90 à 200 px selon sa longueur) et ne déborde jamais.
- Mise en page : regroupe les textes dans un bloc en flex colonne (avec un gap) positionné dans la zone sûre, pour qu'un titre qui passe sur plusieurs lignes pousse le texte suivant au lieu de le chevaucher. Un texte ne passe jamais sous un autre.
- Zone sûre : tout texte et tout élément important entre x 90 et 990, et entre y 280 et 1450. Le décor peut déborder.
- Polices disponibles (déjà chargées) : titres "${ctx.fonts.display}", textes "${ctx.fonts.body}". Aucune autre police.
- Couleurs : celles de la scène.${palette} Rien d'autre que des nuances (opacité) de ces couleurs.
- Formes et illustrations : HTML, CSS et SVG en ligne uniquement. Aucune image, aucun fichier, aucun lien externe.

RÈGLES TECHNIQUES (le code qui ne les suit pas est refusé et la scène retombe sur l'animation standard)
- "html" : le contenu de .art (pas de <script>, <style>, <link>, ni attribut on…=).
- "css" : chaque sélecteur commence par #sN (N = numéro de la scène), par ex. "#s2 .livre{…}". Aucune @règle (@keyframes, @media, @import…), aucune propriété animation ou transition : tout le mouvement passe par GSAP. Positionne en px.
- "js" : le corps d'une fonction (tl, root, T, D, gsap). root = l'élément .art de la scène ; tl = la timeline principale ; T et D comme indiqué pour chaque scène. Chaque tween est placé dans tl avec une position absolue, par ex. tl.to(root.querySelector(".x"), {y: 0, duration: 0.6, ease: "expo.out"}, T + 0.2). Utilise root.querySelector / root.querySelectorAll, jamais une recherche dans tout le document.
- États de départ : gsap.set(...) au début du code (sinon tout est visible dès la première image). Pour un fromTo, ajoute immediateRender:false.
- Rendu image par image, donc déterministe : pas de Math.random (utilise un pseudo-hasard fixe, par ex. ((k * 9301 + 49297) % 233280) / 233280), pas de Date, pas de setTimeout/setInterval/requestAnimationFrame, pas de fetch, pas d'accès à window. Tu peux créer des éléments avec document.createElement et les ajouter à root.
- Au plus 150 éléments par scène. Des courbes vives (expo.out, back.out(1.6), power3.inOut), des mouvements qui ont du sens, rien qui clignote.
- Tout se termine avant T + D - 0,45.

${motion.scenes.map((s, i) => (s.anim ? brief(s, i, ctx) : "")).filter(Boolean).join("\n\n")}

Réponds uniquement avec le JSON demandé : une entrée par scène ci-dessus, avec son "index".`;

  let res;
  try {
    log(`scènes libres demandées à Claude : ${wanted.join(", ")}`);
    res = await ask(cfg, prompt, SCHEMA, cwd);
  } catch (e) {
    notes.push(`Animation libre indisponible (${e.message}) : animation standard pour toutes les scènes.`);
    return { arts, notes };
  }
  for (const art of Array.isArray(res?.scenes) ? res.scenes : []) {
    const i = Number(art?.index);
    if (!wanted.includes(i) || arts[i]) continue;
    const ok = checkArt(art, i);
    if (typeof ok === "string") notes.push(`Scène ${i + 1} : code refusé (${ok}), animation standard.`);
    else arts[i] = ok;
  }
  for (const i of wanted) if (!arts[i] && !notes.some((x) => x.startsWith(`Scène ${i + 1} `))) notes.push(`Scène ${i + 1} : Claude n'a pas écrit d'animation, animation standard.`);
  return { arts, notes };
}
