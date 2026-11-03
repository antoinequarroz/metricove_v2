import { NextResponse } from "next/server";
import { freeDisk, listJobs, listRushes, workerStatus } from "@/server/montage";

export const dynamic = "force-dynamic";

/** Everything the editing page needs, in one call (polled while a job runs). */
export function GET() {
  return NextResponse.json({ jobs: listJobs(), rushes: listRushes(), worker: workerStatus(), freeDisk: freeDisk() });
}
