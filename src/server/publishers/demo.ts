import type { Publisher } from "./types";

/** Pretends to publish. Add #echec to a caption to test the failure path. */
export const demoPublisher: Publisher = {
  name: "demo",
  label: "Mode démo",
  status: () => ({ ready: true, detail: "Aucune publication réelle" }),
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
