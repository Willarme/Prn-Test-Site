"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The admin sidebar's links. Client-side only because the active state needs
 * the live pathname; everything else about the shell stays on the server.
 * Groups mirror canon 14A §17 "Admin / Company OS Lite" — OPERATE is the
 * day-to-day decisions, GROW is the door machine, MACHINE is the agent
 * platform watching itself.
 */
const GROUPS: Array<{ label: string; items: Array<[string, string]> }> = [
  {
    label: "Operate",
    items: [
      ["/admin", "Overview"],
      ["/admin/requests", "Requests"],
      ["/admin/approvals", "Approvals"],
    ],
  },
  {
    label: "Grow",
    items: [
      ["/admin/opportunities", "Search opportunities"],
      ["/admin/pages", "Pages"],
      ["/admin/controls", "Page controls"],
    ],
  },
  {
    label: "Machine",
    items: [
      ["/admin/agents", "Agents"],
      ["/admin/system", "System & safety"],
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="adm-nav" aria-label="Admin sections">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="adm-nav-label">{group.label}</div>
          {group.items.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? "active" : undefined}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
