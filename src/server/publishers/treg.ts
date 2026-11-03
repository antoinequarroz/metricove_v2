import fs from "node:fs/promises";
import type { Account, Network, Post, TargetResult } from "@/lib/types";
import { signedMediaUrl } from "../media-url";
import type { MediaFile, Publisher } from "./types";

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
const token = () => tregTokens().get(team) ?? "";

async function call<T = unknown>(id: string, init: CallInit = {}): Promise<{ data: T; headers: Headers }> {
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
    if (res.status === 409 && /ambiguous/i.test(text)) throw new Error(`Plusieurs comptes du même réseau dans la même équipe treg : gardez-en un seul par équipe (${id})`);
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

type Conn = { id?: string | number; name?: string; provider?: string; resource_ref?: string; resource?: { ref?: string; id?: string } };

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
  const fb = (await connections())?.find((c) => c.provider === "facebook");
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
    const { data: page } = await call<P>("facebook.x.page", { query: { page_id: pageId, fields: "id,name,fan_count,username" } });
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

const publishers: Record<Network, (c: Ctx) => Promise<Out>> = {
  async instagram({ post, account: a, media }) {
    if (!media?.path) throw new Error("Instagram exige une vidéo");
    const { data: c } = await call<{ id: string }>("instagram.instagram.media.container.create", {
      method: "POST",
      query: { ig_user_id: a.externalId, media_type: "REELS", video_url: signedMediaUrl(media.id), caption: post.caption },
    });
    // Instagram downloads and processes the video before it can be published.
    for (let i = 0; ; i++) {
      await sleep(i === 0 ? 10_000 : 20_000);
      const { data: s } = await call<{ status_code?: string; status?: string }>("instagram.instagram.media.container.status", {
        query: { ig_container_id: c.id, fields: "status_code,status" },
      });
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram a refusé la vidéo : ${s.status ?? s.status_code}`);
      if (i >= 27) throw new Error("Instagram traite encore la vidéo après 9 minutes");
    }
    const { data } = await call<{ id: string }>("instagram.instagram.post.publish", { method: "POST", query: { ig_user_id: a.externalId, creation_id: c.id } });
    return { externalId: data.id };
  },

  async facebook({ post, account: a, media }) {
    if (media?.path) {
      const { data } = await call<{ id: string }>("facebook.facebook.page.video.create", {
        method: "POST",
          query: { page_id: a.externalId, fields: "id,permalink_url" },
        body: { file_url: signedMediaUrl(media.id), description: post.caption, title: post.youtube?.title, published: true },
      });
      return { externalId: data.id };
    }
    const { data } = await call<{ id: string }>("facebook.facebook.page.post.create", {
      method: "POST",
      query: { page_id: a.externalId },
      form: { message: post.caption, published: true },
    });
    return { externalId: data.id };
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
    const { data: init } = await call<{ data?: { publish_id: string; upload_url: string }; error?: { message?: string } }>("tiktok.tiktok.video.inbox.init", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: { source_info: { source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: chunk, total_chunk_count: count } },
    });
    if (!init.data) throw new Error(`TikTok a refusé l'envoi : ${init.error?.message ?? "réponse inattendue"}`);
    for (let i = 0; i < count; i++) {
      const start = i * chunk;
      const end = i === count - 1 ? bytes.length - 1 : start + chunk - 1; // the last chunk takes the rest
      const res = await put(init.data.upload_url, bytes.subarray(start, end + 1), { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${bytes.length}` });
      if (!res.ok) throw new Error(`Envoi de la vidéo à TikTok refusé (${res.status})`);
    }
    for (let i = 0; i < 15; i++) {
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
    throw new Error("TikTok traite encore la vidéo après 2 minutes 30");
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

  async syncAccounts() {
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
  },

  async publish(post, accounts, media) {
    const at = () => new Date().toISOString();
    const results: Record<string, TargetResult> = {};
    for (const a of accounts) {
      if (!this.status().ready) {
        results[a.id] = { status: "failed", error: `treg n'est pas configuré : ${this.status().detail}`, at: at() };
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
  },
};
