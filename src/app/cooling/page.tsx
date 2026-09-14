import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { featureIsLive, readFeatureSnapshot } from "@/platform/features/state";
import { loadIssueLibrary } from "@/platform/search/issue-library";
import { rootIntakeEnabled } from "@/components/intake/NativeIntakeForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cooling",
  robots: { index: false, follow: false },
};

export default async function CoolingPage() {
  const snapshot = await readFeatureSnapshot({ fresh: true });
  if (!featureIsLive(snapshot, "door_pages")) notFound();
  const library = await loadIssueLibrary(snapshot);
  const family = library.families.find(row => row.id === "cooling");
  return <main>
    <section className="section"><div className="wrap-narrow">
      <nav aria-label="Breadcrumb"><Link href="/">Home</Link> / <span aria-current="page">Cooling</span></nav>
      <h1 className="d1">Cooling problems</h1>
      <p className="lede">Browse available cooling problem pages.</p>
    </div></section>
    <section className="section section-light"><div className="wrap-narrow">
      {family ? <ul className="card-light">{family.doors.map(door => <li key={door.id}><Link href={door.path}>{door.label}</Link></li>)}</ul>
        : <p>No cooling problem pages are listed right now.</p>}
      {featureIsLive(snapshot, "issue_library") && <p><Link href="/problems">Issue Library</Link></p>}
      {rootIntakeEnabled(snapshot) && <p><Link href="/#intake">Describe another problem</Link></p>}
    </div></section>
  </main>;
}
