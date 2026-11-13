import { NextResponse } from "next/server";
import { pexelsFromEnv, pexelsKey, setPexelsKey } from "@/server/broll";

export const dynamic = "force-dynamic";

/** Sets the Pexels key used to search B-roll (empty = remove). The key is never sent back. */
export async function PUT(req: Request) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: unknown };
  if (typeof key !== "string" || key.length > 200 || /\s/.test(key.trim())) return NextResponse.json({ error: "Clé invalide" }, { status: 400 });
  const k = key.trim();
  if (k) {
    const r = await fetch("https://api.pexels.com/videos/search?query=book&per_page=1", { headers: { Authorization: k }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (r && (r.status === 401 || r.status === 403)) return NextResponse.json({ error: "Pexels refuse cette clé" }, { status: 400 });
  }
  setPexelsKey(k);
  return NextResponse.json({ pexels: !!pexelsKey(), pexelsFromEnv: pexelsFromEnv() });
}
