import fs from "node:fs/promises";
import type { Account, Network, Post, TargetResult } from "@/lib/types";
import { signedCoverUrl, signedMediaUrl } from "../media-url";
import type { MediaFile, Publisher } from "./types";
import { fetchTregStats } from "./treg-stats";

// treg (https://treg.to) relays calls to each network's API with its own OAuth apps,
// using the accounts connected in treg. Path parameters go in the query string.
//
// treg keeps one connected account per network and per team. To publish on two
// Instagram accounts, connect them in two treg teams and give one token per team:
//   TREG_TOKENS=perso:<token>,studio:<token>   (or TREG_TOKEN=<token> for a single team)
const base = () => (process.env.TREG_URL ?? "https://treg.to").replace(/\/+$/, "");

/** Team label → agent token. */
export function tregTokens(): Map<string, string> {
  const map = new Map<string, string>();
  if (process.env.TREG_TOKEN) map.set("main", process.env.TREG_TOKEN.trim());
  for (const entry of (process.env.TREG_TOKENS ?? "").split(",")) {
    const i = entry.indexOf(":");
    if (i > 0) map.set(entry.slice(0, i).trim(), entry.slice(i + 1).trim());
  }
  return map;
}

type CallInit = {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  form?: Record<string, string | boolean | undefined>;
  headers?: Record<string, string>;
};

let team = "main";
/** Picks the team (token) the next calls use. Only inside `inTurn`. */
export const setTeam = (label: string) => void (team = label);
const token = () => tregTokens().get(team) ?? "";

// `team` says which token every call uses. A sync and a publication must not switch it under
// each other's feet (a publication waits minutes on Instagram): they take turns.
let turn: Promise<unknown> = Promise.resolve();
export function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = turn.then(work, work);
  turn = run.catch(() => {});
  return run;
}

export async function call<T = unknown>(id: string, init: CallInit = {}): Promise<{ data: T; headers: Headers }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) qs.set(k, String(v));
  let body: string | undefined;
  let type: string | undefined;
  if (init.form) {
    const f = new URLSearchParams();
    for (const [k, v] of Object.entries(init.form)) if (v !== undefined) f.set(k, String(v));
    body = f.toString();
    type = "application/x-www-form-urlencoded";
  } else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    type = "application/json";
  }
  const res = await fetch(`${base()}/call/${id}${qs.size ? `?${qs}` : ""}`, {
    method: init.method ?? (body ? "POST" : "GET"),
    headers: { "X-Treg-Token": token(), ...(type ? { "Content-Type": type } : {}), ...init.headers },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) {
    if (/quotaExceeded/i.test(text)) throw new Error("Quota YouTube du jour épuisé (app Google partagée de treg). Relancez après 9h, ou branchez votre propre app Google dans treg.");
    if (res.status === 409 && /ambiguous/i.test(text)) throw new AmbiguousError(`Plusieurs comptes du même réseau dans la même équipe treg : gardez-en un seul par équipe (${id})`);
    if (res.status === 428) throw new Error(`Compte à reconnecter dans treg (${id.split(".")[0]})`);
    throw new Error(`treg ${res.status} sur ${id} : ${text.slice(0, 300)}`);
  }
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { data: data as T, headers: res.headers };
}

/** treg found two connections that could answer the call and won't pick one. */
class AmbiguousError extends Error {}

/**
 * A call to the Facebook Graph API for the team's Page.
 *
 * With `catalog`, treg's catalog entry is tried first. A team that also connected "Instagram via the Page"
 * has two connections on graph.facebook.com, and treg then refuses catalog calls as ambiguous (409):
 * the call goes again by tool name, /call/facebook/<path>, which always means the Page connection.
 * Without `catalog` (stories have no catalog entry), the call goes by tool name directly.
 */
export async function graph<T = unknown>(path: string, init: CallInit & { catalog?: string; pageId?: string } = {}): Promise<{ data: T; headers: Headers }> {
  const { catalog, pageId, ...rest } = init;
  if (catalog) {
    try {
      return await call<T>(catalog, { ...rest, query: { page_id: pageId, ...rest.query } });
    } catch (e) {
      if (!(e instanceof AmbiguousError)) throw e;
    }
  }
  return call<T>(`facebook/${path}`, rest);
}

/** Facebook answers errors as { error: { message, error_user_msg } } inside treg's own message. */
function facebookReason(e: unknown) {
  const text = (e as Error).message;
  const m = text.match(/"error_user_msg":"((?:[^"\\]|\\.)*)"/) ?? text.match(/"message":"((?:[^"\\]|\\.)*)"/);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ") : text;
}

const NETWORK_LABEL: Record<Network, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload URLs handed out by LinkedIn, YouTube and TikTok are usually pre-signed.
 * If one still wants authorization, send it through treg, which adds the account's key.
 */
async function put(url: string, body: Uint8Array, headers: Record<string, string> = {}) {
  const init = { method: "PUT", headers, body: body as BodyInit, signal: AbortSignal.timeout(600_000) };
  let res = await fetch(url, init);
  if (res.status === 401 || res.status === 403) res = await fetch(`${base()}/call/${url}`, { ...init, headers: { ...headers, "X-Treg-Token": token() } });
  return res;
}

type Conn = {
  id?: string | number;
  name?: string;
  provider?: string;
  /** "default", "instagram-login" or "facebook-page". */
  authorization_method?: string;
  resource_ref?: string;
  resource?: { ref?: string; id?: string };
};

/** The current team's connections, or undefined when treg does not say. */
async function connections(): Promise<Conn[] | undefined> {
  try {
    const res = await fetch(`${base()}/connections`, { headers: { "X-Treg-Token": token() }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Conn[] | { connections?: Conn[]; items?: Conn[] };
    return Array.isArray(body) ? body : (body.connections ?? body.items ?? []);
  } catch {
    return undefined;
  }
}

/** The Facebook Page selected on the team's Facebook connection, if any. */
async function facebookPageId(): Promise<string | undefined> {
  const all = (await connections())?.filter((c) => c.provider === "facebook") ?? [];
  // The Page connection itself, not an "Instagram via the Page" one if treg ever lists it under Facebook.
  const fb = all.find((c) => !c.authorization_method || c.authorization_method === "default") ?? all[0];
  return fb?.resource_ref ?? fb?.resource?.ref ?? fb?.resource?.id;
}

/** treg provider name → Metricove network. */
const PROVIDER_NETWORK: Record<string, Network> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  youtube: "youtube",
  google: "youtube",
  tiktok: "tiktok",
  x: "x",
  twitter: "x",
};
const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function account(network: Network, externalId: string, name: string, handle: string, extra: Partial<Account> = {}): Account {
  return {
    id: `treg-${team}-${network}-${externalId}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
    network,
    name: name || handle,
    handle: handle.replace(/^@/, ""),
    hue: hueOf(externalId),
    followers: 0,
    connected: true,
    externalId,
    // Which treg team (token) this account belongs to.
    providerKind: `treg:${team}`,
    ...extra,
  };
}

/* ---------- Accounts ---------- */

const readers: Record<Network, () => Promise<Account | undefined>> = {
  async instagram() {
    type P = { user_id?: string; id?: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number };
    const { data } = await call<P>("instagram.instagram.user.profile", {
      query: { ig_user_id: "me", fields: "user_id,username,name,profile_picture_url,followers_count" },
    });
    const id = data.user_id ?? data.id;
    if (!id) return undefined;
    return account("instagram", id, data.name ?? "", data.username ?? id, { avatarUrl: data.profile_picture_url, followers: data.followers_count ?? 0 });
  },
  async facebook() {
    type P = { id?: string; name?: string; fan_count?: number; username?: string };
    const pageId = await facebookPageId();
    if (!pageId) return undefined;
    const { data: page } = await graph<P>(pageId, { catalog: "facebook.x.page", pageId, query: { fields: "id,name,fan_count,username" } });
    if (!page.id) return undefined;
    return account("facebook", page.id, page.name ?? "", page.username ?? page.name ?? page.id, { followers: page.fan_count ?? 0 });
  },
  async linkedin() {
    type P = { sub?: string; name?: string; picture?: string; email?: string };
    const { data } = await call<P>("linkedin.linkedin.user.profile");
    if (!data.sub) return undefined;
    return account("linkedin", data.sub, data.name ?? "", data.name?.toLowerCase().replace(/\s+/g, "") ?? data.sub, { avatarUrl: data.picture });
  },
  async youtube() {
    type C = { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } }; statistics?: { subscriberCount?: string } };
    const { data } = await call<{ items?: C[] } & Partial<C>>("youtube.youtube.channel.profile", { query: { part: "snippet,statistics", mine: true } });
    const c = data.items?.[0] ?? (data.id ? (data as C) : undefined);
    if (!c) return undefined;
    return account("youtube", c.id, c.snippet?.title ?? "", c.snippet?.customUrl ?? c.snippet?.title ?? c.id, {
      avatarUrl: c.snippet?.thumbnails?.default?.url,
      followers: Number(c.statistics?.subscriberCount ?? 0),
    });
  },
  async tiktok() {
    type P = { data?: { creator_username?: string; creator_nickname?: string; creator_avatar_url?: string } };
    const { data } = await call<P>("tiktok.tiktok.creator.info", { method: "POST", body: {}, headers: { "Content-Type": "application/json; charset=UTF-8" } });
    const c = data.data;
    if (!c?.creator_username) return undefined;
    return account("tiktok", c.creator_username, c.creator_nickname ?? "", c.creator_username, { avatarUrl: c.creator_avatar_url });
  },
  // Each X profile read costs about $0.01 on treg: it only runs on "Synchroniser".
  async x() {
    type P = { data?: { id: string; username: string; name: string; profile_image_url?: string; public_metrics?: { followers_count?: number } } };
    const { data } = await call<P>("x.x.user.profile", { query: { "user.fields": "profile_image_url,public_metrics" } });
    const u = data.data;
    if (!u) return undefined;
    return account("x", u.id, u.name, u.username, { avatarUrl: u.profile_image_url, followers: u.public_metrics?.followers_count ?? 0 });
  },
};

/* ---------- Publishing, one function per network ---------- */

type Ctx = { post: Post; account: Account; media?: MediaFile };
type Out = { externalId?: string };

/** LinkedIn's "little text" format needs these characters escaped. */
const linkedinText = (s: string) => s.replace(/[\\()[\]{}<>@|~_*]/g, (c) => `\\${c}`);
const LINKEDIN_HEADERS = { "LinkedIn-Version": "202601", "X-Restli-Protocol-Version": "2.0.0" };

/* ---------- Facebook stories ---------- */

/** Name of the treg tool that reaches Facebook's video upload host with the Page's key. */
const RUPLOAD_TOOL = "facebook-rupload";

/** A photo story: the photo is first sent to the Page without being shown, then turned into a story. */
async function facebookPhotoStory(page: string, media: MediaFile): Promise<Out> {
  const { data: photo } = await graph<{ id: string }>(`${page}/photos`, {
    catalog: "facebook.facebook.page.photo.create",
    pageId: page,
    method: "POST",
    body: { url: signedMediaUrl(media.id), published: false },
  });
  if (!photo.id) throw new Error("Facebook n'a pas accepté la photo");
  const { data } = await graph<{ success?: boolean; post_id?: string }>(`${page}/photo_stories`, { method: "POST", body: { photo_id: photo.id } });
  if (data.success === false) throw new Error("Facebook n'a pas publié la story");
  return { externalId: data.post_id ?? photo.id };
}

/** A video story, in Facebook's three steps: open an upload, hand over the video, publish. */
async function facebookVideoStory(page: string, media: MediaFile): Promise<Out> {
  const { data: start } = await graph<{ video_id?: string; upload_url?: string }>(`${page}/video_stories`, { method: "POST", body: { upload_phase: "start" } });
  if (!start.video_id || !start.upload_url) throw new Error("Facebook n'a pas ouvert l'envoi de la story");
  // Facebook downloads the video itself from our signed link. The upload host (rupload.facebook.com) wants
  // the Page's key, which only treg holds: the call goes through the team's "facebook-rupload" treg tool
  // (see docs/TREG.md for the one command that creates it).
  const res = await fetch(`${base()}/call/${RUPLOAD_TOOL}${new URL(start.upload_url).pathname}`, {
    method: "POST",
    headers: { "X-Treg-Token": token(), file_url: signedMediaUrl(media.id) },
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  if (!res.ok || !/"success"\s*:\s*true/.test(text)) {
    console.error(`[treg] facebook story upload ${res.status}: ${text.slice(0, 300)}`);
    if (res.status === 404 || /not found|unknown tool|no such tool|no tool/i.test(text))
      throw new Error(`Les stories vidéo Facebook demandent un réglage de plus dans treg (outil « ${RUPLOAD_TOOL} », voir docs/TREG.md). Les stories photo marchent sans.`);
    throw new Error(`Facebook n'a pas pu recevoir la vidéo de la story (${res.status})`);
  }
  const { data } = await graph<{ success?: boolean; post_id?: string }>(`${page}/video_stories`, {
    method: "POST",
    body: { upload_phase: "finish", video_id: start.video_id },
  });
  if (data.success === false) throw new Error("Facebook n'a pas publié la story");
  return { externalId: data.post_id ?? start.video_id };
}

/**
 * Creates an Instagram container (a photo, a Reel or a story being prepared), waits until Instagram
 * has processed it, then publishes it.
 */
async function instagramPublish(a: Account, query: Record<string, string | undefined>, opts: { video: boolean }): Promise<Out> {
  // treg's "Instagram login" app is not reviewed by Meta yet: it reads but cannot publish (code 10).
  // The "Facebook Page" method uses approved permissions, so we fall back to it.
  let headers: Record<string, string> = {};
  let c: { id: string };
  const create = { method: "POST", query: { ig_user_id: a.externalId, ...query } };
  try {
    ({ data: c } = await call<{ id: string }>("instagram.instagram.media.container.create", create));
  } catch (e) {
    if (!/does not have permission|"code":10\b/i.test((e as Error).message)) throw instagramError(e);
    headers = { "X-Treg-Authorization-Method": "facebook-page" };
    try {
      ({ data: c } = await call<{ id: string }>("instagram.instagram.media.container.create", { ...create, headers }));
    } catch (e2) {
      const reason = (e2 as Error).message;
      console.error("[treg] instagram via facebook-page", reason);
      // Only a missing Page connection (or the same refusal again) is fixed by connecting the Page method.
      // Anything else is the real reason: a file Meta can't read, an expired connection, a limit, a timeout.
      if (!/does not have permission|"code":10\b|not connected|no connection|authorization[- ]method|page-tools|No usable Instagram/i.test(reason)) throw instagramError(e2);
      throw new Error(
        `Meta refuse la publication par la connexion « Instagram » de treg. Reliez @${a.handle} à une Page Facebook, puis connectez la méthode Page dans treg (instagram, page-tools).`,
      );
    }
  }
  // Instagram downloads and processes the media before it can be published. A photo takes seconds, a video minutes.
  const [first, next, tries] = opts.video ? [10_000, 20_000, 27] : [3_000, 5_000, 24];
  let hiccups = 0;
  for (let i = 0; ; i++) {
    await sleep(i === 0 ? first : next);
    let s: { status_code?: string; status?: string };
    try {
      ({ data: s } = await call<{ status_code?: string; status?: string }>("instagram.instagram.media.container.status", {
        query: { ig_container_id: c.id, fields: "status_code,status" },
        headers,
      }));
      hiccups = 0;
    } catch (e) {
      // One lost answer must not throw away a media Instagram is still processing.
      if (++hiccups >= 3 || i >= tries) throw e;
      continue;
    }
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram a refusé ${opts.video ? "la vidéo" : "la photo"} : ${s.status ?? s.status_code}`);
    if (i >= tries) throw new Error(`Instagram traite encore ${opts.video ? "la vidéo après 9 minutes" : "la photo après 2 minutes"}`);
  }
  const { data } = await call<{ id: string }>("instagram.instagram.post.publish", { method: "POST", query: { ig_user_id: a.externalId, creation_id: c.id }, headers });
  return { externalId: data.id };
}

/** Meta's own reason when it refuses a photo or a video, in plain words. */
function instagramError(e: unknown) {
  const text = (e as Error).message;
  if (/aspect ratio|"code":36003\b/i.test(text)) return new Error("Instagram refuse le format de l'image : dans le fil, une photo doit être entre 4:5 et 1,91:1.");
  if (/"code":9004\b|Only photo or video can be accepted|media type/i.test(text)) return new Error("Instagram n'a pas pu lire le fichier : il accepte les photos JPEG et les vidéos MP4.");
  return e as Error;
}

const publishers: Record<Network, (c: Ctx) => Promise<Out>> = {
  async instagram({ post, account: a, media }) {
    if (!media?.path) throw new Error("Instagram exige une photo ou une vidéo");
    const story = post.format === "story";
    const url = signedMediaUrl(media.id);
    if (media.kind === "image") {
      if (media.mime !== "image/jpeg") throw new Error("Instagram n'accepte que les photos JPEG : réimportez la photo dans Metricove, elle sera convertie.");
      // A story has no caption. A feed photo has no media_type.
      return instagramPublish(a, story ? { media_type: "STORIES", image_url: url } : { image_url: url, caption: post.caption }, { video: false });
    }
    if (story) return instagramPublish(a, { media_type: "STORIES", video_url: url }, { video: true });
    return instagramPublish(
      a,
      {
        media_type: "REELS",
        video_url: url,
        caption: post.caption,
        // The image shown on the profile grid. Without it, Instagram takes the first frame.
        cover_url: media.cover ? signedCoverUrl(media.id) : undefined,
      },
      { video: true },
    );
  },

  async facebook({ post, account: a, media }) {
    const page = a.externalId!;
    try {
      if (post.format === "story") {
        if (!media?.path) throw new Error("Une story a besoin d'une photo ou d'une vidéo");
        return media.kind === "image" ? await facebookPhotoStory(page, media) : await facebookVideoStory(page, media);
      }
      if (media?.path && media.kind === "image") {
        const { data } = await graph<{ id: string; post_id?: string }>(`${page}/photos`, {
          catalog: "facebook.facebook.page.photo.create",
          pageId: page,
          method: "POST",
          body: { url: signedMediaUrl(media.id), caption: post.caption, published: true },
        });
        return { externalId: data.post_id ?? data.id };
      }
      if (media?.path) {
        const { data } = await graph<{ id: string }>(`${page}/videos`, {
          catalog: "facebook.facebook.page.video.create",
          pageId: page,
          method: "POST",
          query: { fields: "id,permalink_url" },
          body: { file_url: signedMediaUrl(media.id), description: post.caption, title: post.youtube?.title, published: true },
        });
        return { externalId: data.id };
      }
      const { data } = await graph<{ id: string }>(`${page}/feed`, {
        catalog: "facebook.facebook.page.post.create",
        pageId: page,
        method: "POST",
        form: { message: post.caption, published: true },
      });
      return { externalId: data.id };
    } catch (e) {
      if (e instanceof AmbiguousError) throw e;
      // Keep treg's own messages (reconnect, quota), and shorten Facebook's JSON to its sentence.
      const reason = facebookReason(e);
      throw reason === (e as Error).message ? e : new Error(`Facebook a refusé : ${reason}`);
    }
  },

  async linkedin({ post, account: a, media }) {
    const author = `urn:li:person:${a.externalId}`;
    let videoUrn: string | undefined;
    if (media?.path) {
      const bytes = await fs.readFile(media.path);
      type Init = { value: { video: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } };
      const { data: init } = await call<Init>("linkedin.linkedin.video.upload.init", {
        method: "POST",
        query: { action: "initializeUpload" },
        headers: LINKEDIN_HEADERS,
        body: { initializeUploadRequest: { owner: author, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } },
      });
      // The upload URLs are pre-signed by LinkedIn: the parts go straight there.
      const etags: string[] = [];
      for (const part of init.value.uploadInstructions) {
        const res = await put(part.uploadUrl, bytes.subarray(part.firstByte, part.lastByte + 1), { "Content-Type": "application/octet-stream" });
        if (!res.ok) throw new Error(`Envoi de la vidéo à LinkedIn refusé (${res.status})`);
        etags.push(res.headers.get("etag") ?? "");
      }
      await call("linkedin.linkedin.video.upload.finalize", {
        method: "POST",
        query: { action: "finalizeUpload" },
        headers: LINKEDIN_HEADERS,
        body: { finalizeUploadRequest: { video: init.value.video, uploadToken: "", uploadedPartIds: etags } },
      });
      videoUrn = init.value.video;
      // LinkedIn processes the video for a moment before a post can use it.
      await sleep(30_000);
    }
    const { headers } = await call("linkedin.linkedin.user.post.create", {
      method: "POST",
      headers: LINKEDIN_HEADERS,
      body: {
        author,
        commentary: linkedinText(post.caption),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        ...(videoUrn ? { content: { media: { id: videoUrn, title: post.youtube?.title ?? "" } } } : {}),
      },
    });
    return { externalId: headers.get("x-restli-id") ?? undefined };
  },

  async youtube({ post, media }) {
    if (!media?.path) throw new Error("YouTube exige une vidéo");
    const short = post.youtube?.format === "short";
    const title = (post.youtube?.title || post.caption.split("\n")[0] || "Vidéo").slice(0, 100);
    const description = short && !/#shorts/i.test(post.caption) ? `${post.caption}\n\n#Shorts` : post.caption;
    const { headers } = await call("youtube.youtube.video.upload", {
      method: "POST",
      query: { part: "snippet,status", uploadType: "resumable" },
      body: {
        snippet: { title, description: description.slice(0, 5000), categoryId: "22" },
        status: { privacyStatus: post.youtube?.privacy ?? "public", selfDeclaredMadeForKids: false },
      },
    });
    const session = headers.get("location");
    if (!session) throw new Error("YouTube n'a pas ouvert d'envoi (pas d'en-tête Location)");
    // The session URL already carries the authorization.
    const bytes = await fs.readFile(media.path);
    const res = await put(session, bytes, { "Content-Type": media.mime });
    const text = await res.text();
    if (!res.ok) throw new Error(`Envoi de la vidéo à YouTube refusé (${res.status}) : ${text.slice(0, 200)}`);
    return { externalId: (JSON.parse(text) as { id?: string }).id };
  },

  // TikTok only lets audited apps publish directly. treg's app isn't yet, so the video
  // goes to the TikTok inbox: the creator adds the caption and posts it from the app.
  async tiktok({ media }) {
    if (!media?.path) throw new Error("TikTok exige une vidéo");
    const bytes = await fs.readFile(media.path);
    const MB = 1024 * 1024;
    const chunk = bytes.length <= 64 * MB ? bytes.length : 10 * MB;
    const count = Math.max(1, Math.floor(bytes.length / chunk));
    const { data: init } = await call<{ data?: { publish_id: string; upload_url: string }; error?: { code?: string; message?: string } }>("tiktok.tiktok.video.inbox.init", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: { source_info: { source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: chunk, total_chunk_count: count } },
    });
    if (init.error?.code && init.error.code !== "ok") {
      if (/pending_share|spam_risk/i.test(init.error.code)) throw new Error("TikTok refuse un nouvel envoi : trop de vidéos attendent déjà dans ton app TikTok. Finalise-les ou supprime-les, puis relance.");
      throw new Error(`TikTok a refusé l'envoi : ${init.error.code}${init.error.message ? ` (${init.error.message})` : ""}`);
    }
    if (!init.data?.upload_url) throw new Error(`TikTok a refusé l'envoi : ${init.error?.message ?? "réponse inattendue"}`);
    for (let i = 0; i < count; i++) {
      const start = i * chunk;
      const end = i === count - 1 ? bytes.length - 1 : start + chunk - 1; // the last chunk takes the rest
      const res = await put(init.data.upload_url, bytes.subarray(start, end + 1), { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${bytes.length}` });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        console.error(`[treg] tiktok upload ${res.status} on ${new URL(init.data.upload_url).host}: ${text}`);
        throw new Error(
          res.status === 404
            ? "TikTok a refusé l'envoi (404). Ça arrive quand la même vidéo attend déjà dans ton app TikTok : finalise-la ou supprime-la, puis relance."
            : `Envoi de la vidéo à TikTok refusé (${res.status})${text ? ` : ${text}` : ""}`,
        );
      }
    }
    // TikTok sometimes takes several minutes. The file is already uploaded, so after the wait it
    // counts as sent: marking it failed would make a retry send a duplicate to the inbox.
    for (let i = 0; i < 30; i++) {
      await sleep(10_000);
      const { data: s } = await call<{ data?: { status?: string; fail_reason?: string } }>("tiktok.tiktok.publish.status", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: { publish_id: init.data.publish_id },
      });
      const status = s.data?.status;
      if (status === "SEND_TO_USER_INBOX" || status === "PUBLISH_COMPLETE") return { externalId: `inbox:${init.data.publish_id}` };
      if (status === "FAILED") throw new Error(`TikTok a refusé la vidéo : ${s.data?.fail_reason ?? "raison inconnue"}`);
    }
    console.warn(`[treg] tiktok ${init.data.publish_id} still processing after 5 min, counted as sent to the inbox`);
    return { externalId: `inbox:${init.data.publish_id}` };
  },

  async x({ post }) {
    // Media upload through treg isn't documented yet: X gets the text only.
    const { data } = await call<{ data?: { id: string } }>("x.x.post.create", { method: "POST", body: { text: post.caption } });
    return { externalId: data.data?.id };
  },
};

export const tregPublisher: Publisher = {
  name: "treg",
  label: "treg",
  status() {
    const n = tregTokens().size;
    if (!n) return { ready: false, detail: "TREG_TOKEN manquant" };
    if (!process.env.PUBLIC_URL) return { ready: false, detail: "PUBLIC_URL manquant (adresse publique de Metricove)" };
    return { ready: true, detail: n > 1 ? `treg.to · ${n} équipes` : "treg.to" };
  },

  syncAccounts() {
    return inTurn(() => syncAll());
  },

  fetchStats(accounts, opts) {
    return fetchTregStats(accounts, opts);
  },

  publish(post, accounts, media) {
    return inTurn(() => publishAll(this, post, accounts, media));
  },
};

async function syncAll() {
  {
    const all: Account[] = [];
    const warnings: string[] = [];
    for (const label of tregTokens().keys()) {
      team = label;
      // Every network is tried. Failures are only reported for networks the team has connected in treg:
      // the others just fail with "not connected".
      const connected = new Set((await connections())?.map((c) => PROVIDER_NETWORK[c.provider ?? ""]).filter(Boolean));
      // One network failing (quota, expired) must not hide the others.
      for (const [network, read] of Object.entries(readers) as [Network, () => Promise<Account | undefined>][]) {
        try {
          const a = await read();
          if (a) all.push(a);
          else if (connected.has(network)) warnings.push(`${NETWORK_LABEL[network]} (équipe ${label}) : connecté dans treg, mais aucun compte trouvé`);
        } catch (e) {
          if (connected.has(network)) warnings.push(`${NETWORK_LABEL[network]} (équipe ${label}) : ${(e as Error).message}`);
        }
      }
    }
    if (!all.length && warnings.length) throw new Error(warnings[0]);
    if (!all.length) throw new Error("Aucun compte trouvé dans treg : vérifiez les connexions et les jetons (TREG_TOKENS)");
    return { accounts: all, warnings };
  }
}

async function publishAll(self: Publisher, post: Post, accounts: Account[], media?: MediaFile) {
  {
    const at = () => new Date().toISOString();
    const results: Record<string, TargetResult> = {};
    for (const a of accounts) {
      if (!self.status().ready) {
        results[a.id] = { status: "failed", error: `treg n'est pas configuré : ${self.status().detail}`, at: at() };
      } else if (!a.externalId || !a.providerKind?.startsWith("treg:") || !tregTokens().has(a.providerKind.slice(5))) {
        results[a.id] = { status: "failed", error: "Compte non relié à treg (synchronisez les comptes)", at: at() };
      } else {
        team = a.providerKind.slice(5);
        try {
          const out = await publishers[a.network]({ post, account: a, media });
          results[a.id] = { status: "published", externalId: out.externalId, at: at() };
        } catch (e) {
          results[a.id] = { status: "failed", error: (e as Error).message, at: at() };
        }
      }
    }
    return results;
  }
}
