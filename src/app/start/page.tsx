import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StartRequestForm } from "@/components/intake/StartRequestForm";
import { ROUTES } from "@/domain/intake/contracts";
import { flagEnabled } from "@/platform/flags";

export const metadata: Metadata = { title: "Start with what happened" };

export default function StartPage() {
  if (!flagEnabled("intake_shell_enabled")) notFound();
  return (
    <main className="section section-light">
      <div className="wrap-narrow">
        <div className="eyebrow">Start a request</div>
        <h1 className="d2">Start with what happened.</h1>
        <p className="lede" style={{ margin: "16px 0 30px" }}>
          Plain words are enough. We&apos;ll organize what you tell us into a Job Packet a
          provider can actually use.
        </p>
        <StartRequestForm
          attribution={{
            page_id: null,
            intent_cluster_id: null,
            search_opportunity_id: null,
            problem_family_hint: null,
            landing_path: ROUTES.start,
          }}
        />
      </div>
    </main>
  );
}
