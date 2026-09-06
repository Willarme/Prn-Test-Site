import type { Metadata } from "next";
import Link from "next/link";
import { demoSamplesEnabled } from "@/domain/demo/mode";
import styles from "../demo.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Full demo directory", robots: { index: false, follow: false } };

type Destination = { name: string; detail: string; href?: string; intent?: "results" | "guided"; status: string };
const groups: { title: string; detail: string; entries: Destination[] }[] = [
  { title: "01 / The homeowner journey", detail: "Run the full AC flow or open a fresh sample. A sample creates its own private demonstration record, with access kept in this browser.", entries: [
    { name: "AC Problem Page · LIVE v43", detail: "The complete 15-section guide with its connected intake, observations and equipment diagrams.", href: "/ac-blowing-warm-air", status: "Working guide + intake" },
    { name: "Guided AC walkthrough", detail: "Start a synthetic example partway into the process, then answer the guided checks yourself.", intent: "guided", status: "Working flow · synthetic example" },
    { name: "Results, Job Packet and PDF", detail: "A prepared sample result. From there, open the actual packet, download the PDF, keep it, add details or try its share controls.", intent: "results", status: "Working flow · synthetic example" },
    { name: "General problem intake", detail: "Describe a different example. The dedicated guided demo is AC; other problems have a more limited path.", href: "/start", status: "Working intake" },
  ] },
  { title: "02 / The connected product previews", detail: "Explore the approved product concepts. Feedback saves demo responses; illustrated schedules, quotes, verification and product records are examples.", entries: [
    { name: "One Connected Home", detail: "The overview connecting the homeowner products.", href: "/pages/overview", status: "Interactive concept" },
    { name: "Dashboard", detail: "The place for the homeowner to return and see what is happening.", href: "/pages/dashboard", status: "Interactive concept" },
    { name: "Trust Network", detail: "How people and recommendations could connect around a home problem.", href: "/pages/trust-network", status: "Interactive concept" },
    { name: "Home Memory", detail: "The developing record of equipment, work and the home itself.", href: "/pages/home-memory", status: "Interactive concept" },
    { name: "SmartQuote", detail: "The quote-comparison experience and its example analysis.", href: "/pages/smartquote", status: "Interactive concept" },
    { name: "Provider OS", detail: "A preview of the provider side of the process.", href: "/pages/provider-os", status: "Interactive concept" },
  ] },
  { title: "03 / Supporting pages", detail: "The navigation and explanation around the main journey.", entries: [
    { name: "Home", detail: "The original trial home page and intake entrance.", href: "/", status: "Working navigation" },
    { name: "Cooling problems", detail: "The cooling guide index.", href: "/cooling/", status: "Working navigation" },
    { name: "What this tool can help with", detail: "An explanation of the tool’s current scope.", href: "/what-this-tool-can-help-with/", status: "Information" },
    { name: "How our numbers work", detail: "The methodology and source boundaries behind local information.", href: "/local-records/methodology", status: "Information" },
    { name: "No hot water", detail: "Another problem entrance. Its copy identifies the narrower scope of this trial.", href: "/no-hot-water", status: "General intake entrance" },
    { name: "Terms", detail: "The current terms page.", href: "/terms", status: "Information" },
    { name: "Privacy", detail: "The current privacy notice.", href: "/privacy", status: "Information" },
  ] },
  { title: "04 / Earlier feature-lab explorations", detail: "Smaller earlier concepts retained for comparison. These are separate from the six current product previews above.", entries: [
    { name: "DIY Packet", detail: "An earlier take on the DIY support concept.", href: "/future/diy-packet", status: "Earlier concept" },
    { name: "SmartQuote lab", detail: "The earlier quote concept and feedback surface.", href: "/future/smartquote", status: "Earlier concept" },
    { name: "Provider tracking", detail: "An earlier provider-progress concept.", href: "/future/provider-tracking", status: "Earlier concept" },
    { name: "Property dashboard lab", detail: "The earlier home dashboard concept.", href: "/future/property-dashboard", status: "Earlier concept" },
  ] },
];

export default function DemoDirectory() {
  const localSample = demoSamplesEnabled();
  const clientDemo = process.env.PRN_CLIENT_DEMO === "1" || !localSample;
  const visibleGroups = localSample ? groups : groups.map((group, index) => ({
    ...group,
    detail: index === 0 ? "Open the prepared example with its results, guided checks and real sample PDF. No customer record or account is created." : index === 1 ? "Explore the approved product concepts. Illustrated schedules, quotes, verification and product records are examples; these services are not activated in the presentation." : group.detail,
    entries: group.entries.map(entry => entry.intent ? {
      ...entry,
      detail: entry.intent === "guided" ? "Follow the optional AC check logic using a fixed synthetic scenario. Your choices stay in the sample walkthrough." : "The actual results and packet presentation for an invented home, with a real prepared PDF and labelled keep, share and email previews.",
      status: "Prepared interactive sample",
    } : entry.href === "/ac-blowing-warm-air" ? { ...entry, detail: "Explore the complete 15-section guide and equipment diagrams. Use the prepared walkthrough below for this presentation.", status: "Guide preview" } : entry.href === "/start" || entry.href === "/no-hot-water" ? { ...entry, detail: "Preview the intake entrance. Custom requests are not enabled in this presentation; use the prepared AC sample above.", status: "Intake preview" } : entry),
  }));
  return <main className={`${styles.demo} ${styles.catalog}`}>
    <div className={styles.catalogHead}><p className={styles.kicker}>Property Response Network / Demo directory</p><Link href="/demo">← Demo entrance</Link></div>
    <h1>Every demo, in one place.</h1>
    <p className={styles.catalogIntro}>Use this for your own walkthrough or to jump to a particular part of the experience. Use example details throughout. No provider is contacted, no appointment is booked and email actions stay in preview.</p>
    {visibleGroups.map(group => <section key={group.title} className={styles.catalogSection}>
      <h2>{group.title}</h2><p>{group.detail}</p>
      <div className={styles.routeList}>{group.entries.map(entry => <article className={styles.routeRow} key={entry.name}>
        <div><h3>{entry.name}</h3><small>{entry.status}</small></div><p>{entry.detail}</p>
        {entry.href ? <Link href={entry.href}>Open <span aria-hidden>↗</span></Link> : <form action="/demo/start" method="post"><input type="hidden" name="intent" value={entry.intent} /><button type="submit">Open sample <span aria-hidden>→</span></button></form>}
      </article>)}</div>
    </section>)}
    <aside className={styles.localOnly}><h2>Keep, share, add details and email preview</h2><p>{localSample ? "These belong to a specific request. Open a sample result above to reach them with the right permissions. Each sample has its own real packet; there are no shared customer records or fixed private links in this directory." : "Open the prepared result above to explore these next steps. The sample uses invented details and generic demonstration links; it does not save a real home record or send an email."}</p></aside>
    {!clientDemo && <aside className={styles.localOnly}><h2>Joshua and Missy · local operator tools</h2><p>The working operator controls are separate from the client tour. Publishing, AI policy and internal QA stay behind the existing admin access controls. A live AI writer result can still be rejected by QA; generated pages are not automatically released.</p><Link href="/admin">Operator dashboard ↗</Link><Link href="/admin/controls">Page-creator controls ↗</Link><Link href="/admin/requests">Request register ↗</Link><Link href="/admin/system">AI and system controls ↗</Link><Link href="/admin/agents">Agent registry ↗</Link><Link href="/admin/pages">SEO pages and QA ↗</Link><Link href="/admin/opportunities">Search opportunities ↗</Link><Link href="/admin/approvals">Data repair approvals ↗</Link></aside>}
  </main>;
}
