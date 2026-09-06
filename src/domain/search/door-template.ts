import { z } from "zod";
import reviewedBinding from "../../../content/door-template/v43/binding.json";
import { FactBundle, type SearchOpportunity } from "@/domain/search/contracts";

const Text = z.string().min(1);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const SourceIds = z.array(Text);
const PendingRuntime = z.literal("CLAIMED_ON_PAGE_PENDING_RUNTIME_VERIFICATION");
export const V43_TEMPLATE_ID = "door-v43";
export const V43_TEMPLATE_VERSION = "43.0.0";
export const V43_TEMPLATE_BUNDLE_ID = "fb_door_v43_ac_warm_air";
export const V43_NOINDEX_REASON = "v43 production source, asset and runtime checks pending";

export const DirectAnswer = z.object({ text: Text, source_ids: SourceIds, evidence_status: z.literal("PENDING_SOURCE_VERIFICATION") }).strict();
export const ToolValue = z.object({
  heading: Text, claim: Text, rows: z.array(z.object({ generic: Text, ours: Text }).strict()).min(1),
  footnote: Text, runtime_status: PendingRuntime,
}).strict();
export const CapabilityQuestion = z.object({
  capability_id: Text, question: Text, answer: Text,
  claimed_status: z.enum(["CAN ANSWER", "CAN OFTEN ANSWER", "CAN ANSWER WHAT IT CHANGES", "CAN NARROW", "STILL NEEDS TESTING", "NOT SAFE TO DETERMINE REMOTELY"]),
  required_inputs: z.array(Text), optional_inputs: z.array(Text), possible_outputs: z.array(Text),
  safety_class: z.enum(["observation_only", "safe_homeowner_action", "licensed_electrical", "licensed_refrigerant", "documentation"]),
  runtime_status: PendingRuntime,
}).strict();
export const MetricCard = z.object({ metric_id: Text, value: Text, statement: Text, qualifier: Text, source_class: Text, source_ids: SourceIds }).strict();
export const VisualAsset = z.object({
  asset_id: Text, source_path: Text, source_sha256: Hash, public_svg_path: Text, raster_path: Text,
  width: z.number().int().positive(), height: z.number().int().positive(), title: Text, description: Text, caption: Text,
  raster_evidence_status: z.literal("REQUIRES_DEPLOYED_ASSET_CHECK"), og_image: z.boolean(),
}).strict();
export const Methodology = z.object({ path: z.literal("/local-records/methodology"), record_status: z.literal("BUILDING_REPAIR_RECORD"),
  text: Text, sample_size: z.null(), evidence_status: z.literal("NO_MEASURED_RECORD_EVIDENCE") }).strict();
export const SourceBinding = z.object({
  source_id: Text, publisher: Text, title: Text, url: z.string().url(), inherited_note: Text,
  evidence_status: z.literal("INHERITED_UNVERIFIED"), verified_at: z.null(), source_path: Text, source_sha256: Hash,
}).strict();
export const ClaimBinding = z.object({
  claim_id: Text, claim_type: z.enum(["quantitative", "cost_and_guidance", "capability"]), section_id: Text, text: Text,
  source_ids: SourceIds, capability_ids: z.array(Text),
  evidence_status: z.enum(["PENDING_SOURCE_VERIFICATION", "PENDING_RUNTIME_VERIFICATION"]),
}).strict();
const FrozenBlock = z.object({ block_id: Text, kind: z.enum(["intent_answer", "safe_checks", "custom"]), heading: Text, body_md: Text, source_fact_bundle_ids: SourceIds }).strict();
const PageFields = z.object({
  canonical_path: z.literal("/problems/ac-blowing-warm-air"), title: Text, meta_description: Text, h1: Text,
  hero: z.object({ headline: Text, subheadline: Text }).strict(), content_blocks: z.array(FrozenBlock).length(16),
  internal_links: z.array(z.object({ label: Text, path: Text }).strict()), template_id: z.literal("door-v43"), template_version: z.literal("43.0.0"),
  structured_data_plan: z.null(), safety_note_required: z.literal(true), problem_family: z.literal("hvac"),
  source_fact_bundle_ids: SourceIds, geography: z.object({ mode: z.literal("national"), country: z.literal("US") }).strict(),
  generation: z.object({ model: z.literal("frozen-template-v43"), prompt_id: z.null(), prompt_version: z.null() }).strict(),
}).strict();

/** Stable comparison ignores object-key order only; no visible words or fields are masked. */
export function stableV43Value(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableV43Value).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableV43Value(record[key])).join(",") + "}";
}

const Shape = z.object({
  template_id: z.literal("door-v43"), template_version: z.literal("43.0.0"), spec_id: z.literal("ac-blowing-warm-air"), spec_version: z.literal("43.0.0"),
  reference_sha256: Hash, source_tree_sha256: Hash, rendered_sha256: Hash, binding_sha256: Hash, content_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  canonical_path: z.literal("/problems/ac-blowing-warm-air"), title: Text, meta_description: Text, h1: Text,
  section_order: z.array(Text).length(15), sections: z.array(z.object({ section_id: Text, heading: Text, text: Text }).strict()).length(15),
  document_text: Text, supporting_text: Text, page_fields: PageFields,
  direct_answer: DirectAnswer, tool_value: ToolValue, capability_questions: z.array(CapabilityQuestion).length(9),
  metric_cards: z.array(MetricCard).length(3), visual_assets: z.array(VisualAsset).length(3), methodology: Methodology,
  source_bindings: z.array(SourceBinding).length(11), claim_bindings: z.array(ClaimBinding).min(1),
}).strict();
const frozen = Shape.parse(reviewedBinding);
const fingerprint = stableV43Value(frozen);
export const DoorTemplateBinding = Shape.superRefine((binding, ctx) => {
  if (stableV43Value(binding) !== fingerprint) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "v43 binding differs from reviewed frozen source; export a reviewed version, never edit owner/AI fields" });
});
export type DoorTemplateBinding = z.infer<typeof DoorTemplateBinding>;

/** A clone prevents one caller from changing the shared reviewed baseline. */
export function getV43DoorBinding(): DoorTemplateBinding { return structuredClone(frozen); }
export function v43ContentBlocks(binding: DoorTemplateBinding = getV43DoorBinding()) { return DoorTemplateBinding.parse(binding).page_fields.content_blocks; }
export function v43SpecFields(binding: DoorTemplateBinding = getV43DoorBinding()) { return DoorTemplateBinding.parse(binding).page_fields; }

export function isV43Opportunity(opportunity: SearchOpportunity, tenantId?: string): boolean {
  const keyword = opportunity.keyword.trim().toLowerCase().replace(/\s+/g, " ");
  return ["ac blowing warm air", "ac running but blowing warm air"].includes(keyword)
    && opportunity.intent_type === "problem"
    && (opportunity.problem_family_hint === "hvac" || opportunity.problem_family_hint === null)
    && opportunity.geography.mode === "national" && opportunity.geography.country === "US"
    && (opportunity.tenant_id === undefined || opportunity.tenant_id === "prn")
    && (tenantId === undefined || tenantId === "prn");
}

/** Only the in-repo source attribution is verified here. External claims remain pending. */
export function getV43TemplateBundle(): FactBundle {
  return FactBundle.parse({
    fact_bundle_id: V43_TEMPLATE_BUNDLE_ID, schema_version: "1.0.0", topic: "Frozen v43 AC door template; external claims unverified",
    geography: { mode: "national", country: "US" },
    facts: frozen.page_fields.content_blocks.map((block) => ({ fact_id: "fact_" + block.block_id, statement: block.body_md,
      source_url: "prn://door-template/v43/ac-blowing-warm-air#" + block.block_id,
      source_type: "frozen_template_source_only", verified_at: frozen.content_date + "T00:00:00Z", confidence: "high" })),
    rights_class: "first_party", ttl_days: 180, expires_at: null, permitted_page_classes: ["intent_door"], version: 43,
    created_at: frozen.content_date + "T00:00:00Z",
  });
}

/** Cross-object guard: editable generic fields cannot disagree with the actual frozen renderer. */
export function v43ProtectedFieldIssues(spec: Record<string, unknown>): string[] {
  const issues = Object.entries(frozen.page_fields).filter(([key, expected]) => stableV43Value(spec[key]) !== stableV43Value(expected)).map(([key]) => key);
  const query = typeof spec.primary_query === "string" ? spec.primary_query.trim().toLowerCase().replace(/\s+/g, " ") : "";
  if (!["ac blowing warm air", "ac running but blowing warm air"].includes(query)) issues.push("primary_query");
  if (spec.tenant_id !== undefined && spec.tenant_id !== "prn") issues.push("tenant_id");
  const intake = spec.intake_context as Record<string, unknown> | undefined;
  for (const [key, expected] of Object.entries({ page_id: spec.page_id,
    search_opportunity_id: spec.search_opportunity_id, intent_cluster_id: spec.intent_cluster_id,
    problem_family_hint: frozen.page_fields.problem_family })) {
    if (intake?.[key] !== expected) issues.push("intake_context." + key);
  }
  return issues;
}
