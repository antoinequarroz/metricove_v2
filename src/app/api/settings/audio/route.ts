import { NextResponse } from "next/server";
import { audioOverview, checkKey, setAudioKey, setAudioPrefs } from "@/server/audio-ai";

export const dynamic = "force-dynamic";

/** Réglages → Voix et musique: which keys are set (never the keys), the providers, the voice, the Claude model. */
export function GET() {
  return NextResponse.json(audioOverview());
}

/**
 * `{ provider: "elevenlabs" | "google", key }` sets or removes (empty) a key, checked with the provider first.
 * Otherwise the choices: `voiceProvider`, `voiceId` + `voiceName`, `musicProvider`, `claudeModel`.
 */
export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.provider !== undefined) {
    if (b.provider !== "elevenlabs" && b.provider !== "google") return NextResponse.json({ error: "Fournisseur inconnu" }, { status: 400 });
    if (typeof b.key !== "string" || b.key.length > 300 || /\s/.test(b.key.trim())) return NextResponse.json({ error: "Clé invalide" }, { status: 400 });
    const key = b.key.trim();
    if (key && (await checkKey(b.provider, key)) === false) return NextResponse.json({ error: b.provider === "elevenlabs" ? "ElevenLabs refuse cette clé" : "Google refuse cette clé" }, { status: 400 });
    setAudioKey(b.provider, key);
    return NextResponse.json(audioOverview());
  }
  const r = setAudioPrefs(b);
  if (typeof r === "string") return NextResponse.json({ error: r }, { status: 400 });
  return NextResponse.json(audioOverview());
}
