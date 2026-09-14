"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { adminAction, adminActionMessage } from "./action";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true); setError(null);
    try {
      await adminAction("/api/admin/login", { body: { password } });
      setPassword("");
      router.refresh();
    } catch (error) { setError(adminActionMessage(error)); }
    finally { setBusy(false); }
  }

  return <form className="adm-login-form" method="post" action="/api/admin/login" onSubmit={submit} aria-busy={busy}>
    <div className="field">
      <label className="field-label" htmlFor="admin-password">Owner password</label>
      <input id="admin-password" name="password" type="password" className="inp" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy} aria-describedby={error ? "admin-login-error" : undefined} />
    </div>
    {error && <p id="admin-login-error" className="adm-action-message adm-action-message--error" role="alert">{error}</p>}
    <button type="submit" className="btn" disabled={busy || !password}>{busy ? "Signing in…" : "Open Company OS"}<span aria-hidden> ↗</span></button>
    <p className="adm-login-foot">Private owner workspace. Your session expires after 12 hours.</p>
  </form>;
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signOut() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await adminAction("/api/admin/login", { method: "DELETE" }); router.refresh(); }
    catch (error) { setError(adminActionMessage(error)); }
    finally { setBusy(false); }
  }
  return <span><button type="button" className="adm-signout" disabled={busy} onClick={signOut}>{busy ? "Signing out…" : "Sign out"}</button>{error && <span className="adm-signout-result" role="alert">{error}</span>}</span>;
}
