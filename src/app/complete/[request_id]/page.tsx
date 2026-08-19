import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DetailsBox, type DetailsField } from "@/components/intake/DetailsBox";
import { DiagnoseWalkthrough } from "@/components/intake/DiagnoseWalkthrough";
import { nextFor } from "@/domain/intake/playbook";
import { flagEnabled } from "@/platform/flags";
import { loadJourneyContext } from "@/platform/intake/complete";
import { runtimeStore } from "@/platform/stores/runtime";

export const metadata: Metadata = {
  title: "Complete your Job Packet",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The two-box step after the first description (owner direction):
 *   Box 1 — details a technician needs, green-checked where we already have
 *           them, photo-first with typed fallback, never required.
 *   Box 2 — optional guided diagnosis, replayed statically from the playbook.
 * The packet is available the whole time; nothing here blocks it.
 */
export default async function CompletePage({ params }: { params: Promise<{ request_id: string }> }) {
  if (!flagEnabled("intake_shell_enabled")) notFound();
  const { request_id } = await params;
  const ctx = await loadJourneyContext(request_id);
  if (!ctx) notFound();
  const store = runtimeStore();
  const [answers, diagnosis] = await Promise.all([
    store.listIntakeAnswers(request_id),
    store.listDiagnosisAnswers(request_id),
  ]);

  const latest = new Map<string, { value: string | null; source: string }>();
  for (const a of answers) latest.set(a.field_key, { value: a.value_text, source: a.source });

  const fields: DetailsField[] = ctx.playbook.required_fields.map((f) => ({
    field_key: f.field_key,
    label: f.label,
    why_it_matters: f.why_it_matters,
    how_to_find: f.how_to_find,
    photo_prompt: f.photo_prompt,
    accepts: f.accepts,
    priority: f.priority,
    harvest_to_property_memory: f.harvest_to_property_memory,
    have: latest.get(f.field_key) ?? null,
  }));

  // Resume point for the walkthrough: replay answers through the same branch
  // rules the client uses.
  let currentStepId: string | null = ctx.playbook.first_step_id;
  let outcomeId: string | null = null;
  const byStep = new Map(diagnosis.map((d) => [d.step_id, d]));
  const seen = new Set<string>();
  while (currentStepId && !seen.has(currentStepId)) {
    seen.add(currentStepId);
    const step = ctx.playbook.diagnostic_steps.find((s) => s.step_id === currentStepId);
    const ans = step ? byStep.get(step.step_id) : undefined;
    if (!step || !ans) break;
    const b = nextFor(step, ans.answer ?? "any");
    if (!b) break;
    if (b.outcome_id) {
      outcomeId = b.outcome_id;
      currentStepId = null;
    } else {
      currentStepId = b.next_step_id;
    }
  }

  const haveCount = fields.filter((f) => f.have).length;

  return (
    <main>
      <section className="section" style={{ paddingBottom: 36 }}>
        <div className="wrap-narrow">
          <div className="eyebrow">{ctx.playbook.cluster_label}</div>
          <h1 className="d2">Good — your packet already exists.</h1>
          <p className="lede" style={{ margin: "14px 0 10px" }}>
            {ctx.playbook.intro}
          </p>
          <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
            {haveCount > 0
              ? `We already picked up ${haveCount} detail${haveCount === 1 ? "" : "s"} from what you wrote. `
              : ""}
            Add as much or as little as you like — then view your packet whenever you&apos;re ready.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
            <Link href={`/results/${request_id}`} className="btn btn-pink">
              View my Job Packet →
            </Link>
            <span className="hint" style={{ color: "var(--on-dark-faint)", alignSelf: "center" }}>
              It updates automatically as you add details below.
            </span>
          </div>
        </div>
      </section>

      <section className="section section-light" style={{ paddingTop: 48 }}>
        <div className="wrap">
          <div className="grid2" style={{ background: "transparent", border: "none", gap: 22 }}>
            <div>
              <DetailsBox requestId={request_id} fields={fields} />
            </div>
            <div>
              <div style={{ marginBottom: 10 }}>
                <span className="pill pill-green">Optional</span>{" "}
                <strong>Walk through it with me (if you want)</strong>
                <p className="hint" style={{ marginTop: 4 }}>
                  Short steps that eliminate causes one at a time. Sometimes it ends in a fix you
                  can do yourself; always it makes the packet — and any quote — sharper.
                </p>
              </div>
              {ctx.playbook.first_step_id ? (
                <DiagnoseWalkthrough
                  requestId={request_id}
                  steps={ctx.playbook.diagnostic_steps}
                  outcomes={ctx.playbook.outcomes}
                  firstStepId={ctx.playbook.first_step_id}
                  resume={{ currentStepId, outcomeId, answered: diagnosis.length }}
                />
              ) : (
                <div className="card-light">
                  <p>
                    We don&apos;t have a guided walkthrough for this problem type yet. The details on
                    the left are what matter most — and your packet is ready now.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
