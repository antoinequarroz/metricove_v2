import { NextResponse } from "next/server";
import { listAccounts, upsertAccount } from "@/server/db";
import { getPublisher } from "@/server/publishers";

/** Imports the accounts connected in Postiz or treg. */
export async function POST() {
  const p = getPublisher();
  if (!p.syncAccounts) return NextResponse.json({ error: "Le mode démo n'a pas de comptes à synchroniser" }, { status: 400 });
  try {
    const remote = await p.syncAccounts();
    const ids = new Set(remote.map((a) => a.id));
    remote.forEach(upsertAccount);
    // Accounts no longer found stay for history, marked as disconnected.
    const prefix = `${p.name}-`;
    listAccounts()
      .filter((a) => a.id.startsWith(prefix) && !ids.has(a.id))
      .forEach((a) => upsertAccount({ ...a, connected: false }));
    return NextResponse.json({ count: remote.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
