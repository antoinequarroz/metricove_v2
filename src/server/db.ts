import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seedAccounts, seedMedia, seedPosts } from "@/lib/seed";
import type { Account, Media, Post } from "@/lib/types";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");

const globalForDb = globalThis as unknown as { __metricoveDb?: Database.Database };

export function db() {
  if (globalForDb.__metricoveDb) return globalForDb.__metricoveDb;
  fs.mkdirSync(path.join(DATA_DIR, "media"), { recursive: true });
  const conn = new Database(path.join(DATA_DIR, "metricove.db"));
  conn.pragma("journal_mode = WAL");
  conn.exec(`
    create table if not exists accounts (
      id text primary key,
      network text not null,
      name text not null,
      handle text not null,
      hue integer not null default 20,
      followers integer not null default 0,
      connected integer not null default 1,
      avatar_url text,
      external_id text,
      provider_kind text
    );
    create table if not exists media (
      id text primary key,
      title text not null,
      duration integer not null default 0,
      aspect text not null default '9:16',
      source text not null default 'upload',
      created_at text not null,
      hues text not null default '[20,340]',
      file text
    );
    create table if not exists posts (
      id text primary key,
      account_ids text not null,
      caption text not null default '',
      media_id text,
      scheduled_at text not null,
      status text not null,
      origin text not null default 'manual',
      results text,
      error text,
      youtube text,
      updated_at text not null
    );
    create index if not exists posts_due on posts (status, scheduled_at);
  `);
  // Columns added after the first release.
  const cols = (conn.prepare("pragma table_info(posts)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("youtube")) conn.exec("alter table posts add column youtube text");
  globalForDb.__metricoveDb = conn;
  maybeSeed(conn);
  return conn;
}

/** Demo data, only when the database is empty and demo mode is on. */
function maybeSeed(conn: Database.Database) {
  const demo = (process.env.PUBLISHER ?? "demo") === "demo" && process.env.SEED_DEMO !== "false";
  const empty = (conn.prepare("select count(*) as n from posts").get() as { n: number }).n === 0;
  if (!demo || !empty) return;
  const tx = conn.transaction(() => {
    seedAccounts.forEach(upsertAccount);
    seedMedia().forEach(insertMedia);
    seedPosts().forEach(savePost);
  });
  tx();
}

/* ---------- Accounts ---------- */

type AccountRow = {
  id: string;
  network: Account["network"];
  name: string;
  handle: string;
  hue: number;
  followers: number;
  connected: number;
  avatar_url: string | null;
  external_id: string | null;
  provider_kind: string | null;
};

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  network: r.network,
  name: r.name,
  handle: r.handle,
  hue: r.hue,
  followers: r.followers,
  connected: !!r.connected,
  avatarUrl: r.avatar_url ?? undefined,
  externalId: r.external_id ?? undefined,
  providerKind: r.provider_kind ?? undefined,
});

export function listAccounts(): Account[] {
  return (db().prepare("select * from accounts order by network, name").all() as AccountRow[]).map(toAccount);
}

export function upsertAccount(a: Account) {
  db()
    .prepare(
      `insert into accounts (id, network, name, handle, hue, followers, connected, avatar_url, external_id, provider_kind)
       values (@id, @network, @name, @handle, @hue, @followers, @connected, @avatarUrl, @externalId, @providerKind)
       on conflict(id) do update set network=excluded.network, name=excluded.name, handle=excluded.handle,
         followers=excluded.followers, connected=excluded.connected, avatar_url=excluded.avatar_url, external_id=excluded.external_id,
         provider_kind=excluded.provider_kind`,
    )
    .run({ ...a, connected: a.connected ? 1 : 0, avatarUrl: a.avatarUrl ?? null, externalId: a.externalId ?? null, providerKind: a.providerKind ?? null });
}

/* ---------- Media ---------- */

type MediaRow = {
  id: string;
  title: string;
  duration: number;
  aspect: Media["aspect"];
  source: Media["source"];
  created_at: string;
  hues: string;
  file: string | null;
};

const toMedia = (r: MediaRow): Media => ({
  id: r.id,
  title: r.title,
  duration: r.duration,
  aspect: r.aspect,
  source: r.source,
  createdAt: r.created_at,
  hues: JSON.parse(r.hues),
  url: r.file ? `/api/media/${r.id}/file` : undefined,
});

export function listMedia(): Media[] {
  return (db().prepare("select * from media order by created_at desc").all() as MediaRow[]).map(toMedia);
}

export function getMediaRow(id: string) {
  return db().prepare("select * from media where id = ?").get(id) as MediaRow | undefined;
}

export function insertMedia(m: Media & { file?: string }) {
  db()
    .prepare(
      `insert or ignore into media (id, title, duration, aspect, source, created_at, hues, file)
       values (@id, @title, @duration, @aspect, @source, @createdAt, @hues, @file)`,
    )
    .run({ ...m, hues: JSON.stringify(m.hues), file: m.file ?? null });
}

/* ---------- Posts ---------- */

type PostRow = {
  id: string;
  account_ids: string;
  caption: string;
  media_id: string | null;
  scheduled_at: string;
  status: Post["status"];
  origin: Post["origin"];
  results: string | null;
  error: string | null;
  youtube: string | null;
};

const toPost = (r: PostRow): Post => ({
  id: r.id,
  accountIds: JSON.parse(r.account_ids),
  caption: r.caption,
  mediaId: r.media_id ?? undefined,
  scheduledAt: r.scheduled_at,
  status: r.status,
  origin: r.origin,
  results: r.results ? JSON.parse(r.results) : undefined,
  error: r.error ?? undefined,
  youtube: r.youtube ? JSON.parse(r.youtube) : undefined,
});

export function listPosts(): Post[] {
  return (db().prepare("select * from posts order by scheduled_at").all() as PostRow[]).map(toPost);
}

export function getPost(id: string): Post | undefined {
  const r = db().prepare("select * from posts where id = ?").get(id) as PostRow | undefined;
  return r && toPost(r);
}

export function savePost(p: Post) {
  db()
    .prepare(
      `insert into posts (id, account_ids, caption, media_id, scheduled_at, status, origin, results, error, youtube, updated_at)
       values (@id, @accountIds, @caption, @mediaId, @scheduledAt, @status, @origin, @results, @error, @youtube, @now)
       on conflict(id) do update set account_ids=excluded.account_ids, caption=excluded.caption, media_id=excluded.media_id,
         scheduled_at=excluded.scheduled_at, status=excluded.status, origin=excluded.origin, results=excluded.results,
         error=excluded.error, youtube=excluded.youtube, updated_at=excluded.updated_at`,
    )
    .run({
      ...p,
      accountIds: JSON.stringify(p.accountIds),
      mediaId: p.mediaId ?? null,
      results: p.results ? JSON.stringify(p.results) : null,
      error: p.error ?? null,
      youtube: p.youtube ? JSON.stringify(p.youtube) : null,
      now: new Date().toISOString(),
    });
}

export function deletePost(id: string) {
  db().prepare("delete from posts where id = ?").run(id);
}

/**
 * Atomically claims posts that are due, so two ticks never publish the same post.
 */
export function claimDuePosts(now = new Date()): Post[] {
  const conn = db();
  const tx = conn.transaction(() => {
    const rows = conn
      .prepare("select * from posts where status = 'scheduled' and scheduled_at <= ? order by scheduled_at limit 20")
      .all(now.toISOString()) as PostRow[];
    const mark = conn.prepare("update posts set status = 'publishing', updated_at = ? where id = ? and status = 'scheduled'");
    return rows.filter((r) => mark.run(now.toISOString(), r.id).changes === 1).map((r) => ({ ...toPost(r), status: "publishing" as const }));
  });
  return tx();
}

/** Posts stuck in "publishing" after a crash go back to the queue. */
export function releaseStuckPosts(olderThanMinutes = 10) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  db().prepare("update posts set status = 'scheduled' where status = 'publishing' and updated_at < ?").run(cutoff);
}
