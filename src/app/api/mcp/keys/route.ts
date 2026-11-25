import { NextResponse } from "next/server";
import { listKeys, revokeKeys } from "@/server/mcp/keys";

export const dynamic = "force-dynamic";

/** The connectors that can read Metricove (signed-in session or API_TOKEN, like the rest of /api). */
export function GET() {
  return NextResponse.json({ keys: listKeys() });
}

/** Cuts one connector off (?id=…), or all of them. They must sign in again to come back. */
export function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? undefined;
  return NextResponse.json({ revoked: revokeKeys(id) });
}
