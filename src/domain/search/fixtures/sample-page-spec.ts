import {
  handcraftedDoorBundle,
  handcraftedDoorBundleId,
} from "@/domain/search/content-bank-provenance";
import { PageSpec } from "@/domain/search/pages";

/**
 * Door Wave 2: the ONE excellent handcrafted template instance, built before
 * A05 is allowed to generate at scale. Content is deliberately conservative:
 * genuinely useful, no diagnosis, no dangerous instructions, no invented
 * facts or local claims.
 *
 * PROVENANCE, BACKFILLED (inspection F1/F2). This page predates the provenance
 * seam: every block carried `source_fact_bundle_ids: []`, which meant the
 * urgency lint blocked it and its OWNER COULD NOT EDIT IT — the edit path runs
 * the same lint as the generator, correctly, and this page failed it. It does
 * NOT cite the hvac content-bank bundle, because its copy is not the content
 * bank's copy: it was written by hand, block by block, and includes a closing
 * FAQ the bank has no fact for. It cites a bundle of its own, minted below from
 * its own authored text. No customer-visible copy changed; nothing renders
 * `source_fact_bundle_ids`.
 */
const DOOR_KEY = "ac_not_turning_on";
const CREATED_AT = "2026-08-14T00:00:00Z";
const BUNDLE_ID = handcraftedDoorBundleId(DOOR_KEY);
export const SAMPLE_PAGE_SPEC: PageSpec = PageSpec.parse({
  page_spec_id: "ps_ac_not_turning_on_v1",
  schema_version: "1.0.0",
  page_id: "page_ac_not_turning_on",
  version: 1,
  status: "STAGED",
  intent_id: "intent_ac_not_turning_on",
  intent_cluster_id: "ic_hvac_no_power",
  search_opportunity_id: "so_seed_ac_not_turning_on_355a5905",
  primary_query: "ac not turning on",
  supporting_queries: ["why is my ac not turning on", "ac won't turn on"],
  problem_family: "hvac",
  geography: { mode: "national", country: "US" },
  canonical_path: "/problems/ac-not-turning-on",
  title: "AC Not Turning On? What It Can Mean and What's Safe to Check",
  meta_description:
    "Your AC won't turn on. What that can mean, the few things that are safe to check yourself, what not to do, and when it becomes urgent.",
  h1: "Your AC won't turn on",
  hero: {
    headline: "AC not turning on?",
    subheadline:
      "Before anyone talks you into a service call you may not need — here's what this usually involves, and what's actually safe to check.",
  },
  content_blocks: [
    {
      block_id: "blk_intent_answer",
      kind: "intent_answer",
      heading: "What this usually means",
      body_md:
        "An AC that won't turn on at all is a different situation from one that runs but blows warm. A completely unresponsive system most often traces to power or controls: the thermostat, a tripped breaker, a safety switch (many air handlers have a float switch that cuts power when the drain pan is full), or the outdoor unit's disconnect. It can also be a failed capacitor or contactor — parts a technician can test in minutes but that aren't safe to probe yourself. The honest answer: several common causes look identical from the outside, which is exactly why a clear description of what you observed helps so much.",
      source_fact_bundle_ids: [BUNDLE_ID],
    },
    {
      block_id: "blk_safe_checks",
      kind: "safe_checks",
      heading: "Safe things to check first",
      body_md:
        "- Thermostat: is the display on, set to COOL, and set below room temperature? If it runs on batteries, try fresh ones.\n- Breaker panel: look for a tripped breaker labeled AC, air handler, or furnace. If one is tripped, you may reset it ONCE. If it trips again, stop — that's a signal for a professional.\n- Filter: a badly clogged filter can overheat a system until it shuts itself off. If it's gray and matted, replace it.\n- Condensate: if you can see the drain pan under an attic or closet air handler and it's full of water, a float switch may have cut the power on purpose.",
      source_fact_bundle_ids: [BUNDLE_ID],
    },
    {
      block_id: "blk_do_not",
      kind: "do_not_do",
      heading: "What not to do",
      body_md:
        "- Don't keep resetting a breaker that keeps tripping — breakers trip for a reason.\n- Don't open the outdoor unit or electrical panels beyond the breaker switch itself. Capacitors hold a charge even with power off.\n- Don't run the system if you noticed a burning smell when it last tried to start.",
      source_fact_bundle_ids: [BUNDLE_ID],
    },
    {
      block_id: "blk_urgency",
      kind: "when_urgency_changes",
      heading: "When this becomes urgent",
      body_md:
        "A cooling outage is usually a comfort problem, not an emergency — with exceptions. Treat it as urgent if there's any burning or electrical smell, visible sparking, or a breaker that immediately re-trips; and prioritize it on dangerous-heat days if anyone in the home is elderly, an infant, or medically heat-sensitive.",
      source_fact_bundle_ids: [BUNDLE_ID],
    },
    {
      block_id: "blk_who",
      kind: "who_handles_it",
      heading: "Who typically handles this",
      body_md:
        "This is HVAC territory. If your checks point at the breaker panel itself (a burnt smell at the panel, a breaker that won't reset), it can cross into electrician territory — one more reason a clear, organized description helps route it to the right trade the first time.",
      source_fact_bundle_ids: [BUNDLE_ID],
    },
    {
      block_id: "blk_faq",
      kind: "faq",
      heading: "Quick answers",
      body_md:
        "**Why does my AC hum but not start?** A hum with no start often points at a capacitor or motor issue — testable by a technician, not safe to probe yourself.\n\n**Does it matter that it happened after a power outage?** Yes, mention it. Some systems need a few minutes of delay after power returns, and surges can also trip built-in protection. It's a useful clue — include it in your description.",
      source_fact_bundle_ids: [BUNDLE_ID],
    },
  ],
  safety_note_required: true,
  structured_data_plan: null,
  internal_links: [],
  intake_context: {
    page_id: "page_ac_not_turning_on",
    intent_cluster_id: "ic_hvac_no_power",
    search_opportunity_id: "so_seed_ac_not_turning_on_355a5905",
    problem_family_hint: "hvac",
  },
  monetization_eligible: false,
  monetization_policy_id: null,
  user_value_score: null,
  indexed: true,
  noindex_reason: null,
  // THE SHAPE THIS PAGE ACTUALLY HAS (inspection F4). It claimed
  // "tpl_intent_page" while carrying a sixth block — the closing FAQ — that the
  // factory never emits and that template never declared. tpl_intent_page_faq
  // is that same shape plus the FAQ slot, registered in template.ts. Nothing
  // renders from a TemplateSpec, so this changes no markup; it changes what the
  // registry TRUTHFULLY describes.
  template_id: "tpl_intent_page_faq",
  template_version: "1.0.0",
  generation: { model: null, prompt_id: null, prompt_version: null },
  experiment: { experiment_id: null, variant: null },
  qa: { state: "PENDING", reasons: [] },
  source_fact_bundle_ids: [BUNDLE_ID],
  created_at: CREATED_AT,
  updated_at: null,
});

/**
 * THE BUNDLE THOSE IDS POINT AT — minted FROM this page's own blocks, so the
 * citation cannot claim a statement the page does not make. It is registered
 * beside the content-bank bundles rather than inside them: `handcrafted_door`
 * is a different source from `content_bank`, and collapsing the two would let a
 * generated page cite handcrafted copy (or the reverse) without anyone noticing.
 *
 * Geography is `national/US` for the same reason the content bank's is: this
 * page's safety guidance names US breaker panels and US emergency numbers, and
 * saying so in data beats leaving it implicit in prose.
 */
export const SAMPLE_PAGE_BUNDLE = handcraftedDoorBundle(
  DOOR_KEY,
  SAMPLE_PAGE_SPEC.content_blocks,
  { geography: { mode: "national", country: "US" }, created_at: CREATED_AT }
);
