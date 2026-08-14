import type { SearchOpportunity } from "@/domain/search/contracts";
import { PageSpec } from "@/domain/search/pages";
import { slugify } from "@/domain/search/importer";
import { shortHash } from "@/domain/shared/hash";

/**
 * A05 Intent-Door Page Factory (Door Wave 3): compiles an approved
 * NEW-recommended SearchOpportunity into a typed PageSpec rendered by the ONE
 * shared template. A05 writes PageSpecs — it never invents websites, consent
 * language, or analyzer logic (#14A §15, SEO_DOORS Wave 3).
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
  const kw = opportunity.keyword;
  const family = opportunity.problem_family_hint;
  const bank = (family && FAMILY_CONTENT[family]) || GENERIC;
  const slug = slugify(kw).replace(/_/g, "-");
  const pageId = `page_${slugify(kw)}_${shortHash(kw)}`;
  const now = deps.now();
  const title = buildTitle(kw);

  return PageSpec.parse({
    page_spec_id: `ps_${slugify(kw)}_v1`,
    schema_version: "1.0.0",
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
    canonical_path: `/problems/${slug}`,
    title,
    meta_description: `${kw} — what it can mean, the few things that are safe to check yourself, what not to do, and when it becomes urgent.`.slice(0, 170),
    h1: kw.charAt(0).toUpperCase() + kw.slice(1),
    hero: {
      headline: kw.charAt(0).toUpperCase() + kw.slice(1) + "?",
      subheadline: "What this usually involves, what's safe to check, and one organized next step.",
    },
    content_blocks: [
      { block_id: "blk_intent_answer", kind: "intent_answer", heading: "What this usually means", body_md: bank.intent_answer(kw), source_fact_bundle_ids: [] },
      { block_id: "blk_safe_checks", kind: "safe_checks", heading: "Safe things to check first", body_md: bank.safe_checks, source_fact_bundle_ids: [] },
      { block_id: "blk_do_not", kind: "do_not_do", heading: "What not to do", body_md: bank.do_not_do, source_fact_bundle_ids: [] },
      { block_id: "blk_urgency", kind: "when_urgency_changes", heading: "When this becomes urgent", body_md: bank.when_urgency_changes, source_fact_bundle_ids: [] },
      { block_id: "blk_who", kind: "who_handles_it", heading: "Who typically handles this", body_md: bank.who_handles_it, source_fact_bundle_ids: [] },
    ],
    safety_note_required: family === "electrical" || family === "hvac" || family === "water_damage",
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
    template_id: "tpl_intent_page",
    template_version: "1.0.0",
    generation: { model: "content-bank-v1", prompt_id: null, prompt_version: null },
    experiment: { experiment_id: null, variant: null },
    qa: { state: "PENDING", reasons: [] },
    source_fact_bundle_ids: [],
    created_at: now,
    updated_at: null,
  });
}

/**
 * Compile only NEW-recommended candidates, up to the hard cap. One bad
 * keyword never kills the batch — it is skipped and reported.
 */
export interface BuildResult {
  specs: PageSpec[];
  skipped: Array<{ keyword: string; reason: string }>;
}

export function buildCandidatePages(
  opportunities: SearchOpportunity[],
  maxPages: number,
  deps: FactoryDeps
): BuildResult {
  const specs: PageSpec[] = [];
  const skipped: BuildResult["skipped"] = [];
  for (const o of opportunities.filter((x) => x.recommendation === "NEW").slice(0, maxPages)) {
    try {
      specs.push(compilePageSpec(o, deps));
    } catch (err) {
      skipped.push({ keyword: o.keyword, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { specs, skipped };
}
