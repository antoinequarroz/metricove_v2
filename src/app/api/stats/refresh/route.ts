import { NextResponse } from "next/server";
import { getStats, refreshStats } from "@/server/stats";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Reads fresh numbers now, X included (a few cents). */
export async function POST() {
  try {
    const warnings = await refreshStats({ paid: true });
    return NextResponse.json({ ...getStats(), warnings });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
