import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { adminMode } from "@/platform/admin/auth";
import { SignOutButton } from "@/components/admin/LoginForm";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "Overview"],
  ["/admin/opportunities", "Search opportunities"],
  ["/admin/pages", "Pages"],
  ["/admin/controls", "Page-creator controls"],
  ["/admin/requests", "Requests"],
  ["/admin/approvals", "Approvals"],
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const mode = await adminMode();
  const unlocked = mode === "unlocked";
  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ background: "var(--asphalt-2)", borderBottom: "1px solid var(--line-d)" }}>
        <div
          className="wrap"
          style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "10px 26px" }}
        >
          <span className="mono" style={{ color: "var(--pink)", marginRight: 12 }}>
            Owner Admin
          </span>
          {unlocked &&
            NAV.map(([href, label]) => (
              <Link key={href} href={href} className="btn btn-ghost btn-sm">
                {label}
              </Link>
            ))}
          <span style={{ marginLeft: "auto" }}>
            {unlocked ? <SignOutButton /> : <span className="pill pill-amber">Locked</span>}
          </span>
        </div>
      </div>
      <div className="wrap" style={{ padding: "34px 26px 80px" }}>{children}</div>
    </div>
  );
}
