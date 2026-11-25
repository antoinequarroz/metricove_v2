import "server-only";
import { safeEqual, SESSION_COOKIE } from "./auth";
import { currentSessionToken } from "./password";

/**
 * The middleware's check, for routes it skips: the session cookie, or "Authorization: Bearer <API_TOKEN>".
 * Next 15.5 reads the body of every request that goes through a Node.js middleware, and the route then
 * finds it used up ("Response body object should not be disturbed or locked"). Upload chunks skip the
 * middleware for that reason, and check here instead.
 */
export async function isAllowed(req: Request): Promise<boolean> {
  const expected = await currentSessionToken();
  if (!expected) return true;
  const apiToken = process.env.API_TOKEN;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (apiToken && bearer && safeEqual(bearer, apiToken)) return true;
  const prefix = `${SESSION_COOKIE}=`;
  const cookie = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(prefix))
    ?.slice(prefix.length);
  return !!cookie && safeEqual(decodeURIComponent(cookie), expected);
}
