// Texte d'un document bureautique (Word, OpenDocument, RTF, PowerPoint) pour que Claude le lise :
// textutil sur le Mac (docx, doc, odt, rtf), sinon lecture directe du XML dans le zip (docx, odt, pptx).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { run } from "./util.mjs";

const MAX = 200_000;

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");

/** Le texte d'un XML de traitement de texte : un paragraphe par ligne. */
function xmlText(xml) {
  return decode(xml
    .replace(/<w:tab\/>|<text:tab\/>/g, "\t")
    .replace(/<w:br\/>|<text:line-break\/>|<a:br\/>/g, "\n")
    .replace(/<\/w:p>|<\/text:p>|<\/text:h>|<\/a:p>/g, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const unzip = (file, ...names) => run("unzip", ["-p", file, ...names]).catch(() => "");

/** Texte brut d'un RTF, sans textutil : les mots, sans les commandes. */
function rtfText(rtf) {
  // Retire les tables (polices, couleurs, styles, infos) : des groupes entiers, accolades comprises.
  let body = rtf;
  for (const kw of ["fonttbl", "colortbl", "stylesheet", "info", "\\*"]) {
    for (;;) {
      const at = body.search(new RegExp(`\\{\\\\${kw}`));
      if (at < 0) break;
      let depth = 0, end = at;
      for (; end < body.length; end++) {
        if (body[end] === "\\") { end++; continue; }
        if (body[end] === "{") depth++;
        else if (body[end] === "}" && --depth === 0) break;
      }
      body = body.slice(0, at) + body.slice(end + 1);
    }
  }
  return body
    .replace(/\\par[d]?\b ?/g, "\n").replace(/\\line\b ?/g, "\n").replace(/\\tab\b ?/g, "\t")
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => Buffer.from([parseInt(h, 16)]).toString("latin1"))
    .replace(/\\u(-?\d+) ?(\\'[0-9a-f]{2}|\?)?/gi, (_, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n))
    .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Écrit à côté de `file` un .txt avec son texte et renvoie son chemin ; null si rien n'a pu être lu.
 * `type` : docx, doc, odt, rtf ou pptx.
 */
export async function officeToText(file, type) {
  let text = "";
  // textutil (macOS) lit fidèlement Word, OpenDocument et RTF.
  if (["docx", "doc", "odt", "rtf"].includes(type) && existsSync("/usr/bin/textutil")) {
    text = await run("/usr/bin/textutil", ["-convert", "txt", "-stdout", file]).catch(() => "");
  }
  if (!text.trim()) {
    if (type === "docx") text = xmlText(await unzip(file, "word/document.xml"));
    else if (type === "odt") text = xmlText(await unzip(file, "content.xml"));
    else if (type === "rtf") text = rtfText(readFileSync(file, "latin1"));
    else if (type === "pptx") {
      const list = await run("unzip", ["-Z1", file]).catch(() => "");
      const slides = list.split("\n").filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
      const parts = [];
      for (const [i, s] of slides.entries()) parts.push(`--- Diapositive ${i + 1} ---\n${xmlText(await unzip(file, s))}`);
      text = parts.join("\n\n");
    }
  }
  text = text.trim().slice(0, MAX);
  if (!text) return null;
  const out = `${file}.txt`;
  writeFileSync(out, text);
  return out;
}
