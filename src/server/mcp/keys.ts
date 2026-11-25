import "server-only";
import crypto from "node:crypto";
import { safeEqual } from "../auth";
import { db } from "../db";

/**
 * Who may use the MCP server: API_TOKEN (scripts, Claude Code), or a key issued to a connector
 * (Claude on claude.ai, the desktop and mobile apps) once someone signed in to Metricove said yes.
 * Metricove has one owner: a key gives read access to everything, nothing more.
 */

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();

/** Keys look like "mcv_" + 43 random characters: easy to spot in a leaked file. */
const TOKEN_PREFIX = "mcv_";

/** The public address of Metricove (PUBLIC_URL, else what the proxy says), without a trailing slash. */
export function publicOrigin(req: Request): string {
  if (/^https?:\/\//.test(process.env.PUBLIC_URL ?? "")) return process.env.PUBLIC_URL!.replace(/\/+$/, "");
  const h = req.headers;
  const url = new URL(req.url);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? url.host;
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** True when the "Authorization: Bearer …" header opens the MCP server. Notes when a key was last used. */
export function mcpAuthorized(header: string | null): boolean {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length > 200) return false;
  const apiToken = process.env.API_TOKEN;
  if (apiToken && safeEqual(token, apiToken)) return true;
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const r = db().prepare("select id, last_used_at from mcp_tokens where token_hash = ?").get(sha256(token)) as { id: string; last_used_at: string | null } | undefined;
  if (!r) return false;
  if (!r.last_used_at || Date.now() - new Date(r.last_used_at).getTime() > 60_000) db().prepare("update mcp_tokens set last_used_at = ? where id = ?").run(now(), r.id);
  return true;
}

export type McpKey = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

export const listKeys = (): McpKey[] =>
  (db().prepare("select id, name, created_at, last_used_at from mcp_tokens order by created_at desc").all() as { id: string; name: string; created_at: string; last_used_at: string | null }[]).map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));

/** Cuts one connector off (or all of them, without an id). It must sign in again to come back. */
export const revokeKeys = (id?: string) => (id ? db().prepare("delete from mcp_tokens where id = ?").run(id) : db().prepare("delete from mcp_tokens").run()).changes;

function createKey(name: string): string {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  db().prepare("insert into mcp_tokens (id, name, token_hash, created_at) values (?, ?, ?, ?)").run(crypto.randomUUID(), name.trim().slice(0, 80) || "Agent", sha256(token), now());
  return token;
}

// ---- OAuth 2.1 (PKCE, dynamic client registration): how Claude connects without a key to copy.

export type OAuthClient = { id: string; name: string; redirectUris: string[] };

/** Only https addresses, or http on this machine (Claude Code, MCP Inspector). */
export function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 500) return false;
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function registerClient(name: string, redirectUris: string[]): OAuthClient {
  const id = `mcp_${crypto.randomBytes(12).toString("base64url")}`;
  const clean = name.trim().slice(0, 80) || "Agent";
  db().prepare("insert into oauth_clients (id, name, redirect_uris, created_at) values (?, ?, ?, ?)").run(id, clean, JSON.stringify(redirectUris), now());
  return { id, name: clean, redirectUris };
}

export function getClient(id: unknown): OAuthClient | null {
  if (typeof id !== "string") return null;
  const r = db().prepare("select * from oauth_clients where id = ?").get(id) as { id: string; name: string; redirect_uris: string } | undefined;
  return r ? { id: r.id, name: r.name, redirectUris: JSON.parse(r.redirect_uris) as string[] } : null;
}

export type AuthorizeRequest = { client: OAuthClient; redirectUri: string; state: string | null; codeChallenge: string };

/**
 * Checks an authorization request (query string or consent form). An unknown client or return
 * address is an error shown on the page: the browser is never sent to an unchecked address.
 */
export function readAuthorize(get: (name: string) => string | null | undefined): AuthorizeRequest | string {
  const client = getClient(get("client_id"));
  if (!client) return "Ce connecteur n'est pas inscrit auprès de Metricove. Reprends la connexion depuis Claude.";
  const redirectUri = get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) return "L'adresse de retour ne correspond pas à celle du connecteur.";
  if (get("response_type") !== "code") return "Type de réponse non pris en charge.";
  const codeChallenge = get("code_challenge") ?? "";
  if (get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return "Ce connecteur doit utiliser PKCE (S256).";
  const state = get("state") ?? null;
  if (state && state.length > 1000) return "Paramètre state trop long.";
  return { client, redirectUri, state, codeChallenge };
}

/** The connector's address with the answer added (code or error, and its state). */
export function backTo(req: AuthorizeRequest, params: Record<string, string>): string {
  const url = new URL(req.redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (req.state) url.searchParams.set("state", req.state);
  return url.toString();
}

/** A one-time code, valid 5 minutes, that the connector trades for a key (with its PKCE verifier). */
export function createCode(req: AuthorizeRequest): string {
  const code = crypto.randomBytes(32).toString("base64url");
  db().prepare("delete from oauth_codes where expires_at < ?").run(now());
  db()
    .prepare("insert into oauth_codes (code_hash, client_id, redirect_uri, code_challenge, expires_at) values (?, ?, ?, ?, ?)")
    .run(sha256(code), req.client.id, req.redirectUri, req.codeChallenge, new Date(Date.now() + 5 * 60_000).toISOString());
  return code;
}

/** Trades a code for a new key. Each code works once. Null when anything does not match. */
export function redeemCode(input: { code: unknown; clientId: unknown; redirectUri: unknown; codeVerifier: unknown }): string | null {
  if (typeof input.code !== "string" || typeof input.codeVerifier !== "string" || input.codeVerifier.length < 43 || input.codeVerifier.length > 128) return null;
  return db().transaction(() => {
    const r = db().prepare("delete from oauth_codes where code_hash = ? returning *").get(sha256(input.code as string)) as
      | { client_id: string; redirect_uri: string; code_challenge: string; expires_at: string }
      | undefined;
    if (!r || r.expires_at < now()) return null;
    if (r.client_id !== input.clientId || r.redirect_uri !== input.redirectUri) return null;
    const expected = Buffer.from(r.code_challenge);
    const given = Buffer.from(crypto.createHash("sha256").update(input.codeVerifier as string).digest("base64url"));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    return createKey(getClient(r.client_id)?.name ?? "Agent");
  })();
}
