import { NextResponse } from "next/server";
import { listProfiles } from "@/server/profiles";

export const dynamic = "force-dynamic";

/** The style profile of every project. */
export function GET() {
  return NextResponse.json({ profiles: listProfiles() });
}
