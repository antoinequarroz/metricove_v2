// Shared by middleware (edge) and route handlers: Web Crypto only.

export const SESSION_COOKIE = "mc_session";

async function hmac(secret: string, message: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Session token derived from the password: changing APP_PASSWORD logs everyone out. */
export function sessionToken(password: string) {
  return hmac(password, "metricove-session-v1");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks a signed video URL (see server/media-url.ts), used by platforms that fetch our videos. */
export async function validMediaSignature(id: string, exp: string | null, sig: string | null, secret: string) {
  if (!secret || !exp || !sig || Number(exp) * 1000 < Date.now()) return false;
  return safeEqual(sig, await hmac(secret, `media:${id}:${exp}`));
}
