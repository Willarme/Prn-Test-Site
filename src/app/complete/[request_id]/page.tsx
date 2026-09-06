import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { DetailsBox, type DetailsField } from "@/components/intake/DetailsBox";
import { DiagnoseWalkthrough } from "@/components/intake/DiagnoseWalkthrough";
import { AttachmentRecovery } from "@/components/intake/AttachmentRecovery";
import { acknowledgementLine, trialScope, type HeldFact } from "@/domain/intake/extract";
import { projectWalkthroughView, resolveWalkthroughPosition } from "@/domain/intake/playbook";
import { flagEnabled } from "@/platform/flags";
import { loadJourneyContext } from "@/platform/intake/complete";
import { loadQuestionPlan, orderedDetailFields } from "@/platform/intake/question-plan";
import { runtimeStore } from "@/platform/stores/runtime";
import { ownerAllowed } from "@/platform/links/owner";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { heldFieldConflicts } from "@/domain/intake/field-conflicts";

export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Complete your Job Packet",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Field keys the acknowledgement may name (the facts a first sentence can carry). */
const ACK_KEYS = new Set(["brand", "unit_model_serial", "system_age", "symptom_timing", "fixture_or_appliance", "affected_scope"]);

/**
 * The two-box step after the first description (owner direction):
 *   Box 1 — details a technician needs, green-checked where we already have
 *           them, photo-first with typed fallback, never required.
 *   Box 2 — optional guided diagnosis, replayed statically from the playbook.
 * The packet is available the whole time; nothing here blocks it.
 *
 * Campaign track P4 (2026-09-05):
 *   - the acknowledgement line (merged spec §10.3, BINDING): the facts already
 *     held from the first sentence and A01's classification, in fact form —
 *     "Got it — Carrier, about 8 years old, started Tuesday." It is the only
 *     visible proof that a skipped question was comprehension.
 *   - the route-out (merged spec §17.3): a classification outside the trial's
 *     one trade gets a plain screen that says so and points somewhere, with
 *     the packet still reachable. No thermostat question for a garage door.
 */
export default async function CompletePage({ params, searchParams }: { params: Promise<{ request_id: string }>; searchParams?: Promise<{ uploads?: string; k?: string }> }) {
  if (!flagEnabled("intake_shell_enabled")) notFound();
  const { request_id } = await params;
  const query = await searchParams;
  const uploadWarning = query?.uploads === "partial";
  const k = query?.k;
  if (!(await ownerAllowed(request_id, k))) notFound();
  const ownerQuery = k ? `?k=${encodeURIComponent(k)}` : "";
  const ctx = await loadJourneyContext(request_id);
  if (!ctx) notFound();
  const safety = journeySafetyRule(ctx.journey.problem);
  if (safety && !safety.intake_may_continue) redirect(`/safety/${encodeURIComponent(safety.safety_rule_id)}`);
  const voiceReceipt = ctx.allEvidence.some(e => e.kind === "voice_note")
    ? <p role="status" className="hint" data-voice-receipt>Voice note received, not transcribed.</p>
    : null;
  const store = runtimeStore();
  const [answers, diagnosis, claims] = await Promise.all([
    store.listIntakeAnswers(request_id),
    store.listDiagnosisAnswers(request_id),
    store.listClaims(ctx.journey.problem.problem_id).catch(() => []),
  ]);

  const latest = new Map<string, NonNullable<DetailsField["have"]>>();
  for (const a of answers) {
    const previous = latest.get(a.field_key);
    latest.set(a.field_key, { value: a.value_text, source: a.source,
      confirmed_from_photo: a.source === "confirmed" && previous?.value === a.value_text &&
        (previous?.source === "photo" || previous?.confirmed_from_photo === true) });
  }
  const conflicts = heldFieldConflicts(answers, ctx.allEvidence, ctx.playbook.required_fields);

  // What we already hold, for the acknowledgement: what her own words gave us
  // (auto-detected answers), then A01's supplied claims for any field the
  // answers do not already cover. Nothing typed later belongs in "Got it".
  const held: HeldFact[] = [];
  for (const a of answers) {
    if (a.source === "auto_detected" && a.value_text && ACK_KEYS.has(a.field_key) &&
        latest.get(a.field_key)?.value === a.value_text && !conflicts.some(c => c.field_key === a.field_key)) {
      held.push({ field_key: a.field_key, value_text: a.value_text });
    }
  }
  for (const c of claims) {
    if (c.provenance === "supplied" && ACK_KEYS.has(c.predicate) && !latest.has(c.predicate) && !held.some((h) => h.field_key === c.predicate)) {
      held.push({ field_key: c.predicate, value_text: c.object });
    }
  }
  const acknowledgement = acknowledgementLine(held);

  const scope = trialScope(ctx.journey.problem, ctx.playbook);
  if (!scope.in_scope) {
    return (
      <main>
        <section className="section" style={{ paddingBottom: 36 }}>
          <div className="wrap-narrow" data-route-out>
            {uploadWarning && <AttachmentRecovery requestId={request_id} ownerKey={k} />}
            {voiceReceipt}
            <div className="eyebrow">Outside this trial</div>
            <h1 className="d2">We cannot help with this one yet.</h1>
            <p className="lede" style={{ margin: "14px 0 10px" }}>
              This trial covers one problem in one place: an AC that runs but blows warm air, in Allen
              County, Indiana. What you typed is kept, and your Job Packet holds it.
            </p>
            <h2 className="d3" style={{ margin: "22px 0 8px" }}>Where to go</h2>
            <ul style={{ paddingLeft: 20, margin: "0 0 18px", color: "var(--on-dark-mute)" }}>
              <li>
                {scope.search_term
                  ? `Try a search for "${scope.search_term}".`
                  : "Try a search for the thing itself plus \"repair near me\"."}
              </li>
              <li>If gas, water or power is involved, your utility&apos;s emergency line is on your bill.</li>
              <li>If anyone is in danger, call 911.</li>
            </ul>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href={`/results/${request_id}${ownerQuery}`} className="btn btn-pink">
                View my Job Packet →
              </Link>
              <Link href="/what-this-tool-can-help-with" className="btn btn-ghost">
                What this tool can help with
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const questionPlan = loadQuestionPlan(request_id, ctx.playbook);
  const fields: DetailsField[] = orderedDetailFields(ctx.playbook, answers, questionPlan).map((f) => ({
    field_key: f.field_key,
    label: f.label,
    why_it_matters: f.why_it_matters,
    how_to_find: f.how_to_find,
    photo_prompt: f.photo_prompt,
    accepts: f.accepts,
    priority: f.priority,
    harvest_to_property_memory: f.harvest_to_property_memory,
    have: latest.get(f.field_key) ?? null,
    conflict: (() => {
      const conflict = conflicts.find(c => c.field_key === f.field_key);
      return conflict ? { held_value: conflict.held_value, reported_values: conflict.reported_values } : undefined;
    })(),
  }));

  // Resume point for the walkthrough: replay answers through the same branch
  // rules the client uses. This is the SAME authority the answer/media
  // routes use to reject a step_id the customer hasn't actually reached.
  const { currentStepId, outcomeId } = resolveWalkthroughPosition(ctx.playbook, diagnosis);

  return (
    <main>
      <section className="section" style={{ paddingBottom: 36 }}>
        <div className="wrap-narrow">
          <div className="eyebrow">{ctx.playbook.cluster_label}</div>
          {uploadWarning && <AttachmentRecovery requestId={request_id} ownerKey={k} />}
          {voiceReceipt}
          {acknowledgement && (
            <p className="lede" data-acknowledgement style={{ margin: "0 0 12px", color: "var(--on-dark)" }}>
              {acknowledgement}
            </p>
          )}
          <h1 className="d2">Good — your packet already exists.</h1>
          <p className="lede" style={{ margin: "14px 0 10px" }}>
            {ctx.playbook.intro}
          </p>
          <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
            Add as much or as little as you like — then view your packet whenever you&apos;re ready.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
            <Link href={`/results/${request_id}${ownerQuery}`} className="btn btn-pink">
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
              <DetailsBox
                requestId={request_id}
                ownerKey={k}
                fields={fields}
                address={ctx.address}
                labelConfidence={ctx.labelConfidence}
              />
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
                  ownerKey={k}
                  initialView={projectWalkthroughView(ctx.playbook, currentStepId, outcomeId)}
                  resumed={diagnosis.length > 0}
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
