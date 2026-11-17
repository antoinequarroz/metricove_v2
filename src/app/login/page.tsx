"use client";

import { useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) {
      window.location.href = "/calendar";
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Connexion impossible");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="rise w-full max-w-[360px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl">
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
      </form>
    </div>
  );
}
