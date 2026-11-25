"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";

const card = "rise w-full max-w-[360px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl";
const link = "mt-4 w-full text-center text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline";

/** `compte`: the Compte Postmelo is plugged in (see src/server/compte.ts). It is the way in, the password stays as a spare key. `next`: where to go once signed in. */
export function LoginForm({ compte, next = "" }: { compte: boolean; next?: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [spare, setSpare] = useState(false);

  // Back from the Compte Postmelo without a way in: refused, unreachable, or the sign-in expired.
  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get("erreur");
    if (message) setError(message);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) {
      window.location.href = next || "/calendar";
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Connexion impossible");
      setBusy(false);
    }
  };

  if (compte && !spare)
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className={card}>
          <Logo className="size-9" />
          <h1 className="mt-5 font-display text-[30px] leading-none">Metricove</h1>
          <p className="mt-2 text-[13px] text-ink-3">Connectez-vous avec votre Compte Postmelo, le même pour tous vos outils.</p>
          {error && <p className="mt-4 text-[12.5px] text-danger">{error}</p>}
          <a href={next ? `/api/auth/compte/start?next=${encodeURIComponent(next)}` : "/api/auth/compte/start"} className="press mt-6 flex h-9 w-full select-none items-center justify-center rounded-lg bg-accent text-[13.5px] font-medium text-accent-ink shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_1px_2px_rgba(0,0,0,0.12),0_6px_16px_-6px_var(--accent)] outline-none hover:brightness-[1.06] focus-visible:ring-2 focus-visible:ring-accent/50">
            Continuer avec mon Compte Postmelo
          </a>
          <button type="button" onClick={() => (setSpare(true), setError(""))} className={link}>
            Utiliser le mot de passe de Metricove
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className={card}>
        <Logo className="size-9" />
        <h1 className="mt-5 font-display text-[30px] leading-none">Metricove</h1>
        <p className="mt-2 text-[13px] text-ink-3">Entrez votre mot de passe pour accéder au calendrier.</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe"
          className="mt-6 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
        {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="mt-4 w-full" disabled={busy || !password}>
          {busy ? "Connexion…" : "Se connecter"}
        </Button>
        {compte && (
          <button type="button" onClick={() => (setSpare(false), setError(""))} className={link}>
            Revenir au Compte Postmelo
          </button>
        )}
      </form>
    </div>
  );
}
