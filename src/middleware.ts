import { NextResponse, type NextRequest } from "next/server";
import { safeEqual, SESSION_COOKIE, sessionToken, validMediaSignature } from "./server/auth";

// Everything is private once APP_PASSWORD is set.
// Scripts (Hermes, Claude Code) can use "Authorization: Bearer <API_TOKEN>" on /api routes.
export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const apiToken = process.env.API_TOKEN;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (apiToken && bearer && req.nextUrl.pathname.startsWith("/api/") && safeEqual(bearer, apiToken)) return NextResponse.next();

  // Signed, expiring video links, for Instagram, Facebook and Co. to download the video.
  const media = req.nextUrl.pathname.match(/^\/api\/media\/([^/]+)\/file$/);
  if (media && (await validMediaSignature(media[1], req.nextUrl.searchParams.get("exp"), req.nextUrl.searchParams.get("sig")))) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/auth/login|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
