import { NextResponse } from "next/server";
import { mcpAuthorized, publicOrigin } from "@/server/mcp/keys";
import { handleBody, SUPPORTED_VERSIONS } from "@/server/mcp/server";

export const dynamic = "force-dynamic";

/**
 * The MCP server of Metricove, read only, for Claude and other agents. Also served at /mcp.
 * Only a key opens it ("Authorization: Bearer …": a connector's key or API_TOKEN), never the session
 * cookie: a web page cannot use it on behalf of whoever is signed in, so it can answer any origin.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Cache-Control": "no-store",
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => NextResponse.json(data, { status, headers: { ...CORS, ...extra } });

/** No key: says where to get one (OAuth), so Claude can open the sign-in page by itself. */
const unauthorized = (req: Request) =>
  json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Clé manquante ou révoquée" } }, 401, {
    "WWW-Authenticate": `Bearer realm="Metricove", resource_metadata="${publicOrigin(req)}/.well-known/oauth-protected-resource/mcp"`,
  });

export async function POST(req: Request) {
  if (!mcpAuthorized(req.headers.get("authorization"))) return unauthorized(req);
  const version = req.headers.get("mcp-protocol-version");
  if (version && !SUPPORTED_VERSIONS.includes(version)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported protocol version: ${version}` } }, 400);
  const text = await req.text();
  if (text.length > 1_000_000) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const out = handleBody(body);
  return out === null ? new NextResponse(null, { status: 202, headers: CORS }) : json(out);
}

// Stateless server: no stream to open, no session to close.
export async function GET(req: Request) {
  if (!mcpAuthorized(req.headers.get("authorization"))) return unauthorized(req);
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
