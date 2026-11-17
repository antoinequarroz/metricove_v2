// "Se connecter avec Lamio": Lamio, the messaging app of the suite, vouches for the person.
//
//  1. /api/auth/lamio/start sends the browser to Lamio with a random "state", kept in a cookie.
//  2. Lamio checks the person is signed in and may open this tool, then sends the browser back
//     to /api/auth/lamio with a code that works once.
//  3. This server trades the code for the person, with the secret shared with Lamio. The secret
//     never goes through the browser.
//
// Lamio decides who may come in (its admins, and the members they allow on its Modules page).
// Off unless LAMIO_URL and LAMIO_SSO_SECRET are both set. The password keeps working either way.

export const LAMIO_STATE_COOKIE = "lamio_state";
export const LAMIO_STATE_MAX_AGE = 600;
const MIN_SECRET = 32;

export type LamioUser = { id: string; name: string; email: string; role: string };

export function lamioConfig(env: Record<string, string | undefined> = process.env, client = "metricove") {
  const url = env.LAMIO_URL?.replace(/\/+$/, "");
  const secret = env.LAMIO_SSO_SECRET ?? "";
  if (!url || !/^https?:\/\//.test(url) || secret.length < MIN_SECRET) return null;
  return { url, secret, client: env.LAMIO_CLIENT || client };
}

export const lamioAuthorizeUrl = (config: { url: string; client: string }, state: string) => `${config.url}/sso/authorize?client=${encodeURIComponent(config.client)}&state=${encodeURIComponent(state)}`;

/** Trades the code Lamio gave the browser for the person it belongs to. Null when Lamio refuses or can't be reached. */
export async function lamioUser(config: { url: string; secret: string; client: string }, code: string): Promise<LamioUser | null> {
  try {
    const res = await fetch(`${config.url}/api/sso/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ client: config.client, code }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const user = ((await res.json()) as { user?: LamioUser }).user;
    return user && typeof user.id === "string" && typeof user.email === "string" ? user : null;
  } catch (e) {
    console.error("[lamio] échange du code impossible", e);
    return null;
  }
}
