import { NextResponse } from "next/server";
import { redeemCode } from "@/server/mcp/keys";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
const oauthError = (error: string, description: string) => NextResponse.json({ error, error_description: description }, { status: 400, headers: CORS });

/** Trades the one-time code (with its PKCE verifier) for the connector's key. Form or JSON body. */
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  const data: Record<string, unknown> = type.includes("application/json")
    ? (((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>)
    : Object.fromEntries(new URLSearchParams(await req.text()));
  if (data.grant_type !== "authorization_code") return oauthError("unsupported_grant_type", "Seul authorization_code est accepté");
  const token = redeemCode({ code: data.code, clientId: data.client_id, redirectUri: data.redirect_uri, codeVerifier: data.code_verifier });
  if (!token) return oauthError("invalid_grant", "Code invalide, expiré ou déjà utilisé");
  return NextResponse.json({ access_token: token, token_type: "Bearer", scope: "metricove" }, { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}
