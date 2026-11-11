import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";
import { checkPassword, currentSessionToken, passwordRequired, SESSION_MAX_AGE, setPassword } from "@/server/password";

/** Changes the app password. This device stays logged in, every other one is logged out. */
export async function POST(req: Request) {
  // Only a logged-in person changes the password: a script with API_TOKEN must not.
  if (req.headers.get("authorization")) return NextResponse.json({ error: "Changez le mot de passe depuis l'app" }, { status: 403 });
  const { current, next } = (await req.json().catch(() => ({}))) as { current?: string; next?: string };
  if (passwordRequired() && !checkPassword(current)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Mot de passe actuel incorrect" }, { status: 400 });
  }
  if (!next || next.length < 10) return NextResponse.json({ error: "Le nouveau mot de passe doit faire au moins 10 caractères" }, { status: 400 });
  if (next.length > 200) return NextResponse.json({ error: "Mot de passe trop long" }, { status: 400 });
  setPassword(next);
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
