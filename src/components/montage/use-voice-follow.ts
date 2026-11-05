"use client";

import { useEffect, useRef, useState } from "react";

/* Minimal typing of the Web Speech API (Chrome, Edge, Safari). */
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: { length: number; [i: number]: SpeechResult } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

const norm = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

export const voiceFollowSupported = () =>
  typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

/**
 * Follows the speaker in the script: returns the line being read.
 * Each spoken word is looked for a few words ahead of where we are, so a skipped word or a "euh" does not lose the place.
 */
export function useVoiceFollow(lines: string[], on: boolean, start: number) {
  const [line, setLine] = useState(start);
  const [error, setError] = useState("");
  const words = useRef<{ w: string; line: number }[]>([]);
  const cursor = useRef(0);

  useEffect(() => {
    words.current = lines.flatMap((l, i) => l.split(/\s+/).map((w) => ({ w: norm(w), line: i }))).filter((x) => x.w);
  }, [lines]);

  // Restart from the chosen line.
  useEffect(() => {
    cursor.current = Math.max(0, words.current.findIndex((x) => x.line >= start));
    setLine(start);
  }, [start, on]);

  useEffect(() => {
    if (!on) return;
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Ce navigateur ne sait pas suivre la voix. Essaie Chrome ou Safari.");
      return;
    }
    setError("");
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    const used = new Map<number, number>(); // result index → words already matched
    let alive = true;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const spoken = e.results[i][0].transcript.split(/\s+/).map(norm).filter(Boolean);
        for (let k = used.get(i) ?? 0; k < spoken.length; k++) {
          const w = spoken[k];
          if (w.length < 2) continue;
          const ahead = words.current.slice(cursor.current, cursor.current + 8);
          const j = ahead.findIndex((x) => x.w === w);
          if (j >= 0) cursor.current += j + 1;
        }
        used.set(i, spoken.length);
      }
      const at = words.current[Math.min(cursor.current, words.current.length - 1)];
      if (at) setLine(at.line);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        alive = false;
        setError("Le micro est refusé pour la reconnaissance vocale.");
      }
    };
    // Chrome stops after a silence: start again while the mode is on.
    rec.onend = () => {
      if (!alive) return;
      used.clear();
      try {
        rec.start();
      } catch {
        /* already started */
      }
    };
    rec.start();
    return () => {
      alive = false;
      rec.onend = null;
      rec.stop();
    };
  }, [on]);

  return { line, error };
}
