import "server-only";
import type { StatsPayload } from "@/lib/types";
import { listAccounts, listAccountStats, listFollowerHistory, listPostStats, saveAccountStats, savePostStats, setAccountFollowers } from "./db";
import { getPublisher } from "./publishers";

const g = globalThis as unknown as { __metricoveStats?: { running?: Promise<string[]>; paid?: boolean; last: number } };
const state = () => (g.__metricoveStats ??= { last: 0 });

/** Paid networks (X) are read at most this often, even when "Actualiser" is clicked several times. */
const PAID_EVERY_MS = 6 * 3_600_000;
/** The automatic refresh, free networks only. */
const AUTO_EVERY_MS = 12 * 3_600_000;
/** When an automatic refresh read nothing (network down), it tries again after this. */
const RETRY_MS = 15 * 60_000;

/** Why statistics can't be read right now, or undefined when they can. */
function blocked(): string | undefined {
  const p = getPublisher();
  if (!p.fetchStats) return "Ce mode de publication ne donne pas de statistiques";
  // Reading needs the service itself, not everything publishing needs (a public address, for example).
  const s = p.status();
  if (!s.ready && !(p.name === "treg" && /PUBLIC_URL/.test(s.detail ?? ""))) return s.detail ?? "Service de publication à configurer";
  return undefined;
}

export function getStats(): StatsPayload {
  const ids = new Set(listAccounts().map((a) => a.id));
  return {
    accounts: listAccountStats().filter((s) => ids.has(s.accountId)),
    posts: listPostStats().filter((p) => ids.has(p.accountId)),
    history: listFollowerHistory().filter((h) => ids.has(h.accountId)),
    available: !blocked(),
  };
}

/** Reads fresh numbers from the networks. Refreshes asked at once share one run. Throws when nothing can be read at all. */
export function refreshStats(opts: { paid: boolean }): Promise<string[]> {
  const s = state();
  if (s.running) {
    // A click that lands during an automatic (free) run still gets its paid networks read, right after.
    if (opts.paid && !s.paid) return s.running.then(() => refreshStats(opts), () => refreshStats(opts));
    return s.running;
  }
  const run = (async () => {
    const why = blocked();
    if (why) throw new Error(why);
    const accounts = listAccounts();
    const known = new Map(listAccountStats().map((x) => [x.accountId, x]));
    // An account read less than 6 hours ago is not paid for again. One whose last read failed is retried.
    const fresh = (id: string) => Date.now() - new Date(known.get(id)?.fetchedAt ?? 0).getTime() < PAID_EVERY_MS && !known.get(id)?.error;
    const { stats, posts, warnings } = await getPublisher().fetchStats!(
      accounts.filter((a) => !(a.network === "x" && fresh(a.id))),
      opts,
    );
    for (const st of stats) {
      saveAccountStats(st);
      if (st.error) continue;
      savePostStats(st.accountId, posts.filter((x) => x.accountId === st.accountId));
      const a = accounts.find((x) => x.id === st.accountId);
      if (a && st.followers !== undefined && st.followers !== a.followers) setAccountFollowers(a.id, st.followers);
    }
    // A run where every account failed counts as not done: the automatic refresh comes back soon.
    const worked = !stats.length || stats.some((x) => !x.error);
    s.last = worked ? Date.now() : Date.now() - AUTO_EVERY_MS + RETRY_MS;
    return warnings;
  })().finally(() => {
    s.running = undefined;
    s.paid = undefined;
  });
  s.running = run;
  s.paid = opts.paid;
  return run;
}

/** Called by the scheduler: refreshes twice a day, in the background. Never pays. */
export function refreshStatsIfStale() {
  const s = state();
  if (s.running || blocked()) return;
  if (!s.last) {
    // After a restart, the last refresh time comes from the stored numbers.
    s.last = Math.max(0, ...listAccountStats().map((x) => new Date(x.fetchedAt).getTime())) || 1;
  }
  if (Date.now() - s.last < AUTO_EVERY_MS) return;
  s.last = Date.now() - AUTO_EVERY_MS + RETRY_MS;
  refreshStats({ paid: false }).catch((e) => console.error("[stats]", e));
}
