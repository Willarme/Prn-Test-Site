"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Task groups follow Company OS's company, growth and operations work. */
const GROUPS: Array<{ label: string; items: Array<[string, string]> }> = [
  {
    label: "Company",
    items: [
      ["/admin", "Cockpit"],
      ["/admin/requests", "Requests"],
      ["/admin/approvals", "Decisions"],
    ],
  },
  {
    label: "Growth",
    items: [
      ["/admin/opportunities", "Opportunities"],
      ["/admin/page-creator", "Page Creator"],
      ["/admin/templates", "Templates"],
      ["/admin/pages", "Pages"],
      ["/admin/controls", "Page controls"],
    ],
  },
  {
    label: "Operations",
    items: [
      ["/admin/features", "Features"],
      ["/admin/agents", "Agents"],
      ["/admin/connections", "Connections"],
      ["/admin/map", "System map"],
      ["/admin/audit", "Activity"],
      ["/admin/system", "System & safety"],
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="adm-nav" aria-label="Company OS sections">
      {GROUPS.map((group, index) => (
        <div key={group.label} className="adm-nav-group">
          <div className="adm-nav-label"><span>{group.label}</span><span>0{index + 1}</span></div>
          {group.items.map(([href, label]) => {
            const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
            return (
            <Link
              key={href}
              href={href}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
            >
              <span>{label}</span><span className="adm-nav-arrow" aria-hidden>↗</span>
            </Link>
          );})}
        </div>
      ))}
    </nav>
  );
}
