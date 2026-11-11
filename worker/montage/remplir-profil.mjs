#!/usr/bin/env node
// Remplit le profil de style d'un projet dans Metricove (Réglages → Styles) à partir d'un fichier de profils/.
//   node remplir-profil.mjs livrematch            remplit le profil
//   node remplir-profil.mjs livrematch --dry-run  montre ce qui serait envoyé, sans rien changer
// Ce qui existe déjà est gardé : la couleur, la signature, le logo, les images, les posts modèles et les idées
// déjà saisis. Le ton est remplacé. Les posts modèles viennent du fichier, puis des posts déjà publiés du projet.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, loadConfig } from "./lib/util.mjs";
import { Api } from "./lib/api.mjs";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry-run");
const file = join(HERE, "profils", `${name}.json`);
if (!name || !/^[\w-]+$/.test(name) || !existsSync(file)) {
  console.error("Usage : node remplir-profil.mjs <nom> [--dry-run]   (un fichier profils/<nom>.json doit exister)");
  process.exit(1);
}
const spec = JSON.parse(readFileSync(file, "utf8"));
const api = new Api(loadConfig());

const state = await api.req("GET", "/api/state");
const project = state.projects.find((p) => new RegExp(spec.project, "i").test(p.name));
if (!project) {
  console.error(`Aucun projet dont le nom correspond à « ${spec.project} ». Projets : ${state.projects.map((p) => p.name).join(", ") || "aucun"}.`);
  process.exit(1);
}
const { profiles } = await api.req("GET", "/api/profiles");
const current = profiles[project.id];
if (!current?.refs) {
  console.error("Ce Metricove ne connaît pas encore les références : installe d'abord la dernière image sur le serveur.");
  process.exit(1);
}

const texts = (list) => list.map((t) => String(t || "").trim()).filter(Boolean);
const unique = (list) => [...new Set(list)];

// Posts modèles : ceux du fichier, ceux déjà saisis, puis les derniers posts publiés du projet.
const fromFile = spec.examplesFile && existsSync(join(HERE, spec.examplesFile))
  ? readFileSync(join(HERE, spec.examplesFile), "utf8").split(/^--- exemple ---$/m).map((p) => p.replace(/^# .*$/m, "").trim())
  : [];
const published = state.posts
  .filter((p) => p.status === "published" && p.accountIds.some((id) => project.accountIds.includes(id)) && (p.caption || "").trim().length >= 80)
  .sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt)))
  .map((p) => p.caption.trim());
const kept = unique(texts([...(spec.examples || []), ...fromFile, ...current.refs.examples.map((e) => e.text)])).slice(0, 8);
const examples = unique([...kept, ...unique(published).slice(0, spec.publishedExamples ?? 0)]).slice(0, 8);
const ideas = unique(texts([...current.refs.ideas.map((e) => e.text), ...(spec.ideas || [])])).slice(0, 50);

const body = {
  ...(spec.look ? { look: spec.look } : {}),
  ...(spec.tone ? { tone: spec.tone } : {}),
  ...(spec.skill ? { skill: spec.skill } : {}),
  refs: { examples: examples.map((text) => ({ text })), ideas: ideas.map((text) => ({ text })) },
};

console.log(`Projet : ${project.name}`);
console.log(`Apparence : ${spec.look ? Object.entries(spec.look).map(([k, v]) => `${k}=${v}`).join(", ") : "inchangée"} (couleur, signature et logo gardés)`);
console.log(`Ton : ${spec.tone ? `${spec.tone.length} caractères` : "inchangé"}`);
console.log(`Posts modèles : ${examples.length} (dont ${examples.filter((e) => published.includes(e) && !kept.includes(e)).length} pris dans tes posts publiés)`);
for (const e of examples) console.log(`  · ${e.split("\n")[0].slice(0, 90)}`);
console.log(`Idées : ${ideas.length}`);
if (dry) {
  console.log("Essai : rien n'a été changé.");
} else {
  await api.req("PUT", `/api/profiles/${project.id}`, { json: body });
  console.log("Profil enregistré. Regarde-le dans Réglages → Styles.");
}
