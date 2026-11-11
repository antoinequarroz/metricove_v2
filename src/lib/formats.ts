import type { Media, Network, PostFormat } from "./types";

// What each network can publish, in one place: the editor warns with these rules,
// and the server checks them again before a post is scheduled.

/** Stories exist on these networks only. */
export const STORY_NETWORKS: Network[] = ["instagram", "facebook"];
/** These networks publish photos. The others take videos (or text). */
export const PHOTO_NETWORKS: Network[] = ["instagram", "facebook"];
/** These networks refuse a post without a video. */
const VIDEO_ONLY: Network[] = ["tiktok", "youtube"];

/** Instagram refuses feed photos taller than 4:5 or wider than 1.91:1. */
export const IG_PHOTO_RATIO = { min: 4 / 5, max: 1.91 };
/** Stories longer than this are refused (Instagram) or cut (Facebook). */
export const STORY_MAX_SECONDS = 60;

const PNG_PROBLEM = "Instagram n'accepte que les photos JPEG : convertissez cette photo, ou retirez le compte Instagram.";

const LABEL: Record<Network, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok" };
const list = (ns: Network[]) => ns.map((n) => LABEL[n]).join(", ");

type MediaShape = Pick<Media, "kind" | "aspect" | "duration" | "width" | "height" | "mime">;

/** File type from the file name, as the networks will see it. */
export function mimeOfFile(file?: string | null): string | undefined {
  const ext = file?.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  return ext === "mov" ? "video/quicktime" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "video/mp4";
}

/** Instagram only takes JPEG photos, in the feed and in stories. */
export const instagramRefusesFile = (m: MediaShape) => m.kind === "image" && !!m.mime && m.mime !== "image/jpeg";

/** Width divided by height. Falls back on the rough aspect when the size is unknown. */
export function ratioOf(m: MediaShape): number {
  if (m.width && m.height) return m.width / m.height;
  return m.aspect === "9:16" ? 9 / 16 : m.aspect === "1:1" ? 1 : 16 / 9;
}

/** True when Instagram accepts this photo in the feed as it is. */
export function fitsInstagramFeed(m: MediaShape) {
  const r = ratioOf(m);
  // A hair of tolerance: 1080x1350 and 1080x566 are the usual exports.
  return r >= IG_PHOTO_RATIO.min - 0.01 && r <= IG_PHOTO_RATIO.max + 0.01;
}

/** What the post becomes on one network, in the words of that network. */
export function formatLabel(format: PostFormat | undefined, media: MediaShape | undefined, network?: Network): string {
  if (format === "story") return "Story";
  if (!media) return "Texte";
  if (media.kind === "image") return "Photo";
  if (network === "instagram") return "Reel";
  if (network === "youtube") return "Vidéo";
  return "Vidéo";
}

/**
 * Why this post can't be published as it is, in French, one sentence per problem.
 * Empty when everything is fine.
 */
export function postProblems(input: { format?: PostFormat; media?: MediaShape; networks: Network[] }): string[] {
  const { format, media, networks } = input;
  const out: string[] = [];
  const has = (n: Network) => networks.includes(n);

  if (format === "story") {
    const others = networks.filter((n) => !STORY_NETWORKS.includes(n));
    if (others.length) out.push(`Les stories ne partent que sur Instagram et Facebook : retirez ${list(others)}, ou choisissez « Publication ».`);
    if (!media) out.push("Une story a besoin d'une photo ou d'une vidéo.");
    else if (has("instagram") && instagramRefusesFile(media)) out.push(PNG_PROBLEM);
    else if (media.kind === "video" && media.duration > STORY_MAX_SECONDS) out.push(`Une story vidéo dure ${STORY_MAX_SECONDS} secondes au plus (celle-ci : ${Math.round(media.duration)} s).`);
    return out;
  }

  if (!media) {
    const need = networks.filter((n) => n === "instagram" || VIDEO_ONLY.includes(n));
    if (need.length) out.push(`${list(need)} ne publie${need.length > 1 ? "nt" : ""} pas de texte seul : ajoutez ${need.every((n) => n === "instagram") ? "une photo ou une vidéo" : "une vidéo"}.`);
    return out;
  }

  if (media.kind === "image") {
    const noPhoto = networks.filter((n) => !PHOTO_NETWORKS.includes(n));
    if (noPhoto.length) out.push(`${list(noPhoto)} : les photos ne sont pas prises en charge, seulement les vidéos. Retirez ${noPhoto.length > 1 ? "ces comptes" : "ce compte"} ou choisissez une vidéo.`);
    if (has("instagram") && instagramRefusesFile(media)) out.push(PNG_PROBLEM);
    if (has("instagram") && !fitsInstagramFeed(media))
      out.push("Instagram refuse cette photo dans le fil : elle doit être entre 4:5 (portrait) et 1,91:1 (paysage). Recadrez-la, ou publiez-la en story.");
  }
  return out;
}
