import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { seedAccounts, seedMedia, seedPosts } from "@/lib/seed";
import { mimeOfFile } from "@/lib/formats";
import type { Account, AccountStats, Media, Post, PostStat, Project } from "@/lib/types";

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
    create table if not exists account_stats (
      account_id text primary key,
      data text not null
    );
    create table if not exists post_stats (
      account_id text not null,
      external_id text not null,
      data text not null,
      primary key (account_id, external_id)
    );
    create table if not exists follower_history (
      account_id text not null,
      day text not null,
      followers integer not null,
      primary key (account_id, day)
    );
    create index if not exists posts_due on posts (status, scheduled_at);
    create table if not exists projects (
      id text primary key,
      name text not null,
      hue integer not null default 20,
      account_ids text not null default '[]',
      position integer not null default 0
    );
  `);
  // Columns added after the first release.
  const cols = (conn.prepare("pragma table_info(posts)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("youtube")) conn.exec("alter table posts add column youtube text");
  const mediaCols = (conn.prepare("pragma table_info(media)").all() as { name: string }[]).map((c) => c.name);
  if (!mediaCols.includes("cover")) conn.exec("alter table media add column cover text");
  // Photos, for photo posts and stories.
  if (!mediaCols.includes("kind")) conn.exec("alter table media add column kind text not null default 'video'");
  if (!mediaCols.includes("width")) conn.exec("alter table media add column width integer");
  if (!mediaCols.includes("height")) conn.exec("alter table media add column height integer");
  if (!cols.includes("format")) conn.exec("alter table posts add column format text");
  // Carousels: every media of the post, in order, as JSON.
  if (!cols.includes("media_ids")) conn.exec("alter table posts add column media_ids text");
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

/** Only the follower count, so a refresh never writes back an older name or avatar. */
export function setAccountFollowers(id: string, followers: number) {
  db().prepare("update accounts set followers = ? where id = ?").run(followers, id);
}

export function deleteAccount(id: string) {
  db().prepare("delete from accounts where id = ?").run(id);
  for (const t of ["account_stats", "post_stats", "follower_history"]) db().prepare(`delete from ${t} where account_id = ?`).run(id);
  for (const p of listProjects()) if (p.accountIds.includes(id)) saveProject({ ...p, accountIds: p.accountIds.filter((a) => a !== id) });
}

/* ---------- Projects ---------- */

type ProjectRow = { id: string; name: string; hue: number; account_ids: string; position: number };

const toProject = (r: ProjectRow): Project => ({ id: r.id, name: r.name, hue: r.hue, accountIds: JSON.parse(r.account_ids) });

export function listProjects(): Project[] {
  return (db().prepare("select * from projects order by position, name").all() as ProjectRow[]).map(toProject);
}

export function saveProject(p: Project) {
  db()
    .prepare(
      `insert into projects (id, name, hue, account_ids, position)
       values (@id, @name, @hue, @accountIds, (select coalesce(max(position), 0) + 1 from projects))
       on conflict(id) do update set name=excluded.name, hue=excluded.hue, account_ids=excluded.account_ids`,
    )
    .run({ id: p.id, name: p.name, hue: p.hue, accountIds: JSON.stringify(p.accountIds) });
}

export function deleteProject(id: string) {
  db().prepare("delete from projects where id = ?").run(id);
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
  /** Feed cover image (file name in data/media), when there is one. */
  cover?: string | null;
  kind?: Media["kind"] | null;
  width?: number | null;
  height?: number | null;
};

const toMedia = (r: MediaRow): Media => ({
  id: r.id,
  title: r.title,
  kind: r.kind === "image" ? "image" : "video",
  width: r.width ?? undefined,
  height: r.height ?? undefined,
  mime: mimeOfFile(r.file),
  duration: r.duration,
  aspect: r.aspect,
  source: r.source,
  createdAt: r.created_at,
  hues: JSON.parse(r.hues),
  url: r.file ? `/api/media/${r.id}/file` : undefined,
  // The file name changes with each new cover, so browsers never show an old one.
  cover: r.cover ? `/api/media/${r.id}/cover?v=${encodeURIComponent(r.cover)}` : undefined,
});

export function setMediaCover(id: string, cover: string | null) {
  db().prepare("update media set cover = ? where id = ?").run(cover, id);
}

export function listMedia(): Media[] {
  return (db().prepare("select * from media order by created_at desc").all() as MediaRow[]).map(toMedia);
}

/** One library item as the app sees it, or undefined. */
export function getMedia(id: string): Media | undefined {
  const r = getMediaRow(id);
  return r && toMedia(r);
}

export function getMediaRow(id: string) {
  return db().prepare("select * from media where id = ?").get(id) as MediaRow | undefined;
}

export function insertMedia(m: Media & { file?: string }) {
  db()
    .prepare(
      `insert or ignore into media (id, title, duration, aspect, source, created_at, hues, file, kind, width, height)
       values (@id, @title, @duration, @aspect, @source, @createdAt, @hues, @file, @kind, @width, @height)`,
    )
    .run({ ...m, hues: JSON.stringify(m.hues), file: m.file ?? null, kind: m.kind ?? "video", width: m.width ?? null, height: m.height ?? null });
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
  format?: string | null;
  media_ids?: string | null;
};

const toPost = (r: PostRow): Post => ({
  id: r.id,
  accountIds: JSON.parse(r.account_ids),
  caption: r.caption,
  mediaId: r.media_id ?? undefined,
  mediaIds: r.media_ids ? JSON.parse(r.media_ids) : undefined,
  format: r.format === "story" ? "story" : undefined,
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
      `insert into posts (id, account_ids, caption, media_id, media_ids, scheduled_at, status, origin, results, error, youtube, format, updated_at)
       values (@id, @accountIds, @caption, @mediaId, @mediaIds, @scheduledAt, @status, @origin, @results, @error, @youtube, @format, @now)
       on conflict(id) do update set account_ids=excluded.account_ids, caption=excluded.caption, media_id=excluded.media_id, media_ids=excluded.media_ids,
         scheduled_at=excluded.scheduled_at, status=excluded.status, origin=excluded.origin, results=excluded.results,
         error=excluded.error, youtube=excluded.youtube, format=excluded.format, updated_at=excluded.updated_at`,
    )
    .run({
      ...p,
      accountIds: JSON.stringify(p.accountIds),
      // A carousel keeps its first media in media_id, so older code still finds a thumbnail.
      mediaId: p.mediaIds?.[0] ?? p.mediaId ?? null,
      mediaIds: p.mediaIds && p.mediaIds.length > 1 ? JSON.stringify(p.mediaIds) : null,
      results: p.results ? JSON.stringify(p.results) : null,
      error: p.error ?? null,
      youtube: p.youtube ? JSON.stringify(p.youtube) : null,
      format: p.format === "story" ? "story" : null,
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

/* ---------- Statistics ---------- */

export function listAccountStats(): AccountStats[] {
  return (db().prepare("select data from account_stats").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

/** Keeps the last good numbers when a refresh only brings an error. */
export function saveAccountStats(s: AccountStats) {
  const old = db().prepare("select data from account_stats where account_id = ?").get(s.accountId) as { data: string } | undefined;
  const merged: AccountStats = s.error && old ? { ...(JSON.parse(old.data) as AccountStats), error: s.error } : s;
  db()
    .prepare("insert into account_stats (account_id, data) values (?, ?) on conflict(account_id) do update set data = excluded.data")
    .run(s.accountId, JSON.stringify(merged));
  if (!s.error && s.followers !== undefined) {
    db()
      .prepare("insert into follower_history (account_id, day, followers) values (?, ?, ?) on conflict(account_id, day) do update set followers = excluded.followers")
      .run(s.accountId, s.fetchedAt.slice(0, 10), s.followers);
  }
}

export function listPostStats(): PostStat[] {
  return (db().prepare("select data from post_stats").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

/** Adds or updates the posts just read for one account. Older posts keep their last numbers. */
export function savePostStats(accountId: string, posts: PostStat[]) {
  const conn = db();
  const tx = conn.transaction(() => {
    const put = conn.prepare("insert into post_stats (account_id, external_id, data) values (?, ?, ?) on conflict(account_id, external_id) do update set data = excluded.data");
    for (const p of posts) put.run(accountId, p.externalId, JSON.stringify(p));
    // Posts older than 90 days are no longer shown anywhere.
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
    conn.prepare("delete from post_stats where account_id = ? and json_extract(data, '$.publishedAt') < ?").run(accountId, cutoff);
  });
  tx();
}

export function listFollowerHistory(): { accountId: string; day: string; followers: number }[] {
  return db().prepare("select account_id as accountId, day, followers from follower_history where day >= date('now', '-90 days') order by day").all() as {
    accountId: string;
    day: string;
    followers: number;
  }[];
}
