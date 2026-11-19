"use client";

import { BookPlus, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { STYLE_WORKER, type MontageJob, type ReviewNote } from "@/lib/montage";
import { DEFAULT_STYLE, MAX_NOTES, noteLines } from "@/lib/profiles";
import { useProfiles } from "@/lib/use-profiles";
import { atLeast } from "../brand-reading";
import { Button } from "../ui";
import { JobStatus } from "./parts";
import { montageApi, useMontage } from "./use-montage";

const WORKER_MIN = STYLE_WORKER.split(".").map(Number);

/**
 * Under the review notes: the resolved ones become rules of the style the montage is made with. Claude proposes 1 to 6
 * rules (on the Mac), Antoine ticks those to add to the style's notes.
 */
export function StyleRules({ job, notes }: { job: MontageJob; notes: ReviewNote[] }) {
  const { data, refresh } = useMontage();
  const { styles, save } = useProfiles();
  const [sending, setSending] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const styleId = job.styleId ?? DEFAULT_STYLE;
  const style = job.projectId ? styles?.[job.projectId]?.find((s) => s.id === styleId) : undefined;
  const task = (data?.jobs ?? []).find((j) => j.kind === "style" && j.styleTask?.mode === "rules" && j.styleTask.from === job.id);
  const rules = task?.status === "done" ? (task.styleTask?.result?.rules ?? []) : [];
  const resolved = notes.filter((n) => n.status === "resolved" && (n.text.trim() || n.target)).length;
  const old = !!data?.worker?.version && !atLeast(data.worker.version, WORKER_MIN);
  useEffect(() => setChosen(rules), [rules.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job.projectId || (!resolved && !task)) return null;

  const ask = async () => {
    setSending(true);
    try {
      if (task) await montageApi(`/api/montage/jobs/${task.id}`, { method: "DELETE" });
      await montageApi("/api/montage/jobs", { method: "POST", body: JSON.stringify({ kind: "style", mode: "rules", projectId: job.projectId, styleId, from: job.id }) });
      refresh();
    } catch (e) {
      toast.error("Demande non envoyée", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };
  const dismiss = () => task && montageApi(`/api/montage/jobs/${task.id}`, { method: "DELETE" }).then(refresh, (e: Error) => toast.error(e.message));
  const add = async () => {
    if (!style || !chosen.length) return;
    setSaving(true);
    try {
      const have = new Set(noteLines(style.notes).map((l) => l.toLowerCase()));
      const fresh = chosen.filter((r) => !have.has(r.toLowerCase()));
      const next = [style.notes.trim(), ...fresh.map((r) => `- ${r}`)].filter(Boolean).join("\n");
      if (next.length > MAX_NOTES) throw new Error("Les notes du style sont trop longues : fais de la place dans Ressources → Styles.");
      await save(job.projectId!, { notes: next }, styleId === DEFAULT_STYLE ? undefined : styleId);
      toast.success(`${fresh.length} règle${fresh.length > 1 ? "s" : ""} ajoutée${fresh.length > 1 ? "s" : ""} au style « ${style.name} »`, { description: "Les prochains montages faits avec ce style les suivront." });
      await dismiss();
    } catch (e) {
      toast.error("Règles non ajoutées", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <BookPlus className="size-3.5 text-accent" /> Garder ces retours pour la suite
        </span>
        {task && task.status !== "done" && <JobStatus job={task} />}
        <span className="ml-auto" />
        {task && task.status !== "working" && (
          <button onClick={dismiss} aria-label="Retirer" className="press grid size-6 place-items-center rounded-md text-ink-3 hover:text-ink">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {!task && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-pretty text-ink-3">
            Claude lit tes {resolved} retour{resolved > 1 ? "s" : ""} résolu{resolved > 1 ? "s" : ""} et propose des règles pour le style « {style?.name ?? "du projet"} » : tu choisis celles à garder.
          </p>
          <Button size="sm" variant="ghost" disabled={sending || !resolved} onClick={ask}>
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Proposer des règles
          </Button>
        </div>
      )}
      {old && !rules.length && <p className="mt-1.5 text-[12px] text-warn">Mets à jour le programme du Mac (version {STYLE_WORKER}) : la demande attendra jusque-là.</p>}
      {task && (task.status === "queued" || task.status === "working") && <p className="mt-1.5 text-ink-3">{task.step ?? "En attente du Mac…"}</p>}
      {task?.status === "failed" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-pretty text-warn">{task.error ?? "Échec"}</span>
          <Button size="sm" variant="ghost" disabled={sending} onClick={ask}>
            Réessayer
          </Button>
        </div>
      )}
      {rules.length > 0 && (
        <>
          <ul className="mt-2 flex flex-col gap-1">
            {rules.map((r) => (
              <li key={r}>
                <label className="flex items-start gap-2 rounded-lg bg-surface-2/60 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={chosen.includes(r)}
                    onChange={(e) => setChosen(e.target.checked ? [...chosen, r] : chosen.filter((x) => x !== r))}
                    className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="text-pretty">{r}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={sending} onClick={ask}>
              Autres règles
            </Button>
            <Button size="sm" disabled={saving || !chosen.length || !style} onClick={add}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <BookPlus className="size-3.5" />} Ajouter {chosen.length} règle{chosen.length > 1 ? "s" : ""} au style
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
