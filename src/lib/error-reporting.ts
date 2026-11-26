/**
 * Ce qui part vers Orbi avec une erreur : jamais de cookie, d'en-tête, de corps de requête ni de
 * paramètre d'URL (jetons de connexion, codes OAuth). Seuls le chemin et la pile d'appels restent.
 */
type ScrubbableEvent = {
  request?: { url?: string; cookies?: unknown; headers?: unknown; data?: unknown; query_string?: unknown };
  user?: unknown;
};

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.request) {
    const url = event.request.url;
    event.request = { url: url ? url.split("?")[0].split("#")[0] : undefined };
  }
  delete event.user;
  return event;
}
