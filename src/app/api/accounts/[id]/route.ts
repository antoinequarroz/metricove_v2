import { NextResponse } from "next/server";
import { deleteAccount, listAccounts, listPosts } from "@/server/db";

/** Removes an account added by hand. Postiz accounts are managed in Postiz. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = listAccounts().find((a) => a.id === id);
  if (!account) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  if (account.externalId) return NextResponse.json({ error: "Ce compte vient de Postiz : retirez-le dans Postiz" }, { status: 409 });
  const used = listPosts().filter((p) => p.accountIds.includes(id)).length;
  if (used) return NextResponse.json({ error: `Ce compte est utilisé par ${used} post${used > 1 ? "s" : ""}` }, { status: 409 });
  deleteAccount(id);
  return NextResponse.json({ ok: true });
}
