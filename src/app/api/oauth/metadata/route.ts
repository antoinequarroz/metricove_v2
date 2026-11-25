import { NextResponse } from "next/server";
import { publicOrigin } from "@/server/mcp/keys";

export const dynamic = "force-dynamic";

/** OAuth server metadata (RFC 8414), served at /.well-known/oauth-authorization-server: how Claude connects. */
export function GET(req: Request) {
  const origin = publicOrigin(req);
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["metricove"],
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } },
  );
}
