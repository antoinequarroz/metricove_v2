import type { Account, AccountStats, Network, PostStat } from "@/lib/types";
import { call, graph, inTurn, tregTokens, setTeam } from "./treg";

// Statistics read through treg. Every call here is a read, and free, except on X (see `x` below).
// Each network gives different numbers: what a network does not give stays undefined.

/** Days covered by the account totals (views, reach, interactions). */
const PERIOD = 28;
/** How many recent posts are read per account. Enough for almost one post a day over the period. */
const POSTS = 25;
/** A read that hangs must not hold back a publication: reads give up quickly. */
const timeout = 20_000;
/** Dates as the browser reads them everywhere (Meta writes "+0000", which Safari refuses). */
const iso = (d?: string) => (d && !Number.isNaN(Date.parse(d)) ? new Date(d).toISOString() : undefined);

type Out = { stats: Omit<AccountStats, "accountId" | "fetchedAt">; posts: Omit<PostStat, "accountId" | "network">[] };

const num = (v: unknown) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
const sum = (...v: (number | undefined)[]) => (v.some((x) => x !== undefined) ? v.reduce<number>((t, x) => t + (x ?? 0), 0) : undefined);
/** A value that may be missing without failing the rest. */
const soft = <T>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

/** Meta's and treg's errors, shortened to one sentence. */
function reason(e: unknown) {
  const text = (e as Error).message ?? String(e);
  if (/not connected|no connection|428|à reconnecter/i.test(text)) return "Compte à reconnecter dans treg";
  if (/does not have permission|"code":(10|200)\b|scope|insufficient|unauthorized|403/i.test(text)) return "treg n'a pas l'autorisation de lire les statistiques de ce compte";
  if (/quota/i.test(text)) return "Quota du jour épuisé, réessayez demain";
  const m = text.match(/"message":"((?:[^"\\]|\\.)*)"/);
  return (m ? m[1] : text).slice(0, 160);
}

/* ---------- Instagram ---------- */

type IgInsights = { data?: { name: string; total_value?: { value?: number }; values?: { value?: number }[] }[] };
const igValues = (d?: IgInsights) => Object.fromEntries((d?.data ?? []).map((m) => [m.name, m.total_value?.value ?? m.values?.[0]?.value]));

async function instagram(a: Account): Promise<Out> {
  // treg's "Instagram login" connection sometimes lacks the insights permission: the Page method is tried next.
  let headers: Record<string, string> = {};
  const ig = async <T>(id: string, query: Record<string, string | number | undefined>) => {
    try {
      return (await call<T>(id, { query, headers, timeout })).data;
    } catch (e) {
      if (headers["X-Treg-Authorization-Method"] || !/permission|"code":(10|200)\b/i.test((e as Error).message)) throw e;
      headers = { "X-Treg-Authorization-Method": "facebook-page" };
      return (await call<T>(id, { query, headers, timeout })).data;
    }
  };
  const id = a.externalId!;
  const profile = await ig<{ followers_count?: number }>("instagram.instagram.user.profile", { ig_user_id: id, fields: "followers_count,media_count" });

  const until = Math.floor(Date.now() / 1000);
  const since = until - PERIOD * 86_400;
  const totals = igValues(
    await soft(
      ig<IgInsights>("instagram.instagram.account.insights", { ig_user_id: id, metric: "reach,views,total_interactions", period: "day", metric_type: "total_value", since, until }),
    ),
  );

  type M = { id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string; thumbnail_url?: string; media_url?: string; timestamp?: string; like_count?: number; comments_count?: number };
  const list = await ig<{ data?: M[] }>("instagram.instagram.user.posts", {
    ig_user_id: id,
    fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
    limit: POSTS,
  });
  const posts: Out["posts"] = [];
  // After two reads in a row with no answer, the remaining posts keep their likes and comments only.
  let misses = 0;
  for (const m of list.data ?? []) {
    const raw = misses < 2 ? await soft(ig<IgInsights>("instagram.instagram.media.insights", { ig_media_id: m.id, metric: "views,reach,saved,shares" })) : undefined;
    misses = raw ? 0 : misses + 1;
    const v = igValues(raw);
    posts.push({
      externalId: m.id,
      caption: m.caption,
      url: m.permalink,
      thumb: m.thumbnail_url ?? (m.media_type === "VIDEO" ? undefined : m.media_url),
      publishedAt: iso(m.timestamp),
      likes: num(m.like_count),
      comments: num(m.comments_count),
      views: num(v.views),
      reach: num(v.reach),
      saves: num(v.saved),
      shares: num(v.shares),
    });
  }
  return {
    stats: { followers: num(profile.followers_count), period: PERIOD, views: num(totals.views), reach: num(totals.reach), interactions: num(totals.total_interactions) },
    posts,
  };
}

/* ---------- Facebook ---------- */

async function facebook(a: Account): Promise<Out> {
  const page = a.externalId!;
  const { data: p } = await graph<{ fan_count?: number; followers_count?: number }>(page, { catalog: "facebook.x.page", pageId: page, query: { fields: "fan_count,followers_count" }, timeout });

  type P = { id: string; message?: string; created_time?: string; permalink_url?: string; full_picture?: string; shares?: { count?: number }; comments?: { summary?: { total_count?: number } }; reactions?: { summary?: { total_count?: number } } };
  const { data: list } = await graph<{ data?: P[] }>(`${page}/posts`, {
    catalog: "facebook.facebook.page.posts",
    pageId: page,
    query: { fields: "id,message,created_time,permalink_url,full_picture,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)", limit: POSTS },
    timeout,
  });
  // Views are asked post by post. The first refusal (permission, metric renamed by Meta) stops the asking.
  type I = { data?: { name?: string; values?: { value?: number }[] }[] };
  let ask = true;
  const posts: Out["posts"] = [];
  for (const m of list.data ?? []) {
    const r = ask ? await soft(graph<I>(`${m.id}/insights`, { catalog: "facebook.x.post-insights", query: { post_id: m.id, metric: "post_media_view" }, timeout })) : undefined;
    if (!r) ask = false;
    posts.push({
      externalId: m.id,
      caption: m.message,
      url: m.permalink_url,
      thumb: m.full_picture,
      publishedAt: iso(m.created_time),
      views: num(r?.data.data?.[0]?.values?.[0]?.value),
      likes: num(m.reactions?.summary?.total_count),
      comments: num(m.comments?.summary?.total_count),
      shares: num(m.shares?.count),
    });
  }
  return { stats: { followers: num(p.followers_count) ?? num(p.fan_count) }, posts };
}

/* ---------- YouTube ---------- */

async function youtube(a: Account): Promise<Out> {
  type C = { statistics?: { subscriberCount?: string; viewCount?: string } };
  const { data: ch } = await call<{ items?: C[] }>("youtube.youtube.channel.profile", { query: { part: "statistics", mine: true }, timeout });
  const s = ch.items?.[0]?.statistics;

  // The "uploads" playlist of a channel is its id with UC replaced by UU. Cheap on Google's quota (1 unit).
  const uploads = a.externalId!.replace(/^UC/, "UU");
  type I = { contentDetails?: { videoId?: string } };
  const list = await soft(call<{ items?: I[] }>("youtube.youtube.channel.videos.uploads", { query: { part: "contentDetails", playlistId: uploads, maxResults: POSTS }, timeout }));
  const ids = (list?.data.items ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean) as string[];
  let posts: Out["posts"] = [];
  if (ids.length) {
    type V = { id: string; snippet?: { title?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } };
    const { data } = await call<{ items?: V[] }>("youtube.youtube.video.detail", { query: { part: "snippet,statistics", id: ids.join(",") }, timeout });
    posts = (data.items ?? []).map((v) => ({
      externalId: v.id,
      caption: v.snippet?.title,
      url: `https://youtu.be/${v.id}`,
      thumb: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url,
      publishedAt: v.snippet?.publishedAt,
      views: num(v.statistics?.viewCount),
      likes: num(v.statistics?.likeCount),
      comments: num(v.statistics?.commentCount),
    }));
  }
  // YouTube's view count is for the channel's whole life: no `period`.
  return { stats: { followers: num(s?.subscriberCount), views: num(s?.viewCount) }, posts };
}

/* ---------- TikTok ---------- */

async function tiktok(): Promise<Out> {
  const json = { "Content-Type": "application/json; charset=UTF-8" };
  type V = { id: string; title?: string; video_description?: string; cover_image_url?: string; share_url?: string; create_time?: number; view_count?: number; like_count?: number; comment_count?: number; share_count?: number };
  const { data } = await call<{ data?: { videos?: V[] }; error?: { code?: string; message?: string } }>("tiktok.tiktok.user.videos", {
    method: "POST",
    query: { fields: "id,title,video_description,cover_image_url,share_url,create_time,view_count,like_count,comment_count,share_count" },
    headers: json,
    // TikTok gives 20 videos at most per call.
    body: { max_count: Math.min(20, POSTS) },
    timeout,
  });
  if (data.error?.code && data.error.code !== "ok") throw new Error(data.error.message || data.error.code);
  const posts: Out["posts"] = (data.data?.videos ?? []).map((v) => ({
    externalId: v.id,
    caption: v.video_description || v.title,
    url: v.share_url,
    thumb: v.cover_image_url,
    publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : undefined,
    views: num(v.view_count),
    likes: num(v.like_count),
    comments: num(v.comment_count),
    shares: num(v.share_count),
  }));
  // The follower count needs one more TikTok permission (user.info.stats): it stays empty without it.
  type U = { data?: { user?: { follower_count?: number } } };
  const user = await soft(call<U>("tiktok.tiktok.user.profile", { query: { fields: "follower_count,likes_count,video_count" }, timeout }));
  // Totals over the videos read above, not over a period.
  return {
    stats: {
      followers: num(user?.data.data?.user?.follower_count),
      views: sum(...posts.map((p) => p.views)),
      interactions: sum(...posts.flatMap((p) => [p.likes, p.comments, p.shares])),
    },
    posts,
  };
}

/* ---------- X ---------- */

// X charges through treg: about $0.01 for the profile and $0.005 per post returned, so $0.06 at most per read.
// X drops replies and reposts after taking the latest posts: asking for 10 over the period keeps some left.
async function x(a: Account): Promise<Out> {
  type U = { data?: { public_metrics?: { followers_count?: number } } };
  const { data: u } = await call<U>("x.x.user.profile", { query: { "user.fields": "public_metrics" }, timeout });
  type T = { id: string; text?: string; created_at?: string; public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number; impression_count?: number; bookmark_count?: number } };
  const list = await soft(call<{ data?: T[] }>("x.x.user.posts", { query: {
        id: a.externalId,
        max_results: 10,
        start_time: new Date(Date.now() - PERIOD * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z"),
        "tweet.fields": "id,text,created_at,public_metrics",
        exclude: "retweets,replies",
      },
      timeout,
    }),
  );
  const posts: Out["posts"] = (list?.data.data ?? []).map((t) => ({
    externalId: t.id,
    caption: t.text,
    url: `https://x.com/${a.handle}/status/${t.id}`,
    publishedAt: t.created_at,
    views: num(t.public_metrics?.impression_count),
    likes: num(t.public_metrics?.like_count),
    comments: num(t.public_metrics?.reply_count),
    shares: sum(num(t.public_metrics?.retweet_count), num(t.public_metrics?.quote_count)),
    saves: num(t.public_metrics?.bookmark_count),
  }));
  return {
    stats: { followers: num(u.data?.public_metrics?.followers_count), views: sum(...posts.map((p) => p.views)), interactions: sum(...posts.flatMap((p) => [p.likes, p.comments, p.shares])) },
    posts,
  };
}

// LinkedIn has no statistics endpoint in treg's catalog for a personal profile.
const readers: Partial<Record<Network, (a: Account) => Promise<Out>>> = { instagram, facebook, youtube, tiktok, x };

/** Networks that charge for each read. */
export const PAID_NETWORKS: Network[] = ["x"];

export async function fetchTregStats(accounts: Account[], opts: { paid: boolean }) {
  const stats: AccountStats[] = [];
  const posts: PostStat[] = [];
  const warnings: string[] = [];
  for (const a of accounts) {
    const read = readers[a.network];
    const label = a.providerKind?.startsWith("treg:") ? a.providerKind.slice(5) : undefined;
    if (!read || !a.connected || !a.externalId || !label || !tregTokens().has(label)) continue;
    if (PAID_NETWORKS.includes(a.network) && !opts.paid) continue;
    // Publications and syncs share the "current team" with these reads: they take turns,
    // one account at a time, so a post that is due only waits for one account.
    await inTurn(async () => {
      setTeam(label);
      const fetchedAt = new Date().toISOString();
      try {
        const out = await read(a);
        stats.push({ accountId: a.id, fetchedAt, ...out.stats });
        posts.push(...out.posts.map((p) => ({ ...p, accountId: a.id, network: a.network })));
      } catch (e) {
        const error = reason(e);
        console.error(`[treg] stats ${a.network} @${a.handle}: ${(e as Error).message}`);
        stats.push({ accountId: a.id, fetchedAt, error });
        warnings.push(`@${a.handle} : ${error}`);
      }
    });
  }
  return { stats, posts, warnings };
}
