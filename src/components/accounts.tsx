"use client";

import { ExternalLink, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NETWORK_ORDER, NETWORKS, NetworkBadge } from "@/lib/networks";
import type { Account, Network } from "@/lib/types";
import { useStore } from "@/lib/store";
import { compact } from "@/lib/utils";
import { ProjectsSection } from "./projects";
import { Avatar, Button } from "./ui";

export function AccountsPage() {
  const accounts = useStore((s) => s.accounts);
  const posts = useStore((s) => s.posts);
  const publisher = useStore((s) => s.publisher);
  const syncAccounts = useStore((s) => s.syncAccounts);
  const removeAccount = useStore((s) => s.removeAccount);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState<Network | null>(null);
  const isPostiz = publisher.name !== "demo"; // a real publishing service: Postiz or treg
  const service = publisher.label;
  const serviceUrl = publisher.name === "treg" ? "https://treg.to" : publisher.detail ? `https://${publisher.detail}` : undefined;

  // With Postiz or treg, accounts are connected there. Before that, they can be added by hand to plan posts.
  const add = (network: Network = "instagram") =>
    isPostiz && publisher.ready
      ? toast(`Connectez le compte dans ${service}`, { description: "Puis cliquez sur « Synchroniser » pour le voir ici." })
      : setAdding(network);
  const reconnect = () => toast(`Reconnectez le compte dans ${service}`, { description: "Puis cliquez sur « Synchroniser »." });

  const remove = async (a: Account) => {
    try {
      await removeAccount(a.id);
      toast.success("Compte retiré", { description: `@${a.handle}` });
    } catch (e) {
      toast.error("Impossible de retirer le compte", { description: (e as Error).message });
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const { count: n, warnings } = await syncAccounts();
      toast.success("Comptes synchronisés", { description: `${n} compte${n > 1 ? "s" : ""} trouvé${n > 1 ? "s" : ""} dans ${service}.` });
      // Accounts connected in the service but not imported, with the reason (quota, expired…).
      for (const w of warnings) toast.warning("Compte non importé", { description: w, duration: 12_000 });
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
          <Button variant="primary" onClick={() => add()}>
            <Plus className="size-4" />
            {isPostiz && publisher.ready ? "Connecter un compte" : "Ajouter un compte"}
          </Button>
        </div>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-[13px]">
            <span className={`size-2 shrink-0 rounded-full ${publisher.ready && isPostiz ? "bg-ok" : "bg-warn"}`} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{isPostiz ? `Publication via ${service}${publisher.ready && publisher.detail ? ` · ${publisher.detail}` : ""}` : "Mode démo : aucune publication réelle"}</p>
              <p className="text-ink-3">
                {isPostiz
                  ? publisher.ready
                    ? `Les comptes se connectent dans ${service}, puis se synchronisent ici.`
                    : publisher.detail
                  : "Ajoutez vos comptes pour préparer le calendrier. Les posts passent en « Publié » à l'heure prévue, sans rien envoyer aux réseaux."}
              </p>
            </div>
            {isPostiz && publisher.ready && serviceUrl && (
              <a href={serviceUrl} target="_blank" rel="noreferrer" className="press inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
                Ouvrir {service} <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
          {adding && <AddAccountForm network={adding} onDone={() => setAdding(null)} />}
          {accounts.length > 0 && <ProjectsSection />}
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
                    <button onClick={() => add(n)} className="flex w-full items-center gap-2 px-4 py-4 text-[13px] text-ink-3 hover:bg-surface-2">
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
                          <div className="text-[12px] text-ink-3">
                            @{a.handle}
                            {a.providerKind?.startsWith("treg:") && <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-px text-[11px]">équipe {a.providerKind.slice(5)}</span>}
                          </div>
                        </div>
                        <div className="hidden w-28 text-right sm:block">
                          <div className="tabular text-[13.5px] font-semibold">{compact(a.followers)}</div>
                          <div className="text-[11.5px] text-ink-3">abonnés</div>
                        </div>
                        <div className="hidden w-28 text-right sm:block">
                          <div className="tabular text-[13.5px] font-semibold">{count}</div>
                          <div className="text-[11.5px] text-ink-3">programmés</div>
                        </div>
                        <div className="w-40 text-right">
                          {!a.externalId ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-[12px] text-ink-3">{isPostiz ? `Non relié à ${service}` : "Ajouté à la main"}</span>
                              <button
                                onClick={() => remove(a)}
                                title="Retirer ce compte"
                                aria-label={`Retirer @${a.handle}`}
                                className="press grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-danger"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </span>
                          ) : a.connected ? (
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-ok">
                              <span className="size-1.5 rounded-full bg-ok" /> Connecté
                            </span>
                          ) : (
                            <Button size="sm" onClick={reconnect}>
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

const field =
  "h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

function AddAccountForm({ network: initial, onDone }: { network: Network; onDone: () => void }) {
  const addAccount = useStore((s) => s.addAccount);
  const [network, setNetwork] = useState<Network>(initial);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const a = await addAccount({ network, handle, name });
      toast.success("Compte ajouté", { description: `${NETWORKS[a.network].label} · @${a.handle}` });
      onDone();
    } catch (err) {
      toast.error("Ajout impossible", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rise rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <NetworkBadge network={network} />
        <h2 className="text-[13.5px] font-semibold">Ajouter un compte</h2>
        <button type="button" onClick={onDone} aria-label="Fermer" className="press ml-auto grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex gap-2 max-sm:flex-col">
        <select value={network} onChange={(e) => setNetwork(e.target.value as Network)} className={`${field} sm:w-40`} aria-label="Réseau">
          {NETWORK_ORDER.map((n) => (
            <option key={n} value={n}>
              {NETWORKS[n].label}
            </option>
          ))}
        </select>
        <input autoFocus required value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@nom_utilisateur" className={`${field} min-w-0 flex-1`} aria-label="Nom d'utilisateur" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom affiché (facultatif)" className={`${field} min-w-0 flex-1`} aria-label="Nom affiché" />
        <Button type="submit" variant="primary" disabled={busy || !handle.trim()}>
          Ajouter
        </Button>
      </div>
      <p className="mt-2.5 text-[12px] text-ink-3">
        Ce compte sert à préparer le calendrier. Il publiera pour de vrai une fois treg branché et le compte connecté là-bas.
      </p>
    </form>
  );
}
