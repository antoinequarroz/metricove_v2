"use client";

import { Check, KeyRound, LogOut, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NetworkBadge } from "@/lib/networks";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

type Overview = {
  password: { source: "app" | "env" | "none"; changedAt?: string };
  publisher: { name: string; label: string; ready: boolean; detail?: string };
  teams: string[];
  apiToken: boolean;
  publicUrl: string | null;
};

type FacebookTeam = {
  team: string;
  choice: string;
  used?: string;
  byName: boolean;
  connections: { id: string; name?: string; kind: "page" | "instagram"; method?: string; page?: string; usable: boolean }[];
  error?: string;
};

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body as T;
}

const dateFr = (iso: string) => new Date(iso).toLocaleString("fr-CH", { dateStyle: "long", timeStyle: "short" });

export function SettingsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);

  const load = () =>
    fetch("/api/settings")
      .then((r) => json<Overview>(r))
      .then(setOverview)
      .catch((e: Error) => toast.error("Réglages illisibles", { description: e.message }));

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <header className="flex flex-wrap items-end gap-4 border-b border-line px-6 pt-5 pb-4 max-md:px-4">
        <div>
          <p className="text-[12px] font-medium text-ink-3">Metricove</p>
          <h1 className="font-display text-[34px] leading-[1.05]">Réglages</h1>
        </div>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <PasswordSection overview={overview} onChanged={load} />
          {overview?.publisher.name === "treg" && <FacebookSection />}
          <InfoSection overview={overview} />
        </div>
      </div>
    </>
  );
}

function Section({ title, hint, children, delay = 0 }: { title: string; hint?: React.ReactNode; children: React.ReactNode; delay?: number }) {
  return (
    <section className="rise" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface shadow-card">{children}</div>
    </section>
  );
}

const inputClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

function PasswordSection({ overview, onChanged }: { overview: Overview | null; onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const source = overview?.password.source;
  const needsCurrent = source !== "none";
  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 10;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    try {
      await json(await fetch("/api/settings/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }) }));
      toast.success("Mot de passe changé", { description: "Cet appareil reste connecté. Les autres devront se reconnecter." });
      setCurrent("");
      setNext("");
      setConfirm("");
      onChanged();
    } catch (err) {
      toast.error("Mot de passe inchangé", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <Section
      title="Mot de passe"
      hint={
        source === "app" && overview?.password.changedAt
          ? `Changé dans Metricove le ${dateFr(overview.password.changedAt)}.`
          : source === "env"
            ? "Celui du fichier .env du serveur (APP_PASSWORD). Une fois changé ici, c'est le nouveau qui compte."
            : source === "none"
              ? "Aucun mot de passe : tout le monde peut ouvrir Metricove. Choisissez-en un."
              : undefined
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        {needsCurrent && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Mot de passe actuel</span>
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
          </label>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Nouveau mot de passe</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Confirmer</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          </label>
        </div>
        <p className={cn("text-[12.5px]", mismatch || tooShort ? "text-danger" : "text-ink-3")}>
          {mismatch ? "Les deux mots de passe ne sont pas pareils." : tooShort ? "Au moins 10 caractères." : "Au moins 10 caractères. Les autres appareils seront déconnectés."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || !next || mismatch || tooShort || next !== confirm || (needsCurrent && !current)}>
            <KeyRound className="size-4" />
            {busy ? "Changement…" : "Changer le mot de passe"}
          </Button>
          {source !== "none" && (
            <Button type="button" variant="ghost" onClick={logout} className="ml-auto">
              <LogOut className="size-4" />
              Se déconnecter
            </Button>
          )}
        </div>
      </form>
    </Section>
  );
}

function FacebookSection() {
  const [teams, setTeams] = useState<FacebookTeam[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setTeams((await json<{ teams: FacebookTeam[] }>(await fetch("/api/settings/facebook"))).teams);
    } catch (e) {
      toast.error("Connexions Facebook illisibles", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const choose = async (team: string, choice: string) => {
    setSaving(team);
    try {
      const body = await json<{ teams: FacebookTeam[] }>(
        await fetch("/api/settings/facebook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team, choice }) }),
      );
      setTeams(body.teams);
      toast.success("Connexion Facebook enregistrée", { description: "Cliquez sur « Synchroniser » dans Comptes pour mettre la Page à jour." });
    } catch (e) {
      toast.error("Choix non enregistré", { description: (e as Error).message });
    } finally {
      setSaving(null);
    }
  };

  const withFacebook = teams?.filter((t) => t.connections.length || t.error) ?? [];

  return (
    <Section
      delay={50}
      title="Connexion Facebook"
      hint="Quand une équipe treg a plusieurs connexions Facebook, Metricove prend seul la bonne : une Page choisie, la plus récente d'abord. Vous pouvez en imposer une."
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-[12.5px] text-ink-3">{teams ? `${withFacebook.length} équipe${withFacebook.length > 1 ? "s" : ""} avec Facebook` : "Lecture des connexions treg…"}</span>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Relire
        </Button>
      </div>
      {teams && !withFacebook.length && <p className="px-4 py-4 text-[13px] text-ink-3">Aucune équipe treg n&apos;a de connexion Facebook.</p>}
      {withFacebook.map((t, i) => (
        <div key={t.team} className={cn("px-4 py-3.5", i && "border-t border-line")}>
          <div className="flex items-center gap-2">
            <NetworkBadge network="facebook" />
            <span className="text-[13.5px] font-medium">Équipe {t.team}</span>
            {t.byName && (
              <span className="rounded bg-surface-2 px-1.5 py-px text-[11px] text-ink-3" title="treg voit deux connexions sur Facebook : Metricove appelle la Page par le nom de son outil, sans erreur.">
                appel par nom d&apos;outil
              </span>
            )}
          </div>
          {t.error ? (
            <p className="mt-2 text-[12.5px] text-danger">{t.error}</p>
          ) : (
            <div className="mt-2.5 flex flex-col gap-1" role="radiogroup" aria-label={`Connexion Facebook de l'équipe ${t.team}`}>
              <Choice
                label="Automatique"
                detail={t.used ? `utilise la connexion n° ${t.used}` : "aucune connexion avec une Page"}
                selected={t.choice === "auto"}
                disabled={saving === t.team}
                onSelect={() => choose(t.team, "auto")}
              />
              {t.connections.map((c) =>
                c.usable ? (
                  <Choice
                    key={c.id}
                    label={`${c.name || "Page Facebook"} · n° ${c.id}`}
                    detail={`Page ${c.page}${t.used === c.id ? " · utilisée" : ""}`}
                    selected={t.choice === c.id}
                    disabled={saving === t.team}
                    onSelect={() => choose(t.team, c.id)}
                  />
                ) : (
                  <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-ink-3">
                    <span className="size-4 shrink-0" />
                    <span className="min-w-0 truncate">
                      {c.kind === "instagram" ? "Instagram via la Page" : c.name || "Connexion Facebook"} · n° {c.id}
                      <span className="ml-1.5">{c.kind === "instagram" ? "(sert à Instagram, pas choisissable)" : "(aucune Page choisie : vide, à supprimer dans treg)"}</span>
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}

function Choice({ label, detail, selected, disabled, onSelect }: { label: string; detail: string; selected: boolean; disabled?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 disabled:opacity-60",
        selected ? "bg-accent-soft" : "hover:bg-ink/[0.04]",
      )}
    >
      <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-150", selected ? "border-accent bg-accent text-white" : "border-line-strong")}>
        {selected && <Check className="size-2.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{label}</span>
        <span className="block truncate text-[12px] text-ink-3">{detail}</span>
      </span>
    </button>
  );
}

function InfoSection({ overview }: { overview: Overview | null }) {
  if (!overview) return null;
  const rows: [string, React.ReactNode, boolean][] = [
    ["Publication", overview.publisher.name === "demo" ? "Mode démo" : `${overview.publisher.label}${overview.publisher.detail ? ` · ${overview.publisher.detail}` : ""}`, overview.publisher.ready && overview.publisher.name !== "demo"],
    ["Équipes treg", overview.teams.length ? overview.teams.join(", ") : "Aucune", overview.teams.length > 0],
    ["Adresse publique", overview.publicUrl ?? "Non définie (PUBLIC_URL)", !!overview.publicUrl],
    ["Jeton pour les scripts", overview.apiToken ? "Défini (Hermes, Claude Code, Mac)" : "Non défini (API_TOKEN)", overview.apiToken],
  ];
  return (
    <Section
      delay={100}
      title="Serveur"
      hint={
        <>
          Lu dans le fichier .env du serveur. Les comptes se gèrent dans <Link href="/accounts" className="font-medium text-accent">Comptes</Link>.
        </>
      }
    >
      {rows.map(([label, value, ok], i) => (
        <div key={label} className={cn("flex items-center gap-3 px-4 py-2.5 text-[13px]", i && "border-t border-line")}>
          <span className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-ok" : "bg-warn")} />
          <span className="w-44 shrink-0 font-medium max-sm:w-32">{label}</span>
          <span className="min-w-0 truncate text-ink-3">{value}</span>
        </div>
      ))}
    </Section>
  );
}
