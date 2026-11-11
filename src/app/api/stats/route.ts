import { NextResponse } from "next/server";
import { getStats } from "@/server/stats";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getStats());
}
