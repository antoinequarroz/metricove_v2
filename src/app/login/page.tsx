import { settings } from "@/server/compte";
import { LoginForm } from "./login-form";

// Read when the page is asked for, not at build time: COMPTE_URL comes from the environment of the server.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm compte={!!settings()} />;
}
