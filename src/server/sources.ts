import "server-only";
import fs from "node:fs";
import path from "node:path";
import { MAX_SOURCE_BYTES, type SourceFile, type SourceType } from "@/lib/strategy";
import { DATA_DIR } from "./db";

// Documents sent to be read by Claude (a strategy, a charte): kept until the reading is done with,
// then deleted with its request. One never used is deleted after two days.

const ID = /^[0-9a-f-]{36}\.(pdf|png|jpg|webp|txt|md|css|html|csv|docx|doc|odt|rtf|pptx)$/;
const dir = (projectId: string) => path.join(DATA_DIR, "sources", projectId.replace(/[^\w-]/g, ""));
const TEXT_TYPES: Record<string, SourceType> = { txt: "txt", text: "txt", md: "md", markdown: "md", css: "css", html: "html", htm: "html", csv: "csv" };
/** Office documents: a zip (docx, odt, pptx) or an old Word file, told apart by their extension. */
const ZIP_TYPES: Record<string, SourceType> = { docx: "docx", odt: "odt", pptx: "pptx" };

/** What the bytes really are: a PDF, an image, or text with a known extension. */
function kindOf(b: Buffer, name: string): SourceType | undefined {
  if (b.length > 4 && b.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  const suffix = path.extname(name).slice(1).toLowerCase();
  if (b.length > 4 && b.readUInt32BE(0) === 0x504b0304) return ZIP_TYPES[suffix];
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return suffix === "doc" ? "doc" : undefined;
  if (b.toString("latin1", 0, 5) === "{\\rtf") return "rtf";
  const ext = TEXT_TYPES[suffix];
  if (!ext || b.includes(0)) return undefined;
  // Text must be readable UTF-8.
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return ext;
  } catch {
    return undefined;
  }
}

function sweep(projectId: string) {
  const d = dir(projectId);
  if (!fs.existsSync(d)) return;
  const old = Date.now() - 2 * 86_400_000;
  for (const f of fs.readdirSync(d)) {
    const file = path.join(d, f);
    try {
      if (fs.statSync(file).mtimeMs < old) fs.rmSync(file, { force: true });
    } catch {}
  }
}

export function addSource(projectId: string, bytes: Buffer, name: string): SourceFile | string {
  if (!bytes.length) return "Fichier vide";
  if (bytes.length > MAX_SOURCE_BYTES) return "Fichier trop lourd (9 Mo au plus) : exporte une version allégée";
  const clean = name.replace(/[\0-\x1f]/g, "").trim().slice(0, 120) || "Document";
  const type = kindOf(bytes, clean);
  if (!type) return "Format non lu : PDF, Word (.docx, .doc), OpenDocument, RTF, PowerPoint (.pptx), image (JPEG, PNG, WebP), texte, Markdown, CSV, CSS ou HTML";
  sweep(projectId);
  const id = `${crypto.randomUUID()}.${type}`;
  fs.mkdirSync(dir(projectId), { recursive: true });
  fs.writeFileSync(path.join(dir(projectId), id), bytes);
  return { id, name: clean, type };
}

/** The file of a document of this project, if it is one. */
export function sourceFile(projectId: string, id: string): string | undefined {
  if (!ID.test(id)) return undefined;
  const file = path.join(dir(projectId), id);
  return fs.existsSync(file) ? file : undefined;
}

export function removeSources(projectId: string, ids: string[]) {
  for (const id of ids) if (ID.test(id)) fs.rmSync(path.join(dir(projectId), id), { force: true });
}

export const SOURCE_MIME: Record<SourceType, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
