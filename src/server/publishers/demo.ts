import type { AccountStats, PostStat } from "@/lib/types";
import type { Publisher } from "./types";

/** A steady pseudo-random number from a text, so demo numbers do not jump at each refresh. */
const rnd = (seed: string, max: number) => [...seed].reduce((h, c) => (h * 33 + c.charCodeAt(0)) % 99_991, 17) % max;

/** Pretends to publish. Add #echec to a caption to test the failure path. */
export const demoPublisher: Publisher = {
  name: "demo",
  label: "Mode démo",
  status: () => ({ ready: true, detail: "Aucune publication réelle" }),
  /** Made-up numbers, to show the Statistics page without any real account. */
  async fetchStats(accounts) {
    const fetchedAt = new Date().toISOString();
    const stats: AccountStats[] = [];
    const posts: PostStat[] = [];
    for (const a of accounts) {
      if (a.network === "linkedin") continue;
      const base = Math.max(200, a.followers);
      for (let i = 0; i < 6; i++) {
        const views = Math.round(base * (0.3 + rnd(`${a.id}v${i}`, 300) / 100));
        posts.push({
          accountId: a.id,
          network: a.network,
          externalId: `demo-${a.id}-${i}`,
          caption: ["Les coulisses du tournage de cette semaine", "3 erreurs que je faisais au début", "Ce livre m'a fait changer d'avis", "Nouveau format, dites-moi ce que vous en pensez", "Le making-of en 30 secondes", "Réponse à vos questions"][i],
          publishedAt: new Date(Date.now() - (i * 2 + 1) * 86_400_000 - rnd(a.id, 20) * 3_600_000).toISOString(),
          views,
          reach: Math.round(views * 0.8),
          likes: Math.round(views * (0.03 + rnd(`${a.id}l${i}`, 60) / 1000)),
          comments: rnd(`${a.id}c${i}`, 40),
          shares: rnd(`${a.id}s${i}`, 25),
        });
      }
      const mine = posts.filter((p) => p.accountId === a.id);
      stats.push({
        accountId: a.id,
        fetchedAt,
        followers: a.followers,
        period: 28,
        views: mine.reduce((t, p) => t + (p.views ?? 0), 0) * 2,
        reach: mine.reduce((t, p) => t + (p.reach ?? 0), 0),
        interactions: mine.reduce((t, p) => t + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0), 0),
      });
    }
    return { stats, posts, warnings: [] };
  },
  async publish(post, accounts) {
    await new Promise((r) => setTimeout(r, 400));
    const fail = post.caption.includes("#echec");
    const at = new Date().toISOString();
    return Object.fromEntries(
      accounts.map((a) => [
        a.id,
        fail ? { status: "failed" as const, error: "Échec simulé (#echec dans le texte)", at } : { status: "published" as const, externalId: `demo-${post.id}`, at },
      ]),
    );
  },
};
