import type { PageSpec } from "@/domain/search/pages";
import { sameIntentFamily } from "@/domain/search/recommend";

/**
 * A06 Page Quality & Release (Door Wave 4): cheap deterministic checks FIRST;
 * the (currently fixture) critic runs ONLY on deterministic passes — a failed
 * deterministic check never pays for an AI critic (#23 §2.4/§8.3). PASS moves
 * a page to the owner publish queue; A06 never publishes (#14A §15.1).
 */
export interface QaResult {
  page_spec_id: string;
  state: "PASS" | "FAIL";
  reasons: string[];
  user_value_score: number | null;
  critic_ran: boolean;
}

const PLACEHOLDER_PATTERN = /\b(TODO|TBD|FIXME|lorem ipsum|\[placeholder\]|xxx)\b/i;

export function runDeterministicChecks(spec: PageSpec, existing: PageSpec[]): string[] {
  const reasons: string[] = [];
  // Self-identity by OBJECT REFERENCE, never by id: two distinct specs whose
  // keywords slugify identically must still collide on canonical path/title
  // (Wave slice verification finding — id-based exclusion skipped exactly
  // the strongest duplicates).
  const others = existing.filter((e) => e !== spec);

  if (others.some((e) => e.canonical_path === spec.canonical_path)) {
    reasons.push(`duplicate canonical path ${spec.canonical_path}`);
  }
  if (others.some((e) => e.title === spec.title)) {
    reasons.push("duplicate title");
  }
  const overlap = others.find((e) => sameIntentFamily(e.primary_query, spec.primary_query));
  if (overlap) {
    reasons.push(
      `intent overlaps existing page "${overlap.primary_query}" — merge instead of publish (doorway rule)`
    );
  }
  if (!spec.content_blocks.some((b) => b.kind === "intent_answer")) {
    reasons.push("missing intent_answer block — page must answer the search on the page itself");
  }
  const totalContent = spec.content_blocks.reduce((sum, b) => sum + b.body_md.length, 0);
  if (totalContent < 600) {
    reasons.push(`thin content (${totalContent} chars) — not independently useful`);
  }
  const allText = `${spec.title} ${spec.meta_description} ${spec.h1} ${spec.hero.headline} ${spec.content_blocks.map((b) => b.body_md).join(" ")}`;
  if (PLACEHOLDER_PATTERN.test(allText)) {
    reasons.push("placeholder text present");
  }
  if (spec.intake_context.page_id !== spec.page_id) {
    reasons.push("intake attribution page_id mismatch — events would misattribute");
  }
  if (spec.internal_links.some((l) => !l.path.startsWith("/"))) {
    reasons.push("external or malformed internal link");
  }
  if (
    spec.safety_note_required &&
    !spec.content_blocks.some((b) => b.kind === "when_urgency_changes" || b.kind === "do_not_do")
  ) {
    reasons.push("safety-relevant family without an urgency/do-not block");
  }
  if (!spec.indexed && spec.noindex_reason === null) {
    reasons.push("non-indexed page without recorded reason");
  }
  if (/\b(guarantee|cheapest|licensed and insured|top rated)\b/i.test(allText)) {
    reasons.push("unsupported claim language present");
  }
  return reasons;
}

/**
 * Fixture critic (Tier-0 heuristic). The production critic is a model call
 * behind this same signature (#23 §2.1 Luna first, Terra escalation); its
 * scores land in the same user_value_score field the policy gates on.
 */
export function fixtureCritic(spec: PageSpec): number {
  let score = 40;
  const kinds = new Set(spec.content_blocks.map((b) => b.kind));
  score += Math.min(25, kinds.size * 5); // breadth of genuinely useful sections
  const totalContent = spec.content_blocks.reduce((sum, b) => sum + b.body_md.length, 0);
  score += Math.min(20, Math.floor(totalContent / 200)); // depth
  if (spec.problem_family !== null) score += 5; // routed specificity
  if (spec.content_blocks.some((b) => b.kind === "when_urgency_changes")) score += 5;
  if (spec.generation.model === null) score += 5; // handcrafted
  return Math.min(100, score);
}

export function qaCandidatePages(specs: PageSpec[], existing: PageSpec[]): QaResult[] {
  const results: QaResult[] = [];
  const accepted: PageSpec[] = [...existing];
  for (const spec of specs) {
    const reasons = runDeterministicChecks(spec, accepted);
    if (reasons.length > 0) {
      results.push({ page_spec_id: spec.page_spec_id, state: "FAIL", reasons, user_value_score: null, critic_ran: false });
      continue; // deterministic FAIL never reaches the critic
    }
    const score = fixtureCritic(spec);
    const pass = score >= 60;
    results.push({
      page_spec_id: spec.page_spec_id,
      state: pass ? "PASS" : "FAIL",
      reasons: pass ? [] : [`critic user_value_score ${score} below 60`],
      user_value_score: score,
      critic_ran: true,
    });
    if (pass) accepted.push(spec); // later candidates are checked against it
  }
  return results;
}
