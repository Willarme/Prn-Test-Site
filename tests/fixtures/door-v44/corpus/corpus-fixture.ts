import { compileDoorV44Page, doorV44IntentReviewHash } from "@/domain/search/door-v44/compiler";
import { loadDoorV44Spec } from "@/domain/search/door-v44/loader";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import type { DoorV44CompilerContext } from "@/domain/search/door-v44/compiler-types";
import type { DoorV44RichText, DoorV44Spec, DoorV44SubjectKind, DoorV44Visual } from "@/domain/search/door-v44/types";
import { compilerFixture } from "../compiler-fixture";

/** Synthetic case material, not reviewed household guidance or production capability evidence. */
export const corpusDefinitions = [
  { id: "F02", query: "furnace blowing cold air", label: "furnace", kind: "equipment", nameplate: true, media: "photo", related: true,
    hazards: ["combustion", "carbon_monoxide"], checks: 3, faq: 5, roles: ["decision_observation", "safe_vs_sealed", "why_not_diy"],
    focus: "The simulated furnace case separates a reported cool supply stream from the recorded heating demand and the combustion safety boundary.",
    observations: ["Reported heating demand", "Recorded supply sensation", "Existing alarm report"],
    causes: ["An unresolved heating demand", "A delivery-path question", "A combustion assessment boundary"],
    stop: "The simulated carbon monoxide alarm report closes the ordinary observation path.", question: "Which alarm and heating-demand details belong together?" },
  { id: "F03", query: "heater will not turn on", label: "heater", kind: "equipment", nameplate: true, media: null, related: false,
    hazards: ["unknown_energy", "electrical"], checks: 2, faq: 6, roles: ["decision_observation", "safe_vs_sealed"],
    focus: "The simulated heater case leaves the heater category unresolved until an existing description distinguishes a portable appliance from a fixed heating system.",
    observations: ["Reported heater category", "Existing control description", "Reported power arrangement", "Timing of the inactive state"],
    causes: ["A control-state question", "An unresolved energy supply"],
    stop: "An unknown energy arrangement prevents selection of a physical test in this synthetic case.", question: "How does the heater category limit the next question?" },
  { id: "F04", query: "dishwasher not draining", label: "dishwasher", kind: "appliance", nameplate: false, media: "photo", related: true,
    hazards: ["water", "electrical"], checks: 2, faq: 4, roles: ["decision_observation", "safe_vs_sealed", "elapsed_time"],
    focus: "The simulated dishwasher case distinguishes the timing of standing water from an observed leak while keeping the water and electrical boundaries separate.",
    observations: ["Stage of the recorded cycle", "Standing-water location", "Existing leak report"],
    causes: ["A cycle-state question", "A discharge-path question", "An unresolved level observation", "A separate leak report"],
    stop: "The synthetic water and electrical hazard combination ends practical action suggestions.", question: "When was standing water first recorded in the cycle?" },
  { id: "F05", query: "refrigerator not cooling", label: "refrigerator", kind: "appliance", nameplate: true, media: null, related: false,
    hazards: ["food_safety", "electrical"], checks: 3, faq: 6, roles: ["decision_observation", "safe_vs_sealed", "elapsed_time", "extent"],
    focus: "The simulated refrigerator case tracks an existing temperature report and its elapsed-time uncertainty separately from any judgment about food suitability.",
    observations: ["Existing temperature report", "Time the change was noticed", "Compartment affected", "Recorded door state", "Food exposure uncertainty"],
    causes: ["A compartment-specific change", "An elapsed-time uncertainty", "A door-state question"],
    stop: "Food suitability remains outside the synthetic temperature account and requires appropriate authoritative guidance.", question: "What timing is actually known about the cooling change?" },
  { id: "F06", query: "water heater leaking", label: "water heater", kind: "equipment", nameplate: true, media: "photo", related: false,
    hazards: ["water", "energy", "scalding"], checks: 1, faq: 5, roles: ["decision_observation", "safe_vs_sealed", "extent"],
    focus: "The simulated urgent water heater case records the reported spread and location of water while leaving the energy source and temperature exposure explicitly unresolved.",
    observations: ["Reported water location", "Recorded spread", "Existing energy-source description", "Reported exposure boundary"],
    causes: ["An external connection question", "A vessel-origin question", "A surrounding-water possibility", "An unresolved discharge report"],
    stop: "The simulated water and energy exposure closes the ordinary observation branch immediately.", question: "Which reported exposure makes this an urgent account?" },
  { id: "F07", query: "toilet keeps running", label: "toilet", kind: "fixture", nameplate: false, media: null, related: false,
    hazards: ["water_overflow"], checks: 2, faq: 4, roles: ["decision_observation", "safe_vs_sealed"],
    focus: "The simulated toilet case distinguishes a continuous running sound from an intermittent refill report using location and timing instead of an equipment label.",
    observations: ["Pattern of the recorded sound", "Existing overflow report"],
    causes: ["An unresolved refill pattern"],
    stop: "A simulated overflow report ends the ordinary timing comparison.", question: "Is the recorded sound continuous or intermittent?" },
  { id: "F08", query: "ceiling stain after rain", label: "ceiling stain", kind: "current_problem", nameplate: false, media: "photo", related: true,
    hazards: ["overhead_material", "concealed_electrical"], checks: 2, faq: 5, roles: ["decision_observation", "safe_vs_sealed", "extent", "elapsed_time"],
    focus: "The simulated ceiling stain case records the stained material, its extent and its relationship to a rain event while keeping the concealed origin unresolved.",
    observations: ["Stained material already described", "Extent in the existing account", "Timing relative to rain"],
    causes: ["A weather-linked origin question", "A concealed-service question"],
    stop: "The simulated overhead-material concern closes the ordinary record-gathering branch.", question: "How does the stain account relate to the rain timeline?" },
  { id: "F09", query: "sewage smell in basement", label: "basement smell", kind: "current_problem", nameplate: false, media: null, related: false,
    hazards: ["biohazard", "air_quality"], checks: 1, faq: 6, roles: ["decision_observation", "safe_vs_sealed", "extent"],
    focus: "The simulated basement smell case retains the reported location and onset while separating an odor description from identification of any gas or biological exposure.",
    observations: ["Location in the existing account", "Recorded onset", "Reported affected area", "Existing exposure report"],
    causes: ["An unresolved drainage association", "An unidentified air-quality concern", "A separate moisture association"],
    stop: "The synthetic air-quality or biohazard exposure report routes away from ordinary observation prompts.", question: "Which parts of the odor account remain unidentified?" },
  { id: "F10", query: "outlet feels hot", label: "outlet", kind: "object", nameplate: false, media: null, related: false,
    hazards: ["electrical_heat", "fire"], checks: 1, faq: 4, roles: ["decision_observation", "safe_vs_sealed"],
    focus: "The simulated outlet case begins with an existing heat report and the electrical stop boundary; it contains recorded evidence only and excludes a new touch test.",
    observations: ["Existing heat description", "Already reported visible change"],
    causes: ["An unresolved contact condition", "An unresolved load association"],
    stop: "The synthetic electrical heat report activates the stop boundary before any physical-test proposal.", question: "What was already reported before the stop boundary?" },
  { id: "F11", query: "branch on roof after storm", label: "branch on roof", kind: "current_problem", nameplate: false, media: null, related: true,
    hazards: ["weather", "structural", "downed_line"], checks: 1, faq: 5, roles: ["decision_observation", "safe_vs_sealed", "extent"],
    focus: "The simulated storm case uses an existing ground-level account of a branch and affected roof area while leaving structural stability and line status unresolved.",
    observations: ["Previously recorded branch position", "Affected roof area in the account", "Existing line-status report", "Recorded weather context", "Unresolved structural condition"],
    causes: ["A branch-contact question", "An unresolved roof-load question", "An unidentified line association", "A continuing weather boundary"],
    stop: "The synthetic downed-line or structural concern ends ordinary access and inspection suggestions.", question: "Which recorded detail establishes the access boundary?" },
] as const;
export type CorpusId = typeof corpusDefinitions[number]["id"];
export interface CorpusFixture { spec: DoorV44Spec; context: DoorV44CompilerContext; definition: typeof corpusDefinitions[number] }
const rich = (value: string): DoorV44RichText => [{ type: "text", value }];

export async function corpusFixture(id: CorpusId): Promise<CorpusFixture> {
  const definition = corpusDefinitions.find(row => row.id === id);
  if (!definition) throw new Error("Unknown synthetic corpus fixture");
  const d = definition;
  const seed = await compilerFixture(d.kind === "current_problem" ? "f08" : "f04");
  const base = seed.spec.identity.family_id;
  const remap = (value: unknown): unknown => typeof value === "string" ? value.replaceAll(base.toLowerCase(), id.toLowerCase()).replaceAll(base, id)
    .replaceAll("fixture.source.manual", "fixture.source." + id.toLowerCase()).replaceAll("fixture.claim.observation", "fixture.claim." + id.toLowerCase())
    : Array.isArray(value) ? value.map(remap) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)])) : value;
  const { spec, context } = remap(seed) as typeof seed;
  const key = id.toLowerCase();
  const slug = d.query.replaceAll(" ", "-");
  const title = d.query[0].toUpperCase() + d.query.slice(1);
  spec.identity.slug = slug; spec.identity.canonical_path = "/problems/" + slug;
  spec.intent.primary_query = d.query;
  spec.intent.primary_decision = d.question;
  spec.intent.sub_intents = [...d.observations];
  spec.intent.problem_state = ["F06", "F09", "F10", "F11"].includes(id) ? "urgent" : "symptom";
  spec.subject = { subject_id: "fixture.subject." + key, display_label: d.label, short_label: d.label,
    cta_label: d.kind === "current_problem" ? "THIS PROBLEM" : d.label.toUpperCase(), second_person_label: d.kind === "current_problem" ? "this problem" : "your " + d.label,
    possessive_label: d.kind === "current_problem" ? "this problem's" : "your " + d.label + "'s", plural_label: d.label + " cases", subject_kind: d.kind as DoorV44SubjectKind };
  const patternIds = Object.values(spec.actions).map(action => action.pattern_id);
  context.validation.subjects = [{ ...spec.subject, allowed_pattern_ids: patternIds, allowed_family_ids: [id] }];
  spec.head.page.title = title + ": a synthetic evidence case";
  spec.head.page.meta_description = "Synthetic case for " + d.query + ": " + d.observations[0].toLowerCase() + " and the " + d.hazards[0].replaceAll("_", " ") + " boundary.";
  spec.head.page.og_description = spec.head.page.meta_description;
  spec.head.nav.category_label = d.label + " cases"; spec.head.crumb.family_label = spec.head.nav.category_label; spec.head.crumb.problem_label = title;
  const familyPage = context.validation.pages.find(row => row.page_id === spec.head.nav.category_page_id)!;
  context.validation.pages = [{ ...familyPage, canonical_path: "/problems/synthetic-" + key },
    { page_id: spec.identity.page_id, tenant_id: spec.identity.tenant_id, canonical_path: spec.identity.canonical_path, family_id: id, live: false, redirect_to: null }];
  context.validation.eligibilities = [{ receipt_id: spec.intent.page_eligibility_receipt, tenant_id: spec.identity.tenant_id, page_id: spec.identity.page_id,
    opportunity_id: spec.identity.opportunity_id, canonical_intent_id: spec.identity.canonical_intent_id, intent_cluster_id: spec.identity.intent_cluster_id,
    family_id: id, primary_decision: d.question, primary_query: d.query }];
  spec.intake.attribution.landing_path = spec.identity.canonical_path;
  spec.intake.heading = rich("Start with " + spec.subject.second_person_label);
  spec.intake.lede = d.focus;
  spec.intake.placeholder = "The synthetic account records " + d.observations[0].toLowerCase() + ".";
  spec.intake.prompts[0].text = "Use the existing account of " + d.observations[0].toLowerCase() + ".";
  spec.intake.prompts[1].evidence_type = d.nameplate ? "nameplate" : "location_material";
  spec.intake.prompts[1].text = d.nameplate ? "An existing label description may identify the " + d.label + " category." : "Use the recorded location and material of the " + d.label + " case.";
  spec.intake.prompts[2].text = "Keep the unrecorded " + d.observations.at(-1)!.toLowerCase() + " explicitly unknown.";
  spec.intake.so_far_items = [d.observations[0], d.observations[1], "Unresolved " + d.hazards[0].replaceAll("_", " ") + " boundary"];
  spec.layout.conditional_sections.nameplate_help = d.nameplate;
  spec.intake.media_controls = d.media ? [{ kind: d.media, capability_id: "home_problem_analyzer" }] : [];
  spec.layout.conditional_sections.media_controls = Boolean(d.media);
  context.validation.capabilities.find(row => row.capability_id === "home_problem_analyzer")!.media_kinds = d.media ? [d.media] : [];

  const hero = spec.sections.hero;
  hero.badge_problem = d.label; hero.h1 = rich(title); hero.cap_last = rich("A synthetic account of " + spec.subject.second_person_label);
  hero.answer = [{ type: "paragraph", children: [...rich(d.focus + " This case uses invented records to exercise the relationship between the reported observation, the unanswered question and the permitted evidence boundary. Every example belongs to a nonpublic software test. The record separates an existing description from a physical action, and any conclusion requiring measurement remains a qualified assessment question. The controlled source below exists solely for this test."), { type: "source_ref", source_id: spec.sources[0].source_id, label: "Synthetic case source" }] }];
  hero.value_heading = "Record the " + d.label + " evidence"; hero.value_claim = "Keep the " + d.hazards[0].replaceAll("_", " ") + " boundary explicit";
  hero.value_rows.forEach((row, i) => { row.generic = ["An isolated symptom", "A missing timeline", "An assumed category", "An unclear limit", "A detached source"][i]; row.ours = rich([d.observations[0], d.observations[1], d.observations.at(-1)!, d.question, "A traceable synthetic " + d.label + " case"][i]); });
  const family = { family_id: id, source_family_id: "fixture.family." + key, reviewed: true, protocol_ids: ["fixture.protocol." + key],
    protocol_check_ids: Array.from({ length: Math.max(d.observations.length, d.checks) }, (_, i) => `fixture.check.${key}.${i}`),
    hazard_ids: d.hazards.map(hazard => `fixture.hazard.${key}.${hazard}`), eval_receipt_ids: d.hazards.map(hazard => `fixture.eval.${key}.${hazard}`) };
  context.validation.families = [family];
  spec.sections.observations.rows = d.observations.map((look, i) => ({ id: `${key}.observation.${i}`, look,
    rules_out: "This recorded " + look.toLowerCase() + " supports a question, not a diagnosis.", protocol_check_id: family.protocol_check_ids[i] }));
  spec.sections.common_causes.rows = d.causes.map((cause, i) => ({ id: `${key}.cause.${i}`, cause,
    notice: "Synthetic branch awaiting evidence about " + cause.toLowerCase() + ".", fix_class: "never", fix_label: "Qualified evidence required", range: null,
    omission_reason: "Synthetic corpus has no reviewed price evidence.", claim_ids: [] }));
  const safety = spec.sections.safe_observations;
  safety.protocol_id = family.protocol_ids[0]; safety.hazard_ids = [...family.hazard_ids]; safety.eval_receipt_ids = [...family.eval_receipt_ids];
  safety.lede = "Synthetic case boundary for " + d.hazards.map(hazard => hazard.replaceAll("_", " ")).join(" and ") + ".";
  safety.checks = Array.from({ length: d.checks }, (_, i) => ({ id: `${key}.check.${i}`, heading: d.observations[i],
    body: "Use only the invented account of " + d.observations[i].toLowerCase() + "; this case prescribes no physical test.", protocol_check_id: family.protocol_check_ids[i] }));
  safety.never_items = family.hazard_ids.map((hazard_id, i) => ({ id: `${key}.never.${i}`, hazard_id, text: "This synthetic " + d.hazards[i].replaceAll("_", " ") + " boundary excludes physical intervention." }));
  safety.stop_items = family.hazard_ids.map((hazard_id, i) => ({ id: `${key}.stop.${i}`, hazard_id, text: i === 0 ? d.stop : "The recorded " + d.hazards[i].replaceAll("_", " ") + " concern requires a separate qualified safety path." }));
  spec.sections.stats.cards.forEach((row, i) => { row.statement = ["The synthetic case stores an existing " + d.observations[0].toLowerCase() + ".", "The synthetic case retains the " + d.hazards[0].replaceAll("_", " ") + " boundary.", "The synthetic case leaves its cost evidence unavailable."][i]; });
  spec.sections.flip.columns.forEach((row, i) => { row.body = [d.focus, d.question, "The " + d.label + " record keeps its source and uncertainty together."][i]; });
  spec.sections.general_vs_yours.rows.forEach((row, i) => { row.where = ["A symptom label", "A timeline", "A category description", "A hazard report"][i]; row.ours = [d.observations[0], d.observations[1], d.question, d.stop][i]; });
  spec.sections.capability.rows.forEach((row, i) => { row.ask = i === 4 ? "What in my account still requires a qualified assessment?" : "What does my " + d.observations[i % d.observations.length].toLowerCase() + " change?"; row.tells = i === 4 ? "The " + d.label + " conclusion still requires testing." : "The synthetic account can retain " + d.observations[i % d.observations.length].toLowerCase() + "."; });
  spec.sections.job_packet.example_rows.forEach(row => {
    if (row.key === "equipment" || row.key === "location_material") { row.key = d.nameplate ? "equipment" : "location_material"; row.value = d.nameplate ? "Synthetic category: " + d.label : "Recorded location and material for the " + d.label + " case"; }
    else row.value = ({ problem: d.query, context: d.observations[1], ruled_out: "The synthetic account supplies observations rather than exclusions", still_to_test: d.causes[0] } as Record<string, string>)[row.key];
  });
  spec.sections.faq.questions = Array.from({ length: d.faq }, (_, i) => ({ id: `${key}.faq.${i}`,
    kind: (["urgent", "diy", "cost", "lead_privacy", "other", "other"] as const)[i],
    question: ["Which safety boundary changes this case?", "Does this case prescribe a physical test?", "What cost evidence exists for this case?", "Does this synthetic form send a household lead?", d.question, "What remains unresolved in the " + d.label + " record?"][i],
    answer: rich([d.stop, "This is an invented evidence record; physical intervention is outside its scope.", "The " + d.label + " case has no reviewed price evidence.", "This fixture is compiled offline with an inert test journey; no household lead is sent.", d.focus, "The record leaves " + d.causes[0].toLowerCase() + " unresolved."][i]) }));
  spec.sections.closer.heading = rich("Start with " + spec.subject.second_person_label); spec.sections.closer.body = "Keep " + d.observations[0].toLowerCase() + " with the synthetic " + d.label + " account.";
  const visualSeed = spec.visuals[0]; const assetSeed = context.asset_records[0];
  spec.visuals = d.roles.map((role, i) => ({ ...structuredClone(visualSeed), id: `${key}.visual.${i}`, asset_id: `fixture.asset.${key}.${i}`, role: role as DoorV44Visual["role"],
    title: "Synthetic " + d.label + " " + role.replaceAll("_", " "), alt: "Synthetic " + d.label + " " + role.replaceAll("_", " "),
    caption: rich("Synthetic diagram for the " + d.label + " " + role.replaceAll("_", " ") + " record."), plate_class: "plate-" + (i + 1) }));
  context.validation.visual_assets = spec.visuals.map(visual => ({ ...structuredClone(visual), tenant_id: spec.identity.tenant_id }));
  context.asset_records = spec.visuals.map(visual => ({ ...assetSeed, asset_id: visual.asset_id }));
  const sourceHash = doorV44Hash({ fixture: id, focus: d.focus, hazards: d.hazards, provenance: "invented evidence only" });
  const claimHash = doorV44Hash({ fixture: id, label: "1", provenance: "single synthetic case" });
  spec.claims.forEach(row => { row.content_hash = claimHash; });
  context.validation.claims = structuredClone(spec.claims);
  context.validation.sources = context.validation.sources.filter(row => row.source_id === spec.sources[0].source_id).map(row => ({ ...row, content_hash: sourceHash }));
  context.source_records.forEach(row => { row.content_hash = sourceHash; row.title = "Synthetic " + d.label + " evidence record"; row.url = row.canonical_url = "https://fixture.example/corpus/" + key; });
  context.fact_records.forEach(row => { row.content_hash = claimHash; row.denominator = "A synthetic " + d.label + " case"; row.methodology_id = "fixture.methodology." + key; });
  spec.layout.conditional_sections.related = d.related;
  spec.related_page_ids = d.related ? [`fixture.${key}.sibling_context`, `fixture.${key}.sibling_boundary`] : [];
  if (d.related) {
    spec.sections.related = { links: spec.related_page_ids.map((page_id, i) => ({ page_id, label: d.label + (i ? " boundary case" : " context case") })) };
    context.validation.pages.push(...spec.related_page_ids.map((page_id, i) => ({ page_id, tenant_id: spec.identity.tenant_id, canonical_path: `/problems/synthetic-${key}-sibling-${i}`, family_id: id, live: true, redirect_to: null })));
  } else delete spec.sections.related;
  context.intent_review = { receipt_id: "fixture_intent_review_" + key, content_hash: doorV44IntentReviewHash(spec) };
  context.validation.input_hashes.corpus_case_sha256 = doorV44Hash(d);
  return { spec, context, definition };
}

/** Test-only orchestration: the real pure loader runs before the real compiler can be invoked. */
export function preflightCorpusFixture(input: CorpusFixture) { return loadDoorV44Spec(input.spec, input.context.validation); }
export async function compileCorpusFixture(input: CorpusFixture, compile = compileDoorV44Page) {
  const preflight = preflightCorpusFixture(input);
  if (!preflight.ok) return { ...preflight, stage: "preflight" as const };
  return { ...await compile(input.spec, input.context), stage: "compile" as const };
}
