import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";
import { checkPassword, currentSessionToken, passwordRequired, SESSION_MAX_AGE } from "@/server/password";

export async function POST(req: Request) {
  const { password: given } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!passwordRequired()) return NextResponse.json({ ok: true });
  if (!checkPassword(given)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, (await currentSessionToken())!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
