"use client";

import { Check, Crosshair, MessageSquarePlus, PenLine, RotateCcw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MAX_SENT_NOTES, type MontageMark, type ReviewNote } from "@/lib/montage";
import { cn } from "@/lib/utils";
import { Button } from "../ui";
import { Segmented } from "./controls";
import { fmtSec } from "./parts";
import { montageApi } from "./use-montage";

// Review notes of a face-cam edit, kept on the server: a moment, a few words, a drawing, maybe an element of the picture.
// Open until marked resolved; « Envoyer les retours à Claude » asks a new version that handles the open ones.

export type NoteDraft = { version: number; t: number; text?: string; image?: string; target?: ReviewNote["target"] };

export function useReviewNotes(jobId: string) {
  const [notes, setNotes] = useState<ReviewNote[] | undefined>();
  const base = `/api/montage/jobs/${jobId}/notes`;
  const reload = useCallback(() => montageApi<{ notes: ReviewNote[] }>(base).then((r) => setNotes(r.notes)).catch(() => setNotes((n) => n ?? [])), [base]);
  useEffect(() => void reload(), [reload]);
  const run = async (p: Promise<{ notes: ReviewNote[]; note?: ReviewNote }>) => {
    try {
      const r = await p;
      setNotes(r.notes);
      return r.note;
    } catch (e) {
      toast.error("Retour non enregistré", { description: (e as Error).message });
    }
  };
  return {
    notes: notes ?? [],
    loaded: notes !== undefined,
    reload,
    add: (d: NoteDraft) => run(montageApi(base, { method: "POST", body: JSON.stringify(d) })),
    update: (id: string, patch: Partial<Pick<ReviewNote, "text" | "status" | "t">>) => {
      setNotes((list) => list?.map((n) => (n.id === id ? { ...n, ...patch } : n)));
      return run(montageApi(`${base}/${id}`, { method: "PATCH", body: JSON.stringify(patch) }));
    },
    remove: (id: string) => run(montageApi(`${base}/${id}`, { method: "DELETE" })),
  };
}

/** The open notes of a version, as the marks the timeline draws. */
export const notesAsMarks = (notes: ReviewNote[], version: number): MontageMark[] => notes.filter((n) => n.version === version && n.status === "open").map((n) => ({ id: n.id, version: n.version, t: n.t, text: n.text || n.target?.label || "" }));

/** The notes Claude gets with the next request: open ones that say something, those of the version on show first. */
export function notesToSend(notes: ReviewNote[], version: number) {
  const open = notes.filter((n) => n.status === "open" && (n.text.trim() || n.image || n.target));
  return [...open.filter((n) => n.version === version), ...open.filter((n) => n.version !== version)].slice(0, MAX_SENT_NOTES);
}

export function ReviewNotesPanel({
  jobId,
  api,
  version,
  canSend,
  busy,
  focus,
  onSeek,
  onAdd,
  onSend,
}: {
  jobId: string;
  api: ReturnType<typeof useReviewNotes>;
  version: number;
  /** A new version can be asked (review, Mac free). */
  canSend: boolean;
  busy: boolean;
  /** The note just added: its field takes the focus. */
  focus: string | null;
  onSeek: (version: number, t: number) => void;
  onAdd?: () => void;
  onSend: (ids: string[], extra: string) => Promise<boolean>;
}) {
  const [show, setShow] = useState<"open" | "resolved">("open");
  const [all, setAll] = useState(false);
  const [extra, setExtra] = useState("");
  const { notes } = api;
  const mine = all ? notes : notes.filter((n) => n.version === version);
  const list = mine.filter((n) => n.status === show).sort((a, b) => a.version - b.version || a.t - b.t);
  const count = (s: ReviewNote["status"]) => mine.filter((n) => n.status === s).length;
  const send = notesToSend(notes, version);
  const openAll = notes.filter((n) => n.status === "open" && (n.text.trim() || n.image || n.target)).length;

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <MessageSquarePlus className="size-3.5 text-accent" /> Retours
        </span>
        <Segmented<"open" | "resolved">
          label="Retours affichés"
          value={show}
          onChange={setShow}
          options={[
            { value: "open", label: `Ouverts · ${count("open")}` },
            { value: "resolved", label: `Résolus · ${count("resolved")}` },
          ]}
        />
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
          Toutes les versions
        </label>
        {onAdd && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onAdd} title="Un retour à l'endroit de la vidéo (touche C)">
            <MessageSquarePlus className="size-3.5" /> Commenter ici
          </Button>
        )}
      </div>

      {list.length ? (
        <ul className="flex flex-col gap-1.5">
          {list.map((n) => (
            <NoteRow key={n.id} jobId={jobId} n={n} here={n.version === version} autoFocus={focus === n.id} api={api} onSeek={onSeek} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg bg-surface-2/60 px-2.5 py-2 text-[12px] text-pretty text-ink-3">
          {show === "open"
            ? "Aucun retour ouvert. Mets la vidéo en pause et appuie sur C pour commenter ce moment, sur V pour viser un élément de l'image, ou dessine une note."
            : "Aucun retour résolu pour l'instant."}
        </p>
      )}

      {canSend && (
        <div className="mt-3 border-t border-line pt-3">
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            maxLength={2000}
            aria-label="Demande pour Claude"
            placeholder={send.length ? "Un mot de plus pour Claude (facultatif)" : "Par ex. « plus court, garde la prise 2 », ou laisse des retours sur la vidéo"}
            className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent/60"
          />
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            {openAll > send.length && <span className="text-[11.5px] text-ink-3">{MAX_SENT_NOTES} retours au plus par demande : les autres partiront avec la suivante.</span>}
            <Button
              size="sm"
              disabled={busy || (!extra.trim() && !send.length)}
              onClick={async () => {
                if (await onSend(send.map((n) => n.id), extra)) setExtra("");
              }}
            >
              <Send className="size-3.5" /> {send.length ? `Envoyer ${send.length} retour${send.length > 1 ? "s" : ""} à Claude` : "Nouvelle version"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteRow({ jobId, n, here, autoFocus, api, onSeek }: { jobId: string; n: ReviewNote; here: boolean; autoFocus: boolean; api: ReturnType<typeof useReviewNotes>; onSeek: (version: number, t: number) => void }) {
  const [text, setText] = useState(n.text);
  useEffect(() => setText(n.text), [n.text]);
  const resolved = n.status === "resolved";
  return (
    <li className={cn("flex items-start gap-2 rounded-lg border border-line p-1.5 text-[12.5px]", resolved ? "bg-transparent opacity-75" : "bg-surface-2/60")}>
      {n.image ? (
        <button onClick={() => onSeek(n.version, n.t)} className="shrink-0" aria-label="Aller à ce moment">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/montage/jobs/${jobId}/notes/${n.id}/image`} alt="" className="h-12 w-auto rounded-md" />
        </button>
      ) : (
        <span className="grid h-12 w-8 shrink-0 place-items-center rounded-md bg-ink/5 text-ink-3">{n.target ? <Crosshair className="size-3.5" /> : <PenLine className="size-3.5" />}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
          <button onClick={() => onSeek(n.version, n.t)} className="tabular font-mono hover:text-accent" title="Aller à ce moment">
            {here ? "" : `v${n.version} · `}
            {fmtSec(n.t)}
          </button>
          {n.target && <span className="truncate rounded bg-accent/10 px-1.5 py-px text-accent">{n.target.label}</span>}
          {n.sentIn && <span className="rounded bg-ink/5 px-1.5 py-px">Envoyé pour la v{n.sentIn}</span>}
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() !== n.text && api.update(n.id, { text: text.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          autoFocus={autoFocus}
          maxLength={1000}
          placeholder={n.image ? "Dessin sans texte" : "Ton retour à cet endroit"}
          aria-label={`Retour à ${fmtSec(n.t)}`}
          className="h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 outline-none hover:border-line-strong focus:border-accent/60 focus:bg-surface"
        />
      </div>
      <button
        onClick={() => api.update(n.id, { status: resolved ? "open" : "resolved" })}
        aria-label={resolved ? "Rouvrir" : "Marquer comme résolu"}
        title={resolved ? "Rouvrir" : "Marquer comme résolu"}
        className={cn("press grid size-7 shrink-0 place-items-center rounded-md border", resolved ? "border-line-strong text-ink-3" : "border-ok/40 text-ok hover:bg-ok/10")}
      >
        {resolved ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
      </button>
      <button onClick={() => api.remove(n.id)} aria-label="Supprimer le retour" title="Supprimer" className="press grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:text-ink">
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
