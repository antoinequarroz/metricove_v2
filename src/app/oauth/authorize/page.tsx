import { Logo } from "@/components/logo";
import { readAuthorize } from "@/server/mcp/keys";

export const dynamic = "force-dynamic";

// Same look as the app's primary button.
const primary =
  "press h-9 flex-1 rounded-lg bg-accent text-[13.5px] font-medium text-accent-ink shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_1px_2px_rgba(0,0,0,0.12),0_6px_16px_-6px_var(--accent)] hover:brightness-[1.06]";
const secondary = "press h-9 flex-1 rounded-lg border border-line-strong bg-surface text-[13.5px] font-medium shadow-card hover:bg-surface-2";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Where Claude (or another agent) asks to read Metricove. Behind the middleware: whoever sees this
 * page is signed in (otherwise they go through /login first and come back here).
 */
export default async function AuthorizePage({ searchParams }: Props) {
  const params = await searchParams;
  const request = readAuthorize((k) => {
    const v = params[k];
    return typeof v === "string" ? v : null;
  });

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="rise w-full max-w-[400px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl">
        <Logo className="size-9" />
        {typeof request === "string" ? (
          <>
            <h1 className="mt-5 font-display text-[26px] leading-tight">Connexion impossible</h1>
            <p className="mt-2 text-[13px] text-ink-3">{request}</p>
          </>
        ) : (
          <form method="post" action="/api/oauth/authorize">
            <h1 className="mt-5 font-display text-[26px] leading-tight">Connecter {request.client.name} à Metricove ?</h1>
            <p className="mt-2 text-[13px] text-ink-3">
              Il pourra lire le calendrier, les comptes, les projets, les posts, la médiathèque et les statistiques. Il ne pourra rien modifier ni publier.
            </p>
            {Object.entries({
              client_id: request.client.id,
              redirect_uri: request.redirectUri,
              state: request.state ?? "",
              response_type: "code",
              code_challenge: request.codeChallenge,
              code_challenge_method: "S256",
            }).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <div className="mt-6 flex gap-2">
              <button name="decision" value="deny" className={secondary}>
                Refuser
              </button>
              <button name="decision" value="allow" className={primary}>
                Autoriser
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
