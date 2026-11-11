// Voix d'un projet (profil de style réglé dans Metricove, Réglages → Styles) : le ton écrit par Antoine,
// et le SKILL.md d'un skill du Mac que Claude lit avant d'écrire.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { log } from "./util.mjs";

const MAX_SKILL = 8000;

/** Le texte du SKILL.md du dossier donné, ou "" (dossier absent, autre fichier, trop gros). Seul un SKILL.md est lu. */
export function skillText(folder) {
  if (typeof folder !== "string" || !folder.trim()) return "";
  let p = folder.trim();
  if (p === "~" || p.startsWith("~/")) p = join(homedir(), p.slice(1));
  p = resolve(p);
  const file = basename(p) === "SKILL.md" ? p : join(p, "SKILL.md");
  try {
    if (!existsSync(file) || !statSync(file).isFile()) {
      log(`skill du projet introuvable : ${file}`);
      return "";
    }
    return readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim().slice(0, MAX_SKILL);
  } catch (e) {
    log(`skill du projet illisible (${file}) :`, e.message);
    return "";
  }
}

/**
 * Les lignes « ton et règles » du projet pour un prompt : le ton du profil s'il existe, sinon `fallback`
 * (les règles d'origine du programme), puis le guide du skill.
 */
export function voiceRules(job, fallback) {
  const tone = String(job.voice?.tone || "").trim();
  const rules = tone
    ? tone.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith("-") ? l : `- ${l}`)).join("\n")
    : fallback;
  const skill = skillText(job.voice?.skill);
  return `${rules}${skill ? `\n- Guide de style du projet (skill), à suivre pour le ton et la forme ; les règles ci-dessus et les limites de longueur passent avant :\n<guide>\n${skill}\n</guide>` : ""}`;
}
