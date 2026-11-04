import type { Account, Post, TargetResult } from "./types";

/** What really happened on one account, in words Antoine can act on. */
export type Outcome = { kind: "published" | "inbox" | "failed" | "pending"; label: string; detail?: string };

/** Turns a raw publisher error into a short, readable reason. */
export function readableError(error = "") {
  if (/does not have permission|"code":10\b/i.test(error)) return "Meta refuse la publication par treg (droits de l'app Instagram de treg).";
  if (/non relié à treg|synchronisez/i.test(error)) return "Compte non relié à treg : synchronisez les comptes.";
  if (/quota/i.test(error)) return "Quota du réseau dépassé : réessayez plus tard.";
  if (/token|expired|expiré|OAuth/i.test(error)) return "Connexion au réseau expirée : reconnectez le compte dans treg.";
  const short = error.replace(/\s+/g, " ").trim();
  return short.length > 160 ? `${short.slice(0, 157)}…` : short || "Erreur inconnue";
}

export function outcomeOf(result: TargetResult | undefined, post: Post): Outcome {
  if (!result) return post.status === "publishing" || post.status === "scheduled" ? { kind: "pending", label: post.status === "publishing" ? "Envoi en cours…" : "En attente" } : { kind: "pending", label: "Pas encore publié" };
  if (result.status === "failed") return { kind: "failed", label: "Échec", detail: readableError(result.error) };
  if (result.externalId?.startsWith("inbox:")) {
    const until = new Date(new Date(result.at).getTime() + 24 * 3600_000);
    return { kind: "inbox", label: "À finaliser dans l'app TikTok", detail: `Ouvre TikTok (brouillons ou notifications), colle la légende et publie avant le ${until.toLocaleString("fr-CH", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.` };
  }
  return { kind: "published", label: "Publié" };
}

/** One line per account, for the toast after "Publier maintenant". */
export function summary(post: Post, accounts: Account[]) {
  const rows = accounts.filter((a) => post.accountIds.includes(a.id)).map((a) => ({ a, o: outcomeOf(post.results?.[a.id], post) }));
  const count = (k: Outcome["kind"]) => rows.filter((r) => r.o.kind === k).length;
  const lines = rows.map(({ a, o }) => `@${a.handle} : ${o.kind === "failed" ? `échec, ${o.detail}` : o.kind === "inbox" ? "à finaliser dans l'app TikTok (24 h)" : o.label.toLowerCase()}`);
  return { lines, published: count("published"), inbox: count("inbox"), failed: count("failed"), total: rows.length };
}

/** True when a "published" post still waits for Antoine in the TikTok app. */
export const waitsInTikTok = (post: Post) => post.status !== "failed" && Object.values(post.results ?? {}).some((r) => r.externalId?.startsWith("inbox:"));
