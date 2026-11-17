/**
 * "Continuer avec mon Compte Postmelo". Copie de clients/compte.ts du dépôt postmelo-compte,
 * avec deux réglages propres à Metricove : l'identifiant vaut "metricove" par défaut, et
 * l'adresse publique est PUBLIC_URL (déjà utilisée pour les liens des vidéos) si APP_URL est vide.
 *
 * Le Compte Postmelo décide qui peut entrer (ses administrateurs, et les personnes à qui Metricove
 * est ouvert). Metricove n'a pas de comptes : qui entre voit tout, comme avec le mot de passe.
 * Sans COMPTE_URL et COMPTE_CLIENT_SECRET, rien ne change. Le mot de passe marche dans tous les cas.
 *
 *   GET /api/auth/compte/start     → const { url, cookie } = await startSignIn(); pose le cookie, redirige vers url
 *   GET /api/auth/compte/callback  → const person = await finishSignIn(req.url, cookie); ouvre la session de l'outil
 *
 * Variables de l'outil :
 *   COMPTE_URL            adresse du service de compte, ex. https://compte.exemple.ch
 *   COMPTE_CLIENT_ID      identifiant de l'outil, "metricove" par défaut
 *   COMPTE_CLIENT_SECRET  le secret partagé (le même que METRICOVE_CLIENT_SECRET côté compte)
 *   APP_URL               adresse publique de l'outil ; à défaut, PUBLIC_URL
 *
 * C'est le parcours standard OpenID Connect "authorization code" avec PKCE : n'importe quelle
 * bibliothèque OpenID Connect (openid-client, Auth.js, AppAuth sur iOS…) fait la même chose.
 */

export const START_PATH = "/api/auth/compte/start";
export const CALLBACK_PATH = "/api/auth/compte/callback";
/** Cookie that carries the pending sign-in between start and callback: httpOnly, SameSite=Lax, 10 minutes. */
export const PENDING_COOKIE = "compte_pending";
export const PENDING_MAX_AGE = 600;

export type Person = {
  /** Stable id of the person, the same in every tool. */
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  /** The account is protected by a second factor. */
  twoFactor: boolean;
  /** When the person last proved who they are, in seconds since 1970. */
  authTime: number;
  /** Keep it if the tool wants "sign out everywhere": see signOutUrl. */
  idToken: string;
};

type Settings = { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
type Endpoints = { authorization_endpoint: string; token_endpoint: string; end_session_endpoint?: string; issuer: string };

const trim = (value: string | undefined) => (value ?? "").trim().replace(/\/+$/, "");

/** Null when the variables are missing: the tool then keeps its own sign-in. */
export function settings(env: Record<string, string | undefined> = process.env): Settings | null {
  const url = trim(env.COMPTE_URL);
  const clientId = (env.COMPTE_CLIENT_ID ?? "").trim() || "metricove";
  const clientSecret = (env.COMPTE_CLIENT_SECRET ?? "").trim();
  const app = trim(env.APP_URL) || trim(env.PUBLIC_URL);
  if (!url || !clientId || clientSecret.length < 32 || !app) return null;
  return { issuer: `${url}/api/auth`, clientId, clientSecret, redirectUri: app + CALLBACK_PATH };
}

let discovered: { issuer: string; endpoints: Promise<Endpoints> } | null = null;

function endpoints(s: Settings): Promise<Endpoints> {
  if (discovered?.issuer !== s.issuer) {
    const endpoints = fetch(`${s.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) }).then(async (res) => {
      if (!res.ok) throw new Error(`Service de compte injoignable (${res.status})`);
      const meta = (await res.json()) as Endpoints;
      if (meta.issuer !== s.issuer) throw new Error("Le service de compte ne répond pas sous l'adresse attendue");
      return meta;
    });
    // A failed discovery is not kept: the next sign-in tries again.
    endpoints.catch(() => (discovered = null));
    discovered = { issuer: s.issuer, endpoints };
  }
  return discovered.endpoints;
}

const random = (bytes = 32) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
const sha256 = async (value: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64url");

/**
 * Step 1. Returns the address to send the browser to, and the value of the pending cookie.
 * `maxAge` (seconds) asks for a recent sign-in: older sessions must type their password again.
 */
export async function startSignIn(options: { maxAge?: number; next?: string } = {}, s = settings()) {
  if (!s) throw new Error("Connexion par compte non configurée");
  const meta = await endpoints(s);
  const pending = { state: random(), nonce: random(), verifier: random(48), next: options.next ?? "" };
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: s.clientId,
    redirect_uri: s.redirectUri,
    scope: "openid profile email",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await sha256(pending.verifier),
    code_challenge_method: "S256",
    ...(options.maxAge !== undefined ? { max_age: String(options.maxAge) } : {}),
  }).toString();
  return { url: url.href, cookie: Buffer.from(JSON.stringify(pending)).toString("base64url") };
}

/**
 * Step 2. Trades the code of the callback for the person. Throws when anything is off:
 * the tool then shows its sign-in page again with the message.
 */
export async function finishSignIn(callbackUrl: string, cookie: string | undefined, s = settings()): Promise<Person & { next: string }> {
  if (!s) throw new Error("Connexion par compte non configurée");
  const params = new URL(callbackUrl).searchParams;
  let pending: { state: string; nonce: string; verifier: string; next: string };
  try {
    pending = JSON.parse(Buffer.from(cookie ?? "", "base64url").toString());
  } catch {
    throw new Error("La connexion a expiré, recommencez");
  }
  if (!pending?.state || params.get("state") !== pending.state) throw new Error("La connexion a expiré, recommencez");
  if (params.get("iss") && params.get("iss") !== s.issuer) throw new Error("Réponse d'un autre service");
  if (params.get("error")) throw new Error(params.get("error") === "access_denied" ? "Accès refusé" : "La connexion a échoué");
  const code = params.get("code");
  if (!code) throw new Error("La connexion a échoué");

  const meta = await endpoints(s);
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(s.clientId)}:${encodeURIComponent(s.clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: s.redirectUri, code_verifier: pending.verifier }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(res.status === 403 ? "Cet outil n'est pas ouvert à votre compte" : "La connexion a échoué");
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("La connexion a échoué");

  // The ID token comes straight from the service, over TLS, in answer to our secret:
  // OpenID Connect (Core §3.1.3.7) then lets the client trust it without checking its signature.
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== s.issuer || !audience.includes(s.clientId) || claims.nonce !== pending.nonce || typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("Réponse du service de compte invalide");
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") throw new Error("Réponse du service de compte invalide");

  return {
    id: claims.sub,
    name: typeof claims.name === "string" ? claims.name : claims.email,
    email: claims.email,
    role: claims.role === "admin" ? "admin" : "member",
    twoFactor: claims.two_factor === true,
    authTime: typeof claims.auth_time === "number" ? claims.auth_time : now,
    idToken: id_token,
    // Only a path of this tool, never another site.
    next: /^\/(?![/\\])/.test(pending.next) ? pending.next : "/",
  };
}

/** Where to send the browser to close the account session too ("sign out everywhere"). */
export async function signOutUrl(idToken: string, s = settings()) {
  if (!s) return null;
  const meta = await endpoints(s);
  if (!meta.end_session_endpoint) return null;
  const url = new URL(meta.end_session_endpoint);
  url.search = new URLSearchParams({ id_token_hint: idToken, client_id: s.clientId, post_logout_redirect_uri: s.redirectUri.slice(0, -CALLBACK_PATH.length) }).toString();
  return url.href;
}
