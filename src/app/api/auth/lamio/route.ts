import { cookies } from "next/headers";
import { safeEqual, SESSION_COOKIE } from "@/server/auth";
import { LAMIO_STATE_COOKIE, lamioConfig, lamioUser } from "@/server/lamio";
import { currentSessionToken, SESSION_MAX_AGE } from "@/server/password";

export const dynamic = "force-dynamic";

const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");
const clearState = () => `${LAMIO_STATE_COOKIE}=; Path=/api/auth/lamio; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

// Relative addresses stay on this app whatever sits in front of it.
function go(location: string, session?: string) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearState());
  if (session) headers.append("Set-Cookie", `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure()}`);
  return new Response(null, { status: 302, headers });
}

/** Steps 2 and 3 of "Se connecter avec Lamio": see src/server/lamio.ts. */
export async function GET(req: Request) {
  const config = lamioConfig();
  if (!config) return go("/login");
  const params = new URL(req.url).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const expected = (await cookies()).get(LAMIO_STATE_COOKIE)?.value;
  // The state proves this browser started the sign-in: a link forged elsewhere has no matching cookie.
  if (!state || !code || !expected || !safeEqual(state, expected)) return go("/login?lamio=refus");

  const user = await lamioUser(config, code);
  if (!user) return go("/login?lamio=refus");
  console.log(`[lamio] connexion de ${user.email}`);
  return go("/", (await currentSessionToken()) ?? undefined);
}
