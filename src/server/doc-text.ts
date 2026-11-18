import "server-only";
import zlib from "node:zlib";

// Word (.docx), OpenDocument (.odt) and RTF documents turned into Markdown when they are sent,
// so Claude on the Mac reads them like any text: headings, lists, tables and paragraphs kept.

/** Most text kept from one document (a strategy is a few pages; a huge file is cut, not refused). */
const MAX_TEXT = 400_000;
/** Most bytes inflated from one zip entry (guards against zip bombs). */
const MAX_ENTRY = 40_000_000;

/** The files of a zip archive, by name, read lazily. Undefined when it is not a readable zip. */
function readZip(b: Buffer): Map<string, () => Buffer> | undefined {
  // End of central directory: signature 0x06054b50 within the last 64 KB.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const files = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return undefined;
    const method = b.readUInt16LE(p + 10);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    files.set(name, () => {
      if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50) throw new Error("zip");
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      const data = b.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      throw new Error("zip");
    });
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const c = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const tidy = (s: string) =>
  s
    .split("\n")
    // Spaces collapsed, except the indentation of nested list items.
    .map((line) => {
      const indent = /^ *(?=- )/.exec(line)?.[0] ?? "";
      return indent + line.replace(/[ \t\u00a0]+/g, " ").trim();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);

/** Text of one Word paragraph or table cell: runs, tabs and line breaks. */
const wordRuns = (xml: string) =>
  [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\b[^>]*\/>|<w:(tab|ptab)\b[^>]*\/>|<w:(br|cr)\b[^>]*\/>/g)]
    .map((m) => (m[2] ? "\t" : m[3] ? "\n" : decode(m[1] ?? "")))
    .join("");

/** One Word paragraph as Markdown: headings and list items marked. */
function wordParagraph(p: string): string {
  const text = wordRuns(p).replace(/\t/g, " ").trim();
  if (!text) return "";
  const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? "";
  const level = /^(?:heading|titre|berschrift|titolo)\s*(\d)$/i.exec(style.replace(/[_-]/g, ""))?.[1];
  if (level) return `${"#".repeat(Math.min(6, Number(level) + 1))} ${text}`;
  if (/^(title|titre)$/i.test(style)) return `# ${text}`;
  if (/<w:numPr>/.test(p) || /list/i.test(style)) {
    const depth = Number(/<w:ilvl w:val="(\d)"/.exec(p)?.[1] ?? 0);
    return `${"  ".repeat(Math.min(depth, 4))}- ${text}`;
  }
  return text;
}

function docxText(zip: Map<string, () => Buffer>): string | undefined {
  const main = zip.get("word/document.xml");
  if (!main) return undefined;
  const body = main().toString("utf8");
  const out: string[] = [];
  // Tables become Markdown rows; everything else is paragraphs, in order.
  for (const [block] of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g)) {
    if (block.startsWith("<w:tbl>")) {
      const rows = [...block.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(([tr]) =>
        [...tr.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(([tc]) => wordRuns(tc).replace(/\s+/g, " ").replace(/\|/g, "/").trim()),
      );
      const width = Math.max(0, ...rows.map((r) => r.length));
      if (!width) continue;
      out.push("");
      rows.forEach((r, i) => {
        out.push(`| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`);
        if (i === 0) out.push(`|${" --- |".repeat(width)}`);
      });
      out.push("");
    } else {
      const line = wordParagraph(block);
      out.push(line);
      if (line.startsWith("#")) out.push("");
    }
  }
  return tidy(out.join("\n"));
}

function odtText(zip: Map<string, () => Buffer>): string | undefined {
  const content = zip.get("content.xml");
  if (!content) return undefined;
  const xml = content()
    .toString("utf8")
    // Tables become Markdown rows (a cell's paragraphs on one line).
    .replace(/<table:table\b[\s\S]*?<\/table:table>/g, (table) => {
      const rows = [...table.matchAll(/<table:table-row\b[\s\S]*?<\/table:table-row>/g)].map(([tr]) =>
        [...tr.matchAll(/<table:table-cell\b[\s\S]*?<\/table:table-cell>|<table:table-cell\b[^>]*\/>/g)].map(([tc]) =>
          tc.replace(/<\/text:p>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").replace(/\|/g, "/").trim(),
        ),
      );
      const width = Math.max(0, ...rows.map((r) => r.length));
      if (!width) return "";
      return `\n\n${rows.map((r, i) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |${i === 0 ? `\n|${" --- |".repeat(width)}` : ""}`).join("\n")}\n\n`;
    })
    .replace(/<text:tab\/>/g, " ")
    .replace(/<text:line-break\/>/g, "\n")
    .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, n) => " ".repeat(Math.min(Number(n ?? 1), 8)))
    .replace(/<text:h\b[^>]*?(?:text:outline-level="(\d)")?[^>]*>([\s\S]*?)<\/text:h>/g, (_, l, t) => `\n\n${"#".repeat(Math.min(6, Number(l ?? 1) + 1))} ${t}\n\n`)
    .replace(/<text:list-item\b[^>]*>/g, "\n- ")
    .replace(/<\/text:p>/g, "\n")
    .replace(/<office:annotation\b[\s\S]*?<\/office:annotation>/g, "")
    .replace(/<[^>]+>/g, "");
  return tidy(decode(xml).replace(/- \n+/g, "- "));
}

/** Plain text of an RTF document: control words dropped, paragraphs and escaped characters kept. */
function rtfText(src: string): string {
  const out: string[] = [];
  // Groups that hold no body text (fonts, colors, styles, pictures, metadata).
  const skip = /^\\\*|^\\(fonttbl|colortbl|stylesheet|info|pict|header|footer|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|latentstyles|datastore)\b/;
  let depth = 0;
  let skipFrom = -1;
  let i = 0;
  let uc = 1;
  let drop = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "{") {
      depth++;
      i++;
      if (skipFrom < 0 && skip.test(src.slice(i, i + 40))) skipFrom = depth;
      continue;
    }
    if (c === "}") {
      if (depth === skipFrom) skipFrom = -1;
      depth--;
      i++;
      continue;
    }
    const skipping = skipFrom >= 0;
    if (c === "\\") {
      const m = /^\\(?:([a-z]+)(-?\d+)? ?|'([0-9a-f]{2})|([\\{}~_-])|\r?\n)/i.exec(src.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      if (skipping) continue;
      if (m[3]) {
        if (drop > 0) drop--;
        else out.push(Buffer.from([parseInt(m[3], 16)]).toString("latin1"));
      } else if (m[4]) out.push(m[4] === "~" ? " " : m[4] === "_" ? "-" : m[4] === "-" ? "" : m[4]);
      else if (m[1]) {
        const word = m[1];
        if (word === "uc") uc = Number(m[2] ?? 1);
        else if (word === "u") {
          const n = Number(m[2]);
          out.push(String.fromCharCode(n < 0 ? n + 65536 : n));
          drop = uc;
        } else if (word === "par" || word === "line" || word === "row") out.push("\n");
        else if (word === "tab" || word === "cell") out.push(" ");
      } else out.push("\n");
      continue;
    }
    i++;
    if (skipping || c === "\r" || c === "\n") continue;
    if (drop > 0) {
      drop--;
      continue;
    }
    out.push(c);
  }
  return tidy(out.join(""));
}

export type ConvertedDoc = { text: string } | { error: string };

/** A Word, OpenDocument or RTF file as Markdown; undefined when it is none of these. */
export function documentText(b: Buffer, name: string): ConvertedDoc | undefined {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (b.toString("latin1", 0, 5) === "{\\rtf") {
    const text = rtfText(b.toString("latin1"));
    return text ? { text } : { error: "Document RTF vide" };
  }
  if (ext === "doc" && b.length > 8 && b.readUInt32BE(0) === 0xd0cf11e0) {
    return { error: "Ancien format Word (.doc) : enregistre-le en .docx ou en PDF" };
  }
  if (ext === "pages") return { error: "Fichier Pages : exporte-le en Word (.docx) ou en PDF" };
  if (b.length < 4 || b.readUInt32LE(0) !== 0x04034b50) return undefined;
  let zip: Map<string, () => Buffer> | undefined;
  try {
    zip = readZip(b);
  } catch {
    zip = undefined;
  }
  if (!zip || !(zip.has("word/document.xml") || zip.has("content.xml"))) {
    return ext === "docx" || ext === "odt" ? { error: "Document illisible : enregistre-le à nouveau ou exporte-le en PDF" } : undefined;
  }
  try {
    const text = zip.has("word/document.xml") ? docxText(zip) : odtText(zip);
    return text ? { text } : { error: "Document vide : aucun texte trouvé" };
  } catch {
    return { error: "Document illisible : enregistre-le à nouveau ou exporte-le en PDF" };
  }
}
