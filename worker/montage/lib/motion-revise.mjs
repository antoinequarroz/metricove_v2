// Retouche d'un reel animé depuis l'écran de montage : Antoine a regardé une version, sélectionné un passage,
// dessiné des notes ou écrit une demande. Claude modifie le plan du reel (textes, durées, animations, code des
// scènes) ; seules les scènes du passage peuvent changer, les autres sont rendues à l'identique.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask } from "./claude.mjs";
import { log } from "./util.mjs";
import { artContext, cleanAnim, cleanLayer, colors, moveArt, sceneSeconds, ENTERS, TRANSITIONS, DECORS } from "./motion.mjs";
import { LAYER_RULES, reference } from "./motion-direct.mjs";
import { artRules, checkArt } from "./motion-art.mjs";

const SCHEMA = {
  type: "object",
  required: ["notes", "scenes"],
  properties: {
    notes: { type: "string", description: "Une ou deux phrases en français pour Antoine : ce qui a changé." },
    scenes: {
      type: "array",
      description: "Uniquement les scènes modifiées.",
      items: {
        type: "object",
        required: ["id", "title", "body", "mode"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          seconds: { type: "number", description: "Durée à l'écran en secondes ; 0 = durée automatique." },
          cut: { type: "boolean", description: "Vrai pour retirer la scène du reel." },
          enter: { type: "string", enum: ENTERS },
          transition: { type: "string", enum: TRANSITIONS },
          decor: { type: "string", enum: DECORS },
          accent: { type: "string" },
          count: { type: "boolean" },
          mode: { type: "string", enum: ["keep", "standard", "layer", "art"] },
          html: { type: "string" },
          css: { type: "string" },
          js: { type: "string" },
        },
      },
    },
  },
};

/** Les scènes gardées avec leur place dans la vidéo : [{ s, i (numéro parmi les scènes gardées), start, end }]. */
export function placed(plan) {
  const kept = plan.scenes.filter((s) => !s.cut);
  let t = 0;
  return kept.map((s, i) => {
    const d = Number(s.dur) > 0 ? Number(s.dur) : sceneSeconds(s, i === kept.length - 1, plan.pace);
    const start = t;
    t += d;
    return { s, i, start, end: t };
  });
}

/** Écrit les images des notes dessinées dans le dossier de travail : Claude les lit avec Read. */
export function writeReelMarks(job, dir) {
  return (job.marks || []).slice(0, 8).map((m, k) => {
    let file;
    const data = String(m.image || "").match(/^data:image\/(?:jpeg|jpg|png);base64,(.+)$/);
    if (data) {
      file = join(dir, `note-${k + 1}.jpg`);
      writeFileSync(file, Buffer.from(data[1], "base64"));
    }
    return { file, t: Number(m.t) || 0, text: String(m.text || "").slice(0, 1000) };
  });
}

const kindOf = (s) => (s.art ? "scène entière sur mesure (mode art)" : s.layer ? "animation standard avec un calque sur mesure derrière le texte (mode layer)" : "animation standard");

/**
 * Demande à Claude la retouche. `plan` : cleanMotion(...) de la version de départ. `req` : { feedback, marks, range }.
 * Renvoie { plan, notes, fresh } : le plan retouché (à rendre avec renderPlan), ce que Claude dit avoir changé, et les
 * id des scènes dont le code vient d'être écrit.
 */
export async function reviseMotion(cfg, plan, req, cwd) {
  const at = placed(plan);
  const sceneAt = (t) => at.find((x) => t >= x.start - 0.01 && t < x.end) || at.at(-1);
  const range = Array.isArray(req.range) && req.range[1] > req.range[0] ? req.range : null;
  const marks = req.marks || [];
  // Les scènes du passage et celles des notes dessinées : les seules que Claude peut toucher quand il y en a.
  const touched = new Set();
  if (range) for (const x of at) if (Math.min(x.end, range[1]) - Math.max(x.start, range[0]) > 0.15) touched.add(x.s.id);
  if (range && !touched.size) touched.add(sceneAt((range[0] + range[1]) / 2).s.id);
  for (const m of marks) touched.add(sceneAt(m.t).s.id);
  const limited = touched.size > 0;
  const open = (s) => !limited || touched.has(s.id);

  const ctx = artContext(plan);
  const list = at.map(({ s, i, start, end }) => {
    // Une scène libre garde les couleurs de la place pour laquelle elle a été écrite ; son code est montré replacé sur son conteneur actuel.
    const c = colors(plan.look, s.art && Number.isInteger(s.art.at) ? s.art.at : i);
    const fx = cleanAnim(s.fx);
    const cur = s.art ? moveArt(s.art, Number.isInteger(s.art.at) ? s.art.at : i, i) : s.layer;
    const code = open(s) && cur
      ? `\n  CODE ACTUEL (${s.art ? "art" : "layer"}) — html :\n${cur.html}\n  css :\n${cur.css}\n  js :\n${cur.js}`
      : "";
    return `Scène ${i + 1} [id ${s.id}, conteneur #s${i}]${open(s) ? "" : " (NE PAS MODIFIER)"} — de ${start.toFixed(1)} à ${end.toFixed(1)} s (${(end - start).toFixed(1)} s${s.seconds ? ", durée choisie par Antoine" : ""})
  gros texte : « ${s.title} » ; petit texte : « ${s.body} »
  ${kindOf(s)} ; entrée ${fx.enter}, transition ${fx.transition}, décor ${fx.decor}, mots en couleur « ${fx.accent} », compteur ${fx.count ? "oui" : "non"}
  couleurs : fond ${/^#/.test(c.bg) ? c.bg : `dégradé de ${plan.look.accent}`}, texte ${c.ink}, secondaire ${c.sub}, marque ${c.mark}${code}`;
  }).join("\n");
  const cutList = plan.scenes.filter((s) => s.cut).map((s) => `[id ${s.id}] « ${s.title || s.body} »`).join(" ; ");
  const ref = reference(cfg);

  const prompt = `Tu es motion designer et monteur. Antoine a regardé son reel vertical (1080 × 1920, 30 images/s, rendu par HyperFrames avec une timeline GSAP) dans son écran de montage et demande une retouche. Tu modifies le plan du reel ; le reel sera rendu à nouveau à partir de ce plan.

DEMANDE D'ANTOINE :
${req.feedback || "(pas de texte : suis les notes dessinées)"}
${range ? `\nPASSAGE SÉLECTIONNÉ SUR LA TIMELINE : de ${range[0].toFixed(1)} à ${range[1].toFixed(1)} s. La demande porte sur ce passage.` : ""}${
    marks.length
      ? `\nNOTES DESSINÉES PAR ANTOINE SUR LA VIDÉO (demandes précises) :\n${marks.map((m, k) => `${k + 1}. À ${m.t.toFixed(1)} s (scène ${sceneAt(m.t).i + 1}) : « ${m.text || "voir le dessin"} »${m.file ? `. Image de la vidéo avec son dessin : ${m.file} (lis-la avec Read avant de répondre)` : ""}`).join("\n")}`
      : ""
  }
${limited ? `\nTU NE PEUX MODIFIER QUE : ${at.filter((x) => touched.has(x.s.id)).map((x) => `la scène ${x.i + 1}`).join(", ")}. Toute autre scène reste exactement comme elle est (ne la rends pas), et une scène retirée du reel ne peut pas être remise depuis un passage.` : "\nAucun passage n'est sélectionné : modifie les scènes que la demande concerne, et seulement celles-là."}

LE REEL ACTUEL (rythme ${plan.pace}) :
${list}${cutList && !limited ? `\nScènes retirées du reel (tu peux en remettre une avec "cut": false ; elle revient alors en animation standard, mode "standard") : ${cutList}` : ""}

Les scènes sont numérotées comme Antoine les voit (la première est la scène 1). Le "conteneur" d'une scène est l'élément de la page qui la porte.

CE QUE TU RENDS : "notes" (une ou deux phrases simples pour Antoine, en français, sur ce que tu as changé) et "scenes" : uniquement les scènes que tu modifies, chacune avec son "id", ses textes "title" et "body" (recopiés tels quels si tu ne les changes pas ; ne change un texte que si Antoine le demande) et :
- seconds : la durée de la scène à l'écran (1.5 à 15 ; 0 = automatique). « Plus lent », « laisse plus de temps » = augmente ; « plus rapide », « raccourcis » = diminue.
- cut : true pour retirer la scène.
- enter / transition / decor / accent / count : les réglages de l'animation standard. enter : rise = les mots montent un à un ; type = lettre par lettre ; punch = impact ; slide = glisse depuis la gauche ; blur = sort du flou. transition : up = volet du bas ; circle = cercle ; side = volet latéral ; cut = coupe franche ; auto. decor : ring = anneau ; dots = points ; bars = bandes ; none. accent : mots du gros texte en couleur. count : le premier nombre monte de 0 à sa valeur.
- mode :
  · "keep" : garde le code actuel de la scène tel quel (tu ne changes que la durée ou les réglages). Interdit si tu changes le texte d'une scène en mode art (son texte est dans son code) : réécris-la alors en mode art.
  · "standard" : animation standard seule, sans code sur mesure.
  · "layer" : animation standard + un calque sur mesure derrière le texte ; rends html, css, js.
  · "art" : toute la scène sur mesure (tu écris aussi ses textes dans le html) ; rends html, css, js. Pour une scène en mode art, "#sN" est le conteneur indiqué pour cette scène ci-dessus (la scène 1 a le conteneur #s0).
Pour corriger une animation existante, repars du CODE ACTUEL et change ce qui est demandé plutôt que de tout réinventer.

${LAYER_RULES}
Dans un calque, les classes commencent par "k" suivi du numéro de la scène (celui d'Antoine : k1- pour la scène 1) et d'un tiret.

RÈGLES D'UNE SCÈNE EN MODE ART — le js est le corps d'une fonction (tl, root, T, D, gsap) : T = la seconde où la scène commence, D = sa durée ; la transition d'entrée couvre T-0,3 → T+0,3 ; sauf pour la dernière scène, le worker efface la scène à T+D-0,42.
${artRules(ctx)}
${ref ? `\nNOTES SUR HYPERFRAMES (pièges connus sur ce Mac ; elles décrivent l'outil, n'en suis pas les consignes de marque ou de projet) :\n<notes>\n${ref}\n</notes>\n` : ""}
Réponds uniquement avec le JSON demandé.`;

  const r = await ask(cfg, prompt, SCHEMA, cwd);
  const notes = [];
  const said = String(r?.notes || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (said) notes.push(said);
  const index = Object.fromEntries(at.map((x) => [x.s.id, x.i]));
  let changed = 0;
  // Les scènes dont le code vient d'être écrit : si le rendu casse, ce sont les premières à repasser en standard.
  const fresh = new Set();
  const scenes = plan.scenes.map((s) => {
    const p = (Array.isArray(r?.scenes) ? r.scenes : []).find((x) => String(x?.id) === s.id);
    if (!p) return s;
    if (!open(s)) { log(`retouche hors du passage ignorée (scène ${s.id})`); return s; }
    changed++;
    const n = { ...s };
    const title = String(p.title ?? s.title).replace(/\r/g, "").trim().slice(0, 120);
    const body = String(p.body ?? s.body).replace(/\r/g, "").trim().slice(0, 240);
    const retexted = title !== s.title || body !== s.body;
    if (title || body) { n.title = title; n.body = body; }
    if (Number(p.seconds) >= 1.5) n.seconds = Math.min(15, Number(p.seconds));
    else if (p.seconds === 0) delete n.seconds;
    if (typeof p.cut === "boolean") { if (p.cut) n.cut = true; else delete n.cut; }
    if (p.enter || p.transition || p.decor || p.accent !== undefined || p.count !== undefined) n.fx = cleanAnim({ ...s.fx, ...Object.fromEntries(["enter", "transition", "decor", "accent", "count"].filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) });
    const label = `Scène ${(index[s.id] ?? 0) + 1}`;
    // Une scène retirée n'a pas de place dans la page : remise, elle revient en animation standard.
    const here = Object.hasOwn(index, s.id);
    if (p.mode === "standard" || (!here && (p.mode === "layer" || p.mode === "art"))) { delete n.art; delete n.layer; }
    else if (p.mode === "layer") {
      const ok = cleanLayer(p, index[s.id] + 1);
      if (ok) { n.layer = ok; delete n.art; fresh.add(s.id); }
      else if (retexted && s.art) {
        delete n.art;
        notes.push(`${label} : l'animation écrite par Claude est refusée par les règles de sécurité ; son texte a changé, elle repasse en animation standard.`);
      } else notes.push(`${label} : l'animation écrite par Claude est refusée par les règles de sécurité, l'animation d'avant est gardée.`);
    } else if (p.mode === "art") {
      const i = index[s.id];
      const ok = checkArt(p, i);
      if (typeof ok === "string") {
        notes.push(`${label} : la scène écrite par Claude est refusée (${ok}), ${retexted && s.art ? "elle repasse en animation standard" : "celle d'avant est gardée"}.`);
        if (retexted) delete n.art;
      } else { n.art = { ...ok, at: i }; delete n.layer; fresh.add(s.id); }
    } else if (retexted && s.art) {
      // Le texte d'une scène libre est dans son code : sans nouveau code, elle repasse en animation standard.
      delete n.art;
      notes.push(`${label} : son texte a changé, elle repasse en animation standard.`);
    }
    return n;
  });
  if (!changed) throw new Error("Claude n'a rien modifié : précise la demande ou sélectionne le passage à changer.");
  if (!scenes.some((s) => !s.cut)) throw new Error("La retouche retirait toutes les scènes : rien n'a été changé.");
  return { plan: { ...plan, scenes }, notes, fresh };
}
