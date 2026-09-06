import type { ReactNode } from "react";
import { RESULTS_CSS } from "@/components/results/results-css";

/**
 * The results page's frame — MOCKUP-2's `.wrap > .screen > .nav + .pad`, with
 * the scoped stylesheet inlined once. Shared by the results page and its two
 * sub-pages (/results/[id]/email and /results/[id]/send) so they read as the
 * same place.
 *
 * The nav's two words are the mockup's, verbatim ("Go Live" · "Your request").
 * Wording is frozen on that page, so they stay even though the site header
 * above says Property Response Network; that is on the list for Melissa.
 */
export function ResultsShell({ children }: { children: ReactNode }) {
  return (
    <main className="rp">
      <style dangerouslySetInnerHTML={{ __html: RESULTS_CSS }} />
      <div className="rp-wrap">
        <div className="screen">
          <div className="nav">
            <span className="logo">Go Live</span>
            <span>·</span>
            <span>Your request</span>
          </div>
          <div className="pad">{children}</div>
        </div>
      </div>
    </main>
  );
}
