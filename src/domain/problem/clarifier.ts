import type { FieldRequirement, IntakePlaybook } from "@/domain/intake/playbook";

/**
 * WHICH QUESTION TO ASK NEXT — the deterministic implementation, and the cap.
 *
 * ─── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
 *
 * `select_next_clarifier` has been a registered capability with no owner, no
 * alias and no executor since Wave 0. The Loop Spec Audit (A01 condition 6) named
 * the three failures that follow exactly, and they were all live: the alias
 * resolved to nothing, the capability was not in A01's allowed list, and the
 * gateway had no executor for it. This is the executor.
 *
 * ─── IT INVENTS NO CONTENT ──────────────────────────────────────────────────
 *
 * Every question it can return is a field the shipped playbook already declares,
 * in the order that file already declares it, with the wording that file already
 * carries. Nothing about which question a homeowner is asked changed when this
 * was bound — it made an existing, unreachable ordering reachable.
 *
 * ─── THE CAP IS A COUNT, NOT A TAG ──────────────────────────────────────────
 *
 * A01's whole argument is that every clarifying question is unpaid work extracted
 * from someone who is already anxious. So the ceiling is enforced as a RUNNING
 * COUNT of questions actually asked, not as a per-question validity check — the
 * audit is explicit that a per-question tag is not the same thing and that the
 * mechanism, not the number, is what a build session decides.
 *
 * Since the 2026-08-30 ruling, every question ALSO carries its canon
 * `value_reason` tag (six categories — see ClarifierCandidate and
 * intake/playbook.ts). The tag is the licence to ask; the count is the
 * ceiling. Neither substitutes for the other, which is exactly the
 * distinction the audit drew.
 *
 * The NUMBER is `intake.max_clarifying_questions` and is TODO-ASK-OWNER
 * (Melissa). Its shipped value reproduces the `.slice(0, 5)` already in
 * buildJobPacketFixture — an observed constant, not a chosen limit.
 *
 * ─── AND IT IS THE FLOOR UNDER THE MODEL ────────────────────────────────────
 *
 * The model-backed clarifier (platform/problem/ai-clarifier.ts) does not write
 * questions. It CHOOSES one of the candidates below, by field key, from a closed
 * enum. So the worst a model can do is pick a worse question from the owner's own
 * list — it cannot invent one, cannot ask a hundred, and cannot ask at all once
 * the cap is reached, because the cap is checked before it is consulted.
 */

export interface ClarifierCandidate {
  field_key: string;
  /** The playbook's own label, asked as a question. */
  question: string;
  why_it_matters: string;
  /**
   * One of the SIX CANON tags (A01 spec §4; ruled 2026-08-28 condition 3 and
   * crew 2026-08-30): the machine-checkable licence to ask. `why_it_matters`
   * above is the same fact as prose — the tag classifies, the prose explains,
   * and neither replaces the other.
   */
  value_reason: FieldRequirement["value_reason"];
  priority: FieldRequirement["priority"];
  /** How the homeowner may answer — the playbook's own list. */
  accepts: FieldRequirement["accepts"];
}

export interface ClarifierSelection {
  /** The one question to ask, or null when nothing should be asked. */
  ask: ClarifierCandidate | null;
  /** Always populated — on an ask as well as a refusal. */
  reason: string;
  /** How many questions have been asked so far, including none. */
  asked_count: number;
  /** The ceiling this selection was made under. */
  max_questions: number;
}

export interface ClarifierInput {
  playbook: IntakePlaybook;
  /** Field keys the homeowner has already answered, however they answered them. */
  answered_field_keys: readonly string[];
  /** How many clarifying questions this request has already been asked. */
  asked_count: number;
  /** The ceiling. Read from policy by the caller — never defaulted here. */
  max_questions: number;
}

/**
 * Every question still worth asking, best first. CORE before HELPFUL, and within
 * each band the playbook's own declared order — which is an editorial ordering a
 * human wrote, and therefore a better default than any ranking this file could
 * invent.
 */
export function clarifierCandidates(
  playbook: IntakePlaybook,
  answeredFieldKeys: readonly string[]
): ClarifierCandidate[] {
  const answered = new Set(answeredFieldKeys);
  const open = playbook.required_fields.filter((f) => !answered.has(f.field_key));
  const rank = (f: FieldRequirement) => (f.priority === "core" ? 0 : 1);
  return [...open]
    .sort((a, b) => rank(a) - rank(b))
    .map((f) => ({
      field_key: f.field_key,
      question: f.label,
      why_it_matters: f.why_it_matters,
      value_reason: f.value_reason,
      priority: f.priority,
      accepts: f.accepts,
    }));
}

/**
 * THE CAP, CHECKED FIRST. Exported so the model-backed path can call exactly this
 * before it consults anything — the ceiling is not a thing a model is asked to
 * respect, it is a thing that happens before a model is reached.
 */
export function capReached(askedCount: number, maxQuestions: number): boolean {
  return askedCount >= maxQuestions;
}

export function selectNextClarifierDeterministic(input: ClarifierInput): ClarifierSelection {
  const base = { asked_count: input.asked_count, max_questions: input.max_questions };

  if (capReached(input.asked_count, input.max_questions)) {
    return {
      ask: null,
      reason: `the clarifying-question ceiling is reached (${input.asked_count}/${input.max_questions}) — every further question is unpaid work asked of someone who has already answered enough`,
      ...base,
    };
  }

  const candidates = clarifierCandidates(input.playbook, input.answered_field_keys);
  if (candidates.length === 0) {
    return {
      ask: null,
      reason: "every field this playbook asks for has been answered",
      ...base,
    };
  }

  const pick = candidates[0];
  return {
    ask: pick,
    reason: `highest-priority unanswered field in the playbook's own order (${pick.priority})`,
    ...base,
  };
}
