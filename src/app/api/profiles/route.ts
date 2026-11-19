import { NextResponse } from "next/server";
import { listProfiles, listStyles } from "@/server/profiles";

export const dynamic = "force-dynamic";

/** The default style of every project (`profiles`) and all the styles of every project (`styles`, default first). */
export function GET() {
  return NextResponse.json({ profiles: listProfiles(), styles: listStyles() });
}
