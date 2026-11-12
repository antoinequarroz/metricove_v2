import { NextResponse } from "next/server";
import { getPublisher } from "@/server/publishers";
import { tregTokens } from "@/server/publishers/treg";
import { passwordSource } from "@/server/password";
import { pexelsFromEnv, pexelsKey } from "@/server/broll";

export const dynamic = "force-dynamic";

/** What the Réglages page shows. Never returns a secret, only whether it is set. */
export function GET() {
  const p = getPublisher();
  return NextResponse.json({
    password: passwordSource(),
    publisher: { name: p.name, label: p.label, ...p.status() },
    teams: p.name === "treg" ? [...tregTokens().keys()] : [],
    apiToken: !!process.env.API_TOKEN,
    pexels: !!pexelsKey(),
    pexelsFromEnv: pexelsFromEnv(),
    publicUrl: process.env.PUBLIC_URL ?? null,
  });
}
