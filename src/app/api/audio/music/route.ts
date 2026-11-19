import { NextResponse } from "next/server";
import { MUSIC_PROMPT_MAX, MUSIC_PROVIDERS, type MusicProvider } from "@/lib/audio-ai";
import { AudioError, audioPrefs, compose } from "@/server/audio-ai";
import { addAsset } from "@/server/library";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Composes a music and keeps it in Ressources → Musique. `{ prompt, seconds, provider?, name?, tags?, styles? }`.
 * Answers `{ item }` (the library item: the Mac downloads it by `/api/library/<id>/file`). Used by the Mac for the
 * music made for one video, and by Ressources → Musique.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (!prompt || prompt.length > MUSIC_PROMPT_MAX) return NextResponse.json({ error: `Décris la musique (${MUSIC_PROMPT_MAX} caractères au plus)` }, { status: 400 });
  const provider = (MUSIC_PROVIDERS.find((m) => m.id === b.provider)?.id ?? audioPrefs().musicProvider) as MusicProvider;
  const seconds = Number(b.seconds) || 30;
  try {
    const a = await compose(provider, prompt, seconds);
    const name = typeof b.name === "string" && b.name.trim() ? b.name : prompt.slice(0, 60);
    const tags = Array.isArray(b.tags) ? b.tags : [];
    const item = addAsset("music", a.bytes, { name, tags, styles: Array.isArray(b.styles) ? b.styles : [], source: provider });
    if (typeof item === "string") return NextResponse.json({ error: item }, { status: 400 });
    return NextResponse.json({ item, provider }, { status: 201 });
  } catch (e) {
    const err = e instanceof AudioError ? e : new AudioError(`Musique non générée (${(e as Error).message})`.slice(0, 300), 502);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
