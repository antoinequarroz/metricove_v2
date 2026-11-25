import { NextResponse } from "next/server";
import { publicOrigin } from "@/server/mcp/keys";

export const dynamic = "force-dynamic";

/** Protected resource metadata (RFC 9728), served at /.well-known/oauth-protected-resource: the MCP server and who issues its keys. */
export function GET(req: Request) {
  const origin = publicOrigin(req);
  return NextResponse.json(
    { resource: `${origin}/mcp`, resource_name: "Metricove", authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: ["metricove"] },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } },
  );
}
