import { PENDING_COOKIE, PENDING_MAX_AGE, settings, startSignIn } from "@/server/compte";

export const dynamic = "force-dynamic";

const back = (message: string) => new Response(null, { status: 302, headers: { Location: `/login?erreur=${encodeURIComponent(message)}`, "Cache-Control": "no-store" } });

/** Sends the browser to the Compte Postmelo. It comes back on /api/auth/compte/callback. */
export async function GET() {
  if (!settings()) return back("La connexion par Compte Postmelo n'est pas configurée");
  try {
    const { url, cookie } = await startSignIn();
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Set-Cookie": `${PENDING_COOKIE}=${cookie}; Path=/api/auth/compte; HttpOnly; SameSite=Lax; Max-Age=${PENDING_MAX_AGE}${secure}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[compte] service injoignable", e);
    return back("Le Compte Postmelo ne répond pas. Réessayez, ou utilisez le mot de passe.");
  }
}
