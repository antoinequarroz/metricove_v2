import { NextResponse } from "next/server";
import type { MontageFormat, MontageJob } from "@/lib/montage";
import { listProjects } from "@/server/db";
import { getRushRow, listJobs, saveJob } from "@/server/montage";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

type Body = {
  kind?: MontageJob["kind"];
  title?: string;
  projectId?: string;
  brief?: Partial<MontageJob["brief"]>;
  rushIds?: string[];
  script?: string;
};

/** Asks the Mac for an edit (kind "montage", with rushes) or for a teleprompter script (kind "script"). */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const kind = b.kind === "script" ? "script" : "montage";
  const format: MontageFormat = ["9:16", "4:5", "1:1", "16:9"].includes(b.brief?.format as string) ? (b.brief!.format as MontageFormat) : "9:16";
  const rushIds = [...new Set(b.rushIds ?? [])].filter((id) => getRushRow(id));
  if (kind === "montage" && !rushIds.length) return NextResponse.json({ error: "Choisissez au moins un rush" }, { status: 400 });
  if (kind === "script" && !b.brief?.instructions?.trim()) return NextResponse.json({ error: "Décrivez l'idée de la vidéo" }, { status: 400 });
  const clip = (s: unknown, n: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, n) : undefined);
  const now = new Date().toISOString();
  const job: MontageJob = {
    id: crypto.randomUUID(),
    kind,
    title: clip(b.title, 120) ?? (kind === "script" ? "Texte de prompteur" : "Nouveau montage"),
    projectId: listProjects().some((p) => p.id === b.projectId) ? b.projectId : undefined,
    status: "queued",
    action: kind === "script" ? "script" : "propose",
    brief: {
      format,
      seconds: Number.isFinite(b.brief?.seconds) && b.brief!.seconds! > 0 ? Math.round(b.brief!.seconds!) : undefined,
      instructions: clip(b.brief?.instructions, 2000),
      hook: clip(b.brief?.hook, 300),
      cta: clip(b.brief?.cta, 300),
    },
    script: clip(b.script, 10_000),
    rushIds,
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json({ job: saveJob(job, null) }, { status: 201 });
}
