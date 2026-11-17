import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";
import { finishSignIn, PENDING_COOKIE } from "@/server/compte";
import { currentSessionToken, SESSION_MAX_AGE } from "@/server/password";

export const dynamic = "force-dynamic";

const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

// Relative addresses stay on this app whatever sits in front of it.
function go(location: string, session?: string) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", `${PENDING_COOKIE}=; Path=/api/auth/compte; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`);
  if (session) headers.append("Set-Cookie", `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure()}`);
  return new Response(null, { status: 302, headers });
}

/** The Compte Postmelo sends the person back here: open the same session as the password does. */
export async function GET(req: Request) {
  try {
    const person = await finishSignIn(req.url, (await cookies()).get(PENDING_COOKIE)?.value);
    console.log(`[compte] connexion de ${person.email}`);
    return go("/", (await currentSessionToken()) ?? undefined);
  } catch (error) {
    return go(`/login?erreur=${encodeURIComponent((error as Error).message)}`);
  }
}
