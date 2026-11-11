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

let cache: { mtime: number; data: AuthFile } | undefined;

/** Sessions can't match this key: used while auth.json exists but can't be read. */
const BROKEN_KEY = crypto.randomBytes(32).toString("hex");

/**
 * The password file. `null` only when the file does not exist (APP_PASSWORD applies).
 * A file that exists but can't be read or parsed is "broken": the last good content is kept if there
 * is one, otherwise nobody gets in. It must never open the app or bring the old password back.
 */
function readAuthFile(): AuthFile | null | "broken" {
  let mtime: number;
  try {
    mtime = fs.statSync(file()).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      cache = undefined;
      return null;
    }
    console.error("[auth] auth.json illisible", e);
    return cache?.data ?? "broken";
  }
  if (cache?.mtime === mtime) return cache.data;
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8")) as AuthFile;
    if (!(data.hash && data.salt && data.sessionKey)) throw new Error("incomplet");
    cache = { mtime, data };
    return data;
  } catch (e) {
    console.error("[auth] auth.json illisible", e);
    return cache?.data ?? "broken";
  }
}

// One hash at a time, off the event loop: a flood of login attempts must not stall the scheduler.
let hashing: Promise<unknown> = Promise.resolve();
function scrypt(password: string, salt: string): Promise<string> {
  const run = hashing.then(() => new Promise<string>((resolve, reject) => crypto.scrypt(password, salt, 32, (e, key) => (e ? reject(e) : resolve(key.toString("hex"))))));
  hashing = run.catch(() => {});
  return run;
}

/** Where the password comes from: changed in the app, APP_PASSWORD, or none (open app). */
export function passwordSource(): { source: "app" | "env" | "none"; changedAt?: string } {
  const f = readAuthFile();
  if (f === "broken") return { source: "app" };
  if (f) return { source: "app", changedAt: f.changedAt };
  return { source: process.env.APP_PASSWORD ? "env" : "none" };
}

export const passwordRequired = () => passwordSource().source !== "none";

export const MAX_PASSWORD = 200;

export async function checkPassword(given: unknown): Promise<boolean> {
  if (typeof given !== "string" || !given || given.length > MAX_PASSWORD) return false;
  const f = readAuthFile();
  if (f === "broken") return false;
  if (f) return safeEqual(await scrypt(given, f.salt), f.hash);
  const env = process.env.APP_PASSWORD;
  return !!env && safeEqual(given, env);
}

/** The session cookie value. Changing the password changes it, which logs every other device out. */
export async function currentSessionToken(): Promise<string | null> {
  const f = readAuthFile();
  if (f) return sessionToken(f === "broken" ? BROKEN_KEY : f.sessionKey);
  const env = process.env.APP_PASSWORD;
  return env ? sessionToken(env) : null;
}

/**
 * Key that signs the media links the networks download. A dedicated secret or API_TOKEN when set.
 * Otherwise the key of the password file (so a replaced APP_PASSWORD stops signing links, and a
 * password chosen on an app that had none still lets the networks fetch the media).
 */
export function mediaSecret(): string {
  const env = process.env.MEDIA_URL_SECRET || process.env.API_TOKEN;
  if (env) return env;
  const f = readAuthFile();
  if (f === "broken") return "";
  return f ? f.sessionKey : process.env.APP_PASSWORD || "";
}

export async function setPassword(next: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const data: AuthFile = { salt, hash: await scrypt(next, salt), sessionKey: crypto.randomBytes(32).toString("hex"), changedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  // Flushed to disk before it replaces the file: a crash must not leave an empty auth.json.
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file());
  cache = undefined;
}

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
