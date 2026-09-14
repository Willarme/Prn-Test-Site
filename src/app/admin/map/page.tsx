import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import "../console.css";

export const dynamic = "force-dynamic";
const groups = [
  { title: "Understand & respond", step: "01", description: "A homeowner's account becomes a request with traceable evidence.", rows: [
    { name: "Request intake & packet inspection", state: "Working console", detail: "Read the recorded problem, answers, claims, safety projection and current packet.", href: "/admin/requests" },
    { name: "Homeowner experience", state: "Demo", detail: "Walk the AC page, guided intake and example results in the demonstration environment.", href: "/demo" },
    { name: "Provider dispatch & booking", state: "Deferred", detail: "A provider directory or mockup is not a working dispatch, booking or acceptance loop.", href: null },
  ] },
  { title: "Review & improve", step: "02", description: "Routine work follows policy. Material exceptions need an exact, evidenced review.", rows: [
    { name: "Approval Center", state: "Working console", detail: "Inspect the proposal and recorded evidence. Existing execution gates remain authoritative.", href: "/admin/approvals" },
    { name: "Data quality & reconciliation", state: "Working console", detail: "Review findings, quarantine and observed samples from A09.", href: "/admin#data-quality" },
    { name: "Agent responsibilities & observations", state: "Working console", detail: "Declared permissions and budgets sit beside saved run receipts, with the distinction visible.", href: "/admin/agents" },
    { name: "Company health & owner economics", state: "Needs trial evidence", detail: "A07/A10 company conclusions need implemented metrics and real outcome data. No health score or autonomy percentage is fabricated.", href: null },
  ] },
  { title: "Build & release", step: "03", description: "Research becomes a draft. A current release gate decides whether it can be published.", rows: [
    { name: "Search opportunity research", state: "Working console", detail: "Review the imported workbook and recorded opportunity decisions.", href: "/admin/opportunities" },
    { name: "Door factory, preview & release", state: "Working console", detail: "Generate staged versions, inspect current QA and edit permitted fields. Blocked pages have no override.", href: "/admin/pages" },
    { name: "Traffic & outcome measurement", state: "Needs trial evidence", detail: "Search impressions, lead conversion and job outcomes require collected production observations.", href: null },
  ] },
  { title: "Operate with boundaries", step: "04", description: "Configuration is inspectable. Connections and actions have observable records.", rows: [
    { name: "AI budget & policy", state: "Working console", detail: "Inspect the active model, capability limits and saved policy.", href: "/admin/system#ai-policy" },
    { name: "Agent pauses & feature gates", state: "Working console", detail: "Read switch state and scope before using an explicit pause or resume control.", href: "/admin/system" },
    { name: "Connection diagnostics", state: "Working console", detail: "Run a bounded read check and inspect missing or unavailable connection configuration.", href: "/admin/connections" },
    { name: "Action & run history", state: "Working console", detail: "Review source-bounded activity without exposing arbitrary agent payloads.", href: "/admin/audit" },
  ] },
];
export default async function SystemMapPage() {
  const gate = await adminGate(); if (gate) return gate;
  return <div className="console-section-stack"><AdminPageHeader eyebrow="Company / system map" title="One system. Clear boundaries." description="The intended operating loop, with today's working surfaces and unfinished services shown separately." actions={<Link className="btn btn-ghost" href="/demo/all">Explore every demo →</Link>} />{groups.map(group => <section className="console-sheet" key={group.step}><div className="console-section-head"><div><p className="adm-kicker">Step {group.step}</p><h2>{group.title}</h2></div></div><p className="adm-description">{group.description}</p><div className="console-table-scroll" tabIndex={0} role="region" aria-label={group.title + " capabilities, scroll horizontally"}><table className="adm-table"><caption className="sr-only">{group.title} capabilities</caption><thead><tr><th scope="col">Area</th><th scope="col">Available now</th><th scope="col">Scope</th></tr></thead><tbody>{group.rows.map(row => <tr key={row.name}><th scope="row">{row.href ? <Link href={row.href}>{row.name} →</Link> : row.name}</th><td><AdminStatus tone="neutral">{row.state}</AdminStatus></td><td>{row.detail}</td></tr>)}</tbody></table></div></section>)}<section className="console-sheet"><p className="adm-kicker">Product & planning</p><h2>A deliberate division of work</h2><p className="adm-description">This console operates the product. The shared PRN vault holds the build plan, decisions, specifications and teammate work log; its separate control panel is a development workbench. Neither a planning entry nor a feature preview activates a customer service.</p><p className="console-footnote">Trust Network, Home Memory, SmartQuote, One Connected Home and the homeowner Dashboard remain represented in the demo collection with their own scope labels. Their previews are not evidence of completed provider, payment or dispatch integrations.</p></section></div>;
}
