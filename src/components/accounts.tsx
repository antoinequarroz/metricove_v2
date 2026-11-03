"use client";

import { ExternalLink, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NETWORK_ORDER, NETWORKS, NetworkBadge } from "@/lib/networks";
import { useStore } from "@/lib/store";
import { compact } from "@/lib/utils";
import { Avatar, Button } from "./ui";

export function AccountsPage() {
  const accounts = useStore((s) => s.accounts);
  const posts = useStore((s) => s.posts);
  const publisher = useStore((s) => s.publisher);
  const syncAccounts = useStore((s) => s.syncAccounts);
  const [syncing, setSyncing] = useState(false);
  const isPostiz = publisher.name === "postiz";

  const soon = () =>
    isPostiz
      ? toast("Ajoutez le compte dans Postiz", { description: "Puis cliquez sur « Synchroniser » pour le voir ici." })
      : toast("Mode démo", { description: "Configurez Postiz (PUBLISHER=postiz) pour connecter vos vrais comptes." });

  const sync = async () => {
    setSyncing(true);
    try {
      const n = await syncAccounts();
      toast.success("Comptes synchronisés", { description: `${n} compte${n > 1 ? "s" : ""} trouvé${n > 1 ? "s" : ""} dans Postiz.` });
    } catch (e) {
      toast.error("Synchronisation impossible", { description: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <header className="flex flex-wrap items-end gap-4 border-b border-line px-6 pt-5 pb-4 max-md:px-4">
        <div>
          <p className="text-[12px] font-medium text-ink-3">Réseaux sociaux</p>
          <h1 className="font-display text-[34px] leading-[1.05]">Comptes</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isPostiz && (
            <Button onClick={sync} disabled={syncing || !publisher.ready}>
              <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
              Synchroniser
            </Button>
          )}
          <Button variant="primary" onClick={soon}>
            <Plus className="size-4" />
            Connecter un compte
          </Button>
        </div>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-[13px]">
            <span className={`size-2 shrink-0 rounded-full ${publisher.ready && isPostiz ? "bg-ok" : "bg-warn"}`} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{isPostiz ? `Publication via Postiz${publisher.ready ? ` · ${publisher.detail}` : ""}` : "Mode démo : aucune publication réelle"}</p>
              <p className="text-ink-3">
                {isPostiz
                  ? publisher.ready
                    ? "Les comptes se connectent dans Postiz, puis se synchronisent ici."
                    : publisher.detail
                  : "Les posts programmés passent en « Publié » à l'heure prévue, sans rien envoyer aux réseaux."}
              </p>
            </div>
            {isPostiz && publisher.ready && publisher.detail && (
              <a href={`https://${publisher.detail}`} target="_blank" rel="noreferrer" className="press inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
                Ouvrir Postiz <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
          {NETWORK_ORDER.map((n, gi) => {
            const list = accounts.filter((a) => a.network === n);
            return (
              <section key={n} className="rise" style={{ animationDelay: `${gi * 50}ms` }}>
                <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                  <NetworkBadge network={n} />
                  {NETWORKS[n].label}
                  <span className="font-normal text-ink-3">{list.length}</span>
                </h2>
                <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  {list.length === 0 && (
                    <button onClick={soon} className="flex w-full items-center gap-2 px-4 py-4 text-[13px] text-ink-3 hover:bg-surface-2">
                      <Plus className="size-4" /> Ajouter un compte {NETWORKS[n].label}
                    </button>
                  )}
                  {list.map((a, i) => {
                    const count = posts.filter((p) => p.accountIds.includes(a.id) && p.status === "scheduled").length;
                    return (
                      <div key={a.id} className={`flex items-center gap-3.5 px-4 py-3 ${i ? "border-t border-line" : ""}`}>
                        <Avatar account={a} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-medium">{a.name}</div>
                          <div className="text-[12px] text-ink-3">@{a.handle}</div>
                        </div>
                        <div className="hidden w-28 text-right sm:block">
                          <div className="tabular text-[13.5px] font-semibold">{compact(a.followers)}</div>
                          <div className="text-[11.5px] text-ink-3">abonnés</div>
                        </div>
                        <div className="hidden w-28 text-right sm:block">
                          <div className="tabular text-[13.5px] font-semibold">{count}</div>
                          <div className="text-[11.5px] text-ink-3">programmés</div>
                        </div>
                        <div className="w-32 text-right">
                          {a.connected ? (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-ok">
                              <span className="size-1.5 rounded-full bg-ok" /> Connecté
                            </span>
                          ) : (
                            <Button size="sm" onClick={soon}>
                              <RefreshCw className="size-3.5" />
                              Reconnecter
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
