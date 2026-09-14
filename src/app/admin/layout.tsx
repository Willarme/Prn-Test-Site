import type { Metadata } from "next";
import type { ReactNode } from "react";
import { adminMode } from "@/platform/admin/auth";
import { runtimeStore } from "@/platform/stores/runtime";
import { AdminShell } from "@/components/admin/AdminShell";
import "./admin.css";

export const metadata: Metadata = {
  title: "Company OS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Each server page retains its read gate before loading protected records. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const mode = await adminMode();
  let storageKind: "file" | "supabase" | "unavailable" = "unavailable";
  // A broken store configuration must not remove access to the sign-in shell.
  // Locked shells do not need to construct a private-data adapter at all.
  if (mode === "unlocked") {
    try { storageKind = runtimeStore().kind; } catch { /* Each page reports its own unavailable observations. */ }
  }
  return <AdminShell unlocked={mode === "unlocked"} storageKind={storageKind}>{children}</AdminShell>;
}
