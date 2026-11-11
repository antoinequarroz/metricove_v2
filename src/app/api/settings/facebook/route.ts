import { NextResponse } from "next/server";
import { setSetting } from "@/server/db";
import { getPublisher } from "@/server/publishers";
import { facebookOverview, facebookSettingKey, tregTokens } from "@/server/publishers/treg";

export const dynamic = "force-dynamic";

/** Each treg team's Facebook connections, and the one Metricove uses. */
export async function GET() {
  if (getPublisher().name !== "treg") return NextResponse.json({ teams: [] });
  return NextResponse.json({ teams: await facebookOverview() });
}

/** Sets a team's Facebook connection: "auto", or a connection id. */
export async function PUT(req: Request) {
  const { team, choice } = (await req.json().catch(() => ({}))) as { team?: unknown; choice?: unknown };
  if (typeof team !== "string" || !tregTokens().has(team)) return NextResponse.json({ error: "Équipe treg inconnue" }, { status: 400 });
  if (typeof choice !== "string" || !/^(auto|[\w-]{1,64})$/.test(choice)) return NextResponse.json({ error: "Choix invalide" }, { status: 400 });
  setSetting(facebookSettingKey(team), choice === "auto" ? null : choice);
  return NextResponse.json({ teams: await facebookOverview() });
}
