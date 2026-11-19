// Illustrations et bruitages faits pour les bibliothèques (action "asset", worker 0.16.0).
// Illustration : Claude dessine des SVG aux couleurs du style. Bruitage : ElevenLabs (clé sur ce Mac) sinon une recette
// FFmpeg (sources synthétiques seulement, jamais de fichier ni de réseau). Les fichiers partent dans /api/library.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ask } from "./claude.mjs";
import { home, run, ensureDir, log } from "./util.mjs";

const MAX_SVG = 60_000;
const SFX_TAGS = ["whoosh", "pop", "click", "thud", "swoosh", "ding", "glitch", "riser", "impact", "typing"];

/** Fait les éléments demandés, les envoie à la bibliothèque, renvoie leurs ids. */
export async function makeAssets(api, cfg, job, step, dir) {
  const a = job.asset || {};
  const count = Math.min(4, Math.max(1, Math.round(a.count || 1)));
  const items = a.kind === "sfx" ? await makeSounds(cfg, a, count, step, ensureDir(dir)) : await makeIllustrations(cfg, a, count, step, dir);
  if (!items.length) throw new Error("Rien n'a pu être fait : reformule la demande.");
  await step("Rangement dans la bibliothèque…", 0.9);
  const ids = [];
  for (const it of items) {
    const r = await api.addAsset(a.kind === "sfx" ? "sfx" : "illustration", it.bytes, { name: it.name, tags: it.tags, styles: a.styles || [], type: it.type });
    if (r?.item?.id) ids.push(r.item.id);
  }
  if (!ids.length) throw new Error("La bibliothèque a refusé les fichiers.");
  return ids;
}

/* ---------- Illustrations ---------- */

async function makeIllustrations(cfg, a, count, step, dir) {
  const palette = (a.palette || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const prompt = `Tu es illustrateur. Dessine ${count} illustration${count > 1 ? "s" : ""} en SVG pour des vidéos de réseaux sociaux${a.style ? ` (style « ${a.style} »)` : ""}.

DEMANDE D'ANTOINE : ${a.prompt}

RÈGLES DU DESSIN
- ${count > 1 ? `${count} variantes vraiment différentes (cadrage, pose, composition), pas la même image recolorée.` : "Une seule image."}
- Style plat et net, formes simples et lisibles en petit (elle sera posée par-dessus une vidéo), contours arrondis, pas de dégradés compliqués.
- ${palette.length ? `Couleurs : UNIQUEMENT celles du style ${palette.join(", ")}, plus du blanc, du noir et des teintes plus claires ou plus foncées de ces couleurs.` : "Couleurs vives et franches, 3 ou 4 au plus."}
- Fond TRANSPARENT : aucun rectangle de fond plein qui couvre toute l'image.
- Pas de texte dans l'image, sauf si la demande en veut un explicitement.
- SVG autonome : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">…</svg>, 20 000 caractères au plus.
- Interdits : <script>, <foreignObject>, <image>, <use> vers un autre fichier, attributs on…, liens (href vers http, data: ou un fichier), @import, polices externes.
- Pour chacune : un "name" court en français (2 à 4 mots) et 2 à 5 "tags" en français, en minuscules.`;
  await step(`Claude dessine ${count > 1 ? `${count} illustrations` : "l'illustration"}…`, 0.3);
  const schema = {
    type: "object",
    required: ["items"],
    properties: { items: { type: "array", items: { type: "object", required: ["name", "tags", "svg"], properties: { name: { type: "string" }, tags: { type: "array", items: { type: "string" } }, svg: { type: "string" } } } } },
  };
  const r = await ask(cfg, prompt, schema, ensureDir(dir));
  const out = [];
  for (const it of (Array.isArray(r?.items) ? r.items : []).slice(0, count)) {
    const svg = cleanSvg(String(it?.svg || ""));
    if (!svg) { log("illustration écartée : SVG refusé"); continue; }
    out.push({ name: String(it.name || a.prompt).trim().slice(0, 80), tags: tagsOf(it.tags), bytes: Buffer.from(svg, "utf8"), type: "image/svg+xml" });
  }
  return out;
}

/** Le SVG s'il est sûr (rien qui s'exécute ni ne charge quoi que ce soit), sinon "". */
export function cleanSvg(raw) {
  let s = raw.trim().replace(/^```(?:svg|xml)?\s*/i, "").replace(/```\s*$/, "").trim();
  s = s.replace(/<\?xml[^>]*\?>\s*/i, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/i, "").trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s) || s.length > MAX_SVG) return "";
  if (/<\s*(script|foreignObject|image|iframe|object|embed|audio|video|animate\w*|set)\b/i.test(s)) return "";
  if (/\son[a-z]+\s*=/i.test(s) || /@import|url\(\s*['"]?(?!#)/i.test(s)) return "";
  // Seuls les liens internes (#id) sont permis.
  if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(s)) return "";
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(s)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

const tagsOf = (raw) => [...new Set((Array.isArray(raw) ? raw : []).map((t) => String(t).toLowerCase().replace(/[,\0-\x1f]/g, "").trim().slice(0, 30)).filter(Boolean))].slice(0, 8);

/* ---------- Bruitages ---------- */

/** La clé ElevenLabs de ce Mac : ELEVENLABS_API_KEY, `elevenlabsKey`, ou une ligne ELEVENLABS_API_KEY=… de `elevenlabsKeyFile`. */
export function elevenKey(cfg) {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  if (cfg.elevenlabsKey) return String(cfg.elevenlabsKey).trim();
  const file = cfg.elevenlabsKeyFile ? home(cfg.elevenlabsKeyFile) : "";
  if (!file || !existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").find((l) => /^\s*(export\s+)?(ELEVENLABS_API_KEY|ELEVEN_API_KEY|XI_API_KEY)\s*=/.test(l));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
}

/** Les recettes FFmpeg : des sources synthétiques (aevalsrc, anoisesrc) dont seuls des nombres changent. Dans une expression, la virgule s'écrit \\, (sinon lavfi coupe le filtre). */
const RECIPES = {
  whoosh: (f, d) => ({ src: `anoisesrc=d=${d}:c=pink:a=0.8`, af: `highpass=f=${Math.round(f / 2)},lowpass=f=${Math.round(f * 4)},afade=t=in:d=${(d * 0.55).toFixed(2)},afade=t=out:st=${(d * 0.55).toFixed(2)}:d=${(d * 0.45).toFixed(2)}` }),
  swoosh: (f, d) => ({ src: `anoisesrc=d=${d}:c=white:a=0.6`, af: `bandpass=f=${Math.round(f * 2)}:w=${Math.round(f)},afade=t=in:d=${(d * 0.3).toFixed(2)},afade=t=out:st=${(d * 0.3).toFixed(2)}:d=${(d * 0.7).toFixed(2)}` }),
  pop: (f, d) => ({ src: `aevalsrc=sin(2*PI*(${f}+${f}*1.5*exp(-t*40))*t)*exp(-t*${(14 / d).toFixed(1)}):d=${d}` }),
  click: (f, d) => ({ src: `aevalsrc=(random(0)*2-1)*exp(-t*400)+0.5*sin(2*PI*${f}*t)*exp(-t*300):d=${d}`, af: "highpass=f=1500" }),
  thud: (f, d) => ({ src: `aevalsrc=sin(2*PI*${Math.min(f, 120)}*t*exp(-t*3))*exp(-t*${(6 / d).toFixed(1)}):d=${d}`, af: "lowpass=f=400" }),
  impact: (f, d) => ({ src: `aevalsrc=sin(2*PI*${Math.min(f, 90)}*t)*exp(-t*${(5 / d).toFixed(1)})+0.5*(random(0)*2-1)*exp(-t*25):d=${d}`, af: "lowpass=f=3000" }),
  ding: (f, d) => ({ src: `aevalsrc=0.7*sin(2*PI*${f}*t)*exp(-t*${(4 / d).toFixed(1)})+0.3*sin(2*PI*${f * 2.01}*t)*exp(-t*${(7 / d).toFixed(1)}):d=${d}` }),
  riser: (f, d) => ({ src: `aevalsrc=0.6*sin(2*PI*(${Math.round(f / 3)}+${f}*t/${d})*t)*(t/${d}):d=${d}`, af: `afade=t=out:st=${(d * 0.9).toFixed(2)}:d=${(d * 0.1).toFixed(2)}` }),
  glitch: (f, d) => ({ src: `aevalsrc=0.5*sgn(sin(2*PI*${f}*t))*mod(floor(t*${Math.round(f / 20) || 30})\\,2)+0.2*(random(0)*2-1):d=${d}`, af: "aecho=0.6:0.4:20:0.3" }),
  typing: (f, d) => ({ src: `aevalsrc=(random(0)*2-1)*exp(-mod(t\\,0.11)*350)*lt(mod(t\\,0.11)\\,0.03):d=${d}`, af: `highpass=f=${Math.max(800, Math.round(f))}` }),
};
const RANGE = { whoosh: [400, 0.6], swoosh: [700, 0.5], pop: [700, 0.18], click: [3000, 0.06], thud: [70, 0.5], impact: [55, 0.9], ding: [1300, 1.2], riser: [900, 1.5], glitch: [600, 0.4], typing: [1500, 1.0] };

async function makeSounds(cfg, a, count, step, dir) {
  await step("Claude prépare les bruitages…", 0.2);
  const schema = {
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "tags", "english", "recipe", "freq", "seconds"],
          properties: { name: { type: "string" }, tags: { type: "array", items: { type: "string" } }, english: { type: "string" }, recipe: { type: "string", enum: Object.keys(RECIPES) }, freq: { type: "number" }, seconds: { type: "number" } },
        },
      },
    },
  };
  const plan = await ask(
    cfg,
    `Antoine veut ${count} bruitage${count > 1 ? "s" : ""} court${count > 1 ? "s" : ""} pour ses vidéos (Reels, TikTok)${a.style ? `, style « ${a.style} »` : ""}.
DEMANDE : ${a.prompt}

Pour chacun (${count > 1 ? "des variantes différentes entre elles" : "un seul"}) donne :
- "name" : nom court en français (2 à 4 mots), "tags" : 1 à 4 étiquettes en minuscules (parmi ${SFX_TAGS.join(", ")} quand ça colle),
- "english" : une description précise en anglais pour un générateur de bruitages (matière, attaque, durée, ambiance ; pas de musique, pas de voix),
- "recipe" : la recette de secours la plus proche parmi ${Object.keys(RECIPES).join(", ")}, "freq" : la fréquence principale en Hz (40 à 4000), "seconds" : la durée (0,05 à 3 s).`,
    schema,
    dir,
  );
  const list = (Array.isArray(plan?.items) ? plan.items : []).slice(0, count);
  const key = elevenKey(cfg);
  const out = [];
  for (const [i, it] of list.entries()) {
    await step(`Bruitage ${i + 1} sur ${list.length}…`, 0.3 + (0.55 * i) / list.length);
    const name = String(it.name || a.prompt).trim().slice(0, 80);
    const tags = tagsOf(it.tags);
    const seconds = Math.min(3, Math.max(0.05, Number(it.seconds) || RANGE[it.recipe]?.[1] || 0.5));
    let bytes = null;
    if (key) {
      try { bytes = await eleven(key, String(it.english || a.prompt).slice(0, 450), seconds); }
      catch (e) { log(`ElevenLabs : ${e.message} (recette FFmpeg à la place)`); }
    }
    if (bytes) { out.push({ name, tags, bytes, type: "audio/mpeg" }); continue; }
    const recipe = RECIPES[it.recipe] ? it.recipe : "whoosh";
    const freq = Math.min(4000, Math.max(40, Number(it.freq) || RANGE[recipe][0]));
    out.push({ name, tags: tags.length ? tags : [recipe], bytes: await synth(recipe, freq, seconds, join(dir, `sfx-${i}.wav`)), type: "audio/wav" });
  }
  return out;
}

async function eleven(key, text, seconds) {
  const r = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    // ElevenLabs demande au moins 0,5 s.
    body: JSON.stringify({ text, duration_seconds: Math.max(0.5, Math.min(22, seconds)), prompt_influence: 0.6 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length < 500) throw new Error("réponse vide");
  return b;
}

/** Un bruitage par FFmpeg : la recette, normalisée et sans clic au début ni à la fin. */
export async function synth(recipe, freq, seconds, file) {
  const d = Number(seconds.toFixed(2));
  const f = Math.round(freq);
  const { src, af } = RECIPES[recipe](f, d);
  const filters = [af, "afade=t=in:d=0.004", `afade=t=out:st=${Math.max(0, d - 0.01).toFixed(3)}:d=0.01`, "loudnorm=I=-16:TP=-1.5", "aresample=44100"].filter(Boolean).join(",");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", src, "-af", filters, "-ac", "2", "-c:a", "pcm_s16le", file]);
  return readFileSync(file);
}
