import { NextResponse } from "next/server";
import { scanRushes, workerSeen } from "@/server/montage";

/** The Mac reports the videos of its rush folder. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { rushes?: unknown };
  if (!Array.isArray(body.rushes)) return NextResponse.json({ error: "Champ « rushes » manquant" }, { status: 400 });
  workerSeen({ worker: "mac" });
  return NextResponse.json({ count: scanRushes(body.rushes) });
}
