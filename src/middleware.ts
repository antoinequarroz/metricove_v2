import { NextResponse, type NextRequest } from "next/server";
import { safeEqual, SESSION_COOKIE, validMediaSignature } from "./server/auth";
import { currentSessionToken, mediaSecret } from "./server/password";

// Everything is private once a password is set (APP_PASSWORD, or the one changed in Réglages).
// Scripts (Hermes, Claude Code) can use "Authorization: Bearer <API_TOKEN>" on /api routes.
export async function middleware(req: NextRequest) {
  // Called by AI agents and their servers, never with the cookie: the MCP server (it checks its own
  // key), the OAuth discovery documents and the code exchange, and the public feed of published videos. The consent page itself stays private.
  if (/^\/(mcp|api\/mcp|api\/oauth\/(register|token|metadata|protected-resource)|api\/public\/videos|\.well-known\/.*)$/.test(req.nextUrl.pathname)) return NextResponse.next();

  const expected = await currentSessionToken();
  if (!expected) return NextResponse.next();

  const apiToken = process.env.API_TOKEN;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (apiToken && bearer && req.nextUrl.pathname.startsWith("/api/") && safeEqual(bearer, apiToken)) return NextResponse.next();

  // Signed, expiring video links, for Instagram, Facebook and Co. to download the video.
  // Covers are signed with "<id>:cover", so a video link can't be reused for its cover and the other way round.
  const media = req.nextUrl.pathname.match(/^\/api\/media\/([^/]+)\/(file|cover)$/);
  const signed = media && (media[2] === "file" ? media[1] : `${media[1]}:cover`);
  if ((req.method === "GET" || req.method === "HEAD") && signed && (await validMediaSignature(signed, req.nextUrl.searchParams.get("exp"), req.nextUrl.searchParams.get("sig"), mediaSecret())))
    return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && safeEqual(cookie, expected)) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const url = req.nextUrl.clone();
  // Claude asking for access: back to its consent page once signed in.
  const next = req.nextUrl.pathname === "/oauth/authorize" ? `${req.nextUrl.pathname}${req.nextUrl.search}` : "";
  url.pathname = "/login";
  url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Node runtime: the password changed in Réglages is read from a file in DATA_DIR.
  runtime: "nodejs",
  // Upload chunks check their own access (src/server/request-auth.ts): the middleware would use up their body.
  matcher: ["/((?!login|api/uploads|api/auth/login|api/auth/compte|_next/static|_next/image|brand/|favicon.ico|apple-icon|manifest.webmanifest).*)"],
};
