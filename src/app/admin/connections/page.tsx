import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { ConnectionDiagnostics } from "@/components/admin/ConnectionDiagnostics";
import { connectionReadiness } from "@/platform/admin/connections";
import "../console.css";

export const dynamic = "force-dynamic";
export default async function ConnectionsPage() {
  const gate = await adminGate(); if (gate) return gate;
  const state = connectionReadiness();
  const items = [
    { title: "Request & packet storage", status: state.storage === "local" ? state.file_override ? "File override active" : "Local file fallback" : "Credentials present", detail: state.storage === "local" ? state.file_override ? "The file-store override keeps runtime records local. Trial database credentials, when present, are deliberately unused." : "Server database credentials are absent, so the existing runtime uses local file storage. This fallback is not a verified Supabase connection." : "Supabase is the implemented data spine. Run the check below to verify table access in this environment." },
    { title: "Supabase customer isolation", status: state.storage === "local" ? "Inactive in file mode" : state.request_scope ? "Credentials present" : "Needs attention", detail: state.storage === "local" ? "Request-scoped database access is inactive while the local store is selected." : state.request_scope ? "Request-scoped credentials are configured. Cross-customer RLS still needs a separate isolation test." : "The existing adapter can use elevated server access when request-scoped credentials are absent. Do not treat configuration as proven customer isolation." },
    { title: "OpenRouter AI", status: state.openrouter ? "Key present" : "Unconfigured", detail: "A key does not prove authentication, model availability or a successful call. Policy controls model selection and budget; agent receipts show actual attempts." },
    { title: "Email delivery", status: state.email === "preview" ? "Preview only" : state.email === "configured" ? "Key present" : "Unconfigured", detail: state.email === "preview" ? "The demo prepares email previews. It does not deliver them to clients." : "Provider configuration is distinct from a verified delivery. Real sending stays behind the existing communication gates." },
    { title: "Search research", status: state.search ? "Credentials present" : "Seed workbook", detail: "The imported opportunity workbook is research. It is not measured traffic, customer demand or a live provider read." },
    { title: "Search Console", status: state.search_console ? "Credentials present" : "Unconfigured", detail: "Traffic and search performance require a verified property and collected observations. No traffic metric is inferred from staged pages." },
  ];
  return <div className="console-section-stack"><AdminPageHeader eyebrow="Machine / connections" title="Know what is connected." description="Configuration, observed access and deliberate isolation—each with its own evidence." actions={<Link className="btn btn-ghost" href="/admin/system">System controls →</Link>} /><div className="console-grid">{items.map(item => <section className="console-sheet" key={item.title}><div className="console-section-head"><h2>{item.title}</h2><AdminStatus tone={item.status === "Needs attention" || item.status === "Unavailable" ? "warning" : "neutral"}>{item.status}</AdminStatus></div><p className="adm-description">{item.detail}</p></section>)}</div><ConnectionDiagnostics /></div>;
}

