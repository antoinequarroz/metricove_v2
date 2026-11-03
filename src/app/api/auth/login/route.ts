import { NextResponse } from "next/server";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/server/auth";

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  const { password: given } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password) return NextResponse.json({ ok: true });
  if (!given || !safeEqual(given, password)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
