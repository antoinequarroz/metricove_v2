import { NextResponse } from "next/server";
import { NETWORK_ORDER } from "@/lib/networks";
import type { Account, Network } from "@/lib/types";
import { listAccounts, upsertAccount } from "@/server/db";

/**
 * Adds an account by hand, to plan posts before Postiz is connected.
 * These accounts are not linked to Postiz: they can't publish until it is.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { network?: Network; name?: string; handle?: string };
  const network = body.network;
  const handle = (body.handle ?? "").trim().replace(/^@/, "");
  const name = (body.name ?? "").trim() || handle;
  if (!network || !NETWORK_ORDER.includes(network)) return NextResponse.json({ error: "Réseau inconnu" }, { status: 400 });
  if (!handle) return NextResponse.json({ error: "Le nom d'utilisateur est obligatoire" }, { status: 400 });
  if (listAccounts().some((a) => a.network === network && a.handle.toLowerCase() === handle.toLowerCase()))
    return NextResponse.json({ error: "Ce compte existe déjà" }, { status: 409 });

  const account: Account = {
    id: `manual-${crypto.randomUUID().slice(0, 8)}`,
    network,
    name: name.slice(0, 80),
    handle: handle.slice(0, 60),
    hue: Math.floor(Math.random() * 360),
    followers: 0,
    connected: true,
  };
  upsertAccount(account);
  return NextResponse.json({ account });
}
