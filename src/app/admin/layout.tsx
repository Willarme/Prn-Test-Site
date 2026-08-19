import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { adminMode } from "@/platform/admin/auth";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

const NAV = [
  ["/admin", "Overview"],
  ["/admin/opportunities", "Search opportunities"],
  ["/admin/pages", "Pages"],
  ["/admin/controls", "Page-creator controls"],
  ["/admin/requests", "Requests"],
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const mode = await adminMode();
  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ background: "var(--asphalt-2)", borderBottom: "1px solid var(--line-d)" }}>
        <div className="wrap" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "10px 26px" }}>
          <span className="mono" style={{ color: "var(--pink)", marginRight: 12 }}>Owner Admin</span>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="btn btn-ghost btn-sm">
              {label}
            </Link>
          ))}
          <span style={{ marginLeft: "auto" }}>
            {mode === "unlocked" && <span className="pill pill-green">Signed in · changes enabled</span>}
            {mode === "locked" && (
              <Link href="/admin/login" className="pill pill-amber">
                Read-only · sign in to make changes
              </Link>
            )}
            {mode === "preview" && <span className="pill pill-amber">Preview mode · read-only</span>}
          </span>
        </div>
      </div>
      {mode === "preview" && (
        <div style={{ background: "rgba(232,149,42,.12)", borderBottom: "1px solid rgba(232,149,42,.4)" }}>
          <div className="wrap" style={{ padding: "10px 26px", fontSize: ".9rem" }}>
            <strong>Preview mode.</strong> Everything here is visible, but publish and control changes
            are disabled until an owner password is configured (Vercel → prn-trial-claude → Settings →
            Environment Variables → <code>ADMIN_PASSWORD</code>) and the database is connected. See the
            owner to-do list.
          </div>
        </div>
      )}
      <div className="wrap" style={{ padding: "34px 26px 80px" }}>{children}</div>
    </div>
  );
}
