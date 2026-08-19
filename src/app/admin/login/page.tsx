import { adminConfigured } from "@/platform/admin/auth";
import { LoginForm } from "@/components/admin/LoginForm";

export default function AdminLogin() {
  const configured = adminConfigured();
  return (
    <div className="wrap-narrow">
      <div className="eyebrow">Owner sign-in</div>
      <h1 className="d2" style={{ marginBottom: 18 }}>Unlock changes</h1>
      {configured ? (
        <LoginForm />
      ) : (
        <div className="cell">
          <p>
            No owner password is configured for this environment yet, so the dashboard runs in
            read-only preview mode. To enable publishing and control changes, add an environment
            variable named <code>ADMIN_PASSWORD</code> (8+ characters) — locally in{" "}
            <code>.env.local</code>, on staging in Vercel → prn-trial-claude → Settings → Environment
            Variables — then redeploy.
          </p>
        </div>
      )}
    </div>
  );
}
