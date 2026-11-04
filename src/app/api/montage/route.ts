import { NextResponse } from "next/server";
import { freeDisk, listJobs, listRushes, workerStatus } from "@/server/montage";

export const dynamic = "force-dynamic";

/** Everything the editing page needs, in one call (polled while a job runs). */
export function GET() {
  // Drawings are heavy and only the Mac needs them: the page gets a link instead.
  const jobs = listJobs().map((j) =>
    j.marks ? { ...j, marks: j.marks.map((m) => ({ ...m, image: m.image ? `/api/montage/jobs/${j.id}/marks/${m.id}` : undefined })) } : j,
  );
  return NextResponse.json({ jobs, rushes: listRushes(), worker: workerStatus(), freeDisk: freeDisk() });
}
