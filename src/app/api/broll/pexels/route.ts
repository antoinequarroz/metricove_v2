import { NextResponse } from "next/server";
import { PexelsError, searchPexels } from "@/server/broll";

export const dynamic = "force-dynamic";

/** B-roll picker: Pexels videos for a search, in the orientation of the edit. ?q=&format=9:16&page=1 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return NextResponse.json({ error: "Écris ce que tu cherches" }, { status: 400 });
  const page = Math.min(20, Math.max(1, Number(u.searchParams.get("page")) || 1));
  try {
    return NextResponse.json(await searchPexels(q, u.searchParams.get("format") ?? "9:16", page));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof PexelsError ? e.status : 500 });
  }
}
