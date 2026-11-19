import fs from "node:fs";
import { NextResponse } from "next/server";
import { isVideoJob } from "@/lib/montage";
import { boardFile, getJob, saveBoard, saveJob, staleWrite, touchJob, touchWorker } from "@/server/montage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The storyboard of a video reel (worker 0.14.0), sent by the Mac before it renders: { image: "data:image/jpeg;base64,…",
 * frames: [{ id, t }], run? }, one tile per beat at the instant it is settled. The Studio shows it while the video renders.
 * `run` (optional): the `run.startedAt` of the Mac's claim.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  // The body first (up to 800 KB, slow on a home uplink), the job after: from here on everything is synchronous, so a
  // stop, a cancel or a DELETE that arrived while the body was coming in is seen, and a deleted job is never saved back.
  const raw: unknown = await req.json().catch(() => null);
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Montage introuvable" }, { status: 404 });
  if (!isVideoJob(job)) return NextResponse.json({ error: "Planche réservée aux reels vidéo" }, { status: 400 });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "Planche attendue : { image, frames }" }, { status: 400 });
  const b = raw as { image?: unknown; frames?: unknown; run?: unknown };
  // Only while the Mac holds the job: a board from a run that is over (stopped, released, or a new request queued
  // since) would show an old storyboard in the Studio.
  const stale = staleWrite(job, b.run, true);
  if (stale) return NextResponse.json({ error: stale }, { status: 409 });
  const error = saveBoard(job, b.image, b.frames);
  if (error) return NextResponse.json({ error }, { status: 400 });
  saveJob(job);
  touchJob(job.id);
  touchWorker(job.id);
  return NextResponse.json({ board: job.run?.board });
}

/** The storyboard image (`?v=` only changes the address when a new one arrives). Kept until the previews are dropped. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const file = getJob(id) ? boardFile(id) : undefined;
  if (!file || !fs.existsSync(file)) return new Response("Introuvable", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
}
