// Lecture d'un site par le worker (Claude n'a pas le droit d'aller sur le web) : textes, couleurs, polices
// et logos possibles, résumés en un texte court que Claude lit. Uniquement des requêtes GET.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const MAX_HTML = 1_500_000;
const MAX_CSS = 800_000;
const MAX_SHEETS = 6;

async function get(url, max, accept = "*/*") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) throw new Error(`→ ${r.status}`);
    const reader = r.body.getReader();
    const parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { ctrl.abort(); break; }
      parts.push(value);
    }
    return { url: r.url || url, type: r.headers.get("content-type") || "", bytes: Buffer.concat(parts).subarray(0, max) };
  } finally {
    clearTimeout(timer);
  }
}

const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((x) => x !== undefined) ?? "";
const abs = (href, base) => { try { return new URL(href.replace(/&amp;/g, "&"), base).toString(); } catch { return ""; } };
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));

const COLOR = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)/gi;

/** Couleurs, variables CSS et polices d'une feuille de style. */
function readCss(css, acc) {
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)[;}]/g)) {
    const v = m[2].trim();
    if (COLOR.test(v) && v.length < 80) acc.vars.set(m[1], v);
    COLOR.lastIndex = 0;
  }
  for (const m of css.matchAll(COLOR)) {
    let c = m[0].toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(c)) c = `#${[...c.slice(1)].map((x) => x + x).join("")}`;
    acc.colors.set(c, (acc.colors.get(c) || 0) + 1);
  }
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const f = m[1].trim().replace(/!important/, "").trim();
    if (f.length < 160 && !f.startsWith("var(")) acc.fonts.set(f, (acc.fonts.get(f) || 0) + 1);
  }
  for (const m of css.matchAll(/@font-face\s*{[^}]*font-family\s*:\s*["']?([^;"'}]+)/gi)) acc.faces.add(m[1].trim());
}

/**
 * Le site résumé pour Claude : { digest, logos } où logos = adresses d'images qui pourraient être le logo
 * (Claude en choisit une, le worker la télécharge).
 */
export async function readSite(url) {
  const page = await get(url, MAX_HTML, "text/html,*/*;q=0.8");
  const html = page.bytes.toString("utf8");
  const base = page.url;
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [""])[0];
  const meta = (name) => {
    for (const tag of head.match(/<meta\b[^>]*>/gi) || []) if ([attr(tag, "name"), attr(tag, "property")].some((n) => n.toLowerCase() === name)) return decode(attr(tag, "content"));
    return "";
  };
  const acc = { vars: new Map(), colors: new Map(), fonts: new Map(), faces: new Set() };
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) readCss(m[1], acc);
  for (const m of html.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)) readCss(m[1], acc);

  const sheets = [];
  const google = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, "rel").toLowerCase();
    const href = abs(attr(tag, "href"), base);
    if (!href) continue;
    if (/fonts\.googleapis\.com/.test(href)) google.push(...[...href.matchAll(/family=([^&:]+)/g)].map((m) => decodeURIComponent(m[1].replace(/\+/g, " "))));
    else if (rel.includes("stylesheet") && sheets.length < MAX_SHEETS) sheets.push(href);
  }
  const fetched = [];
  for (const href of sheets) {
    try {
      const css = (await get(href, MAX_CSS, "text/css,*/*;q=0.5")).bytes.toString("utf8");
      readCss(css, acc);
      for (const m of css.matchAll(/fonts\.googleapis\.com\/css2?\?[^)"']*/g)) google.push(...[...m[0].matchAll(/family=([^&:]+)/g)].map((x) => decodeURIComponent(x[1].replace(/\+/g, " "))));
      fetched.push(href);
    } catch {}
  }

  // Logos possibles : icônes déclarées, images « logo », image de partage.
  const logos = [];
  const addLogo = (u, why) => { const a = abs(u, base); if (a && /^https?:/.test(a) && !logos.some((l) => l.url === a) && logos.length < 10) logos.push({ url: a, why }); };
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const hint = `${attr(tag, "alt")} ${attr(tag, "class")} ${attr(tag, "src")} ${attr(tag, "id")}`.toLowerCase();
    if (/logo|brand|marque/.test(hint)) addLogo(attr(tag, "src"), `image « ${attr(tag, "alt") || "logo"} »`);
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, "rel").toLowerCase();
    if (/icon/.test(rel)) addLogo(attr(tag, "href"), rel);
  }
  for (const guess of ["/logo.svg", "/logo-mark.svg", "/logo.png"]) addLogo(guess, "fichier courant (peut ne pas exister)");
  const og = meta("og:image");
  if (og) addLogo(og, "image de partage (souvent une affiche, rarement le logo seul)");

  const text = decode(html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|section|header|footer|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 5000);

  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const digest = `SITE : ${base}
Titre : ${decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim()}
Description : ${meta("description") || meta("og:description")}
Nom : ${meta("og:site_name")}
theme-color : ${meta("theme-color") || "—"}

VARIABLES CSS DE COULEUR (nom : valeur) :
${[...acc.vars.entries()].slice(0, 80).map(([k, v]) => `${k}: ${v}`).join("\n") || "—"}

COULEURS LES PLUS UTILISÉES (couleur × nombre) :
${top(acc.colors, 24).map(([c, n]) => `${c} × ${n}`).join("\n") || "—"}

POLICES (font-family × nombre) :
${top(acc.fonts, 10).map(([f, n]) => `${f} × ${n}`).join("\n") || "—"}
@font-face : ${[...acc.faces].slice(0, 10).join(", ") || "—"}
Google Fonts : ${[...new Set(google)].slice(0, 10).join(", ") || "—"}
Feuilles lues : ${fetched.length}/${sheets.length}

LOGOS POSSIBLES :
${logos.map((l, i) => `${i + 1}. ${l.url} (${l.why})`).join("\n") || "—"}

TEXTE DE LA PAGE (début) :
${text}`;
  return { digest, logos };
}

const LOGO_TYPES = { "image/svg+xml": "svg+xml", "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };

/** Le logo choisi par Claude, en adresse data: (null s'il est absent, trop lourd ou pas une image). */
export async function fetchLogo(url) {
  try {
    const r = await get(url, 290_000, "image/svg+xml,image/png,image/*;q=0.8");
    if (r.bytes.length >= 290_000) return null;
    let type = Object.keys(LOGO_TYPES).find((t) => r.type.toLowerCase().startsWith(t));
    const head = r.bytes.subarray(0, 400).toString("utf8").trimStart();
    if (!type && (/^<svg\b/i.test(head) || /^<\?xml[\s\S]*<svg\b/i.test(head))) type = "image/svg+xml";
    if (!type) return null;
    // Un SVG n'est jamais mis dans la page comme du code (seulement comme image), mais on retire quand même les scripts.
    let bytes = r.bytes;
    if (type === "image/svg+xml") {
      const svg = bytes.toString("utf8");
      if (!/<svg\b/i.test(svg)) return null;
      bytes = Buffer.from(svg.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, ""));
    }
    return `data:image/${LOGO_TYPES[type]};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
