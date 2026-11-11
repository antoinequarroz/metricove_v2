// Police d'un thème venue de Google Fonts (thème du profil de style : `theme.googleFont`).
// Téléchargée une fois dans le dossier des polices du Mac, puis lue depuis le disque.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { home, log } from "./util.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SPEC = /^[A-Za-z0-9 ]{1,60}(:[a-z,]{1,40}@[0-9.,;]{1,80})?$/;
const SUBSETS = ["latin", "latin-ext"];

/**
 * Les fichiers d'une police Google ("Famille" ou "Famille:axes@valeurs") : [{ file, rules }] (woff2 sur le Mac et
 * ses descripteurs CSS). Téléchargés une fois. [] si la police est refusée ou indisponible.
 */
export async function googleFaces(cfg, spec) {
  spec = String(spec || "");
  if (!SPEC.test(spec)) { if (spec) log(`police ignorée (${spec.slice(0, 60)})`); return []; }
  const dir = join(home(cfg.fontsDir || "~/Movies/Metricove/polices"), spec.replace(/[^A-Za-z0-9]+/g, "-"));
  const index = join(dir, "polices.json");
  try {
    if (!existsSync(index)) {
      mkdirSync(dir, { recursive: true });
      const css = await get(`https://fonts.googleapis.com/css2?family=${spec.replace(/ /g, "+")}&display=block`).then((r) => r.text());
      const faces = [];
      for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g)) {
        if (!SUBSETS.includes(m[1])) continue;
        const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(m[2])?.[1];
        if (!url) continue;
        const rules = ["font-style", "font-weight", "font-stretch", "unicode-range"]
          .map((k) => new RegExp(`${k}:\\s*([^;]+);`).exec(m[2])).filter(Boolean).map((r) => r[0].replace(/[<>"'\\]/g, "")).join("");
        // Une police à plusieurs styles ou graisses fixes donne plusieurs fichiers par sous-ensemble.
        const file = `${m[1]}-${faces.length}.woff2`;
        writeFileSync(join(dir, file), Buffer.from(await get(url).then((r) => r.arrayBuffer())));
        faces.push({ file, rules });
      }
      if (!faces.length) throw new Error("aucun fichier de police dans la réponse");
      writeFileSync(index, JSON.stringify(faces));
      log(`police « ${spec.split(":")[0]} » téléchargée (${faces.length} fichier(s))`);
    }
    return JSON.parse(readFileSync(index, "utf8")).map((f) => ({ file: join(dir, basename(f.file)), rules: String(f.rules) })).filter((f) => existsSync(f.file));
  } catch (e) {
    log(`police « ${spec.split(":")[0]} » indisponible, police de secours utilisée :`, e.message);
    return [];
  }
}

/**
 * Complète le thème avec `fontFaces` (police `theme.googleFont` du profil de style).
 * Sans `googleFont`, ou si le téléchargement échoue, le thème revient sans (polices de secours).
 */
export async function withFont(cfg, theme) {
  if (!theme.googleFont) return theme;
  // Les fichiers de police de la config du Mac sont ceux d'une autre police : ils ne servent pas sous ce nom.
  theme = { ...theme, fontFiles: [] };
  const faces = await googleFaces(cfg, theme.googleFont);
  return faces.length ? { ...theme, fontFaces: faces } : theme;
}

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} → ${r.status}`);
  return r;
}

/** Les règles @font-face du thème ; `src(file)` donne l'adresse de chaque fichier dans la page. */
export function fontFaceCss(theme, src) {
  if (theme.fontFaces?.length) return theme.fontFaces.filter((f) => existsSync(f.file)).map((f) => `@font-face{font-family:"${theme.font}";src:url("${src(f.file)}") format("woff2");${f.rules}}`).join("\n");
  return (theme.fontFiles || []).filter((p) => existsSync(p)).map((p) => `@font-face{font-family:"${theme.font}";src:url("${src(p)}");}`).join("\n");
}

/** Les fichiers de police du thème, à copier à côté de la page. */
export const fontPaths = (theme) => (theme.fontFaces?.length ? theme.fontFaces.map((f) => f.file) : theme.fontFiles || []).filter((p) => existsSync(p));

export const fontDataUrl = (file) => `data:font/${file.endsWith(".woff2") ? "woff2" : "ttf"};base64,${readFileSync(file).toString("base64")}`;
