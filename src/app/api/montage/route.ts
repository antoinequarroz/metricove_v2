import { NextResponse } from "next/server";
import { freeDisk, listJobs, listRushes, pageJob, workerStatus } from "@/server/montage";

export const dynamic = "force-dynamic";

/** Everything the editing page needs, in one call (polled while a job runs). */
export function GET() {
  // Drawings are heavy and only the Mac needs them: the page gets a link instead.
  // The code Claude wrote for a reel stays here too: the page only learns which scenes have some.
  const jobs = listJobs().map((j) => ({
    ...pageJob(j),
    ...(j.marks ? { marks: j.marks.map((m) => ({ ...m, image: m.image ? `/api/montage/jobs/${j.id}/marks/${m.id}` : undefined })) } : {}),
  }));
  return NextResponse.json({ jobs, rushes: listRushes(), worker: workerStatus(), freeDisk: freeDisk() });
}
