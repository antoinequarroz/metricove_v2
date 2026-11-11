import { NextResponse } from "next/server";
import { getStats, refreshStats } from "@/server/stats";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Reads fresh numbers now. With { paid: true } (the "Actualiser" button), X is read too, for a few cents. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { paid?: boolean };
  try {
    const warnings = await refreshStats({ paid: body.paid === true });
    return NextResponse.json({ ...getStats(), warnings });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
