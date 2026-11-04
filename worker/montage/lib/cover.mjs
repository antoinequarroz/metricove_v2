// Couverture de Reel (action "cover") : Claude écrit l'accroche d'après la vidéo, puis rendu en JPEG 1080×1920.
//  - Projet LivreMatch : générateur de la charte LivreMatch (livrematch/video/src/cover.mjs).
//  - Autres projets : même mise en page avec le thème du worker, sur une image de la vidéo assombrie.
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, createWriteStream, renameSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { home, ensureDir, run, themeFor, log } from "./util.mjs";
import { transcribe } from "./transcribe.mjs";
import { ask } from "./claude.mjs";
import { isLivreMatch } from "./caption.mjs";

const SCHEMA = {
  type: "object", required: ["line1", "line2", "accent"],
  properties: { line1: { type: "string" }, line2: { type: "string" }, accent: { type: "string" }, sub: { type: "string" } },
};

async function download(api, url, file) {
  const r = await api.req("GET", url, { raw: true });
  if (!r.ok) throw new Error(`téléchargement de la vidéo → ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file + ".part"));
  renameSync(file + ".part", file);
}

/** Livre LivreMatch correspondant au titre du média (pour reprendre titre, auteur et couverture). */
function findBook(lmDir, title) {
  const dir = join(lmDir, "video", "books");
  if (!existsSync(dir) || !title) return null;
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  for (const slug of readdirSync(dir)) {
    const f = join(dir, slug, "book.json");
    if (!existsSync(f)) continue;
    const b = JSON.parse(readFileSync(f, "utf8"));
    if (norm(b.title) && norm(title).includes(norm(b.title))) return { slug, ...b };
  }
  return null;
}

const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function genericPage({ label, rc, bg, theme }) {
  const accent = rc.accent && rc.line2.toLowerCase().includes(rc.accent.toLowerCase()) ? rc.accent : "";
  const i = accent ? rc.line2.toLowerCase().indexOf(accent.toLowerCase()) : -1;
  const l2 = i < 0 ? esc(rc.line2) : `${esc(rc.line2.slice(0, i))}<span style="color:${theme.accent}">${esc(rc.line2.slice(i, i + accent.length))}</span>${esc(rc.line2.slice(i + accent.length))}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:${theme.dark}}
#bg{position:absolute;inset:0;background:url('${bg}') center/cover;filter:brightness(.35) saturate(.9)}
#st{position:absolute;inset:0;font-family:"${theme.font}",${theme.fallbackFonts};color:${theme.text}}
#label{position:absolute;left:90px;right:90px;top:520px;color:${theme.accent};font-weight:700;font-size:32px;letter-spacing:.14em;text-transform:uppercase}
#hook{position:absolute;left:90px;right:90px;top:600px;font-weight:900;line-height:.92;letter-spacing:-.03em}
#hook .line{display:inline-block;white-space:nowrap}
#rule{position:absolute;left:90px;width:520px;height:12px;border-radius:6px;background:${theme.accent}}
#sub{position:absolute;left:90px;right:120px;font-weight:700;font-size:52px;line-height:1.12;color:rgba(255,255,255,.78)}
</style></head><body><div id="bg"></div><div id="st">
<div id="label">${esc(label)}</div>
<div id="hook"><div><span class="line">${esc(rc.line1)}</span></div><div><span class="line">${l2}</span></div></div>
<div id="rule"></div><div id="sub">${esc(rc.sub || "")}</div></div>
<script>
const h=document.getElementById('hook');for(let s=172;s>=96;s-=4){h.style.fontSize=s+'px';if([...h.querySelectorAll('.line')].every(d=>d.offsetWidth<=900))break}
const b=h.offsetTop+h.offsetHeight;document.getElementById('rule').style.top=(b+46)+'px';document.getElementById('sub').style.top=(b+110)+'px';
</script></body></html>`;
}

/** Rendu d'une page HTML en JPEG avec le Playwright du projet LivreMatch (déjà installé). */
export async function shot(lmDir, html, out) {
  const require = createRequire(join(lmDir, "package.json"));
  const pw = await import(pathToFileURL(require.resolve("@playwright/test")).href);
  const chromium = pw.chromium || pw.default?.chromium;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out, type: "jpeg", quality: 92 });
  } finally { await browser.close(); }
}

/** `localVideo` : vidéo déjà sur le Mac (rendu final du montage) ; sinon elle est téléchargée depuis `media.url`. */
export async function makeCover(api, cfg, { job, media, localVideo }, step) {
  const c = job.cover || {};
  if (!localVideo && !media?.url) throw new Error("vidéo introuvable pour cette couverture");
  const lmDir = home(cfg.livrematchDir || "~/Lab/projets/livrematch");
  const dir = ensureDir(join(cfg.workDir, "couvertures", job.id));
  const video = localVideo || join(dir, "video.mp4");
  try {
    if (!localVideo) {
      await step("Récupération de la vidéo…", 0.1);
      await download(api, media.url, video);
    }
    await step("Transcription de la vidéo…", 0.25);
    const spoken = await transcribe(cfg, video, statSync(video)).then((w) => w.map((x) => x.w).join(" ")).catch(() => "");
    const lm = /livre ?match/i.test(c.project || "") || isLivreMatch({ project: c.project, accounts: c.accounts });
    const book = lm ? findBook(lmDir, media.title) : null;

    await step("Claude écrit l'accroche…", 0.5);
    const rc = book?.reelCover && !c.instructions ? book.reelCover : await ask(cfg, `Écris l'accroche de la couverture (image du feed) d'un Reel, en français.
Vidéo : « ${media.title} »${book ? ` — livre « ${book.title} » de ${book.author}` : ""}.
${spoken ? `Texte dit dans la vidéo : ${spoken.slice(0, 3000)}` : ""}
${c.instructions ? `Consignes d'Antoine (prioritaires) : ${c.instructions}` : ""}
Modèles du style voulu : « Choisi. / Ou brûlé. », « Un job. / Un méchant. », « Sans pouvoir. / En danger. ».
Règles : line1 = 1 à 3 mots (12 caractères max) ; line2 = 1 à 4 mots (18 caractères max) ; accent = le mot fort de line2 ;
sub = une phrase de 4 à 9 mots qui donne envie${lm ? ", sans spoiler au-delà de la 4e de couverture, ni prix ni note" : ""}. N'invente aucun fait.`, SCHEMA, dir);

    await step("Rendu de la couverture…", 0.75);
    const out = join(dir, "couverture.jpg");
    if (lm && existsSync(join(lmDir, "video", "src", "cover.mjs"))) {
      const coverImg = book && existsSync(join(lmDir, "video", "build", book.slug, "cover.jpg")) ? pathToFileURL(join(lmDir, "video", "build", book.slug, "cover.jpg")).href : book?.cover;
      const data = join(dir, "data.json");
      writeFileSync(data, JSON.stringify({ title: book?.title || media.title, author: book?.author || "LivreMatch", cover: coverImg, reelCover: rc }));
      await run("node", [join(lmDir, "video", "src", "cover.mjs"), "--json", data, "--out", out], { cwd: lmDir });
    } else {
      const frame = join(dir, "fond.jpg");
      await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(1, (media.duration || 2) / 2)), "-i", video, "-frames:v", "1", "-q:v", "3", frame]);
      const bg = `data:image/jpeg;base64,${readFileSync(frame).toString("base64")}`;
      await shot(lmDir, genericPage({ label: media.title, rc, bg, theme: themeFor(cfg, job) }), out);
    }
    await step("Envoi de la couverture…", 0.9);
    await api.req("PUT", `/api/media/${media.id}/cover`, { body: readFileSync(out), headers: { "Content-Type": "image/jpeg" } });
    log(`[${job.id.slice(0, 8)}] couverture envoyée (« ${rc.line1} / ${rc.line2} »)`);
    return out;
  } finally {
    if (!localVideo) rmSync(video, { force: true });
  }
}
