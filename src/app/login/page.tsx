import { settings } from "@/server/compte";
import { safeNext } from "@/lib/utils";
import { LoginForm } from "./login-form";

// Read when the page is asked for, not at build time: COMPTE_URL comes from the environment of the server.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  // Where to come back once signed in, e.g. the page where Claude asks for access.
  const next = safeNext((await searchParams).next);
  return <LoginForm compte={!!settings()} next={next} />;
}
