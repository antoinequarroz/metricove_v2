import "server-only";
import type { StatsPayload } from "@/lib/types";
import { listAccounts, listAccountStats, listFollowerHistory, listPostStats, saveAccountStats, savePostStats, upsertAccount } from "./db";
import { getPublisher } from "./publishers";

const g = globalThis as unknown as { __metricoveStats?: { running?: Promise<string[]>; last: number } };
const state = () => (g.__metricoveStats ??= { last: 0 });

/** Paid networks (X) are read at most this often, even when "Actualiser" is clicked several times. */
const PAID_EVERY_MS = 6 * 3_600_000;
/** The automatic refresh, free networks only. */
const AUTO_EVERY_MS = 12 * 3_600_000;

export function getStats(): StatsPayload {
  const ids = new Set(listAccounts().map((a) => a.id));
  return {
    accounts: listAccountStats().filter((s) => ids.has(s.accountId)),
    posts: listPostStats().filter((p) => ids.has(p.accountId)),
    history: listFollowerHistory().filter((h) => ids.has(h.accountId)),
    available: !!getPublisher().fetchStats,
  };
}

/** Reads fresh numbers from the networks. Two refreshes asked at once share one run. */
export function refreshStats(opts: { paid: boolean }): Promise<string[]> {
  const s = state();
  if (s.running) return s.running;
  const run = (async () => {
    const p = getPublisher();
    if (!p.fetchStats || !p.status().ready) return [];
    const accounts = listAccounts();
    const known = new Map(listAccountStats().map((x) => [x.accountId, x]));
    // An account read less than 6 hours ago is not paid for again.
    const fresh = (id: string) => Date.now() - new Date(known.get(id)?.fetchedAt ?? 0).getTime() < PAID_EVERY_MS && !known.get(id)?.error;
    const { stats, posts, warnings } = await p.fetchStats(
      accounts.filter((a) => !(a.network === "x" && fresh(a.id))),
      opts,
    );
    for (const st of stats) {
      saveAccountStats(st);
      if (st.error) continue;
      savePostStats(st.accountId, posts.filter((x) => x.accountId === st.accountId));
      const a = accounts.find((x) => x.id === st.accountId);
      if (a && st.followers !== undefined && st.followers !== a.followers) upsertAccount({ ...a, followers: st.followers });
    }
    s.last = Date.now();
    return warnings;
  })().finally(() => (s.running = undefined));
  s.running = run;
  return run;
}

/** Called by the scheduler: refreshes twice a day, in the background. */
export function refreshStatsIfStale() {
  const s = state();
  if (s.running || !getPublisher().fetchStats) return;
  if (!s.last) {
    // After a restart, the last refresh time comes from the stored numbers.
    s.last = Math.max(0, ...listAccountStats().map((x) => new Date(x.fetchedAt).getTime())) || 1;
  }
  if (Date.now() - s.last < AUTO_EVERY_MS) return;
  s.last = Date.now();
  refreshStats({ paid: false }).catch((e) => console.error("[stats]", e));
}
