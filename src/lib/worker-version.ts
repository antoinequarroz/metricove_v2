/** Versions of the Mac program ("major.minor.patch", worker/montage/montage.mjs VERSION). */

const parts = (v: string | undefined) => {
  const p = (v ?? "").trim().split(".");
  return [0, 1, 2].map((i) => {
    const n = parseInt(p[i] ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
};

/**
 * True when `version` is `min` or newer, comparing the numbers of the triplets. A missing or unreadable version counts
 * as "0.0.0" (a Mac never seen, or a claim without version, gets no job that needs a minimum). No `min` means no
 * minimum: true for any version (old jobs have no `minWorker`).
 */
export function atLeast(version: string | undefined, min: string | undefined): boolean {
  if (!min) return true;
  const v = parts(version);
  const m = parts(min);
  for (let i = 0; i < 3; i++) if (v[i] !== m[i]) return v[i] > m[i];
  return true;
}
