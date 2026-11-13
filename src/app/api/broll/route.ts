import { NextResponse } from "next/server";
import { pexelsKey } from "@/server/broll";
import { macBroll } from "@/server/montage";

export const dynamic = "force-dynamic";

/** B-roll picker: the shots of the Mac B-roll folder (as the Mac last sent them) and whether Pexels can be searched. */
export function GET() {
  return NextResponse.json({ mine: macBroll(), pexels: !!pexelsKey() });
}
