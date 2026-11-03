import { NextResponse } from "next/server";
import { NETWORK_ORDER } from "@/lib/networks";
import type { Network } from "@/lib/types";
import { listMedia } from "@/server/db";
import { hermesReady, suggestCaption } from "@/server/hermes";

/** Asks Hermes for a caption (and a YouTube title) for the post being written. */
export async function POST(req: Request) {
  if (!hermesReady()) return NextResponse.json({ error: "Hermes n'est pas configuré (HERMES_URL et HERMES_API_KEY)" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { networks?: string[]; draft?: string; mediaId?: string };
  const networks = (body.networks ?? []).filter((n): n is Network => NETWORK_ORDER.includes(n as Network));
  if (!networks.length) return NextResponse.json({ error: "Choisissez au moins un compte" }, { status: 400 });
  const media = body.mediaId ? listMedia().find((m) => m.id === body.mediaId) : undefined;
  try {
    const result = await suggestCaption({
      networks,
      draft: String(body.draft ?? "").slice(0, 5000),
      videoTitle: media?.title,
      videoDuration: media?.duration,
      youtube: networks.includes("youtube"),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
