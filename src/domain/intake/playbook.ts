import { z } from "zod";
import { Id, IsoDateTime, SchemaVersion } from "@/domain/shared/primitives";

/**
 * IntakePlaybook — the "generate once, replay forever" object behind the
 * post-description intake (owner direction, 2026-08-19; #23 §2.4 "research a
 * stable fact once, reuse it").
 *
 * One playbook per problem family / intent cluster holds:
 *   1. every field a technician would want BEFORE arriving (model, serial,
 *      age, symptoms…), each with how to find it, a photo prompt, and whether
 *      it should be harvested into the customer's property memory;
 *   2. the full guided-diagnosis walkthrough as a static branching script
 *      (elimination steps, what to look for, how to answer, outcomes with an
 *      honest decision frame).
 *
 * The playbook is produced ONCE (content bank now; model-written later behind
 * the same contract), cached in the database, and rendered step by step with
 * zero per-customer AI calls. Per-customer AI is reserved for reading photos
 * (later) and the packet narrative.
 */
export const FieldAccepts = z.enum(["photo", "text"]);

/**
 * THE SIX CANON `value_reason` TAGS — the A01 canon extract's Build sequence
 * step 4 as a closed enum (A01 spec §4 `ClarifyingQuestion.value_reason`):
 * ask only if the answer can change safety, the packet, DIY viability,
 * provider type, tools/parts needed, or the next step.
 *
 * RULED, twice, so this does not get re-litigated:
 *   - Josh, 2026-08-28 (A01/A02 approval record, condition 3): canon's six
 *     stand; 08_INTAKE_PACKET.md's eight-category clarifier rule is superseded
 *     on this point. *Urgency* was considered and deliberately NOT added — it
 *     is covered by "safety" and "next_step".
 *   - crew, 2026-08-30: the canon extract's six-category enum IS the contract;
 *     08_INTAKE_PACKET.md's differently-worded rule becomes guidance prose
 *     mapped onto these six tags.
 *
 * The enum is the machine-checkable half; `why_it_matters` below stays as the
 * human-readable half — the tag never replaces the prose the homeowner reads.
 */
export const ValueReason = z.enum([
  "safety",
  "packet",
  "diy_viability",
  "provider_type",
  "tools_parts",
  "next_step",
]);
export type ValueReason = z.infer<typeof ValueReason>;

export const FieldRequirement = z.object({
  field_key: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().min(1),
  why_it_matters: z.string().min(1),
  /**
   * WHY THIS QUESTION MAY BE ASKED AT ALL — one of the six canon categories.
   * A question that cannot honestly claim one of these has no business being
   * asked (canon clarifier rule), and a question without a valid tag is
   * rejected right here when the playbook is parsed.
   */
  value_reason: ValueReason,
  /** Plain-language instructions for finding it. */
  how_to_find: z.string().min(1),
  /** What to photograph, when a photo satisfies the field. */
  photo_prompt: z.string().nullable(),
  accepts: z.array(FieldAccepts).min(1),
  /** Required for a strong packet vs. nice-to-have. Nothing is ever forced. */
  priority: z.enum(["core", "helpful"]),
  /** Keep with the home (equipment inventory) when Customer Lite/Property Memory lands. */
  harvest_to_property_memory: z.boolean(),
  /** Regex sources (JS syntax) that auto-detect the field from the customer's own words. */
  auto_detect_patterns: z.array(z.string()),
  /** Voluntary detail groups never enter the capped automatic clarifier plan. */
  optional_group: z.enum(["context", "history", "access"]).optional(),
  choices: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).min(2).optional(),
});
export type FieldRequirement = z.infer<typeof FieldRequirement>;

export const StepInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("photo") }),
  z.object({ kind: z.literal("yes_no") }),
  z.object({
    kind: z.literal("rating"),
    min_label: z.string().min(1),
    max_label: z.string().min(1),
  }),
  z.object({ kind: z.literal("choice"), options: z.array(z.string().min(1)).min(2) }),
  z.object({ kind: z.literal("text") }),
]);
export type StepInput = z.infer<typeof StepInput>;

/** Where an answer leads. Exactly one of next_step_id / outcome_id. */
export const Branch = z.object({
  /** "yes" | "no" | option text | "rating:>=6" | "rating:<6" | "any" */
  when: z.string().min(1),
  next_step_id: z.string().nullable(),
  outcome_id: z.string().nullable(),
});
export type Branch = z.infer<typeof Branch>;

export const DiagnosticStep = z.object({
  step_id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1),
  /** What to do, in one or two friendly sentences. */
  instruction: z.string().min(1),
  /** What a picture of the right thing would show (stands in for the image asset). */
  look_for: z.string().min(1),
  /** Safety line shown before the step, when relevant. */
  safety_note: z.string().nullable(),
  input: StepInput,
  branches: z.array(Branch).min(1),
  /** Which required field(s) this step also satisfies (e.g. a photo of the unit captures the label). */
  satisfies_fields: z.array(z.string()),
});
export type DiagnosticStep = z.infer<typeof DiagnosticStep>;

export const Outcome = z.object({
  outcome_id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1),
  /** What the elimination points to — always phrased as likely, never certain. */
  likely_cause: z.string().min(1),
  diy_possible: z.boolean(),
  /** Safe steps a homeowner can take, if any. */
  diy_steps: z.array(z.string()),
  /** The honest decision frame (no invented prices — OD-13). */
  decision_frame: z.array(z.string()),
  /** What to tell a provider. */
  provider_note: z.string().min(1),
});
export type Outcome = z.infer<typeof Outcome>;

export const IntakePlaybook = z.object({
  playbook_id: Id,
  schema_version: SchemaVersion,
  version: z.number().int().positive(),
  problem_family: z.string().min(1),
  /** Human label for the intent cluster this covers, e.g. "AC runs but doesn't cool". */
  cluster_label: z.string().min(1),
  /** Keyword patterns that route a description to this playbook (JS regex source). */
  match_patterns: z.array(z.string()),
  intro: z.string().min(1),
  required_fields: z.array(FieldRequirement).min(1),
  diagnostic_steps: z.array(DiagnosticStep),
  outcomes: z.array(Outcome),
  first_step_id: z.string().nullable(),
  generated_by: z.string().min(1),
  created_at: IsoDateTime,
});
export type IntakePlaybook = z.infer<typeof IntakePlaybook>;

/** A customer's answer to a required field. */
export const IntakeAnswer = z.object({
  request_id: Id,
  field_key: z.string().min(1),
  value_text: z.string().nullable(),
  evidence_id: Id.nullable(),
  /**
   * "confirmed" (campaign track P4, 2026-09-05): a photo-read value the
   * homeowner tapped Yes on. Coverage Standard §4.3 — a confirm UPGRADES the
   * claim ("read from label · confirmed by homeowner"), so it is its own
   * provenance and never collapses into "typed". Supabase's intake_details
   * CHECK (migration 00005) still lists three values; a migration is owed
   * before that path stores a confirmation.
   */
  source: z.enum(["auto_detected", "typed", "photo", "confirmed"]),
  answered_at: IsoDateTime,
});
export type IntakeAnswer = z.infer<typeof IntakeAnswer>;

/** A customer's answer to a diagnostic step. */
export const DiagnosisAnswer = z.object({
  request_id: Id,
  step_id: z.string().min(1),
  answer: z.string().nullable(),
  evidence_id: Id.nullable(),
  answered_at: IsoDateTime,
});
export type DiagnosisAnswer = z.infer<typeof DiagnosisAnswer>;

/** Validate that every branch target exists and the walkthrough cannot dead-end. */
export function validatePlaybookGraph(pb: IntakePlaybook): string[] {
  const problems: string[] = [];
  const steps = new Set(pb.diagnostic_steps.map((s) => s.step_id));
  const outcomes = new Set(pb.outcomes.map((o) => o.outcome_id));
  if (pb.first_step_id && !steps.has(pb.first_step_id)) {
    problems.push(`first_step_id ${pb.first_step_id} not found`);
  }
  for (const step of pb.diagnostic_steps) {
    for (const b of step.branches) {
      if ((b.next_step_id === null) === (b.outcome_id === null)) {
        problems.push(`${step.step_id}: branch "${b.when}" must name exactly one of next_step_id/outcome_id`);
      }
      if (b.next_step_id && !steps.has(b.next_step_id)) {
        problems.push(`${step.step_id}: unknown next_step_id ${b.next_step_id}`);
      }
      if (b.outcome_id && !outcomes.has(b.outcome_id)) {
        problems.push(`${step.step_id}: unknown outcome_id ${b.outcome_id}`);
      }
    }
    for (const f of step.satisfies_fields) {
      if (!pb.required_fields.some((r) => r.field_key === f)) {
        problems.push(`${step.step_id}: satisfies unknown field ${f}`);
      }
    }
  }
  return problems;
}

/** Resolve which branch an answer takes. */
export function nextFor(step: DiagnosticStep, answer: string): Branch | null {
  const normalized = answer.trim().toLowerCase();
  for (const b of step.branches) {
    const when = b.when.toLowerCase();
    if (when === "any") return b;
    if (when === normalized) return b;
    const m = /^rating:(>=|<)(\d+)$/.exec(when);
    if (m && step.input.kind === "rating") {
      const n = Number(normalized);
      if (Number.isFinite(n)) {
        if (m[1] === ">=" && n >= Number(m[2])) return b;
        if (m[1] === "<" && n < Number(m[2])) return b;
      }
    }
  }
  return step.branches.find((b) => b.when.toLowerCase() === "any") ?? null;
}

/**
 * T1-15 — the browser/server boundary for the guided-diagnosis walkthrough.
 *
 * The full playbook graph (`diagnostic_steps`, `outcomes`, and every
 * `branches` array) stays server-side, always. `StepView` is exactly what a
 * browser needs to RENDER the current step — never `branches`, never
 * `satisfies_fields`, never another step's text. `WalkthroughView` is either
 * the current step or the reached outcome, never both, and never anything
 * from a step/outcome the customer has not reached.
 */
export const StepView = z.object({
  step_id: z.string(),
  title: z.string(),
  instruction: z.string(),
  look_for: z.string(),
  safety_note: z.string().nullable(),
  input: StepInput,
  /** 1-based position, e.g. "Step 2 of 5" — a count, not graph content. */
  step_number: z.number().int().positive(),
  total_steps: z.number().int().positive(),
});
export type StepView = z.infer<typeof StepView>;

export const WalkthroughView = z.object({
  step: StepView.nullable(),
  outcome: Outcome.nullable(),
});
export type WalkthroughView = z.infer<typeof WalkthroughView>;

/**
 * Project the ONE thing the browser needs right now out of a resolved
 * position in the graph (a step id, an outcome id, or neither for a playbook
 * with no walkthrough at all — e.g. GENERIC, whose `first_step_id` is null).
 * Every caller — the page's first render, the answer route, the media
 * route, and the "start over" reset — goes through this single projection,
 * so the boundary this item exists to enforce cannot drift between them.
 */
export function projectWalkthroughView(
  pb: IntakePlaybook,
  currentStepId: string | null,
  outcomeId: string | null
): WalkthroughView {
  if (outcomeId) {
    const outcome = pb.outcomes.find((o) => o.outcome_id === outcomeId) ?? null;
    return { step: null, outcome };
  }
  if (currentStepId) {
    const idx = pb.diagnostic_steps.findIndex((s) => s.step_id === currentStepId);
    if (idx < 0) return { step: null, outcome: null };
    const step = pb.diagnostic_steps[idx];
    return {
      step: {
        step_id: step.step_id,
        title: step.title,
        instruction: step.instruction,
        look_for: step.look_for,
        safety_note: step.safety_note,
        input: step.input,
        step_number: idx + 1,
        total_steps: pb.diagnostic_steps.length,
      },
      outcome: null,
    };
  }
  return { step: null, outcome: null };
}

/**
 * Resolve one customer answer to a step and project the resulting view, in
 * one call — the server-side counterpart of what the browser used to do
 * itself with its own (drifted) copy of the branch rules. Returns null only
 * when `stepId` does not name a real step in this playbook.
 */
export function advanceWalkthrough(pb: IntakePlaybook, stepId: string, answer: string): WalkthroughView | null {
  const step = pb.diagnostic_steps.find((s) => s.step_id === stepId);
  if (!step) return null;
  const branch = nextFor(step, answer);
  if (!branch) return { step: null, outcome: null };
  return projectWalkthroughView(pb, branch.next_step_id, branch.outcome_id);
}

/**
 * Replay a customer's SAVED diagnosis answers from `first_step_id` through
 * `nextFor` to find where they legitimately stand right now. This is the
 * one authority for "what step is this customer actually on" — the page's
 * first render uses it to pick what to show, and every mutating route
 * (answer, media) uses it to REJECT a step_id that isn't the customer's
 * current position, so a client can no longer request an arbitrary step or
 * outcome by guessing/enumerating ids (T1-15 follow-up: the passive
 * whole-graph leak was closed, but an early version of this fix left an
 * active one — any step_id named in the schema resolved and returned its
 * view, regardless of whether the customer had actually reached it).
 */
export function resolveWalkthroughPosition(
  pb: IntakePlaybook,
  diagnosisAnswers: readonly DiagnosisAnswer[]
): { currentStepId: string | null; outcomeId: string | null } {
  let currentStepId: string | null = pb.first_step_id;
  let outcomeId: string | null = null;
  const byStep = new Map(diagnosisAnswers.map((d) => [d.step_id, d]));
  const seen = new Set<string>();
  while (currentStepId && !seen.has(currentStepId)) {
    seen.add(currentStepId);
    const step = pb.diagnostic_steps.find((s) => s.step_id === currentStepId);
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
  return { currentStepId, outcomeId };
}
