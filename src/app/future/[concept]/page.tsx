import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FEATURE_CONCEPTS, findConcept } from "@/domain/feature-lab/concepts";
import { ConceptInterest } from "@/components/results/PacketActions";
import { flagEnabled } from "@/platform/flags";

export function generateStaticParams() {
  return FEATURE_CONCEPTS.map((c) => ({ concept: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ concept: string }>;
}): Promise<Metadata> {
  const { concept } = await params;
  const found = findConcept(concept);
  return { title: found ? `${found.name} (concept)` : "Not found" };
}

export default async function ConceptPage({
  params,
}: {
  params: Promise<{ concept: string }>;
}) {
  if (!flagEnabled("feature_lab_enabled")) notFound();
  const { concept } = await params;
  const found = findConcept(concept);
  if (!found) notFound();
  return (
    <main>
      <section className="section" style={{ paddingBottom: 48 }}>
        <div className="wrap-narrow">
          <div className="eyebrow">{found.name} · concept preview</div>
          <h1 className="d2">{found.headline}</h1>
          <p className="lede" style={{ marginTop: 16 }}>
            {found.pitch}
          </p>
        </div>
      </section>
      <section className="section section-light">
        <div className="wrap-narrow prose">
          <h2>What it will do</h2>
          <ul>
            {found.what_it_will_do.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <div className="safety-note">
            <p style={{ marginBottom: 0 }}>{found.honest_status}</p>
          </div>
          <h2>Would you use this?</h2>
          <ConceptInterest concept={found.slug} landingPath={`/future/${found.slug}`} />
        </div>
      </section>
    </main>
  );
}
