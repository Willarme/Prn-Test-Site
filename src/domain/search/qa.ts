import type { PageLifecycleStatus } from "@/domain/search/lifecycle";
import type { IntentPage, PageSpec } from "@/domain/search/pages";
import {
  NOT_MEASURABLE_CHECKS,
  runAccessibilityChecks,
  type QaRenderSurface,
} from "@/domain/search/qa-accessibility";
import {
  NO_MODEL_CRITIC,
  runAiCriticStage,
  type AICritic,
  type AiCriticInput,
} from "@/domain/search/qa-critic";
import { qaIntentOverlap } from "@/domain/search/qa-intent";
import {
  A06_CHECK_IDS,
  DEFAULT_PAGE_QA_POLICY,
  type PageQaPolicy,
} from "@/domain/search/qa-policy";
import type {
  AiCriticStageResult,
  DeterministicStageResult,
  PageQAResult,
  QaFinding,
  QaOverall,
  QaSeverity,
  QaVerdict,
} from "@/domain/search/qa-types";
import { resolveTemplate, templateMatchesBlocks } from "@/domain/search/template";

/**
 * A06 PAGE QUALITY & RELEASE — the deterministic rule set, the critic stage and
 * the ONE release signal.
 *
 * THIS FILE IS THE AGENT, GROWN IN PLACE. It was already A06's deterministic
 * stage (`runDeterministicChecks` / `qaCandidatePages` / `QaResult`, registered
 * as capability `seo.qa_candidate_pages`), and condition C2 / pre-answer 6 are
 * explicit that A06's build EXTENDS it: "Grow QaResult into PageQAResult in
 * place ... Creating a second type beside the first is how two QA truths and two
 * publish gates get born." Every original check is still here, unchanged in
 * behaviour; what is new is around them.
 *
 * WHAT A06 IS FOR. Cheap deterministic checks FIRST; the critic runs only on
 * deterministic passes, because a failed page never pays for a critic
 * (#23 §2.4/§8.3). A06 never publishes (#14A §15.1) — it produces a
 * recommendation and a human acts on it.
 *
 * THE FOUR THINGS A06 OWNS, and nothing else owns:
 *
 *  1. `PageSpec.qa.state` and `PageSpec.qa.reasons` — SOLE WRITER (coherence
 *     issue 5: "as specified, the safety-critical field is written by no
 *     agent"). A05 sets PENDING at creation and never writes it again. The one
 *     way to write a verdict is `applyQaVerdict` below, and a standing test
 *     asserts no module outside A06 writes a non-PENDING qa state.
 *  2. `release_eligible` — the SINGLE server-side release condition, read by
 *     `src/app/api/admin/pages/publish/route.ts` through
 *     `evaluateReleaseForPublish`. `qa.state` is DERIVED from the same verdict,
 *     never checked beside it (condition C10, coherence issue 6).
 *  3. The lifecycle edges STAGED -> QA_PASS and STAGED -> APPROVED (rebuild),
 *     through the shipped `lifecycle.ts` guards (coherence issue 13). `qa.state`
 *     and `release_eligible` are FACTS ABOUT a STAGED page, never a parallel
 *     state machine.
 *  4. Its own duplication check — REIMPLEMENTED, never shared (issue 15).
 *
 * WHAT IT DELIBERATELY DOES NOT OWN. Publishing (the owner's route action).
 * Waivers — there is NO override path and building one was refused, see
 * `A06_WAIVER_PATH` at the foot of this file. The verification-claim standard
 * (Melissa, Master Todo T2-07 / T7-01). The template SHAPE (unapproved).
 *
 * INDEPENDENCE, ENFORCED BY TEST (condition C14, issue 15, Master Todo T1-09).
 * A06 imports NOTHING from the page factory it inspects, from the recommender,
 * or from the shared intent-family helper those two are allowed to share with
 * each other — "an inspector that shares its subject's logic is not an
 * inspector." It also imports nothing from PRN's problem/trust/provider
 * domains, so whichever way Josh rules on the `auto-seo-core` extraction
 * (pre-answer 10) the later pull is a copy. See
 * tests/a06.independence-and-sole-writer.test.ts for the scan.
 */

/** Bumped whenever a check is added, removed or re-severitied. Travels on every result. */
export const A06_RULE_SET_VERSION = "1.0.0";

export * from "@/domain/search/qa-types";
export {
  A06_CHECK_IDS,
  DEFAULT_BLOCKER_CHECKS,
  DEFAULT_PAGE_QA_POLICY,
  PageQaPolicy,
} from "@/domain/search/qa-policy";
export { NO_MODEL_CRITIC, criticPassed, type AICritic } from "@/domain/search/qa-critic";

/* -------------------------------------------------------------------------- */
/* PATTERNS — A06'S OWN, NOT A05'S                                            */
/* -------------------------------------------------------------------------- */

/**
 * THE REDUNDANT VOICE / CLAIM CHECKS (build step 4). A05's lint pre-filter
 * module runs the same FAMILIES of rule before a page ever reaches A06. These
 * are deliberately a SECOND, INDEPENDENT implementation with its own wording —
 * the same discipline as the duplication check. A05's file says so on its own
 * side: "Nothing in this file is exported for A06 to reuse."
 *
 * A pre-filter and an inspector that share a keyword list fail together on the
 * one input neither list covers. Two lists written from the same canon rule, by
 * two builds, catch each other's gaps — which is the entire argument for
 * redundancy.
 *
 * THE SEMANTICS OF THE CLAIM VOCABULARY STAY PARKED (condition C13). These are
 * PATTERN checks. What a "verified"/"insured"/"qualified" claim must be backed
 * BY is Master Todo T2-07 (Melissa's ruling, P0, unlocks 22) and T7-01, whose
 * WHY names "A06's QC gauntlet claim safety check" by name. A06's default
 * stands exactly as its spec wrote it and this build does not improve on it:
 * detect the claim, emit the finding, route to human review, never auto-pass and
 * never auto-fail, and never invent a stand-in standard so the check looks
 * decisive.
 */

/** The SHIPPED unsupported-claim pattern, preserved verbatim, plus inflections. */
const UNSUPPORTED_CLAIM =
  /\b(guarantee|guaranteed|guarantees|cheapest|licensed and insured|top rated|top-rated)\b/i;

/** Manufactured urgency — A06's list, written from the canon voice rule directly. */
const MANUFACTURED_URGENCY =
  /\b(act (now|fast|today)|before it'?s too late|limited[- ]time|last chance|today only|don'?t wait|hurry|while supplies last|only \d+ (left|spots?|slots?)|offer ends|expires in|countdown|\d+\s*(hours?|minutes?|days?)\s*(left|remaining)|book (within|in the next) \d+|every (minute|hour|day) counts|the longer you wait|will only get worse|could cost you thousands)\b/i;

/** Directory / comparison-shopping framing — A06's list. */
const DIRECTORY_FRAMING =
  /\b(compare (providers|contractors|quotes|pros|prices)|browse (all|our|hundreds)|hundreds of (trusted )?(providers|contractors|pros)|choose from (our|hundreds|dozens)|provider directory|directory of (providers|contractors)|shop around|find the best (provider|contractor|pro)|top \d+ (providers|contractors)|our network of|list of (providers|contractors)|rated \d(\.\d)? (stars?|out of))\b/i;

/**
 * PRICES. PRN quotes no prices on a door page: every PRN dollar is a TEST figure
 * (hard canon rule 4) and consumer-facing pricing is Melissa's call, undecided.
 * A currency amount or a cost claim in public copy is therefore unsourced by
 * construction — the content bank is first-party authored text, not a priced
 * quote — so the check is on the CLAIM, not on the citation.
 */
const UNSOURCED_PRICE =
  /(\$\s?\d|\b\d+\s?(dollars|usd)\b|\bcosts? (about|around|roughly|typically|usually|between)\b|\btypical(ly)? costs?\b|\baverage (cost|price)\b|\bper hour\b.*\b\d|\bflat (rate|fee)\b)/i;

/**
 * VERIFICATION CLAIMS — scoped to claims ABOUT A PROVIDER, deliberately.
 *
 * A bare "verified" or "qualified" anywhere in a sentence is not a trust claim;
 * "our verified providers" and "PRN-vetted contractors" are. Scoping to the
 * provider-adjacent form is what keeps this check from firing on ordinary
 * safety copy while still catching every claim the parked standard will
 * eventually govern.
 */
const PROVIDER_NOUN =
  "(pro|pros|provider|providers|contractor|contractors|technician|technicians|company|companies|business|businesses|plumber|plumbers|electrician|electricians)";
const VERIFY_ADJ =
  "(verified|vetted|certified|insured|bonded|screened|background[- ]checked|pre[- ]screened|pre[- ]qualified|fully[- ]qualified|top[- ]rated|premium)";
const VERIFICATION_CLAIM = new RegExp(
  `(\\b${VERIFY_ADJ}\\b[^.!?]{0,40}\\b${PROVIDER_NOUN}\\b)` +
    `|(\\b${PROVIDER_NOUN}\\b[^.!?]{0,40}\\b(are|is|who are)\\s+${VERIFY_ADJ}\\b)` +
    `|(\\b(we|prn)\\s+(verify|vet|screen|certify|background[- ]check)\\b)` +
    `|(\\bprn[- ](vetted|verified|certified|approved)\\b)`,
  "i"
);

/** Structured-data rating markup, in any of the shapes it actually appears in. */
const RATING_MARKUP =
  /("@type"\s*:\s*"(AggregateRating|Rating|Review)"|itemprop\s*=\s*"(ratingValue|reviewCount|aggregateRating|bestRating)"|aggregateRating|ratingValue|reviewCount|\bschema\.org\/(AggregateRating|Rating|Review)\b)/i;

/** The shipped placeholder pattern, unchanged. */
const PLACEHOLDER_PATTERN = /\b(TODO|TBD|FIXME|lorem ipsum|\[placeholder\]|xxx)\b/i;

/** A markdown link pointing off-site from inside a body. */
const BODY_EXTERNAL_LINK = /\]\(\s*(https?:)?\/\//i;

/* -------------------------------------------------------------------------- */
/* CONTEXT                                                                    */
/* -------------------------------------------------------------------------- */

export interface PageQaHumanGate {
  publish_mode: string;
  human_approval_required: boolean;
}

export interface PageQaContext {
  /** The corpus this page is checked for duplication against. */
  existing?: readonly PageSpec[];
  /**
   * The page registry, for FAIL-CLOSED internal-link resolution. Omitted means
   * link targets could not be verified, which is reported — never assumed good.
   */
  registry?: readonly IntentPage[];
  /** `policy.page_qa.*` — the per-tenant rule set (condition C8/C9). */
  policy?: PageQaPolicy;
  /**
   * `SeoFactoryPolicy.min_user_value_score` — A04 owns the field, A06 reads it.
   * null (today's shipped value) means the `page_qa.min_heuristic_score` default
   * applies.
   */
  min_user_value_score?: number | null;
  /**
   * The human publish gate's state. `release_eligible` FAILS CLOSED the moment
   * this stops being intact — pre-answer 1 point (2): "the residual risk is
   * bounded ONLY by the human, so the flag's meaning must be tied to the human
   * still being there."
   */
  human_gate?: PageQaHumanGate;
  tenant_id?: string;
  /** Defaults to NO_MODEL_CRITIC. The async entry point is the only one that awaits it. */
  critic?: AICritic;
}

const INTACT_HUMAN_GATE: PageQaHumanGate = {
  publish_mode: "OWNER_APPROVAL",
  human_approval_required: true,
};

function humanGateIntact(gate: PageQaHumanGate): boolean {
  return gate.publish_mode === "OWNER_APPROVAL" && gate.human_approval_required === true;
}

/* -------------------------------------------------------------------------- */
/* SURFACES                                                                   */
/* -------------------------------------------------------------------------- */

interface Surface {
  where: string;
  text: string;
}

/** Every string a reader of this page can see. IDs and field names as `where`. */
function visibleSurfaces(spec: PageSpec): Surface[] {
  return [
    { where: "title", text: spec.title },
    { where: "meta_description", text: spec.meta_description },
    { where: "h1", text: spec.h1 },
    { where: "hero.headline", text: spec.hero.headline },
    ...(spec.hero.subheadline ? [{ where: "hero.subheadline", text: spec.hero.subheadline }] : []),
    ...spec.content_blocks.flatMap((b) => [
      ...(b.heading ? [{ where: `${b.block_id}.heading`, text: b.heading }] : []),
      { where: b.block_id, text: b.body_md },
    ]),
    ...spec.internal_links.map((l, i) => ({ where: `internal_links[${i}].label`, text: l.label })),
  ];
}

function renderSurfaces(spec: PageSpec): QaRenderSurface[] {
  return spec.content_blocks.map((b) => ({
    where: b.block_id,
    text: b.body_md,
    markdown: true,
    // Block headings render at h2 under the page H1, so a body heading starts at h3.
    heading_level: 2,
  }));
}

/* -------------------------------------------------------------------------- */
/* THE HEURISTIC SCORE — RECLASSIFIED, NOT DELETED (pre-answer 7)             */
/* -------------------------------------------------------------------------- */

/**
 * The scoring function formerly exported as `fixtureCritic`, under its real
 * name. Identical arithmetic — every constant is the shipped one — so no page's
 * `user_value_score` changes. What changed is what it CLAIMS to be.
 *
 * It is a DETERMINISTIC HEURISTIC: breadth of section kinds, depth of content,
 * routed specificity, an urgency section, handcrafted copy. It has never read a
 * page for meaning and it never sets `ai_critic.status`. Pre-answer 7: "Keep the
 * scoring function (it feeds user_value_score, which
 * SeoFactoryPolicy.min_user_value_score already gates on), but stop calling it a
 * critic run."
 */
export function deterministicHeuristicScore(spec: PageSpec): number {
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

/* -------------------------------------------------------------------------- */
/* THE DETERMINISTIC STAGE                                                    */
/* -------------------------------------------------------------------------- */

interface RawFinding extends Omit<QaFinding, "severity"> {
  proposed: QaSeverity;
}

function raw(
  check: string,
  proposed: QaSeverity,
  where: string,
  message: string,
  repair: string | null
): RawFinding {
  return { check, proposed, where, message, repair_instructions: repair };
}

/**
 * A06's OWN provenance check (coherence issue 7). Reimplemented rather than
 * imported from A05's `content-bank-provenance.ts` for the same reason as the
 * duplication check — and it is a REAL blocker now, not a deferred one: A05's
 * build minted content-bank and handcrafted-door FactBundles and backfilled all
 * seven shipped pages, so `provenance.present` is satisfiable today. A page with
 * an empty `source_fact_bundle_ids` fails.
 */
function provenanceFindings(spec: PageSpec): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const block of spec.content_blocks) {
    if (block.source_fact_bundle_ids.length === 0) {
      findings.push(
        raw(
          "provenance.present",
          "blocker",
          block.block_id,
          "block cites no fact bundle — every fact-bearing block must name where its statement came from",
          "Cite the FactBundle the block's copy came from in source_fact_bundle_ids (content bank or handcrafted door)."
        )
      );
    }
  }
  if (spec.content_blocks.length > 0 && spec.source_fact_bundle_ids.length === 0) {
    findings.push(
      raw(
        "provenance.present",
        "blocker",
        "source_fact_bundle_ids",
        "the page itself cites no fact bundle",
        "The page's source_fact_bundle_ids must carry the union of its blocks' bundles."
      )
    );
  }
  const cited = new Set(spec.content_blocks.flatMap((b) => b.source_fact_bundle_ids));
  for (const id of cited) {
    if (!spec.source_fact_bundle_ids.includes(id)) {
      findings.push(
        raw(
          "provenance.present",
          "blocker",
          "source_fact_bundle_ids",
          `block-level bundle ${id} is missing from the page's own source list`,
          "Add the bundle id to the page's source_fact_bundle_ids so page-level provenance is complete."
        )
      );
    }
  }
  return findings;
}

function duplicationFindings(
  spec: PageSpec,
  others: readonly PageSpec[],
  policy: PageQaPolicy
): RawFinding[] {
  const findings: RawFinding[] = [];

  if (others.some((e) => e.canonical_path === spec.canonical_path)) {
    findings.push(
      raw(
        "duplicate.canonical_path",
        "blocker",
        "canonical_path",
        `duplicate canonical path ${spec.canonical_path}`,
        "Two pages cannot occupy one URL. Merge them, or give this page its own intent and path."
      )
    );
  }
  if (others.some((e) => e.title === spec.title)) {
    findings.push(
      raw(
        "duplicate.title",
        "blocker",
        "title",
        "duplicate title",
        "Retitle the page to the specific question it answers."
      )
    );
  }

  // A06'S OWN MATCHER (issue 15). Measured, with the threshold reported, so the
  // verdict is arguable rather than opaque.
  for (const other of others) {
    const overlap = qaIntentOverlap(
      other.primary_query,
      spec.primary_query,
      policy.intent_overlap_threshold
    );
    if (overlap.overlaps) {
      findings.push(
        raw(
          "duplication.cannibalization",
          "blocker",
          "primary_query",
          `intent overlaps existing page "${other.primary_query}" — merge instead of publish (doorway rule). A06 independent similarity ${overlap.similarity.toFixed(2)} >= ${overlap.threshold}`,
          `Expand or merge ${other.canonical_path} instead of building a second door for the same search need.`
        )
      );
      break;
    }
  }
  return findings;
}

function linkFindings(spec: PageSpec, registry: readonly IntentPage[] | undefined): RawFinding[] {
  const findings: RawFinding[] = [];

  spec.internal_links.forEach((link, i) => {
    if (!link.path.startsWith("/")) {
      findings.push(
        raw(
          "links.internal_root_relative",
          "blocker",
          `internal_links[${i}]`,
          "external or malformed internal link",
          "Internal links are root-relative paths resolved from the page registry, never raw URLs."
        )
      );
    }
  });

  if (spec.internal_links.length > 0) {
    if (registry === undefined) {
      findings.push(
        raw(
          "links.internal_resolvable",
          "major",
          "internal_links",
          "link targets could not be verified — no page registry was supplied to this QA run",
          "Run QA with the page registry so every internal link is resolved against a real, non-retired page."
        )
      );
    } else {
      spec.internal_links.forEach((link, i) => {
        const target = registry.find((p) => p.canonical_path === link.path);
        if (!target) {
          findings.push(
            raw(
              "links.internal_resolvable",
              "blocker",
              `internal_links[${i}]`,
              `broken internal link: no registry page occupies ${link.path}`,
              "Point the link at a page that exists, or drop it. A05's resolver fails closed for exactly this reason."
            )
          );
          return;
        }
        if (target.lifecycle_status === "RETIRED") {
          findings.push(
            raw(
              "links.internal_resolvable",
              "blocker",
              `internal_links[${i}]`,
              `internal link points at RETIRED page ${target.page_id}`,
              "Retarget the link or remove it — a retired page is not a destination."
            )
          );
        }
      });
    }
  }

  for (const block of spec.content_blocks) {
    if (BODY_EXTERNAL_LINK.test(block.body_md)) {
      findings.push(
        raw(
          "links.body_no_external",
          "major",
          block.block_id,
          "an off-site link is embedded in body copy",
          "Door pages link internally. An outbound reference belongs in the fact bundle's source_url, not in customer-visible copy."
        )
      );
    }
  }
  return findings;
}

function structuredDataFindings(spec: PageSpec, policy: PageQaPolicy): RawFinding[] {
  const findings: RawFinding[] = [];

  // Rating markup is rejected wherever it appears, plan or copy — this is the
  // one surface a fake-ratings violation can actually reach.
  for (const surface of visibleSurfaces(spec)) {
    if (RATING_MARKUP.test(surface.text)) {
      findings.push(
        raw(
          "structured_data.no_rating_markup",
          "blocker",
          surface.where,
          "star / aggregate-rating markup is present — PRN publishes no ratings it cannot verify",
          "Remove the rating markup. Ratings are a Trust Network decision (Master Todo T2-07), not a page feature."
        )
      );
    }
  }

  if (spec.structured_data_plan === null) return findings;
  const plan = spec.structured_data_plan;

  if (RATING_MARKUP.test(plan)) {
    findings.push(
      raw(
        "structured_data.no_rating_markup",
        "blocker",
        "structured_data_plan",
        "the structured-data plan emits rating markup",
        "Remove it. Nothing PRN can verify may be marked up."
      )
    );
  }
  for (const denied of policy.structured_data_denied_types) {
    if (new RegExp(`\\b${denied}\\b`).test(plan)) {
      findings.push(
        raw(
          "structured_data.denied_type",
          "blocker",
          "structured_data_plan",
          `"${denied}" is on A06's deny list — PRN is not the contractor, and nothing unverified may be marked up`,
          "Drop the type from the plan."
        )
      );
    }
  }
  if (policy.structured_data_allowed_types.length === 0) {
    findings.push(
      raw(
        "structured_data.allow_list",
        "blocker",
        "structured_data_plan",
        "a structured-data plan is set while A06's allow list is EMPTY — no schema type is owner-approved, so every plan blocks until one is",
        "Get the allow list ratified (PRN Information Structure §12.4 is a DESIGN DRAFT pending Melissa), or emit no structured data."
      )
    );
  }
  return findings;
}

function templateFindings(spec: PageSpec): { findings: RawFinding[]; owner_approved: boolean } {
  const template = resolveTemplate(spec.template_id, spec.template_version);
  if (!template) {
    return {
      owner_approved: false,
      findings: [
        raw(
          "template.registered",
          "blocker",
          "template_id",
          `page claims template ${spec.template_id}@${spec.template_version}, which is not in the template registry`,
          "Register the template, or point the page at one that exists. A page describing itself with a template nobody has is unauditable."
        ),
      ],
    };
  }

  const problems = templateMatchesBlocks(template, spec.content_blocks);
  const findings = problems.map((problem) =>
    raw(
      "template.conformance",
      "major",
      "content_blocks",
      problem,
      "Rebuild the page from its template, or register the shape it actually has as its own template."
    )
  );

  const intakeEmbedded = template.intake_placement !== undefined;
  if (!intakeEmbedded || spec.intake_context.page_id.length === 0) {
    findings.push(
      raw(
        "component.intake_embed",
        "blocker",
        "intake_context",
        "the page does not carry a resolvable shared-intake embed — a door with no intake is a dead end",
        "The template must declare an intake_placement and the page must carry its intake_context."
      )
    );
  }

  return { findings, owner_approved: template.owner_approved };
}

function voiceFindings(spec: PageSpec): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const surface of visibleSurfaces(spec)) {
    const claim = surface.text.match(UNSUPPORTED_CLAIM);
    if (claim) {
      findings.push(
        raw(
          "claims.no_unsupported_language",
          "blocker",
          surface.where,
          `unsupported claim language present: "${claim[0]}"`,
          "PRN does not guarantee outcomes, price positions or vouch for licensing on a door page. Remove the claim."
        )
      );
    }
    const urgency = surface.text.match(MANUFACTURED_URGENCY);
    if (urgency) {
      findings.push(
        raw(
          "voice.no_manufactured_urgency",
          "blocker",
          surface.where,
          `manufactured urgency: "${urgency[0]}" — canon: never manufacture urgency, no countdowns, fake scarcity, or implied damage without evidence`,
          "Describe the hazard, with a source. Pressure is not safety guidance."
        )
      );
    }
    const directory = surface.text.match(DIRECTORY_FRAMING);
    if (directory) {
      findings.push(
        raw(
          "voice.no_directory_framing",
          "blocker",
          surface.where,
          `breadth / comparison-shopping framing: "${directory[0]}" — PRN markets the trusted next step, never a browsable directory`,
          "Rewrite to one clear next step."
        )
      );
    }
    const price = surface.text.match(UNSOURCED_PRICE);
    if (price) {
      findings.push(
        raw(
          "voice.no_unsourced_price",
          "blocker",
          surface.where,
          `unsourced price or cost claim: "${price[0].trim()}" — every PRN dollar is a TEST figure and no consumer pricing is decided`,
          "Remove the figure. Pricing is an owner decision and a door page is not where it lands."
        )
      );
    }
    const verification = surface.text.match(VERIFICATION_CLAIM);
    if (verification) {
      findings.push(
        raw(
          "voice.unqualified_verification_claim",
          "major",
          surface.where,
          `unqualified verification claim about a provider: "${verification[0].trim()}" — ROUTED TO HUMAN REVIEW, not auto-passed and not auto-failed. The standard behind "verified"/"insured"/"vetted" is undecided (Master Todo T2-07, Melissa; T7-01)`,
          "A human decides. Do not invent a stand-in standard so this check looks decisive."
        )
      );
    }
  }
  return findings;
}

function contentFindings(spec: PageSpec, policy: PageQaPolicy): RawFinding[] {
  const findings: RawFinding[] = [];

  if (!spec.content_blocks.some((b) => b.kind === "intent_answer")) {
    findings.push(
      raw(
        "content.intent_answer_present",
        "blocker",
        "content_blocks",
        "missing intent_answer block — page must answer the search on the page itself",
        "Add the direct-answer block. A page that redirects the question is a doorway."
      )
    );
  }

  const totalContent = spec.content_blocks.reduce((sum, b) => sum + b.body_md.length, 0);
  if (totalContent < policy.thin_content_min_chars) {
    findings.push(
      raw(
        "content.not_thin",
        "blocker",
        "content_blocks",
        `thin content (${totalContent} chars) — not independently useful`,
        `Fill the page to at least ${policy.thin_content_min_chars} characters of genuinely useful copy, or do not build it.`
      )
    );
  }

  for (const surface of visibleSurfaces(spec)) {
    const hit = surface.text.match(PLACEHOLDER_PATTERN);
    if (hit) {
      findings.push(
        raw(
          "content.no_placeholder",
          "blocker",
          surface.where,
          `placeholder text present: "${hit[0]}"`,
          "Replace the placeholder with real copy before this page is a candidate."
        )
      );
    }
  }

  if (spec.intake_context.page_id !== spec.page_id) {
    findings.push(
      raw(
        "intake.attribution_matches",
        "blocker",
        "intake_context.page_id",
        "intake attribution page_id mismatch — events would misattribute",
        "Set intake_context.page_id to this page's own page_id."
      )
    );
  }

  if (
    spec.safety_note_required &&
    !spec.content_blocks.some((b) => b.kind === "when_urgency_changes" || b.kind === "do_not_do")
  ) {
    findings.push(
      raw(
        "safety.urgency_block_present",
        "blocker",
        "content_blocks",
        "safety-relevant family without an urgency/do-not block",
        "Add the urgency or do-not-do section this family requires."
      )
    );
  }

  if (!spec.indexed && spec.noindex_reason === null) {
    findings.push(
      raw(
        "index.noindex_reason_recorded",
        "blocker",
        "noindex_reason",
        "non-indexed page without recorded reason",
        "Record why the page is noindexed. An unexplained noindex is indistinguishable from a mistake."
      )
    );
  }

  return findings;
}

/**
 * THE SHIPPED SIGNATURE, PRESERVED. Returns the blocker messages, exactly as it
 * always did, so every existing caller and test reads the same thing. The rich
 * form is `runDeterministicStage`.
 */
export function runDeterministicChecks(
  spec: PageSpec,
  existing: readonly PageSpec[],
  context: PageQaContext = {}
): string[] {
  return runDeterministicStage(spec, { ...context, existing })
    .findings.filter((f) => f.severity === "blocker")
    .map((f) => f.message);
}

export function runDeterministicStage(
  spec: PageSpec,
  context: PageQaContext = {}
): DeterministicStageResult {
  const policy = context.policy ?? DEFAULT_PAGE_QA_POLICY;
  // Self-identity by OBJECT REFERENCE, never by id: two distinct specs whose
  // keywords slugify identically must still collide on canonical path/title
  // (Wave-slice verification finding — id-based exclusion skipped exactly the
  // strongest duplicates).
  const others = (context.existing ?? []).filter((e) => e !== spec);

  const template = templateFindings(spec);
  const rawFindings: RawFinding[] = [
    ...duplicationFindings(spec, others, policy),
    ...contentFindings(spec, policy),
    ...linkFindings(spec, context.registry),
    ...provenanceFindings(spec),
    ...template.findings,
    ...structuredDataFindings(spec, policy),
    ...voiceFindings(spec),
    ...runAccessibilityChecks({
      surfaces: renderSurfaces(spec),
      h1: spec.h1,
      link_labels: spec.internal_links.map((l, i) => ({
        where: `internal_links[${i}]`,
        label: l.label,
      })),
      markup_chars: visibleSurfaces(spec).reduce((sum, s) => sum + s.text.length, 0),
      max_markup_chars: policy.max_markup_chars,
    }).map((f) => raw(f.check, f.severity, f.where, f.message, f.repair_instructions)),
  ];

  // THE HEURISTIC GATE. Its threshold is A06's policy default unless the owner
  // has set SeoFactoryPolicy.min_user_value_score, which is null today.
  const score = deterministicHeuristicScore(spec);
  const minScore = context.min_user_value_score ?? policy.min_heuristic_score;
  if (score < minScore) {
    rawFindings.push(
      raw(
        "content.heuristic_value_score",
        "blocker",
        "user_value_score",
        `heuristic user_value_score ${score} below ${minScore}`,
        "Broaden or deepen the page's sections. NOTE: this is a deterministic heuristic, not a critic judgment."
      )
    );
  }

  /**
   * POLICY DECIDES SEVERITY, not the check that raised the finding — that is
   * what makes the blocker classes per-tenant configuration (condition C8)
   * rather than a constant compiled into the inspector.
   *
   * `template.conformance` is promoted to a blocker automatically once the
   * template it measured against is owner-approved: drift from an APPROVED shape
   * is a real defect; drift from a merely DESCRIPTIVE registry entry is not, and
   * blocking on it would treat an unapproved template as approved (pre-answer 2).
   */
  const blockerSet = new Set<string>(policy.blocker_checks);
  if (template.owner_approved) blockerSet.add("template.conformance");

  const findings: QaFinding[] = rawFindings.map((f) => ({
    check: f.check,
    severity: blockerSet.has(f.check) ? "blocker" : f.proposed === "blocker" ? "major" : f.proposed,
    where: f.where,
    message: f.message,
    repair_instructions: f.repair_instructions,
  }));

  const implemented = new Set<string>(A06_CHECK_IDS);
  const unknownRequired = policy.required_checks.filter((c) => !implemented.has(c));

  return {
    state: findings.some((f) => f.severity === "blocker") ? "FAIL" : "PASS",
    checks_run: policy.required_checks.filter(
      (c) => implemented.has(c) && !NOT_MEASURABLE_CHECKS.some((s) => s.check === c)
    ),
    checks_skipped: NOT_MEASURABLE_CHECKS.filter((s) => policy.required_checks.includes(s.check)).map(
      (s) => ({ ...s })
    ),
    unknown_required_checks: unknownRequired,
    findings,
  };
}

/* -------------------------------------------------------------------------- */
/* THE RESULT                                                                 */
/* -------------------------------------------------------------------------- */

function criticInput(spec: PageSpec, tenantId: string | undefined): AiCriticInput {
  return {
    page_spec_id: spec.page_spec_id,
    ...(tenantId ? { tenant_id: tenantId } : {}),
    primary_query: spec.primary_query,
    title: spec.title,
    meta_description: spec.meta_description,
    h1: spec.h1,
    hero_headline: spec.hero.headline,
    hero_subheadline: spec.hero.subheadline,
    blocks: spec.content_blocks.map((b) => ({
      block_id: b.block_id,
      kind: b.kind,
      heading: b.heading,
      body_md: b.body_md,
    })),
  };
}

function assemble(
  spec: PageSpec,
  deterministic: DeterministicStageResult,
  critic: AiCriticStageResult,
  context: PageQaContext
): PageQAResult {
  const findings = [...deterministic.findings, ...critic.findings];
  const blockers = findings.filter((f) => f.severity === "blocker");
  const state: QaVerdict = deterministic.state === "PASS" && blockers.length === 0 ? "PASS" : "FAIL";

  /**
   * `overall` vs `state` — pre-answer 1 point (3). A deterministic PASS with no
   * critic is NOT reported as a bare green PASS; it reads BLOCKED_PENDING_AI,
   * which is the honest description of a page nothing has read for meaning. It
   * is still release-eligible, because a human publishes every page.
   */
  const overall: QaOverall =
    state === "FAIL"
      ? "FAIL"
      : critic.status === "PASS"
        ? "PASS"
        : "BLOCKED_PENDING_AI";

  const gate = context.human_gate ?? INTACT_HUMAN_GATE;
  const gateIntact = humanGateIntact(gate);

  const releaseReasons: string[] = [];
  if (state === "FAIL") {
    releaseReasons.push(
      `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}: ${blockers.map((b) => b.check).join(", ")}`
    );
  }
  if (!gateIntact) {
    releaseReasons.push(
      `the human publish gate is not intact (publish_mode=${gate.publish_mode}, human_approval_required=${gate.human_approval_required}) — release_eligible fails closed, because a deterministic-only PASS is bounded ONLY by the human still being there`
    );
  }
  if (state === "PASS" && gateIntact) {
    releaseReasons.push(
      critic.status === "PASS"
        ? "deterministic PASS and the critic passed"
        : `deterministic PASS with ai_critic=${critic.status}; a human still publishes every page, so this enters the owner's queue carrying the skipped-critic status, never a bare green PASS`
    );
  }

  const score = deterministicHeuristicScore(spec);

  return {
    page_spec_id: spec.page_spec_id,
    ...(context.tenant_id ?? spec.tenant_id
      ? { tenant_id: context.tenant_id ?? spec.tenant_id }
      : {}),
    rule_set_version: A06_RULE_SET_VERSION,
    deterministic,
    ai_critic: critic,
    overall,
    blockers,
    release_eligible: state === "PASS" && blockers.length === 0 && gateIntact,
    release_reasons: releaseReasons,
    state,
    reasons: blockers.map((b) => b.message),
    user_value_score: state === "PASS" ? score : null,
    heuristic_score: score,
  };
}

/**
 * SYNCHRONOUS QA — the deterministic surface, and the entry point every shipped
 * caller already uses. It NEVER invokes a critic: with no model configured the
 * critic stage is knowable without awaiting anything, and keeping this path
 * synchronous is what lets `qaCandidatePages` stay the exact signature
 * `tools/run-factory.ts` and the admin surfaces already call.
 */
export function runPageQaSync(spec: PageSpec, context: PageQaContext = {}): PageQAResult {
  const deterministic = runDeterministicStage(spec, context);
  const blocked = deterministic.findings.some((f) => f.severity === "blocker");
  const critic: AiCriticStageResult = blocked
    ? {
        status: "NOT_RUN",
        reason:
          "the deterministic stage returned a blocker — the critic was not invoked, because a failed page never pays for a critic (#23 §2.4/§8.3)",
        findings: [],
        provider: null,
        cost_usd: null,
        latency_ms: null,
      }
    : {
        status: "SKIPPED_NO_MODEL",
        reason:
          "no model is configured anywhere in this deployment — the AI critic did not run. This is NOT a pass: nothing has judged this page's voice, claims or usefulness.",
        findings: [],
        provider: null,
        cost_usd: null,
        latency_ms: null,
      };
  return assemble(spec, deterministic, critic, context);
}

/**
 * FULL QA — deterministic stage, then the critic through whatever adapter the
 * caller supplied (default: the no-model critic). This is what the run mode
 * calls.
 */
export async function runPageQa(
  spec: PageSpec,
  context: PageQaContext = {}
): Promise<PageQAResult> {
  const deterministic = runDeterministicStage(spec, context);
  const blocked = deterministic.findings.some((f) => f.severity === "blocker");
  const critic = await runAiCriticStage(
    criticInput(spec, context.tenant_id ?? spec.tenant_id),
    context.critic ?? NO_MODEL_CRITIC,
    { deterministic_blocked: blocked }
  );
  return assemble(spec, deterministic, critic, context);
}

/**
 * The batch form, signature-compatible with the shipped one. Each accepted page
 * joins the corpus, so two candidates in ONE batch cannot both claim an intent.
 */
export function qaCandidatePages(
  specs: readonly PageSpec[],
  existing: readonly PageSpec[],
  context: PageQaContext = {}
): PageQAResult[] {
  const results: PageQAResult[] = [];
  const accepted: PageSpec[] = [...existing];
  for (const spec of specs) {
    const result = runPageQaSync(spec, { ...context, existing: accepted });
    results.push(result);
    if (result.state === "PASS") accepted.push(spec);
  }
  return results;
}

/** Async batch — used by the run mode so the critic stage can be awaited. */
export async function qaCandidatePagesWithCritic(
  specs: readonly PageSpec[],
  existing: readonly PageSpec[],
  context: PageQaContext = {}
): Promise<PageQAResult[]> {
  const results: PageQAResult[] = [];
  const accepted: PageSpec[] = [...existing];
  for (const spec of specs) {
    const result = await runPageQa(spec, { ...context, existing: accepted });
    results.push(result);
    if (result.state === "PASS") accepted.push(spec);
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* THE WRITES A06 OWNS                                                        */
/* -------------------------------------------------------------------------- */

/**
 * THE SOLE WRITE TO `PageSpec.qa` (coherence issue 5). Every non-PENDING qa
 * state in this codebase comes through this function; A05 writes PENDING at
 * creation and never again, and a standing test scans `src/` and `tools/` to
 * prove it.
 *
 * Returns a NEW spec — A06 never mutates the object it was handed, so a caller
 * that discards the result has changed nothing.
 */
export function applyQaVerdict(spec: PageSpec, result: PageQAResult): PageSpec {
  return {
    ...spec,
    qa: { state: result.state, reasons: result.reasons },
    user_value_score: result.user_value_score,
  };
}

/**
 * THE LIFECYCLE EDGES A06 OWNS (coherence issue 13). A PASS moves STAGED ->
 * QA_PASS. A FAIL sends the page back for a rebuild, STAGED -> APPROVED — the
 * edge `lifecycle.ts` already documents. The owner alone owns QA_PASS ->
 * PUBLISHED, and A06 never returns it.
 *
 * Returns null when the page is not STAGED: QA is a fact ABOUT a staged page,
 * and A06 does not drag a page into staging to have an opinion about it.
 */
export function qaLifecycleTarget(
  from: PageLifecycleStatus,
  result: PageQAResult
): PageLifecycleStatus | null {
  if (from !== "STAGED") return null;
  return result.state === "PASS" ? "QA_PASS" : "APPROVED";
}

/* -------------------------------------------------------------------------- */
/* THE ONE PUBLISH GATE                                                       */
/* -------------------------------------------------------------------------- */

export interface ReleaseDecision {
  release_eligible: boolean;
  /** Every reason, in order. Populated on true as well as false. */
  reasons: string[];
  /** The verdict the decision was derived from — for the admin surface and the log. */
  qa: PageQAResult;
}

/**
 * THE SINGLE SERVER-SIDE RELEASE CONDITION (condition C10, coherence issue 6).
 *
 * `src/app/api/admin/pages/publish/route.ts` calls this and checks exactly one
 * boolean. There is no second gate beside it: the route no longer tests
 * `qa.state` itself — `qa.state` is one of the CONJUNCTS INSIDE this function,
 * which is what "derived from, not checked beside" means in practice.
 *
 * THE THREE CONJUNCTS, and why each one is load-bearing:
 *
 *  1. THE RECORDED VERDICT. `spec.qa.state === "PASS"` — the verdict A06 wrote
 *     when it ran. This is the conjunct that makes the rewire provably NOT a
 *     weakening: every page that returned 409 under the old gate still does,
 *     because the old gate WAS this conjunct. A PENDING page cannot become
 *     publishable by being re-checked at publish time.
 *  2. THE LIVE RE-VERIFICATION. A fresh deterministic run must produce no
 *     blocker. A stored PASS is a claim about content as it was; a page whose
 *     content or corpus has changed since must not ride an old verdict onto the
 *     public web. This conjunct is the one that can newly refuse a page — and
 *     when it does, it says which check, and it does NOT rewrite the stored
 *     `qa.state`. No stealth demotion: the queue shows the disagreement.
 *  3. THE HUMAN GATE. `publish_mode === "OWNER_APPROVAL"` and
 *     `human_approval_required` — pre-answer 1 point (2). A deterministic-only
 *     PASS is acceptable ONLY because a human publishes every page; the moment
 *     that stops being true, eligibility fails closed on its own.
 *
 * NO KILL-SWITCH CHECK HERE, deliberately. `checkKillSwitch("A06")` pauses THE
 * AGENT — its QA runs. A human publishing a page A06 already passed is not agent
 * activity, and a paused inspector that also froze the owner's own publish
 * button would be exactly backwards. Same reasoning A05 recorded for the owner's
 * edit path.
 */
export function evaluateReleaseForPublish(
  spec: PageSpec,
  context: PageQaContext = {}
): ReleaseDecision {
  const qa = runPageQaSync(spec, context);
  const reasons: string[] = [];

  const recordedPass = spec.qa.state === "PASS";
  if (!recordedPass) {
    reasons.push(
      `QA has not recorded a PASS for this page (qa.state = ${spec.qa.state}) — A06 is the sole writer of that field and it has not written one`
    );
  }
  if (!qa.release_eligible) {
    reasons.push(...qa.release_reasons.filter((r) => !r.startsWith("deterministic PASS")));
  }
  if (recordedPass && qa.state === "FAIL") {
    reasons.push(
      "the recorded PASS no longer verifies — this page's stored qa.state is NOT being rewritten; the disagreement is the finding"
    );
  }
  const eligible = recordedPass && qa.release_eligible;
  if (eligible) reasons.push(...qa.release_reasons);

  return { release_eligible: eligible, reasons, qa };
}

/* -------------------------------------------------------------------------- */
/* THE GAP A06 REFUSES TO FILL                                                */
/* -------------------------------------------------------------------------- */

/**
 * NO WAIVER PATH EXISTS, AND NONE WAS BUILT (pre-answer 8, verbatim: "Build no
 * waiver mechanism").
 *
 * Canon says A06 cannot waive its own blockers. The Approval Center is the
 * obvious future home for an override, but nothing has specced WHO may waive or
 * ON WHAT EVIDENCE — and an invented override is a hole in the one gate
 * protecting the public site. So a hard blocker in this codebase has no lift.
 *
 * THE HONEST CONSEQUENCE, recorded rather than papered over: A06's false-block
 * rate (§8) is UNCOMPUTABLE. There is no override event, so there is no way to
 * count the blocks a human would have lifted. That KPI reads "no data", not
 * "zero".
 *
 * TODO-ASK-OWNER (Joshua): who may waive an A06 blocker, on what evidence, and
 * does the waiver need its own event? Until that is answered, the honest state
 * is the one shipping.
 */
export const A06_WAIVER_PATH = {
  exists: false,
  false_block_rate_computable: false,
  note: "No waiver/override mechanism exists. A hard blocker has no lift, by decision (Loop Spec Audit pre-answer 8). false-block-rate is therefore uncomputable, not zero.",
} as const;
