import "server-only";
import { NETWORKS } from "@/lib/networks";
import type { Network } from "@/lib/types";

// Hermes Agent API server (OpenAI-compatible), running on the VPS.
// HERMES_URL e.g. http://host.docker.internal:8642, HERMES_API_KEY = API_SERVER_KEY in ~/.hermes/.env
const base = () => (process.env.HERMES_URL ?? "").replace(/\/+$/, "");

export const hermesReady = () => !!base() && !!process.env.HERMES_API_KEY;

export type CaptionRequest = {
  networks: Network[];
  draft?: string;
  videoTitle?: string;
  videoDuration?: number;
  youtube?: boolean;
};

export type CaptionResult = { caption: string; youtubeTitle?: string };

export async function suggestCaption(req: CaptionRequest): Promise<CaptionResult> {
  const limit = Math.min(...req.networks.map((n) => NETWORKS[n].limit));
  const prompt = [
    "Écris la légende d'un post pour les réseaux sociaux d'Antoine Quarroz.",
    `Réseaux : ${req.networks.map((n) => NETWORKS[n].label).join(", ")}.`,
    `Longueur maximale : ${limit} caractères (limite du réseau le plus court).`,
    req.videoTitle ? `Vidéo : « ${req.videoTitle} »${req.videoDuration ? `, ${req.videoDuration} secondes` : ""}.` : "Pas de vidéo.",
    req.draft?.trim() ? `Brouillon actuel à améliorer :\n${req.draft.trim()}` : "Il n'y a pas encore de brouillon.",
    "Ton : naturel, en français, une accroche forte en première ligne, 2 à 4 hashtags pertinents à la fin.",
    "Si c'est utile, tu peux utiliser treg pour vérifier les tendances ou les hashtags du moment.",
    req.youtube ? 'Propose aussi un titre YouTube de 70 caractères maximum.' : "",
    'Réponds uniquement avec du JSON : {"caption": "...", "youtubeTitle": "..."}',
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`${base()}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HERMES_API_KEY}`, "Content-Type": "application/json", "X-Hermes-Session-Key": "metricove-captions" },
    body: JSON.stringify({ model: process.env.HERMES_MODEL || "hermes-agent", stream: false, messages: [{ role: "user", content: prompt }] }),
    // The agent may use tools (treg...), so give it time.
    signal: AbortSignal.timeout(150_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Hermes ${res.status} : ${text.slice(0, 200)}`);
  const content: string = JSON.parse(text)?.choices?.[0]?.message?.content ?? "";
  return parseCaption(content, limit);
}

/** Accepts clean JSON, JSON inside a code block, or plain text. */
export function parseCaption(content: string, limit: number): CaptionResult {
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const data = JSON.parse(match[0]);
      if (typeof data.caption === "string" && data.caption.trim())
        return { caption: data.caption.trim().slice(0, limit), youtubeTitle: typeof data.youtubeTitle === "string" ? data.youtubeTitle.trim().slice(0, 100) : undefined };
    } catch {}
  }
  const plain = content.replace(/```[a-z]*|```/g, "").trim();
  if (!plain) throw new Error("Hermes n'a rien répondu");
  return { caption: plain.slice(0, limit) };
}
