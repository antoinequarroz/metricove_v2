import "server-only";
import type { Project } from "@/lib/types";
import { listAccounts, listProjects } from "./db";

/** Keeps only names and accounts that make sense. */
export function cleanProject(body: Partial<Project>, current?: Project): Project | string {
  const name = (body.name ?? current?.name ?? "").trim().slice(0, 60);
  if (!name) return "Le nom du projet est obligatoire";
  const known = new Set(listAccounts().map((a) => a.id));
  const accountIds = [...new Set((body.accountIds ?? current?.accountIds ?? []).filter((id) => known.has(id)))];
  const hue = Number.isFinite(body.hue) ? Math.round(Number(body.hue)) % 360 : (current?.hue ?? Math.floor(Math.random() * 360));
  if (listProjects().some((p) => p.id !== current?.id && p.name.toLowerCase() === name.toLowerCase())) return "Un projet porte déjà ce nom";
  return { id: current?.id ?? `prj-${crypto.randomUUID().slice(0, 8)}`, name, hue, accountIds };
}
