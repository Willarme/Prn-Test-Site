import { ACTIVE_SAFETY_PACKAGE, type SafetyPackage } from "@/domain/problem/safety-package";

/**
 * SafetyRule registry lite (#14A §14): a deterministic policy layer that runs
 * BEFORE any analysis. Trigger patterns are conservative; response copy is
 * fixed, human-reviewed text — never model-generated, and flagged for expert/
 * legal review before production traffic (see OWNER_TODO in safety-package.ts).
 *
 * ─── THIS IS STILL THE ONE SAFETY SOURCE ───────────────────────────────────
 *
 * 2026-08-25 (Loop Spec Audit A01 conditions 9 and 10): the RULE DATA moved to
 * domain/problem/safety-package.ts, which is versioned, jurisdiction-stamped and
 * readable by someone who does not read TypeScript. This file is unchanged in
 * every way that matters to a caller — same `SafetyRule` shape, same
 * `SAFETY_RULES` export, same `checkSafety()` signature, same rules in the same
 * order, byte-identical copy — and it remains the ONLY place a safety decision
 * is made. The condition was "extend, never duplicate"; a second registry is
 * exactly what a build session must not produce, and there still is not one.
 *
 * ─── WHAT CONFIGURATION CANNOT DO ──────────────────────────────────────────
 *
 * A package supplies WHICH hazards are recognised, in WHAT words, and whether
 * each halts intake. It cannot turn the gate off, move it after classification,
 * or let a model near the decision — those are structure, in this file and in
 * platform/problem/ai-classify.ts, not settings.
 */
export interface SafetyRule {
  safety_rule_id: string;
  label: string;
  patterns: RegExp[];
  approved_response: string;
  intake_may_continue: boolean;
}

/** Compile one package into the runtime rule shape callers already use. */
export function compileSafetyPackage(pkg: SafetyPackage): readonly SafetyRule[] {
  return pkg.rules.map((rule) => ({
    safety_rule_id: rule.safety_rule_id,
    label: rule.label,
    patterns: rule.patterns.map((p) => new RegExp(p.source, p.flags)),
    approved_response: rule.approved_response,
    intake_may_continue: rule.intake_may_continue,
  }));
}

export const SAFETY_RULES: readonly SafetyRule[] = compileSafetyPackage(ACTIVE_SAFETY_PACKAGE);

/** Which package these rules came from — recorded on anything that cites them. */
export const SAFETY_PACKAGE_VERSION = `${ACTIVE_SAFETY_PACKAGE.safety_package_id}@${ACTIVE_SAFETY_PACKAGE.version}`;

export function checkSafety(text: string, rules: readonly SafetyRule[] = SAFETY_RULES): SafetyRule | null {
  for (const rule of rules) {
    if (rule.patterns.some((p) => p.test(text))) return rule;
  }
  return null;
}
