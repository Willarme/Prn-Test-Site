import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { IntakePlaybook, FieldRequirement } from "@/domain/intake/playbook";
import { clarifierCandidates } from "@/domain/problem/clarifier";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";

/** A selection is never an answer. This local preview ledger holds only field
 * keys and provenance, and survives a refresh without another provider call. */
export interface QuestionPlan {
  field_keys: string[];
  engine: "model" | "deterministic";
  run_id: string | null;
  max_questions: number;
}

function location(requestId: string): string {
  const root = process.env.PRN_DEV_DB_PATH
    ? path.dirname(process.env.PRN_DEV_DB_PATH)
    : path.join(process.cwd(), "data", "runtime");
  return path.join(root, "question-plans", `${createHash("sha256").update(requestId).digest("hex")}.json`);
}

export function validateQuestionPlan(value: unknown, playbook: IntakePlaybook): QuestionPlan | null {
  if (!value || typeof value !== "object") return null;
  const p = value as QuestionPlan;
  const valid = new Set(playbook.required_fields.filter(f => !f.optional_group).map(f => f.field_key));
  if (!Array.isArray(p.field_keys) || !Number.isInteger(p.max_questions) || p.max_questions < 0 ||
      p.max_questions > 20 || p.field_keys.length > p.max_questions ||
      new Set(p.field_keys).size !== p.field_keys.length || p.field_keys.some(k => !valid.has(k)) ||
      !["model", "deterministic"].includes(p.engine) ||
      !(p.run_id === null || typeof p.run_id === "string")) return null;
  return p;
}

export function saveQuestionPlan(requestId: string, playbook: IntakePlaybook, plan: QuestionPlan): void {
  if (!validateQuestionPlan(plan, playbook)) throw new Error("invalid question plan");
  const file = location(requestId);
  withFileLock(file, () => {
    if (!existsSync(file)) writeFileAtomic(file, JSON.stringify(plan));
  });
}

export function loadQuestionPlan(requestId: string, playbook: IntakePlaybook): QuestionPlan | null {
  try { return validateQuestionPlan(JSON.parse(readFileSync(location(requestId), "utf8")), playbook); }
  catch { return null; }
}

export function orderedDetailFields(
  playbook: IntakePlaybook,
  answers: readonly { field_key: string }[],
  plan: QuestionPlan | null,
): FieldRequirement[] {
  const answered = new Set(answers.map(a => a.field_key));
  const held = playbook.required_fields.filter(f => !f.optional_group && answered.has(f.field_key));
  const valid = validateQuestionPlan(plan, playbook);
  const order = valid?.field_keys ?? clarifierCandidates(playbook, [...answered]).map(f => f.field_key).slice(0, 5);
  const byKey = new Map(playbook.required_fields.map(f => [f.field_key, f]));
  return [...held, ...order.filter(k => !answered.has(k)).flatMap(k => byKey.has(k) ? [byKey.get(k)!] : [])];
}

/** Voluntary sections are rendered separately from the capped question plan. */
export function optionalDetailFields(playbook: IntakePlaybook): FieldRequirement[] {
  return playbook.required_fields.filter(f => f.optional_group);
}
