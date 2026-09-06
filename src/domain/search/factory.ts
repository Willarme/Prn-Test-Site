import type { FactBundle, SearchOpportunity } from "@/domain/search/contracts";
import { contentBankBundle } from "@/domain/search/content-bank-provenance";
import { isOwnerApproved, type OpportunityDecision } from "@/domain/search/decision";
import {
  DEFAULT_PAGE_FACTORY_POLICY,
  dataFamilyContent,
  type PageFactoryPolicy,
} from "@/domain/search/page-factory-policy";
import { DEFAULT_PAGE_ELIGIBLE_INTENT_TYPES } from "@/domain/search/policy";
import { PageSpec } from "@/domain/search/pages";
import { slugify } from "@/domain/search/importer";
import { shortHash } from "@/domain/shared/hash";
import type { GeographyScope } from "@/domain/shared/primitives";
import { getV43DoorBinding, isV43Opportunity, v43SpecFields, V43_NOINDEX_REASON } from "@/domain/search/door-template";

/**
 * A05 Intent-Door Page Factory (Door Wave 3): compiles an OWNER-APPROVED
 * SearchOpportunity into a typed PageSpec rendered by the ONE shared template.
 * A05 writes PageSpecs — it never invents websites, consent language, or
 * analyzer logic (#14A §15, SEO_DOORS Wave 3).
 *
 * "Owner-approved", not "NEW-recommended" — see `newPageEligibility` below and
 * coherence report seam 2. Pages are built from the owner's decision, never
 * from A04's opinion.
 *
 * Wave note: content generation is currently a deterministic family-based
 * content bank (Tier-0). The production A05 upgrades ONLY the writer behind
 * this same function to a model call (Luna/Terra per #23 §2.1) once OpenAI
 * credentials exist — the PageSpec contract and pipeline do not change.
 * Generated drafts are marked generation.model="content-bank-v1" and cannot
 * publish without A06 QA + owner approval anyway.
 */
interface FamilyContent {
  intent_answer: (keyword: string) => string;
  safe_checks: string;
  do_not_do: string;
  when_urgency_changes: string;
  who_handles_it: string;
}

const GENERIC: FamilyContent = {
  intent_answer: (kw) =>
    `"${kw}" covers a few different situations that can look identical from the outside. What matters most is what you actually observed: when it started, what changed right before, and whether it is getting worse. Several common causes need a professional to tell apart on site — which is exactly why an organized description of the symptoms helps more than guessing at a diagnosis.`,
  safe_checks:
    "- Note exactly when it happens and what you were doing when it started.\n- Check whether anything else in the home changed at the same time.\n- Take a photo of anything visible — stains, drips, damage — from a safe distance.",
  do_not_do:
    "- Don't disassemble equipment or open electrical panels beyond a breaker switch.\n- Don't keep using a fixture or appliance that smells hot, sparks, or trips its breaker repeatedly.",
  when_urgency_changes:
    "Treat this as urgent if there's any burning smell, sparking, active flooding, or a gas smell — for a gas smell, leave first and call your utility or 911 from outside.",
  who_handles_it:
    "The right trade depends on the exact cause. A clear, organized description routes it to the right professional the first time — that's what your Job Packet does.",
};

const FAMILY_CONTENT: Record<string, FamilyContent> = {
  hvac: {
    intent_answer: (kw) =>
      `"${kw}" is a classic heating-and-cooling complaint pattern, and it usually traces to power, controls, airflow, or a component a technician can test quickly. The thermostat, a tripped breaker, a clogged filter, or a safety switch each produce symptoms that look identical from the hallway. A clear description of what the system does — and doesn't do — narrows it fast.`,
    safe_checks:
      "- Thermostat: display on, correct mode, set point past room temperature; fresh batteries if it uses them.\n- Breaker panel: look for a tripped HVAC/air-handler breaker; reset it ONCE at most.\n- Filter: if it's gray and matted, replace it — a starved system can shut itself down.",
    do_not_do:
      "- Don't keep resetting a breaker that re-trips.\n- Don't open the outdoor unit or its electrical compartment — capacitors hold a charge even unplugged.",
    when_urgency_changes:
      "Urgent if there's a burning or electrical smell, visible sparking, or a breaker that immediately re-trips — and prioritize on dangerous-heat or hard-freeze days for anyone heat- or cold-sensitive in the home.",
    who_handles_it:
      "HVAC technicians handle this. If the trail leads to the breaker panel itself, it may cross into electrician territory — your packet helps route it right the first time.",
  },
  plumbing: {
    intent_answer: (kw) =>
      `With "${kw}", the two questions that matter most are where the water is coming from and when — and those two details are exactly what's hardest to see. Supply leaks run whenever pressure is on; drain leaks appear only when a fixture is used. Knowing which pattern you're seeing (constant vs. only-when-used) is among the most useful things you can tell a plumber.`,
    safe_checks:
      "- Find the pattern: constant, or only when a specific fixture runs?\n- Locate your main water shutoff so you can stop supply-side leaks fast.\n- Photograph any staining or dripping and note exactly where it appears.",
    do_not_do:
      "- Don't open ceilings or walls hunting for the leak — pros trace it with less damage.\n- Don't ignore water near outlets, cords, or fixtures; keep power away from wet areas.",
    when_urgency_changes:
      "Urgent if water is actively spreading, near anything electrical, or you can't stop it at a shutoff. Shut off the main if you can reach it safely.",
    who_handles_it:
      "A plumber for the leak itself; a water-damage/restoration pro if material has been soaked for more than a day. The packet keeps both starting from the same facts.",
  },
  electrical: {
    intent_answer: (kw) =>
      `"${kw}" deserves respect: electrical symptoms are the one category where 'wait and see' can be the wrong call. The good news is that the pattern — one outlet vs. one room vs. the whole panel, constant vs. intermittent — tells an electrician a great deal before they arrive. Your job is to observe safely, not to test anything.`,
    safe_checks:
      "- Map it: which outlets, switches, or fixtures are affected? One, one room, or more?\n- Check the panel for a tripped breaker; reset it ONCE at most.\n- Sniff test from a distance: any warmth or odor at outlets means stop using that circuit.",
    do_not_do:
      "- Don't open the panel beyond the breaker switches or probe outlets.\n- Don't keep using any outlet or switch that's warm, discolored, or smells — stop and keep that circuit off.",
    when_urgency_changes:
      "Urgent at the first sign of burning smell, sparking, buzzing, or heat at the panel or any outlet. If something is actively smoking or sparking, get people out and call 911.",
    who_handles_it:
      "A licensed electrician, full stop. Electrical is not a DIY category — the packet's value here is helping the electrician arrive already oriented.",
  },
};

export interface FactoryDeps {
  now: () => string;
  /**
   * A05's namespaced policy sub-block (C2/C3, coherence seam 12). Optional and
   * defaulted so every existing caller behaves identically: the defaults are
   * byte-for-byte the literals that used to sit at factory.ts:120 and :149.
   */
  policy?: PageFactoryPolicy;
  /**
   * Reserved — white-label condition C1. Threaded through to the PageSpec when
   * a caller supplies it; nothing branches on it.
   */
  tenant_id?: string;
}

/** `{keyword}` substitution — the one difference between data and code families. */
function renderFamilyTemplate(template: string, keyword: string): string {
  return template.split("{keyword}").join(keyword);
}

/**
 * Resolve a family's content: DATA first (a policy-supplied family, C3), then
 * the shipped hardcoded bank, then GENERIC. The shipped hvac/plumbing/
 * electrical entries are untouched and `content_families` defaults to empty, so
 * today every page resolves exactly as it did before.
 */
interface ResolvedFamily {
  content: FamilyContent;
  safety_note_required: boolean;
  source: "policy_data" | "content_bank" | "generic";
  /** The content-bank entry key this resolved to — also the provenance bundle key. */
  family_key: string;
}

function resolveFamilyContent(family: string | null, policy: PageFactoryPolicy): ResolvedFamily {
  const fromData = dataFamilyContent(policy, family);
  if (fromData && family) {
    return {
      content: {
        intent_answer: (kw: string) => renderFamilyTemplate(fromData.intent_answer, kw),
        safe_checks: fromData.safe_checks,
        do_not_do: fromData.do_not_do,
        when_urgency_changes: fromData.when_urgency_changes,
        who_handles_it: fromData.who_handles_it,
      },
      safety_note_required: fromData.safety_note_required,
      source: "policy_data",
      family_key: family,
    };
  }
  const banked = family ? FAMILY_CONTENT[family] : undefined;
  return {
    content: banked ?? GENERIC,
    // The shipped rule, unchanged: these three families carry the safety note.
    safety_note_required: family === "electrical" || family === "hvac" || family === "water_damage",
    source: banked ? "content_bank" : "generic",
    family_key: banked && family ? family : GENERIC_FAMILY_KEY,
  };
}

/**
 * PROVENANCE (coherence report issue 7). The content bank is a real source, so
 * it gets a real FactBundle and every block cites it.
 *
 * The scope stamp is the honest part: PRN's shipped families carry US-specific
 * safety instructions, so their bundle says `national/US`. A client's
 * data-supplied family states nothing about scope, so its bundle carries null
 * rather than inheriting PRN's market by accident.
 */
const GENERIC_FAMILY_KEY = "generic";
const US_NATIONAL: GeographyScope = { mode: "national", country: "US" };

function bundleForFamily(resolved: ResolvedFamily, keyword: string, now: string): FactBundle {
  return contentBankBundle(
    resolved.family_key,
    {
      intent_answer: resolved.content.intent_answer(keyword),
      safe_checks: resolved.content.safe_checks,
      do_not_do: resolved.content.do_not_do,
      when_urgency_changes: resolved.content.when_urgency_changes,
      who_handles_it: resolved.content.who_handles_it,
    },
    {
      geography: resolved.source === "policy_data" ? null : US_NATIONAL,
      created_at: now,
    }
  );
}

/**
 * Every content-bank entry that exists, as FactBundles — the provenance
 * registry an admin surface can read and the thing A01-derived bundles will
 * eventually stand beside. `keyword` only shapes the intent_answer statement.
 */
export function listContentBankBundles(
  policy: PageFactoryPolicy = DEFAULT_PAGE_FACTORY_POLICY,
  now = "2026-08-24T00:00:00Z"
): FactBundle[] {
  const keys = new Set<string>([
    GENERIC_FAMILY_KEY,
    ...Object.keys(FAMILY_CONTENT),
    ...Object.keys(policy.content_families),
  ]);
  return [...keys].map((key) => {
    const resolved = resolveFamilyContent(key === GENERIC_FAMILY_KEY ? null : key, policy);
    return bundleForFamily(resolved, `{keyword}`, now);
  });
}

/** Word-start capitalization that leaves apostrophes alone ("won't", not "Won'T"). */
function titleCase(text: string): string {
  return text.replace(/(^|\s)([a-z])/g, (_, sp: string, c: string) => sp + c.toUpperCase());
}

/** Build a <=70-char title, degrading the suffix and finally truncating the keyword. */
function buildTitle(kw: string): string {
  const cased = titleCase(kw);
  for (const suffix of [": What It Can Mean and What to Check", ": What to Check", ""]) {
    const candidate = `${cased}${suffix}`;
    if (candidate.length <= 70) return candidate;
  }
  return `${cased.slice(0, 69)}…`;
}

export function compilePageSpec(opportunity: SearchOpportunity, deps: FactoryDeps): PageSpec {
  if (isV43Opportunity(opportunity, deps.tenant_id)) {
    const binding = getV43DoorBinding();
    const canonicalKeyword = "ac blowing warm air";
    const pageId = `page_${slugify(canonicalKeyword)}_${shortHash(canonicalKeyword)}`;
    const intentClusterId = opportunity.intent_cluster_id ?? `ic_${slugify(canonicalKeyword)}`;
    return PageSpec.parse({
      ...v43SpecFields(binding), door_template: binding,
      // A reviewed template begins a distinct spec lineage; keep the canonical
      // page identity while leaving legacy generated/rejected version IDs intact.
      page_spec_id: `ps_${slugify(canonicalKeyword)}_tpl43_v1`, schema_version: "1.0.0",
      ...(deps.tenant_id ? { tenant_id: deps.tenant_id } : {}), page_id: pageId, version: 1, status: "STAGED",
      intent_id: `intent_${slugify(canonicalKeyword)}`, intent_cluster_id: intentClusterId,
      search_opportunity_id: opportunity.search_opportunity_id, primary_query: opportunity.keyword, supporting_queries: [],
      intake_context: { page_id: pageId, intent_cluster_id: intentClusterId,
        search_opportunity_id: opportunity.search_opportunity_id, problem_family_hint: "hvac" },
      monetization_eligible: false, monetization_policy_id: null, user_value_score: null,
      indexed: false, noindex_reason: V43_NOINDEX_REASON,
      experiment: { experiment_id: null, variant: null }, qa: { state: "PENDING", reasons: [] },
      created_at: deps.now(), updated_at: null,
    });
  }
  const kw = opportunity.keyword;
  const family = opportunity.problem_family_hint;
  const policy = deps.policy ?? DEFAULT_PAGE_FACTORY_POLICY;
  const resolved = resolveFamilyContent(family, policy);
  const bank = resolved.content;
  const slug = slugify(kw).replace(/_/g, "-");
  const pageId = `page_${slugify(kw)}_${shortHash(kw)}`;
  const now = deps.now();
  const title = buildTitle(kw);
  const bundleId = bundleForFamily(resolved, kw, now).fact_bundle_id;

  return PageSpec.parse({
    page_spec_id: `ps_${slugify(kw)}_v1`,
    schema_version: "1.0.0",
    ...(deps.tenant_id ? { tenant_id: deps.tenant_id } : {}),
    page_id: pageId,
    version: 1,
    status: "STAGED",
    intent_id: `intent_${slugify(kw)}`,
    intent_cluster_id: opportunity.intent_cluster_id ?? `ic_${slugify(kw)}`,
    search_opportunity_id: opportunity.search_opportunity_id,
    primary_query: kw,
    supporting_queries: [],
    problem_family: family,
    geography: opportunity.geography,
    // C6: the FINAL PUBLIC path. Both routes key off it — findStagedByPath
    // serves the staged view from it and findPublishedByPath the live one — so
    // it is never a "/staged/" value. Only the PREFIX moved to policy (C2).
    canonical_path: `${policy.canonical_path_prefix}${slug}`,
    title,
    meta_description: `${kw} — what it can mean, the few things that are safe to check yourself, what not to do, and when it becomes urgent.`.slice(0, 170),
    h1: kw.charAt(0).toUpperCase() + kw.slice(1),
    hero: {
      headline: kw.charAt(0).toUpperCase() + kw.slice(1) + "?",
      subheadline: "What this usually involves, what's safe to check, and one organized next step.",
    },
    // PROVENANCE (issue 7): every block cites the content-bank FactBundle its
    // statement actually came from. `provenance.present` is now a real,
    // passing property with a real source; converting to A01-derived bundles
    // later swaps these ids and touches no schema.
    content_blocks: [
      { block_id: "blk_intent_answer", kind: "intent_answer", heading: "What this usually means", body_md: bank.intent_answer(kw), source_fact_bundle_ids: [bundleId] },
      { block_id: "blk_safe_checks", kind: "safe_checks", heading: "Safe things to check first", body_md: bank.safe_checks, source_fact_bundle_ids: [bundleId] },
      { block_id: "blk_do_not", kind: "do_not_do", heading: "What not to do", body_md: bank.do_not_do, source_fact_bundle_ids: [bundleId] },
      { block_id: "blk_urgency", kind: "when_urgency_changes", heading: "When this becomes urgent", body_md: bank.when_urgency_changes, source_fact_bundle_ids: [bundleId] },
      { block_id: "blk_who", kind: "who_handles_it", heading: "Who typically handles this", body_md: bank.who_handles_it, source_fact_bundle_ids: [bundleId] },
    ],
    safety_note_required: resolved.safety_note_required,
    // C12c: A05 emits NO structured data. The allow/deny discipline is written
    // down in policy (page-factory-policy.ts) and enforced by the lint, but
    // writing a rule down must not start emitting markup as a side effect.
    structured_data_plan: null,
    internal_links: [],
    intake_context: {
      page_id: pageId,
      intent_cluster_id: opportunity.intent_cluster_id ?? `ic_${slugify(kw)}`,
      search_opportunity_id: opportunity.search_opportunity_id,
      problem_family_hint: family,
    },
    monetization_eligible: false,
    monetization_policy_id: null,
    user_value_score: null,
    indexed: true,
    noindex_reason: null,
    // C2: was a literal here; the value is unchanged.
    template_id: policy.template_id,
    template_version: policy.template_version,
    generation: { model: "content-bank-v1", prompt_id: null, prompt_version: null },
    experiment: { experiment_id: null, variant: null },
    qa: { state: "PENDING", reasons: [] },
    source_fact_bundle_ids: [bundleId],
    created_at: now,
    updated_at: null,
  });
}

/**
 * THE TRIGGER PREDICATE — coherence report seam 2, the headline change of the
 * A05 build.
 *
 * WHAT THIS LINE USED TO BE: `opportunities.filter((x) => x.recommendation === "NEW")`.
 * `recommendation` is A04's OPINION (contracts.ts:70 says so in as many words).
 * `status` is the OWNER'S DECISION. So for the whole life of this codebase, a
 * page could be built from an agent's suggestion with no human in between —
 * the first human checkpoint that A04 §3.2 and A05 §3 both assert as existing
 * was, in code, not wired at all. A04's build closed the other half (the
 * decision record, decision.ts + opportunity-decisions.ts) and left this pin
 * behind deliberately, with a comment saying A05 must change it on purpose
 * rather than drift past it. This is that change.
 *
 * A05 NOW ASKS ONE QUESTION AND ONE PLACE: `isOwnerApproved()`. It reads the
 * fold over the append-only decision history, never `recommendation`.
 *
 * THE SECOND, NARROWER RULE — and why it is not the same rule. Owner approval
 * says "yes, act on this opportunity." It does not say "and the act is a NEW
 * page." lifecycle.ts:47 records the quota rule verbatim — "Only NEW is
 * eligible for the new-page quota (#23 §1.2)" — and Loop Spec Audit condition
 * 18 is explicit that EXPAND means GROW AN EXISTING PAGE, not create one, and
 * that a build which ignores this "will either silently drop EXPAND events or
 * start creating duplicate pages from them."
 *
 * So the gate is approval; the recommendation decides the SHAPE of the work,
 * and anything that is approved but not a new-page build is REPORTED by name
 * rather than dropped. Nothing here is silent — that is the whole point of the
 * `not_new_page` bucket below.
 */
export type NewPageEligibility =
  | { eligible: true; reason: null }
  | { eligible: false; reason: string };

/**
 * WHICH INTENTS MAY BECOME DOORS — `policy.page_eligible_intent_types`, as ONE
 * predicate with ONE implementation (inspection F3).
 *
 * WHAT WENT WRONG. The rule was owner-visible policy that exactly one caller
 * read: `tools/run-factory.ts`, the CLI that regenerates the committed
 * portfolio. Neither shipped run mode — the admin route or A04's approval hook —
 * went anywhere near it, because both call `runPageFactory` directly. Accepting
 * a tool-intent opportunity in the Approval Center therefore built a door page:
 * "Uuid Generator", complete with breaker-panel safety guidance, from the
 * GENERIC content-bank family. The rule existed, was written down in owner-
 * editable policy, and protected nothing an owner could actually reach.
 *
 * SO THE PREDICATE LIVES HERE AND THE ENFORCEMENT LIVES IN THE SHARED PATH.
 * `runPageFactory` calls this on every candidate; the CLI calls the same
 * function instead of its own `Set.has`. A future entry point inherits the rule
 * by using the shared run, which is the only way a policy stays enforced.
 *
 * FAIL-CLOSED DEFAULT. `eligibleIntentTypes` defaults to the shipped
 * `["problem"]` (one constant, shared with the policy schema's own default), so
 * a caller that forgets to thread the policy through gets the shipped ruling
 * rather than an open gate.
 *
 * THE STEERING RULING ITSELF IS STILL PARKED — TODO-ASK-OWNER (Melissa). This
 * changes WHERE the existing value is enforced, never WHAT it is.
 */
export function pageEligibleIntent(
  opportunity: Pick<SearchOpportunity, "intent_type">,
  eligibleIntentTypes: readonly string[] = DEFAULT_PAGE_ELIGIBLE_INTENT_TYPES
): NewPageEligibility {
  if (eligibleIntentTypes.includes(opportunity.intent_type)) {
    return { eligible: true, reason: null };
  }
  return {
    eligible: false,
    reason:
      `intent_type "${opportunity.intent_type}" is not page-eligible — ` +
      `policy.page_eligible_intent_types allows ${eligibleIntentTypes.join(", ") || "nothing"}. ` +
      "Doors are PROBLEM-intent pages (D-3); a tool/calculator topic keeps its score and its place " +
      "in the queue but never becomes a door. Widen the policy to change this.",
  };
}

export function newPageEligibility(
  opportunity: Pick<SearchOpportunity, "search_opportunity_id" | "status" | "recommendation">,
  decisions: readonly OpportunityDecision[] = []
): NewPageEligibility {
  if (!isOwnerApproved(opportunity, decisions)) {
    return {
      eligible: false,
      reason:
        "not owner-approved — A04's recommendation is an opinion, not a decision (coherence seam 2)",
    };
  }
  /**
   * WHICH RECOMMENDATIONS BLOCK A BUILD — and the line is narrower than it
   * first looks. Found by exercising the real admin flow, not by reading.
   *
   * The first version of this switch let ONLY "NEW" and null through and
   * reported WATCH and REJECT as non-builds. That is seam 2 reintroduced
   * upside down: the owner clicks Accept, whose stated impact in the Approval
   * Center is "This opportunity becomes eligible for page building", and A04's
   * OPINION then silently vetoes it. Making the agent's opinion the gate is the
   * exact defect this whole build exists to remove; it does not become correct
   * by pointing the other way.
   *
   * So the split is by what the recommendation MEANS, not by how much A04 liked
   * the keyword:
   *
   *   EXPAND / MERGE  name a DIFFERENT ACTION on an EXISTING page. They are not
   *                   a weaker "yes" to a new page — C18 is explicit that
   *                   EXPAND means grow an existing page, and that a build
   *                   which ignores this "will either silently drop EXPAND
   *                   events or start creating duplicate pages from them."
   *
   *   WATCH / REJECT  are A04 saying "not now" and "no". The owner has just
   *                   said yes, and an owner override is precisely what the
   *                   decision path is for. The disagreement is not lost: it is
   *                   recorded on the decision itself as
   *                   `recommendation_at_decision`, which is how anyone later
   *                   learns whether the scoring is any good.
   */
  switch (opportunity.recommendation) {
    case "EXPAND":
      return {
        eligible: false,
        reason:
          "approved as EXPAND — expansion GROWS an existing page and is not a new-page build (lifecycle.ts:47, #23 §1.2, Loop Spec Audit C18). No consumer for EXPAND exists yet; A13 owns portfolio expansion.",
      };
    case "MERGE":
      return {
        eligible: false,
        reason:
          "approved as MERGE — folds into an existing page rather than creating a second door",
      };
    // NEW, WATCH, REJECT, or no recommendation at all. The owner approved it.
    default:
      return { eligible: true, reason: null };
  }
}

/**
 * Compile owner-approved, new-page-eligible candidates, up to the hard cap.
 * One bad keyword never kills the batch — it is skipped and reported.
 */
export interface BuildResult {
  specs: PageSpec[];
  skipped: Array<{ keyword: string; reason: string }>;
  /**
   * Owner-approved but NOT a new-page build, with the reason. Separate from
   * `skipped` (which means "we tried and it failed") because these are
   * deliberate non-builds, and separate from silence because a decision the
   * owner made that produces no visible effect is how a loop quietly breaks.
   */
  not_new_page: Array<{
    search_opportunity_id: string;
    keyword: string;
    recommendation: string | null;
    reason: string;
  }>;
}

export function buildCandidatePages(
  opportunities: SearchOpportunity[],
  maxPages: number,
  deps: FactoryDeps,
  decisions: readonly OpportunityDecision[] = []
): BuildResult {
  const specs: PageSpec[] = [];
  const skipped: BuildResult["skipped"] = [];
  const notNewPage: BuildResult["not_new_page"] = [];

  const eligible: SearchOpportunity[] = [];
  for (const o of opportunities) {
    const verdict = newPageEligibility(o, decisions);
    if (verdict.eligible) {
      eligible.push(o);
      continue;
    }
    // An un-approved candidate is the NORMAL state of the queue — 96 of them
    // sit at "candidate" right now — so it is not reported per-row; only an
    // owner decision that produced no page is.
    if (isOwnerApproved(o, decisions)) {
      notNewPage.push({
        search_opportunity_id: o.search_opportunity_id,
        keyword: o.keyword,
        recommendation: o.recommendation,
        reason: verdict.reason,
      });
    }
  }

  for (const o of eligible.slice(0, maxPages)) {
    try {
      specs.push(compilePageSpec(o, deps));
    } catch (err) {
      skipped.push({ keyword: o.keyword, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { specs, skipped, not_new_page: notNewPage };
}
