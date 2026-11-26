import type { Instrumentation } from "next";
import { scrubEvent } from "@/lib/error-reporting";

function dsn() {
  return process.env.SENTRY_DSN?.trim() || null;
}

export async function startErrorReporting() {
  const value = dsn();
  if (!value) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: value,
    environment: process.env.NODE_ENV,
    release: process.env.APP_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
}

export async function reportRequestError(...[error, request, context]: Parameters<Instrumentation.onRequestError>) {
  if (!dsn()) return;
  const Sentry = await import("@sentry/node");
  Sentry.withScope((scope) => {
    scope.setTag("route", context.routePath);
    scope.setTag("route_type", context.routeType);
    scope.setContext("request", { method: request.method, path: request.path.split("?")[0] });
    Sentry.captureException(error);
  });
}
