import type { ReactNode } from "react";
import { adminMode } from "@/platform/admin/auth";
import { LoginForm } from "@/components/admin/LoginForm";

/** Always call before protected server reads. The shell never replaces this gate. */
export async function adminGate(): Promise<ReactNode | null> {
  const mode = await adminMode();
  if (mode === "unlocked") return null;
  if (mode === "preview") return <div className="adm-login">
    <p className="adm-kicker">Company OS / Private workspace</p>
    <h1 className="adm-title">Set up owner access.</h1>
    <p className="adm-description">This workspace contains customer records and operating controls. It stays closed until an owner password is configured.</p>
    <div className="cell"><h2 className="d3">Configure the server</h2><p>Add <code>ADMIN_PASSWORD</code> with at least eight characters to this environment, then restart or redeploy it.</p><p className="adm-small">For local development, set it in <code>.env.local</code>. On the approved hosting environment, use its environment settings. Keep the password out of project files and shared notes.</p></div>
  </div>;
  return <div className="adm-login">
    <p className="adm-kicker">Company OS / Owner access</p>
    <h1 className="adm-title">Your company.<br />A clearer view.</h1>
    <p className="adm-description">Open the private workspace for requests, decisions, growth and system operations.</p>
    <LoginForm />
  </div>;
}
