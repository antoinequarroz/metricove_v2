import { lamioConfig } from "@/server/lamio";
import { LoginForm } from "./login-form";

// Read when the page is asked for, not at build time: LAMIO_URL comes from the environment of the server.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm lamio={!!lamioConfig()} />;
}
