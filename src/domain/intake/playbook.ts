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

export const FieldRequirement = z.object({
  field_key: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().min(1),
  why_it_matters: z.string().min(1),
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
  source: z.enum(["auto_detected", "typed", "photo"]),
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
