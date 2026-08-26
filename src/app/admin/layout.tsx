import type { Metadata } from "next";
import type { ReactNode } from "react";
import { adminMode } from "@/platform/admin/auth";
import { runtimeStore } from "@/platform/stores/runtime";
import { AdminNav } from "@/components/admin/AdminNav";
import { SignOutButton } from "@/components/admin/LoginForm";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The admin shell: a fixed sidebar (canon 14A §17 Company OS Lite grouping)
 * plus the page itself. Nothing renders but the shell when the session is
 * locked — the per-page gates own the sign-in screen.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const mode = await adminMode();
  const unlocked = mode === "unlocked";
  const store = runtimeStore();

  return (
    <div className="adm-shell">
      <aside className="adm-sidebar">
        <div className="adm-brand">
          <span className="flag" aria-hidden>
            ⚑
          </span>
          <span>
            <span className="t">Owner Admin</span>
            <span className="s">Property Response Network</span>
          </span>
        </div>

        {unlocked ? (
          <>
            <AdminNav />
            <div className="adm-sidebar-foot">
              <span
                className="pill"
                title={
                  store.kind === "supabase"
                    ? "Writes land in the Supabase database (permanent)"
                    : "Writes land in a local file until the database is connected"
                }
                style={{
                  background:
                    store.kind === "supabase" ? "rgba(18,165,91,.14)" : "rgba(232,149,42,.14)",
                  color: store.kind === "supabase" ? "var(--green-bright)" : "var(--amber)",
                }}
              >
                {store.kind === "supabase" ? "DB CONNECTED" : "LOCAL STORAGE"}
              </span>
              <SignOutButton />
            </div>
          </>
        ) : (
          <div className="adm-sidebar-foot">
            <span className="pill pill-amber">Locked</span>
          </div>
        )}
      </aside>

      <main className="adm-main">
        <div className="adm-narrow">{children}</div>
      </main>
    </div>
  );
}
