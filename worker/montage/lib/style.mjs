// Tâches « style » (worker 0.18.0) :
//   rules : Claude tire des règles de style des retours qu'Antoine a résolus sur un montage ;
//   copy  : le Mac récupère jusqu'à 3 reels (liens lus par yt-dlp, ou vidéos de la bibliothèque Médias), les mesure
//           (durée des plans, son, débit de parole, images clés) et Claude en écrit les notes d'un nouveau style.
import { createWriteStream, existsSync, readFileSync, renameSync, statSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ask } from "./claude.mjs";
import { probe } from "./rushes.mjs";
import { transcribe } from "./transcribe.mjs";
import { ensureDir, log, run } from "./util.mjs";

export async function makeStyle(api, cfg, job, step, dir) {
  const t = job.styleTask || {};
  if (t.mode === "rules") return { rules: await writeRules(cfg, t, step, dir) };
  if (t.mode === "copy") return copyStyle(api, cfg, job, step, dir);
  throw new Error("Demande de style inconnue.");
}

const RULES_SCHEMA = {
  type: "object", required: ["rules"],
  properties: { rules: { type: "array", items: { type: "string" }, description: "1 à 6 règles courtes, une idée chacune" } },
};

async function writeRules(cfg, t, step, dir) {
  await step("Claude tire des règles de tes retours…", 0.2);
  const prompt = `Tu aides un créateur de vidéos courtes (Reels, TikTok, Shorts) à garder un style constant.
Voici les retours qu'il a faits sur un montage puis marqués comme réglés (entre crochets : l'élément de l'image visé) :
${(t.notes || []).map((n) => `- ${n}`).join("\n")}
${t.current ? `\nNotes déjà dans le style (ne les répète pas) :\n${t.current}\n` : ""}
Écris 1 à 6 règles générales à ajouter aux notes du style, pour que les prochains montages n'aient plus besoin de ces retours.
- Une règle par idée, à l'impératif, 6 à 20 mots, concrète (place, taille, durée, rythme, couleur, son), réutilisable sur une autre vidéo.
- Rien qui ne vaut que pour cette vidéo (pas de mot ou de moment précis de celle-ci).
- Français, sans emoji. Si un retour ne donne pas de règle générale, ignore-le.
Réponds uniquement avec le JSON demandé.`;
  const r = await ask(cfg, prompt, RULES_SCHEMA, dir);
  return (r.rules || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
}

const HEXS = { type: "string", description: "#rrggbb, ou vide" };
const COPY_SCHEMA = {
  type: "object", required: ["summary", "notes", "video"],
  properties: {
    summary: { type: "string", description: "2 à 3 phrases : ce qui fait ce style" },
    notes: { type: "array", items: { type: "string" }, description: "8 à 14 règles de montage, une par ligne" },
    accent: { type: "string", description: "couleur d'accent dominante des textes ou cartes, #rrggbb, ou vide" },
    video: {
      type: "object", required: ["font", "weight", "upper"],
      description: "le look des sous-titres et textes du créateur, tel qu'on le voit sur les images",
      properties: {
        font: { type: "string", description: "nom exact d'une famille Google Fonts, la plus proche de la police des sous-titres" },
        weight: { type: "integer", description: "graisse des sous-titres : 400, 500, 600, 700, 800 ou 900" },
        upper: { type: "boolean", description: "sous-titres en capitales" },
        text: { ...HEXS, description: "couleur des mots des sous-titres, #rrggbb" },
        stroke: { type: "integer", description: "épaisseur du contour des lettres en px pour une image de 1080 de large (0 = aucun, 3 à 8 si contour net)" },
        strokeColor: HEXS,
        box: { type: "string", enum: ["none", "line", "word"], description: "fond coloré derrière toute la ligne, derrière le mot dit seulement, ou aucun" },
        boxColor: HEXS,
        shadow: { type: "boolean", description: "ombre douce sous les lettres" },
        hook: { type: "string", enum: ["band", "text", "box"], description: "titre d'ouverture : bandeau de couleur, gros texte seul, ou cadre blanc" },
        position: { type: "string", enum: ["bottom", "middle", "top"], description: "place des sous-titres" },
        anim: { type: "string", enum: ["karaoke", "pop", "simple"], description: "karaoke = le mot dit change de couleur, pop = mots qui apparaissent un à un, simple = ligne entière" },
        size: { type: "string", enum: ["s", "m", "l"], description: "taille des sous-titres : s petite, m moyenne, l grosse (plus d'un dixième de la largeur par lettre)" },
        highlight: { ...HEXS, description: "couleur des mots mis en avant, #rrggbb" },
        card: { ...HEXS, description: "fond des cartes plein écran s'il y en a, #rrggbb" },
      },
    },
  },
};

// Polices fréquentes des reels, toutes sur Google Fonts : Claude choisit de préférence parmi elles.
const FONTS = "Montserrat, Poppins, Inter, Bebas Neue, Anton, Oswald, Archivo Black, Archivo, Roboto, Roboto Condensed, Lexend, DM Sans, Manrope, Plus Jakarta Sans, Outfit, Sora, Space Grotesk, Bricolage Grotesque, Barlow, Barlow Condensed, Rubik, Nunito, Kanit, League Spartan, Lilita One, Luckiest Guy, Bangers, Titan One, Permanent Marker, Playfair Display, DM Serif Display, Instrument Serif, Fraunces, Libre Baskerville, Caveat";

async function copyStyle(api, cfg, job, step, dir) {
  const t = job.styleTask;
  const refs = (t.refs || []).slice(0, 3);
  const seen = [];
  for (const [i, ref] of refs.entries()) {
    await step(`Récupération du reel ${i + 1}/${refs.length}…`, 0.05 + 0.25 * (i / refs.length));
    const file = await fetchRef(api, cfg, ref, join(ensureDir(join(dir, "reels")), `reel${i + 1}`)).catch((e) => {
      log(`reel ${i + 1} :`, e.message);
      return { error: e.message };
    });
    if (file.error) { seen.push({ i: i + 1, ref, error: file.error }); continue; }
    await step(`Mesure du reel ${i + 1}/${refs.length}…`, 0.3 + 0.35 * (i / refs.length));
    seen.push({ i: i + 1, ref, ...(await measure(cfg, file.path, join(dir, `mesures${i + 1}`), i + 1)) });
  }
  const ok = seen.filter((x) => !x.error);
  if (!ok.length) throw new Error(`Aucun reel n'a pu être lu : ${seen.map((x) => x.error).join(" ; ")}`.slice(0, 600));
  await step("Claude écrit le style…", 0.75);
  const lines = ok.map((x) => `Reel ${x.i}${x.ref.title ? ` (« ${x.ref.title} »)` : ""} : ${x.duration.toFixed(1)} s, ${x.width}×${x.height}, ${x.cuts} coupes (un plan dure ${x.shot.toFixed(1)} s en moyenne, le plus court ${x.shortest.toFixed(1)} s)` +
    `${x.wpm ? `, ${x.wpm} mots par minute` : ""}, son ${x.loudness}${x.music ? ", musique ou fond sonore continu" : ""}. Planches d'images : ${x.sheets.join(", ")} (une image toutes les ${x.every.toFixed(1)} s, dans l'ordre, de gauche à droite puis de haut en bas). Images en grand : ${x.frames.map((f) => basename(f)).join(", ")}.`);
  const failed = seen.filter((x) => x.error).map((x) => `Reel ${x.i} illisible (${x.error.slice(0, 120)}).`);
  const prompt = `Tu es monteur vidéo. Antoine veut un style de montage pour ses vidéos face caméra inspiré de ${ok.length > 1 ? "ces reels" : "ce reel"}.
Mesures faites par son Mac (les coupes sont détectées automatiquement : une coupe sèche sur le même décor peut échapper, les planches font foi) :
${lines.join("\n")}
${failed.join("\n")}
Lis chaque planche et chaque image en grand avec l'outil Read avant de répondre. Regarde : place, taille, police (avec ou sans empattement, étroite ou large, grasse, capitales), couleur, contour, fond et animation probable des sous-titres ; mots mis en couleur ; textes et cartes à l'écran ; écran coupé, plein cadre, visage en incrustation ; zooms et recadrages ; B-roll ; emojis ; couleurs dominantes ; rythme.
Le but est qu'on reconnaisse ce créateur au premier coup d'œil : sois précis et fidèle, pas générique. Une règle comme « sous-titres lisibles » ne sert à rien ; « sous-titres en Anton blanc à contour noir épais, 2 à 3 mots, au tiers bas, mot dit en jaune #ffd400 » sert.
Écris les notes du nouveau style : 8 à 14 règles concrètes, à l'impératif, une idée chacune, que Claude pourra suivre en montant les rushes d'Antoine (sous-titres, accroche, rythme des coupes et des zooms, temps forts mis en scène, B-roll, bruitages, musique, fin). Donne des chiffres quand les mesures en donnent (durée des plans, débit).
N'invente rien qu'on ne voit ou n'entend pas ; ne copie ni logo, ni nom, ni texte du créateur. Français, sans emoji.
summary : 2 à 3 phrases pour Antoine. accent : la couleur des mots mis en avant si elle est nette (#rrggbb), sinon vide.
video : le look tel qu'il est sur les images, que le Mac reproduira tel quel. font : la famille Google Fonts la plus proche de la police des sous-titres, de préférence parmi ${FONTS} ; mesure les couleurs sur les images (pas de couleur au hasard) ; s'il n'y a pas de sous-titres, décris les textes à l'écran.
Réponds uniquement avec le JSON demandé.`;
  const r = await ask(cfg, prompt, COPY_SCHEMA, dir);
  const notes = (r.notes || []).map((x) => String(x).replace(/^[-•*]\s*/, "").trim()).filter(Boolean).slice(0, 16);
  if (!notes.length) throw new Error("Claude n'a pas écrit de notes.");
  // Le résumé de Claude coupé à la fin d'une phrase (700 signes au plus), puis les reels illisibles.
  let said = String(r.summary || "").trim();
  if (said.length > 700) said = said.slice(0, 700).replace(/[^.!?]*$/, "").trim() || said.slice(0, 700);
  const summary = [said, ...failed].filter(Boolean).join(" ");
  // Des images clés du reel restent dans le style comme images d'inspiration (6 au plus, réparties entre les reels).
  const per = Math.max(1, Math.floor(6 / ok.length));
  const frames = ok.flatMap((x) => x.frames.slice(0, per)).slice(0, 6).map((f) => readFileSync(f).toString("base64"));
  return { notes: notes.join("\n"), summary, ...(/^#[0-9a-f]{6}$/i.test(r.accent || "") ? { accent: r.accent } : {}), ...(r.video && typeof r.video === "object" ? { video: r.video } : {}), frames };
}

/** Le fichier d'un reel : une vidéo de la bibliothèque Médias, ou un lien lu par yt-dlp. */
async function fetchRef(api, cfg, ref, base) {
  if (ref.mediaId) {
    const file = `${base}.mp4`;
    const r = await api.req("GET", `/api/media/${encodeURIComponent(ref.mediaId)}/file`, { raw: true });
    if (!r.ok) throw new Error(`vidéo de la bibliothèque → ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(file + ".part"));
    renameSync(file + ".part", file);
    return { path: file };
  }
  if (!ref.url) throw new Error("ni lien ni vidéo");
  const bin = cfg.ytDlp || "yt-dlp";
  const args = ["--no-playlist", "--no-progress", "-f", "mp4/bestvideo*+bestaudio/best", "--merge-output-format", "mp4", "--max-filesize", "300M", "-o", `${base}.%(ext)s`];
  // Instagram et TikTok demandent souvent d'être connecté : yt-dlp prend alors les cookies du navigateur choisi.
  // Si ces cookies sont introuvables (navigateur absent ou autre profil), on réessaie sans eux.
  const cookies = cfg.ytDlpCookies ? String(cfg.ytDlpCookies) : "";
  const tryGet = (withCookies) => run(bin, [...args, ...(withCookies ? ["--cookies-from-browser", cookies] : []), ref.url], { timeoutMs: 180_000 });
  const why = (e) => String(e.stderr || e.message).trim().split("\n").pop().slice(0, 200);
  await tryGet(!!cookies)
    .catch((e) => {
      if (!cookies || e.code === "ENOENT" || !/cookie/i.test(String(e.stderr || e.message))) throw e;
      log(`cookies de « ${cookies} » illisibles (${why(e)}) : nouvel essai sans cookies`);
      return tryGet(false).catch((e2) => {
        e2.cookieError = why(e);
        throw e2;
      });
    })
    .catch((e) => {
      if (e.code === "ENOENT") throw new Error("yt-dlp n'est pas installé sur le Mac (brew install yt-dlp), ou choisis une vidéo de la bibliothèque");
      const hint = e.cookieError
        ? ` (les cookies du navigateur « ${cookies} » sont introuvables : mets dans ytDlpCookies de config.json le navigateur où tu es connecté à Instagram, par ex. safari, firefox, brave, edge)`
        : cookies ? "" : " (Instagram demande souvent ytDlpCookies dans config.json)";
      throw new Error(`le lien n'a pas pu être lu${hint} : ${why(e)}`);
    });
  const dirOf = base.slice(0, base.lastIndexOf("/"));
  const name = readdirSync(dirOf).find((n) => n.startsWith(base.split("/").pop() + ".") && !n.endsWith(".part"));
  if (!name) throw new Error("yt-dlp n'a rien téléchargé");
  return { path: join(dirOf, name) };
}

/** Durée, coupes (détection de changement de plan), volume, débit de parole, planches de 12 images. */
async function measure(cfg, file, dir, n) {
  ensureDir(dir);
  const info = await probe(file);
  const duration = info.duration || info.videoDuration || 0;
  const out = await run("ffmpeg", ["-hide_banner", "-i", file, "-filter:v", "select='gt(scene,0.18)',showinfo", "-an", "-f", "null", "-"], { stderr: true, timeoutMs: 300_000 }).catch(() => "");
  // Seuil bas (les coupes sèches d'un face caméra changent peu l'image), puis une coupe au plus toutes les 0,25 s
  // (un mouvement rapide en donne plusieurs de suite).
  const cuts = [];
  for (const x of [...String(out).matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]))) {
    if (x > 0.2 && x < duration - 0.2 && !(x - cuts.at(-1) < 0.25)) cuts.push(x);
  }
  const marks = [0, ...cuts, duration];
  const shots = marks.slice(1).map((x, i) => x - marks[i]).filter((x) => x > 0.05);
  // Volume et fond sonore : volume moyen, et la part du temps sans silence (une musique continue n'en laisse pas).
  let loudness = "inconnu", music = false;
  if (info.hasAudio) {
    const a = await run("ffmpeg", ["-hide_banner", "-i", file, "-vn", "-af", "volumedetect,silencedetect=n=-40dB:d=0.4", "-f", "null", "-"], { stderr: true, timeoutMs: 120_000 }).catch(() => "");
    const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(a)?.[1]);
    const silent = [...String(a).matchAll(/silence_duration: ([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
    loudness = Number.isFinite(mean) ? `${mean.toFixed(0)} dB en moyenne` : "inconnu";
    music = duration > 0 && silent / duration < 0.03;
  } else loudness = "absent";
  let wpm;
  try {
    const words = await transcribe(cfg, file, statSync(file));
    if (words.length && duration > 3) wpm = Math.round(words.length / (duration / 60));
  } catch (e) { log("transcription du reel impossible :", e.message); }
  // Deux planches de 6 images (3×2) : une image toutes les durée/12 s, petites pour que Claude les lise vite.
  const every = Math.max(0.5, duration / 12);
  const sheets = [];
  for (let k = 0; k < 2; k++) {
    const name = `planche-${n}-${k + 1}.jpg`;
    const start = k * every * 6;
    if (start >= duration) break;
    await run("ffmpeg", ["-v", "error", "-y", "-ss", start.toFixed(2), "-i", file, "-vf", `fps=1/${every.toFixed(3)},scale=360:-2,tile=3x2:padding=6:color=white`, "-frames:v", "1", "-q:v", "4", join(dir, "..", name)]).catch(() => {});
    if (existsSync(join(dir, "..", name))) sheets.push(name);
  }
  // Six images en grand (540 px de large), réparties sur le reel : Claude y lit la police, et elles restent dans le style.
  const frames = [];
  for (const [k, at] of [0.08, 0.25, 0.4, 0.55, 0.7, 0.88].entries()) {
    const out = join(dir, "..", `image-${n}-${k + 1}.jpg`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", (duration * at).toFixed(2), "-i", file, "-vf", "scale=540:-2", "-frames:v", "1", "-q:v", "3", out]).catch(() => {});
    if (existsSync(out)) frames.push(out);
  }
  return {
    frames,
    duration, width: info.width, height: info.height,
    cuts: cuts.length,
    shot: shots.length ? shots.reduce((a, b) => a + b, 0) / shots.length : duration,
    shortest: shots.length ? Math.min(...shots) : duration,
    loudness, music, wpm, every, sheets,
  };
}
