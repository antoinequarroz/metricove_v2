import { NextResponse } from "next/server";
import { AudioError, listVoices } from "@/server/audio-ai";

export const dynamic = "force-dynamic";

/** `?provider=elevenlabs|google`: the voices to choose from. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("provider");
  if (p !== "elevenlabs" && p !== "google") return NextResponse.json({ error: "Fournisseur inconnu" }, { status: 400 });
  try {
    return NextResponse.json({ voices: await listVoices(p) });
  } catch (e) {
    const err = e instanceof AudioError ? e : new AudioError("Voix illisibles", 502);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
