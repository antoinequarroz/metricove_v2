"use client";

import { ArrowDownRight, ArrowUpRight, ExternalLink, Eye, Heart, MessageCircle, RefreshCw, Share2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { NETWORK_ORDER, NETWORKS } from "@/lib/networks";
import { useProjectAccounts, useStore } from "@/lib/store";
import type { Account, PostStat, StatsPayload } from "@/lib/types";
import { cn, compact, fmt } from "@/lib/utils";
import { Avatar, Button } from "./ui";

/** Totals are counted over the posts published in this many days, the same way for every network. */
const DAYS = 28;

type Sort = "recent" | "views" | "likes";
const SORTS: { key: Sort; label: string }[] = [
  { key: "recent", label: "Récents" },
  { key: "views", label: "Vues" },
  { key: "likes", label: "J'aime" },
];

const interactionsOf = (p: PostStat) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
const show = (n: number | undefined) => (n === undefined ? "–" : compact(n));
/** A total that stays unknown when no post reports the number. */
const total = (posts: PostStat[], of: (p: PostStat) => number | undefined) => (posts.some((p) => of(p) !== undefined) ? posts.reduce((t, p) => t + (of(p) ?? 0), 0) : undefined);
/** The automatic first read is tried once per visit of the app, not at each return to the page. */
let askedOnce = false;

export function StatsPage() {
  const accounts = useProjectAccounts();
  const publishedIds = usePublishedIds();
  const [data, setData] = useState<StatsPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<Sort>("recent");
  const [picked, setOnly] = useState<string | null>(null);
  // A filter on an account that left the view (other project, account removed) no longer applies.
  const only = picked && accounts.some((a) => a.id === picked) ? picked : null;

  /** `auto` is the silent first read: it never pays for X. The button does. */
  const refresh = useCallback(async (auto = false) => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/stats/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paid: !auto }) });
      const body = (await res.json().catch(() => ({}))) as StatsPayload & { warnings?: string[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      setData(body);
      setError("");
      // Followers shown in the rest of the app come from the same refresh.
      useStore.getState().load();
      if (!auto) {
        if (body.accounts.length) toast.success("Statistiques à jour");
        else toast("Aucun compte lisible", { description: "Aucun de ces comptes ne donne de statistiques pour le moment." });
      }
      for (const w of body.warnings ?? []) toast.warning("Statistiques incomplètes", { description: w, duration: 10_000 });
    } catch (e) {
      toast.error("Impossible de lire les statistiques", { description: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadStats = useCallback(() => {
    fetch("/api/stats")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Erreur ${r.status}`);
        const body = (await r.json()) as StatsPayload;
        setData(body);
        setError("");
        // First visit: nothing stored yet, so the numbers are read right away.
        if (body.available && !body.accounts.length && !askedOnce) {
          askedOnce = true;
          refresh(true);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [refresh]);

  useEffect(loadStats, [loadStats]);

  const view = useMemo(() => {
    const ids = new Set(accounts.map((a) => a.id));
    const since = Date.now() - DAYS * 86_400_000;
    const posts = (data?.posts ?? []).filter((p) => ids.has(p.accountId));
    const recent = posts.filter((p) => p.publishedAt && new Date(p.publishedAt).getTime() >= since);
    const rows = [...accounts]
      .sort((a, b) => NETWORK_ORDER.indexOf(a.network) - NETWORK_ORDER.indexOf(b.network) || a.handle.localeCompare(b.handle))
      .map((a) => {
        const mine = recent.filter((p) => p.accountId === a.id);
        const stat = data?.accounts.find((s) => s.accountId === a.id);
        const history = (data?.history ?? []).filter((h) => h.accountId === a.id).map((h) => h.followers);
        return {
          account: a,
          stat,
          history,
          followers: stat?.followers ?? (a.followers || undefined),
          delta: history.length > 1 ? history[history.length - 1] - history[0] : undefined,
          posts: mine.length,
          views: total(mine, (p) => p.views),
          interactions: mine.length ? mine.reduce((t, p) => t + interactionsOf(p), 0) : undefined,
        };
      });
    const deltas = rows.filter((r) => r.delta !== undefined);
    const fetched = (data?.accounts ?? []).filter((s) => ids.has(s.accountId)).map((s) => new Date(s.fetchedAt).getTime());
    return {
      rows,
      posts,
      updatedAt: fetched.length ? Math.max(...fetched) : undefined,
      totals: {
        followers: rows.reduce((t, r) => t + (r.followers ?? 0), 0),
        delta: deltas.length ? deltas.reduce((t, r) => t + (r.delta ?? 0), 0) : undefined,
        posts: recent.length,
        views: total(recent, (p) => p.views),
        interactions: recent.length ? recent.reduce((t, p) => t + interactionsOf(p), 0) : undefined,
      },
    };
  }, [accounts, data]);

  const list = useMemo(() => {
    const by: Record<Sort, (p: PostStat) => number> = {
      recent: (p) => (p.publishedAt ? new Date(p.publishedAt).getTime() : 0),
      views: (p) => p.views ?? -1,
      likes: (p) => p.likes ?? -1,
    };
    return view.posts
      .filter((p) => !only || p.accountId === only)
      .sort((a, b) => by[sort](b) - by[sort](a))
      .slice(0, 24);
  }, [view.posts, sort, only]);

  const onlyAccount = only ? accounts.find((a) => a.id === only) : undefined;
  const empty = data && !view.posts.length && !view.rows.some((r) => r.stat);

  return (
    <>
      <header className="flex flex-wrap items-end gap-4 border-b border-line px-6 pt-5 pb-4 max-md:px-4">
        <div>
          <p className="text-[12px] font-medium text-ink-3">
            {view.updatedAt ? `Mis à jour ${formatDistanceToNow(view.updatedAt, { locale: fr, addSuffix: true })}` : "Comptes et posts"}
          </p>
          <h1 className="font-display text-[34px] leading-[1.05]">Statistiques</h1>
        </div>
        <div className="ml-auto">
          <Button onClick={() => refresh()} disabled={refreshing || !data?.available} title="Relit chaque réseau. X coûte quelques centimes par lecture.">
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            {refreshing ? "Lecture…" : "Actualiser"}
          </Button>
        </div>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          {error && !data ? (
            <Notice title="Impossible de charger les statistiques" text={error} action={<Button onClick={loadStats}>Réessayer</Button>} />
          ) : !data ? null : !accounts.length ? (
            <Notice title="Aucun compte" text="Connectez un compte pour voir ses statistiques ici." />
          ) : empty && refreshing ? (
            <Notice title="Lecture des statistiques…" text="Metricove interroge chaque réseau. Cela prend moins d'une minute." />
          ) : empty ? (
            <Notice
              title="Pas encore de statistiques"
              text={data.available ? "Cliquez sur « Actualiser » pour lire les chiffres de vos comptes." : "Ce mode de publication ne donne pas de statistiques."}
            />
          ) : (
            <>
              <section className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
                <Tile label="Abonnés" value={view.totals.followers} delta={view.totals.delta} hint="tous comptes" i={0} />
                <Tile label="Vues" value={view.totals.views} hint={`posts des ${DAYS} derniers jours`} i={1} />
                <Tile label="Interactions" value={view.totals.interactions} hint="j'aime, commentaires, partages, enregistrements" i={2} />
                <Tile label="Posts" value={view.totals.posts} hint={`publiés en ${DAYS} jours`} i={3} />
              </section>

              <section className="rise" style={{ animationDelay: "120ms" }}>
                <h2 className="mb-2 text-[13px] font-semibold">Par compte</h2>
                <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
                  <table className="w-full min-w-[340px] text-[13px]">
                    <thead>
                      <tr className="text-[11.5px] text-ink-3">
                        <th className="px-4 py-2 text-left font-medium">Compte</th>
                        <th className="px-3 py-2 text-right font-medium">Abonnés</th>
                        <th className="w-24 px-3 py-2 text-right font-medium max-sm:hidden">Évolution</th>
                        <th className="px-3 py-2 text-right font-medium max-sm:hidden">Posts</th>
                        <th className="px-3 py-2 text-right font-medium">Vues</th>
                        <th className="py-2 pr-4 pl-3 text-right font-medium max-sm:hidden">Interactions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.rows.map((r) => (
                        <tr
                          key={r.account.id}
                          onClick={() => setOnly(only === r.account.id ? null : r.account.id)}
                          className={cn("cursor-pointer border-t border-line transition-colors duration-150 hover:bg-surface-2/70", only === r.account.id && "bg-accent-soft/60")}
                        >
                          <td className="px-4 py-2.5">
                            {/* The button makes the filter reachable from the keyboard. Its click bubbles to the row. */}
                            <button
                              type="button"
                              aria-pressed={only === r.account.id}
                              title={only === r.account.id ? "Voir les posts de tous les comptes" : `Voir les posts de @${r.account.handle}`}
                              className="flex w-full items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                            >
                              <Avatar account={r.account} size={30} />
                              <span className="block min-w-0 max-sm:max-w-[110px]">
                                <span className="block truncate font-medium">{r.account.name}</span>
                                <span className="block truncate text-[11.5px] text-ink-3">{accountNote(r.account, r.stat?.error, r.stat?.reach)}</span>
                              </span>
                            </button>
                          </td>
                          <td className="tabular px-3 py-2.5 text-right font-semibold">{show(r.followers)}</td>
                          <td className="px-3 py-2.5 max-sm:hidden">
                            <div className="flex items-center justify-end gap-2">
                              <Sparkline values={r.history} />
                              <Delta value={r.delta} />
                            </div>
                          </td>
                          <td className="tabular px-3 py-2.5 text-right max-sm:hidden">{r.stat && !r.stat.error ? r.posts : "–"}</td>
                          <td className="tabular px-3 py-2.5 text-right">{show(r.views)}</td>
                          <td className="tabular py-2.5 pr-4 pl-3 text-right max-sm:hidden">{show(r.interactions)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[12px] text-ink-3">
                  Posts, vues et interactions comptent les publications des {DAYS} derniers jours, jusqu&apos;à 25 par compte (10 sur X). L&apos;évolution des abonnés se remplit jour après jour.
                </p>
              </section>

              <section className="rise" style={{ animationDelay: "180ms" }}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-[13px] font-semibold">Posts</h2>
                  {onlyAccount && (
                    <button onClick={() => setOnly(null)} className="press rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
                      @{onlyAccount.handle} ×
                    </button>
                  )}
                  <div className="ml-auto flex rounded-lg border border-line bg-surface-2/60 p-0.5">
                    {SORTS.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setSort(s.key)}
                        className={cn(
                          "press h-6 rounded-md px-2.5 text-[12px] transition-colors duration-150",
                          sort === s.key ? "bg-surface font-medium text-ink shadow-card" : "text-ink-3 hover:text-ink",
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  {list.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-ink-3">Aucun post trouvé sur {onlyAccount ? "ce compte" : "ces comptes"}.</p>}
                  {list.map((p, i) => (
                    <PostRow key={`${p.accountId}-${p.externalId}`} post={p} account={accounts.find((a) => a.id === p.accountId)} first={i === 0} viaMetricove={publishedIds.has(p.externalId)} />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Ids of the posts Metricove published itself, as the networks name them. */
function usePublishedIds() {
  const posts = useStore((s) => s.posts);
  return useMemo(() => new Set(posts.flatMap((p) => Object.values(p.results ?? {}).flatMap((r) => (r.externalId ? [r.externalId] : [])))), [posts]);
}

function accountNote(a: Account, error?: string, reach?: number) {
  if (error) return error;
  if (a.network === "linkedin") return `@${a.handle} · LinkedIn ne donne pas ses chiffres`;
  return `@${a.handle}${reach !== undefined ? ` · ${compact(reach)} personnes touchées` : ""}`;
}

function Notice({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="rise flex flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="text-[14px] font-medium">{title}</p>
      <p className="max-w-sm text-[13px] text-ink-3">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function Tile({ label, value, hint, delta, i }: { label: string; value?: number; hint: string; delta?: number; i: number }) {
  return (
    <div className="rise rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card" style={{ animationDelay: `${i * 40}ms` }}>
      <div className="flex items-center justify-between text-[12px] font-medium text-ink-3">
        {label}
        <Delta value={delta} />
      </div>
      <div className="tabular mt-1 font-display text-[30px] leading-none">{show(value)}</div>
      <div className="mt-1.5 truncate text-[11.5px] text-ink-3">{hint}</div>
    </div>
  );
}

function Delta({ value }: { value?: number }) {
  if (value === undefined || value === 0) return null;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("tabular inline-flex items-center text-[11.5px] font-medium", value > 0 ? "text-ok" : "text-danger")}>
      <Icon className="size-3.5" />
      {compact(Math.abs(value))}
    </span>
  );
}

/** Follower count over the last days. Needs two days of history to draw anything. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-[11.5px] text-ink-3">–</span>;
  const w = 56;
  const h = 18;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-accent" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PostRow({ post: p, account, first, viaMetricove }: { post: PostStat; account?: Account; first: boolean; viaMetricove: boolean }) {
  const [broken, setBroken] = useState(false);
  const hue = account?.hue ?? 20;
  return (
    <div className={cn("flex items-center gap-3.5 px-4 py-2.5 max-sm:gap-2.5", !first && "border-t border-line")}>
      <div
        className="relative size-11 shrink-0 overflow-hidden rounded-lg"
        style={{ background: `linear-gradient(140deg, oklch(0.78 0.1 ${hue}), oklch(0.55 0.13 ${hue + 40}))` }}
      >
        {p.thumb && !broken && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{p.caption?.split("\n")[0] || <span className="text-ink-3">Sans légende</span>}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
          {account && <Avatar account={account} size={14} badge={false} />}
          <span className="truncate">
            {NETWORKS[p.network].label}
            {account && ` · @${account.handle}`}
            {p.publishedAt && ` · ${fmt(p.publishedAt, "d MMM")}`}
          </span>
          {viaMetricove && <span className="shrink-0 rounded bg-accent-soft px-1.5 py-px text-[10.5px] font-medium text-accent">Metricove</span>}
        </div>
      </div>
      <Metric Icon={Eye} value={p.views} label="vues" strong />
      <Metric Icon={Heart} value={p.likes} label="j'aime" className="max-sm:hidden" />
      <Metric Icon={MessageCircle} value={p.comments} label="commentaires" className="max-sm:hidden" />
      <Metric Icon={Share2} value={p.shares} label="partages" className="max-md:hidden" />
      {p.url ? (
        <a href={p.url} target="_blank" rel="noreferrer" aria-label="Ouvrir le post" className="press grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">
          <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <span className="size-7 shrink-0" />
      )}
    </div>
  );
}

function Metric({ Icon, value, label, strong, className }: { Icon: typeof Eye; value?: number; label: string; strong?: boolean; className?: string }) {
  return (
    <span title={label} className={cn("tabular inline-flex w-16 shrink-0 items-center justify-end gap-1 text-[12.5px]", strong ? "font-semibold" : "text-ink-2", value === undefined && "text-ink-3", className)}>
      <Icon className="size-3.5 text-ink-3" />
      {show(value)}
    </span>
  );
}
