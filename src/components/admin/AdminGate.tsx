import type { ReactNode } from "react";
import { adminMode } from "@/platform/admin/auth";
import { LoginForm } from "@/components/admin/LoginForm";

/**
 * READ gate for every /admin page. The admin surface shows real customer
 * journeys, so nothing renders — and no customer data is loaded — until the
 * owner has an unlocked session. Call it as the FIRST thing in each admin
 * page and return its result when non-null, BEFORE any data fetching.
 */
export async function adminGate(): Promise<ReactNode | null> {
  const mode = await adminMode();
  if (mode === "unlocked") return null;

  if (mode === "preview") {
    return (
      <div className="wrap-narrow">
        <div className="eyebrow">Owner admin</div>
        <h1 className="d2" style={{ marginBottom: 16 }}>
          Set an owner password to open this dashboard
        </h1>
        <div className="cell">
          <p style={{ marginBottom: 12 }}>
            This dashboard shows real customer requests, so it stays closed until an owner
            password exists. Nothing here is visible — not even to you — until then.
          </p>
          <p style={{ marginBottom: 12 }}>
            Add an environment variable named <code>ADMIN_PASSWORD</code> (8+ characters):
          </p>
          <ul style={{ paddingLeft: 20, color: "var(--on-dark-mute)" }}>
            <li>
              locally: a line in <code>.env.local</code>, then restart the dev server
            </li>
            <li>
              on the live site: Vercel → prn-trial-claude → Settings → Environment Variables,
              then Redeploy
            </li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap-narrow">
      <div className="eyebrow">Owner admin</div>
      <h1 className="d2" style={{ marginBottom: 8 }}>
        Sign in
      </h1>
      <p className="lede" style={{ marginBottom: 22 }}>
        This dashboard shows real customer requests. Sign in with your owner password to
        continue.
      </p>
      <LoginForm />
    </div>
  );
}
