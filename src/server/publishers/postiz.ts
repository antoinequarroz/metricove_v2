import fs from "node:fs/promises";
import type { Account, Network, Post, TargetResult } from "@/lib/types";
import type { Publisher } from "./types";

// Postiz public API, self-hosted on the VPS.
// POSTIZ_URL is the API base, e.g. https://postiz.antoinequarroz.ch/api/public/v1
const base = () => (process.env.POSTIZ_URL ?? "").replace(/\/+$/, "");
const key = () => process.env.POSTIZ_API_KEY ?? "";

const KIND_TO_NETWORK: Record<string, Network> = {
  instagram: "instagram",
  "instagram-standalone": "instagram",
  facebook: "facebook",
  x: "x",
  linkedin: "linkedin",
  "linkedin-page": "linkedin",
  youtube: "youtube",
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    // Postiz expects the raw key, without "Bearer".
    headers: { Authorization: key(), ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Postiz ${res.status} sur ${path} : ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Settings Postiz requires per provider. */
function settingsFor(kind: string, post: Post) {
  switch (kind) {
    case "youtube":
      return {
        __type: "youtube",
        title: (post.youtube?.title || post.caption.split("\n")[0] || "Vidéo").slice(0, 100),
        type: post.youtube?.privacy ?? "public",
        selfDeclaredMadeForKids: "no",
        tags: [],
      };
    case "x":
      return { __type: "x", who_can_reply_post: "everyone", community: "" };
    case "instagram":
    case "instagram-standalone":
      return { __type: kind, post_type: "post", is_trial_reel: false, collaborators: [] };
    case "linkedin":
    case "linkedin-page":
      return { __type: kind, post_as_images_carousel: false };
    default:
      return { __type: kind };
  }
}

/** YouTube uses the caption as description; Shorts get the #Shorts tag. */
function contentFor(network: Network, post: Post) {
  if (network === "youtube" && post.youtube?.format === "short" && !/#shorts/i.test(post.caption)) return `${post.caption}\n\n#Shorts`.trim();
  return post.caption;
}

type Integration = { id: string; name: string; identifier: string; picture?: string; disabled?: boolean; profile?: string };

export const postizPublisher: Publisher = {
  name: "postiz",
  label: "Postiz",
  status() {
    if (!base() || !key()) return { ready: false, detail: "POSTIZ_URL et POSTIZ_API_KEY manquants" };
    return { ready: true, detail: new URL(base()).host };
  },

  async syncAccounts() {
    const list = await call<Integration[]>("/integrations");
    return list
      .filter((i) => KIND_TO_NETWORK[i.identifier])
      .map(
        (i, n): Account => ({
          id: `postiz-${i.id}`,
          network: KIND_TO_NETWORK[i.identifier],
          name: i.name,
          handle: i.profile || i.name,
          hue: (n * 67 + 20) % 360,
          followers: 0,
          connected: !i.disabled,
          avatarUrl: i.picture || undefined,
          externalId: i.id,
          providerKind: i.identifier,
        }),
      );
  },

  async publish(post, accounts, media) {
    const at = () => new Date().toISOString();
    const fail = (error: string) => Object.fromEntries(accounts.map((a) => [a.id, { status: "failed" as const, error, at: at() }]));

    if (!this.status().ready) return fail("Postiz n'est pas configuré");

    let image: { id: string; path: string }[] = [];
    if (media?.path) {
      try {
        const form = new FormData();
        const bytes = await fs.readFile(media.path);
        form.append("file", new Blob([bytes], { type: media.mime }), media.title);
        const up = await call<{ id: string; path: string }>("/upload", { method: "POST", body: form });
        image = [{ id: up.id, path: up.path }];
      } catch (e) {
        return fail(`Envoi de la vidéo impossible : ${(e as Error).message}`);
      }
    }

    // One request per account, so one failing network does not block the others.
    const results: Record<string, TargetResult> = {};
    for (const a of accounts) {
      if (!a.externalId || !a.providerKind) {
        results[a.id] = { status: "failed", error: "Compte non relié à Postiz (synchronisez les comptes)", at: at() };
        continue;
      }
      try {
        const res = await call<{ postId: string; integration: string }[]>("/posts", {
          method: "POST",
          body: JSON.stringify({
            type: "now",
            date: new Date().toISOString(),
            shortLink: false,
            tags: [],
            posts: [{ integration: { id: a.externalId }, value: [{ content: contentFor(a.network, post), image }], settings: settingsFor(a.providerKind, post) }],
          }),
        });
        results[a.id] = { status: "published", externalId: res?.[0]?.postId, at: at() };
      } catch (e) {
        results[a.id] = { status: "failed", error: (e as Error).message, at: at() };
      }
    }
    return results;
  },
};
