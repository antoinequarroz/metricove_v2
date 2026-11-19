import { NextResponse } from "next/server";
import { TTS_MAX, VOICE_PROVIDERS, type VoiceProvider } from "@/lib/audio-ai";
import { AudioError, audioPrefs, speak } from "@/server/audio-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Reads a line aloud and sends the sound back (MP3 or WAV). `{ text, provider?, voiceId?, style? }`: what is left out
 * comes from Réglages. Used by the Mac for the voice-over of the reels, and by Réglages to listen to a voice.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > TTS_MAX) return NextResponse.json({ error: `Texte vide ou trop long (${TTS_MAX} caractères au plus)` }, { status: 400 });
  const prefs = audioPrefs();
  const provider = (VOICE_PROVIDERS.find((v) => v.id === b.provider)?.id ?? prefs.voiceProvider) as VoiceProvider;
  const voiceId = typeof b.voiceId === "string" && b.voiceId ? b.voiceId : provider === prefs.voiceProvider ? prefs.voiceId : undefined;
  try {
    const a = await speak(provider, voiceId, text, { style: typeof b.style === "string" ? b.style : undefined });
    return new NextResponse(new Uint8Array(a.bytes), { headers: { "Content-Type": a.type, "Cache-Control": "no-store", "X-Audio-Ext": a.ext } });
  } catch (e) {
    const err = e instanceof AudioError ? e : new AudioError(`Voix non générée (${(e as Error).message})`.slice(0, 300), 502);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
