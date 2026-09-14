import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { featureIsLive, readFeatureSnapshot } from "@/platform/features/state";
import { loadIssueLibrary } from "@/platform/search/issue-library";
import { rootIntakeEnabled } from "@/components/intake/NativeIntakeForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Issue Library", robots: { index: false, follow: false } };

/** Source candidate only: issue_library stays HIDDEN until governed activation. */
export default async function ProblemsPage() {
  const snapshot = await readFeatureSnapshot({ fresh: true });
  if (!featureIsLive(snapshot, "issue_library")) notFound();
  const library = await loadIssueLibrary(snapshot);
  return <main>
    <section className="section"><div className="wrap-narrow">
      <nav aria-label="Breadcrumb"><Link href="/">Home</Link> / <span aria-current="page">Problems</span></nav>
      <h1 className="d1">Issue Library</h1>
      <p className="lede">Browse available problem pages by family.</p>
    </div></section>
    <section className="section section-light"><div className="wrap-narrow">
      {library.families.length ? library.families.map(family => <section className="card-light" key={family.id}>
        <h2 className="d3"><Link href={family.path}>{family.label}</Link></h2>
        <ul>{family.doors.map(door => <li key={door.id}><Link href={door.path}>{door.label}</Link></li>)}</ul>
      </section>) : <p>No problem pages are listed right now.</p>}
      {rootIntakeEnabled(snapshot) && <p><Link href="/#intake">Describe another problem</Link></p>}
    </div></section>
  </main>;
}
