import { NextResponse } from "next/server";
import { backTo, createCode, readAuthorize } from "@/server/mcp/keys";

export const dynamic = "force-dynamic";

const go = (url: string) => new NextResponse(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });

/**
 * The answer of the consent page: a one-time code for the connector, or a refusal.
 * Behind the middleware like the rest of /api: only a signed-in session gets here.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : null;
  };
  const request = readAuthorize(get);
  if (typeof request === "string") return NextResponse.json({ error: request }, { status: 400 });
  if (get("decision") !== "allow") return go(backTo(request, { error: "access_denied" }));
  return go(backTo(request, { code: createCode(request) }));
}
