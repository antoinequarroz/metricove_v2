import { NextResponse } from "next/server";
import { getState } from "@/server/state";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getState());
}
