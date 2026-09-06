import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SAFETY_RULES } from "@/domain/problem/safety";

/**
 * THE HAZARD HALT SCREEN.
 *
 * Where the door adapter sends someone whose own words tripped a halt-class
 * SafetyRule. It renders the rule's `approved_response` and NOTHING ELSE that
 * could be mistaken for advice: the copy is fixed, human-written text from the
 * safety package, never model-generated and never assembled here (#14A §14).
 * This page looks a rule up by id and prints it.
 *
 * A halt creates no ProblemRecord and no packet — only the safety event — so
 * this page has no request id, nothing to resume, and says so by not offering
 * it. The second paragraph tells them what actually happens next, which is that
 * they come back and type it again. Claiming their text was kept would be
 * false on this path: the door page is plain HTML with no draft storage, and
 * the server deliberately stored nothing.
 */
export const metadata: Metadata = {
  title: "Safety first",
};

export default async function SafetyRulePage({
  params,
}: {
  params: Promise<{ rule_id: string }>;
}) {
  const { rule_id } = await params;
  const rule = SAFETY_RULES.find((r) => r.safety_rule_id === rule_id);
  if (!rule) notFound();

  return (
    <main className="section section-light">
      <div className="wrap-narrow">
        <p className="eyebrow">{rule.label}</p>
        <h1 className="display">Safety first</h1>
        <div className="safety-note" role="alert">
          <p>{rule.approved_response}</p>
        </div>
        <p className="prose">
          Come back when everyone is safe and tell us what happened. Typing it again takes a
          minute, and we start from your words.
        </p>
        <p>
          <Link className="btn btn-pink" href="/start">
            Start with what happened
          </Link>
        </p>
      </div>
    </main>
  );
}
