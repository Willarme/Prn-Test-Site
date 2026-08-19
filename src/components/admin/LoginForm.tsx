"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Sign-in failed");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card-light" style={{ maxWidth: 420 }}>
      <div className="field">
        <label className="field-label" htmlFor="admin-password">
          Owner password
        </label>
        <input
          id="admin-password"
          type="password"
          className="inp"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoComplete="current-password"
        />
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--pink-ink)", marginBottom: 12 }}>
          {error}
        </p>
      )}
      <button className="btn btn-pink" disabled={busy || password.length === 0} onClick={submit}>
        {busy ? "Checking…" : "Sign in"}
      </button>
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await fetch("/api/admin/login", { method: "DELETE" });
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
