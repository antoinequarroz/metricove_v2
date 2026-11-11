// The app password, changeable from the Settings page.
//
// Until it is changed, the password is APP_PASSWORD from the environment. Once changed, a scrypt hash
// lives in DATA_DIR/auth.json and wins over APP_PASSWORD. Deleting that file brings APP_PASSWORD back
// (the way out if the new password is forgotten).
//
// Read by the middleware too (Node runtime), so: no database here, only a small file.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeEqual, sessionToken } from "./auth";

type AuthFile = { salt: string; hash: string; sessionKey: string; changedAt: string };

const file = () => path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "auth.json");

let cache: { mtime: number; data: AuthFile | null } | undefined;

function readAuthFile(): AuthFile | null {
  try {
    const mtime = fs.statSync(file()).mtimeMs;
    if (cache?.mtime === mtime) return cache.data;
    const data = JSON.parse(fs.readFileSync(file(), "utf8")) as AuthFile;
    cache = { mtime, data: data.hash && data.salt && data.sessionKey ? data : null };
    return cache.data;
  } catch {
    cache = undefined;
    return null;
  }
}

const scrypt = (password: string, salt: string) => crypto.scryptSync(password, salt, 32).toString("hex");

/** Where the password comes from: changed in the app, APP_PASSWORD, or none (open app). */
export function passwordSource(): { source: "app" | "env" | "none"; changedAt?: string } {
  const f = readAuthFile();
  if (f) return { source: "app", changedAt: f.changedAt };
  return { source: process.env.APP_PASSWORD ? "env" : "none" };
}

export const passwordRequired = () => passwordSource().source !== "none";

export function checkPassword(given: string | undefined): boolean {
  if (!given) return false;
  const f = readAuthFile();
  if (f) return safeEqual(scrypt(given, f.salt), f.hash);
  const env = process.env.APP_PASSWORD;
  return !!env && safeEqual(given, env);
}

/** The session cookie value. Changing the password changes it, which logs every other device out. */
export async function currentSessionToken(): Promise<string | null> {
  const f = readAuthFile();
  if (f) return sessionToken(f.sessionKey);
  const env = process.env.APP_PASSWORD;
  return env ? sessionToken(env) : null;
}

export function setPassword(next: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const data: AuthFile = { salt, hash: scrypt(next, salt), sessionKey: crypto.randomBytes(32).toString("hex"), changedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file());
  cache = undefined;
}

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
