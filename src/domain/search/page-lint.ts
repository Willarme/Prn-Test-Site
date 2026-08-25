import {
  DEFAULT_PAGE_FACTORY_POLICY,
  type PageFactoryPolicy,
} from "@/domain/search/page-factory-policy";
import type { PageSpec } from "@/domain/search/pages";

/**
 * A05's PRE-FILTERS — condition C14 and coherence report issue 8.
 *
 * These are the two guardrails the A05 spec adds that trace cleanly to canon
 * voice rules, and the audit calls them "two real new guardrails". They run on
 * A05's side, BEFORE a page reaches A06, and a finding BLOCKS the page.
 *
 * WRITTEN AGAINST THE SHIPPED BLOCK SHAPE, which is the whole of issue 8. A05
 * §4 specifies `PageContentBlock.slot` / `.source_id` with "MANDATORY when
 * slot === 'urgency'". No such fields exist: the shipped block is
 * block_id / kind / heading / body_md / source_fact_bundle_ids[], and the
 * urgency block's kind is `when_urgency_changes`, not `urgency`. The audit's
 * instruction is explicit — write the lint against the shipped shape and do NOT
 * introduce a parallel slot/source_id pair, because that forks the block schema
 * A06 reads. So the rule is:
 *
 *     kind === "when_urgency_changes"  =>  source_fact_bundle_ids must be
 *                                          non-empty
 *
 * satisfied by the content-bank bundles minted in step 3 (issue 7). The two
 * fixes are one fix; that is why the audit paired them.
 *
 * A06 REIMPLEMENTS, IT DOES NOT IMPORT (C14, coherence issue 15). A06's own
 * versions of these patterns are its build (Master Todo T1-09: "an inspector
 * that shares its subject's logic is not an inspector"). Nothing in this file
 * is exported for A06 to reuse, and nothing here imports qa.ts — this EXTENDS
 * the claim lint at qa.ts:66 in STYLE, as a separate A05-side filter, never by
 * sharing its keyword list.
 *
 * WHY THIS MATTERS AT SCALE, in the spec's own words: A05 fills the urgency
 * slot on every generated page, so "a single unguarded template default becomes
 * a canon violation repeated across the whole page portfolio."
 */

export type LintSeverity = "blocker" | "warning";

export interface LintFinding {
  check: string;
  severity: LintSeverity;
  /** Where it was found — a block_id or a field name. IDs and field names only. */
  where: string;
  message: string;
}

/**
 * MANUFACTURED URGENCY. Canon's voice rule, verbatim: "Never manufacture
 * urgency... No countdowns, fake scarcity, or implied damage without evidence"
 * (01 Canon/05 Selling Points and Marketing Story One Decision Product).
 *
 * The three named families in that rule, as three patterns. Real safety
 * guidance — "urgent if there is a burning smell", "shut off the main" — trips
 * none of them, which is the line the rule draws: describing a hazard is not
 * manufacturing pressure.
 */
const SCARCITY = /\b(act now|before it'?s too late|limited[- ]time|last chance|today only|don'?t wait|hurry|while supplies last|only \d+ (left|spots?|slots?)|offer ends)\b/i;
const COUNTDOWN = /\b(countdown|expires in|\d+\s*(hours?|minutes?|days?)\s*(left|remaining)|book within \d+)\b/i;
const DAMAGE_ESCALATION = /\b(will (only )?get worse|will cost you|could cost you thousands|every (minute|hour|day) counts|the longer you wait|before it becomes a bigger)\b/i;

/**
 * DIRECTORY FRAMING. Canon: "Do not market 'access to hundreds of trusted
 * providers.' Market the trusted next step" (01 Canon/05A). The drift signal
 * this guards against is named in the research: "Let's add reviews and a
 * provider directory so customers can choose" (04 Research/11).
 *
 * Checked across visible copy, meta description AND internal-link labels,
 * because the spec is explicit that link GROUPINGS are part of the surface.
 */
const DIRECTORY_FRAMING = /\b(compare (providers|contractors|quotes|pros)|browse (all|our)|hundreds of (trusted )?(providers|contractors|pros)|choose from (our|hundreds|dozens)|provider directory|directory of (providers|contractors)|shop around|find the best (provider|contractor|pro)|top \d+ (providers|contractors)|our network of|list of (providers|contractors)|all the (providers|contractors) (we|that))\b/i;

/**
 * INVENTED LOCAL STATISTICS. A05 §7 lists FOUR things this agent may never
 * invent — "prices, local statistics, testimonials or provider claims" — and
 * until now only two of the four had a check anywhere in the pipeline. Prices
 * are caught (qa.ts `UNSOURCED_PRICE`); provider claims are caught and routed to
 * a human (qa.ts `VERIFICATION_CLAIM`). A statistic and a testimonial passed
 * both gates untouched. The expected-outcome harness put one of each through the
 * whole pipeline and neither was blocked (NEVER-A05-1).
 *
 * THE ARGUMENT IS THE PRICE ARGUMENT, VERBATIM. A door page's copy is
 * first-party authored text out of the content bank. PRN holds no local dataset,
 * commissions no survey and buys no panel — so a number about how many homes,
 * how often, or what share is UNSOURCED BY CONSTRUCTION. The check is therefore
 * on the CLAIM, not on the citation: there is no citation that could make it
 * true, which is exactly why the spec says "never invent" rather than "always
 * source".
 *
 * TWO SHAPES, DELIBERATELY NARROW.
 *
 *   1. A statistic by its form — a percentage, or an "N out of M" / "1 in 4"
 *      frequency. Neither has an innocent reading in door-page copy.
 *   2. A quantified population claim tied to WHERE THE READER IS: "most homes in
 *      your area", "hundreds of households near you". The locality half is
 *      required. "Most homes have a shutoff near the meter" is ordinary safety
 *      guidance and must keep passing — a hard blocker in this codebase has no
 *      waiver path, so an over-broad rule is not a safe default, it is a page
 *      nobody can ship.
 */
/* `%` is not a word character, so the boundary lives inside the alternation —
 * a trailing \b after "40%" never matches and would silently disarm the half of
 * this rule that catches a percentage. */
const LOCAL_STATISTIC =
  /\b\d{1,3}(\.\d+)?\s?(%|percent\b)|\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten) (out of|in) (\d{1,3}|two|three|four|five|ten)\b/i;

const POPULATION = "(homes?|households?|homeowners?|residents?|properties|families|neighbou?rs)";
const HERE = "(your|this|our|the) (area|neighbou?rhood|street|block|city|town|county|region|zip code|community)";
const LOCAL_POPULATION_CLAIM = new RegExp(
  `\\b(most|nearly all|almost all|the majority of|dozens of|hundreds of|thousands of|\\d{1,3}) ${POPULATION}\\b[^.!?]{0,60}\\b(in|near|around|across) ${HERE}\\b` +
    `|\\b${POPULATION}\\b[^.!?]{0,60}\\b(in|near|around|across) ${HERE}\\b[^.!?]{0,60}\\b(most|nearly all|almost all|\\d{1,3})\\b`,
  "i"
);

/**
 * TESTIMONIALS. The fourth of A05 §7's "may never invent", and the one with the
 * clearest drift signal in the record: "Let's add reviews and a provider
 * directory so customers can choose" (04 Research/11), already guarded against
 * on the directory half by DIRECTORY_FRAMING above. This is the review half.
 *
 * PRN has no customers to quote on a door page — the pages are generated before
 * anyone has used the service through them — so praise attributed to a customer
 * is fabricated by definition. Two shapes again: the vocabulary of reviews, and
 * the SHAPE of one (a quoted line attributed to a customer), because a
 * fabricated testimonial usually arrives as punctuation rather than as the word
 * "testimonial".
 */
const REVIEW_VOCABULARY =
  /\b(testimonial|customer (review|story|quote)|what (our )?(customers|homeowners|clients|neighbou?rs) say|(happy|satisfied|delighted|thrilled) (customer|homeowner|client|resident)|would (highly )?recommend|(five|5)[- ]star|rated \d(\.\d)? (out of|stars?)|\d+ (reviews|ratings))\b/i;
const ATTRIBUTED_QUOTE =
  /["“][^"”\n]{8,240}["”]\s*[—–-]\s*(a |an |the )?[\w. ]{0,30}\b(customer|homeowner|client|resident|neighbou?r|homeowner in|user)\b/i;

function visibleText(spec: PageSpec): Array<{ where: string; text: string }> {
  return [
    { where: "title", text: spec.title },
    { where: "meta_description", text: spec.meta_description },
    { where: "h1", text: spec.h1 },
    { where: "hero.headline", text: spec.hero.headline },
    ...(spec.hero.subheadline ? [{ where: "hero.subheadline", text: spec.hero.subheadline }] : []),
    ...spec.content_blocks.map((b) => ({ where: b.block_id, text: b.body_md })),
    ...spec.content_blocks
      .filter((b) => b.heading !== null)
      .map((b) => ({ where: `${b.block_id}.heading`, text: b.heading as string })),
    ...spec.internal_links.map((l, i) => ({ where: `internal_links[${i}].label`, text: l.label })),
  ];
}

/**
 * THE URGENCY-SLOT CHECK. Two halves: the content must be SOURCED, and it must
 * not be pressure.
 */
export function lintUrgencySlot(spec: PageSpec): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const block of spec.content_blocks) {
    if (block.kind !== "when_urgency_changes") continue;
    if (block.source_fact_bundle_ids.length === 0) {
      findings.push({
        check: "urgency.sourced",
        severity: "blocker",
        where: block.block_id,
        message:
          "urgency content must cite at least one fact bundle — evidence-based safety guidance only, never manufactured (canon voice rule; shipped block shape, no parallel source_id field)",
      });
    }
    for (const [name, pattern] of [
      ["urgency.no_scarcity", SCARCITY],
      ["urgency.no_countdown", COUNTDOWN],
      ["urgency.no_unevidenced_damage", DAMAGE_ESCALATION],
    ] as const) {
      const hit = block.body_md.match(pattern);
      if (hit) {
        findings.push({
          check: name,
          severity: "blocker",
          where: block.block_id,
          message: `manufactured urgency: "${hit[0]}"`,
        });
      }
    }
  }
  return findings;
}

/** THE DIRECTORY-FRAMING CHECK, across every surface A05 writes. */
export function lintDirectoryFraming(spec: PageSpec): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const { where, text } of visibleText(spec)) {
    const hit = text.match(DIRECTORY_FRAMING);
    if (hit) {
      findings.push({
        check: "no_directory_framing",
        severity: "blocker",
        where,
        message: `breadth / comparison-shopping framing: "${hit[0]}" — PRN markets the trusted next step, never a browsable directory`,
      });
    }
  }
  return findings;
}

/**
 * THE INVENTED-EVIDENCE CHECK — statistics and testimonials, across every
 * surface A05 writes. Same surfaces as the directory check, for the same reason:
 * a fabricated statistic in a meta description is still a fabricated statistic.
 */
export function lintInventedEvidence(spec: PageSpec): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const { where, text } of visibleText(spec)) {
    const stat = text.match(LOCAL_STATISTIC) ?? text.match(LOCAL_POPULATION_CLAIM);
    if (stat) {
      findings.push({
        check: "no_invented_statistic",
        severity: "blocker",
        where,
        message: `unsourced statistic: "${stat[0].trim()}" — PRN holds no local dataset, so a number about how many homes or how often is invented by construction (A05 §7 "may NEVER invent … local statistics")`,
      });
    }
    const review = text.match(REVIEW_VOCABULARY) ?? text.match(ATTRIBUTED_QUOTE);
    if (review) {
      findings.push({
        check: "no_testimonial",
        severity: "blocker",
        where,
        message: `testimonial or review language: "${review[0].trim().slice(0, 80)}" — a generated door page has no customers to quote (A05 §7 "may NEVER invent … testimonials")`,
      });
    }
  }
  return findings;
}

/**
 * STRUCTURED-DATA DISCIPLINE (C12c — one of the three §7 guardrails §11
 * dropped). §11 tells the builder to produce `structured_data_types[]` with
 * ZERO rules attached, which the audit names as "exactly the surface a
 * fake-ratings violation appears on".
 *
 * A05 emits no structured data today (`structured_data_plan` is null), so this
 * check is a standing guard rather than a live filter — it is here so the rule
 * exists BEFORE the surface does, which is the only order in which a guardrail
 * is worth anything.
 */
export function lintStructuredData(
  spec: PageSpec,
  policy: PageFactoryPolicy = DEFAULT_PAGE_FACTORY_POLICY
): LintFinding[] {
  if (spec.structured_data_plan === null) return [];
  const findings: LintFinding[] = [];
  const plan = spec.structured_data_plan;
  for (const denied of policy.structured_data.denied_types) {
    if (new RegExp(`\\b${denied}\\b`).test(plan)) {
      findings.push({
        check: "structured_data.denied_type",
        severity: "blocker",
        where: "structured_data_plan",
        message: `"${denied}" is on the deny list — PRN is not the contractor, and nothing unverified (reviews, prices, availability, ratings, areas) may be marked up`,
      });
    }
  }
  if (policy.structured_data.allowed_types.length === 0) {
    findings.push({
      check: "structured_data.no_allow_list",
      severity: "blocker",
      where: "structured_data_plan",
      message:
        "a structured-data plan was set but the allow list is empty — the allow/deny discipline is unratified (PRN Information Structure §12.4 is a DESIGN DRAFT pending Melissa)",
    });
  }
  return findings;
}

export interface LintResult {
  /** True when the page may proceed to A06. */
  passed: boolean;
  findings: LintFinding[];
}

/**
 * THE PRE-FILTER. Run before a page is handed to A06; a blocker stops it there.
 *
 * This is NOT a second publish gate. `qa.state === "PASS"` remains the one
 * server-side condition the publish route reads (coherence issue 6 — never
 * leave a weaker gate alive beside a new one). A page blocked here simply never
 * becomes a candidate A06 sees, so it can never acquire a PASS in the first
 * place.
 */
export function lintPageBeforeQa(
  spec: PageSpec,
  policy: PageFactoryPolicy = DEFAULT_PAGE_FACTORY_POLICY
): LintResult {
  const findings = [
    ...lintUrgencySlot(spec),
    ...lintDirectoryFraming(spec),
    ...lintInventedEvidence(spec),
    ...lintStructuredData(spec, policy),
  ];
  return { passed: !findings.some((f) => f.severity === "blocker"), findings };
}
