/**
 * Remontée des erreurs du serveur vers Orbi (le monitoring de la suite), avec le SDK Sentry : Orbi
 * accepte son protocole tel quel. Côté serveur seulement : aucune page ne charge de script en plus,
 * et la Content-Security-Policy ne change pas.
 *
 * SENTRY_DSN vide = rien n'est envoyé (développement, tests). En production : le DSN du projet
 * « Metricove » d'Orbi (orbi.postmelo.ch > Metricove > Brancher).
 */
import type { Instrumentation } from "next";

export async function register() {
  // This exact check lets Next drop the import from the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startErrorReporting } = await import("./lib/error-reporting.node");
    await startErrorReporting();
    if (process.env.SCHEDULER === "off") return;
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("./lib/error-reporting.node");
    await reportRequestError(error, request, context);
  }
};
