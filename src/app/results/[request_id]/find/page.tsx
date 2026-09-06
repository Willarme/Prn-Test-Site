import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { flagEnabled } from "@/platform/flags";
import { runtimeStore } from "@/platform/stores/runtime";
import { ownerAllowed } from "@/platform/links/owner";

/**
 * /results/[request_id]/find — "Find someone for me" in a trial with no
 * providers on it yet: the honest route-out (merged spec §17.3; routine
 * decision 11). It says what she can do today with what she already holds,
 * and that the matched shortlist is still being built. Never a fake list.
 */
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Find someone for me",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FindPage({ params, searchParams }: { params: Promise<{ request_id: string }>; searchParams?: Promise<{ k?: string }> }) {
  if (!flagEnabled("intake_shell_enabled")) notFound();
  const { request_id } = await params;
  const k = (await searchParams)?.k;
  if (!(await ownerAllowed(request_id, k))) notFound();
  const query = k ? `?k=${encodeURIComponent(k)}` : "";
  const journey = await runtimeStore().getJourney(request_id);
  if (!journey) notFound();

  return (
    <main>
      <section className="section" style={{ paddingBottom: 36 }}>
        <div className="wrap-narrow" data-find-route-out>
          <div className="eyebrow">Find someone for me</div>
          <h1 className="d2">The matched shortlist is still being built for this trial.</h1>
          <p className="lede" style={{ margin: "14px 0 0" }}>
            When it is on, one suggested provider comes with the specific reasons behind the suggestion.
            Today, here is what your Job Packet already lets you do.
          </p>
        </div>
      </section>
      <section className="section section-light">
        <div className="wrap">
          <div className="grid3">
            <div className="cell">
              <span className="tag">Today · 1</span>
              <h2 className="d3">Open your Job Packet</h2>
              <p style={{ margin: "8px 0 14px" }}>
                Three pages a technician can read before coming out: your equipment, what you saw, what
                you checked, and what is still unknown.
              </p>
              <Link href={`/packet/${request_id}${query}`} className="btn btn-pink btn-sm">
                Open my Job Packet
              </Link>
            </div>
            <div className="cell">
              <span className="tag">Today · 2</span>
              <h2 className="d3">Ask your people</h2>
              <p style={{ margin: "8px 0 14px" }}>
                Someone you know has had an AC fixed. A small ask reaches them from your results page,
                with no signup on their side.
              </p>
              <Link href={`/results/${request_id}${query}`} className="btn btn-ghost btn-sm">
                Back to my results
              </Link>
            </div>
            <div className="cell">
              <span className="tag">Today · 3</span>
              <h2 className="d3">Use the call script</h2>
              <p style={{ margin: "8px 0 14px" }}>
                Page 1 of your packet has what to say on the phone, in your own facts, ending with the
                offer to send the photos and the packet ahead.
              </p>
              <Link href={`/packet/${request_id}${query}`} className="btn btn-ghost btn-sm">
                Read my call script
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
