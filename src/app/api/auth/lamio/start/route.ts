import crypto from "node:crypto";
import { LAMIO_STATE_COOKIE, LAMIO_STATE_MAX_AGE, lamioAuthorizeUrl, lamioConfig } from "@/server/lamio";

export const dynamic = "force-dynamic";

/** Step 1 of "Se connecter avec Lamio": see src/server/lamio.ts. */
export async function GET() {
  const config = lamioConfig();
  if (!config) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const state = crypto.randomBytes(24).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: lamioAuthorizeUrl(config, state),
      "Set-Cookie": `${LAMIO_STATE_COOKIE}=${state}; Path=/api/auth/lamio; HttpOnly; SameSite=Lax; Max-Age=${LAMIO_STATE_MAX_AGE}${secure}`,
      "Cache-Control": "no-store",
    },
  });
}
