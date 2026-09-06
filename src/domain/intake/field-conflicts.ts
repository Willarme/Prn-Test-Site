import { CANNOT_REACH_FIELD_VALUE, detectFields, literalFieldText } from "@/domain/intake/extract";
import type { FieldRequirement, IntakeAnswer } from "@/domain/intake/playbook";
import type { EvidenceObject } from "@/domain/problem/contracts";

export interface HeldFieldConflict {
  field_key: "brand" | "system_age";
  label: string;
  held_value: string;
  reported_values: string[];
  evidence_ids: string[];
}

function canonicalValue(key: HeldFieldConflict["field_key"], value: string, fields: FieldRequirement[]): string | null {
  if (key === "system_age") {
    const years = /\b(\d{1,2})\s*(?:years?|yrs?)\b/i.exec(value);
    if (years) return `${Number(years[1])} years`;
  }
  return detectFields(literalFieldText(value), fields).find(f => f.field_key === key)?.value_text ?? null;
}

/** Later observations are already durable private evidence. Rebuild the open
 * conflict from that evidence rather than inventing a second mutable ledger.
 * A later explicit edit/confirmation of the field resolves earlier reports. */
export function heldFieldConflicts(
  answers: readonly IntakeAnswer[],
  evidence: readonly EvidenceObject[],
  fields: FieldRequirement[]
): HeldFieldConflict[] {
  const latest = new Map<string, IntakeAnswer>();
  for (const answer of answers) latest.set(answer.field_key, answer);
  const conflicts: HeldFieldConflict[] = [];
  for (const key of ["brand", "system_age"] as const) {
    const held = latest.get(key);
    if (!held?.value_text || held.value_text === CANNOT_REACH_FIELD_VALUE) continue;
    const heldValue = canonicalValue(key, held.value_text, fields);
    if (!heldValue) continue;
    const reports = new Map<string, string[]>();
    for (const observation of evidence) {
      if (observation.kind !== "customer_text" || observation.field_key !== "intake_answer_text" ||
          observation.evidence_id === held.evidence_id) continue;
      const elapsed = Date.parse(observation.captured_at) - Date.parse(held.answered_at);
      if (elapsed < 0) continue;
      // Older rows have second precision, and database evidence enumeration is
      // not chronological. Equal or invalid timestamps cannot establish that a
      // confirmation came after the report: keep that ambiguity visible.
      const supplied = detectFields(literalFieldText(observation.content), fields).find(f => f.field_key === key);
      if (!supplied) continue;
      const value = canonicalValue(key, supplied.value_text, fields);
      if (!value || value.toLowerCase() === heldValue.toLowerCase()) continue;
      // A manufacture year and an age are different statements; this bounded
      // comparison does not assume a manufacture date or silently convert them.
      if (key === "system_age" && (!/years$/.test(value) || !/years$/.test(heldValue))) continue;
      reports.set(value, [...(reports.get(value) ?? []), observation.evidence_id]);
    }
    if (reports.size) conflicts.push({
      field_key: key, label: key === "brand" ? "Brand" : "Age",
      held_value: heldValue, reported_values: [...reports.keys()], evidence_ids: [...reports.values()].flat(),
    });
  }
  return conflicts;
}

export function fieldConflictText(conflict: HeldFieldConflict): string {
  return `${conflict.label} needs confirmation. Kept: ${conflict.held_value}. Later reported: ${conflict.reported_values.join(" / ")}.`;
}
