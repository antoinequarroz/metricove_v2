import { NextResponse } from "next/server";
import { claimJob, listRushes, workerSeen } from "@/server/montage";

export const dynamic = "force-dynamic";

/**
 * The Mac asks for work every few seconds. 204 = nothing to do.
 * Otherwise: the job, what to do, and its rushes (with a download URL when the file waits on the server).
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { worker?: string; version?: string };
  workerSeen({ worker: b.worker?.slice(0, 40), version: b.version?.slice(0, 20) });
  const job = claimJob();
  if (!job) return new Response(null, { status: 204 });
  const rushes = listRushes()
    .filter((r) => job.rushIds.includes(r.id))
    .map((r) => ({ ...r, thumb: undefined, url: r.origin === "upload" ? `/api/montage/rushes/${r.id}/file` : undefined }));
  return NextResponse.json({ job, action: job.action, rushes });
}
