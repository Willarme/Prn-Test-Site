"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminNav } from "./AdminNav";
import { SignOutButton } from "./LoginForm";

/** Presentation only. Each server page retains its own read gate. */
export function AdminShell({ unlocked, storageKind, children }: {
  unlocked: boolean; storageKind: "file" | "supabase" | "unavailable"; children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  if (/^\/admin\/pages\/[^/]+\/preview\/?$/.test(pathname)) {
    return <div className="adm-shell adm-shell--preview">{children}</div>;
  }
  return <div className={`adm-shell${unlocked ? "" : " adm-shell--locked"}`}>
    <a className="adm-skip" href="#admin-content">Skip to workspace</a>
    <aside className="adm-sidebar" onKeyDown={event => { if (event.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); } }}>
      <Link href="/admin" className="adm-brand" aria-label="Property Response Network Company OS"><span className="adm-pennant" aria-hidden /><span><span className="adm-brand-name">Property Response</span><span className="adm-brand-sub">NETWORK / COMPANY OS</span></span></Link>
      <div className="adm-rail-intro"><span className="adm-rail-index">01 / OPERATIONS</span><p>A clear view.<br />A considered next step.</p></div>
      {unlocked ? <>
        <button ref={menuButton} className="adm-menu-toggle" aria-expanded={menuOpen} aria-controls="admin-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "Close navigation" : "Open navigation"}<span aria-hidden>{menuOpen ? "−" : "+"}</span></button>
        <div id="admin-navigation" className="adm-navigation-container" data-open={menuOpen} onClick={(event) => {
          if (menuOpen && (event.target as HTMLElement).closest("a")) {
            setMenuOpen(false);
            // A current-route click may not trigger Next's route focus handling.
            // Keep focus visible when its containing mobile menu collapses.
            menuButton.current?.focus();
          }
        }}><AdminNav /></div>
        <div className="adm-sidebar-foot"><span className="adm-rail-label">This workspace</span><span className="adm-storage"><span aria-hidden />{storageKind === "unavailable" ? "Storage unavailable" : storageKind === "supabase" ? "Database configured" : "Local file storage"}</span><p className="adm-rail-note">{storageKind === "unavailable" ? "Storage configuration could not be loaded." : storageKind === "supabase" ? "Connection outcomes appear with each reading." : "Records stay in this environment."}</p><div className="adm-rail-actions"><Link href="/demo">Open demo <span aria-hidden>↗</span></Link><SignOutButton /></div></div>
      </> : <div className="adm-sidebar-foot"><span className="adm-rail-label">Private workspace</span><p className="adm-rail-note">Owner access required. Customer records stay behind the sign-in gate.</p><Link className="adm-rail-link" href="/demo">Return to demo ↗</Link></div>}
    </aside>
    <div className="adm-workspace"><div className="adm-workspace-bar"><span>PROPERTY RESPONSE NETWORK</span><span>COMPANY OS <i aria-hidden /> {unlocked ? "OWNER WORKSPACE" : "SIGN IN"}</span></div><main id="admin-content" className="adm-main" tabIndex={-1}><div className="adm-narrow">{children}</div></main><footer className="adm-workspace-footer"><span>Property Response Network</span><span>Evidence before action.</span></footer></div>
  </div>;
}
