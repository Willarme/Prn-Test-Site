/** TypeScript view only. The checked-in draft-07 schemas own runtime shape. */
export type DoorV44IndexPolicy = "trial_noindex" | "staged_noindex" | "public_indexable";
export type DoorV44SubjectKind = "equipment" | "appliance" | "fixture" | "object" | "current_problem";
export type DoorV44CapabilityStatus = "VERIFIED_LIVE" | "PREVIEW" | "HIDDEN" | "UNVERIFIED";
export interface DoorV44Diagnostic { code: string; pointer: string }
export type DoorV44RichText = DoorV44RichNode[];
export type DoorV44RichNode =
  | { type: "text"; value: string }
  | { type: "source_ref"; source_id: string; label: string }
  | { type: "fact_ref"; claim_id: string; label: string }
  | { type: "line_break" }
  | { type: "paragraph" | "sentence" | "strong" | "emphasis" | "ordered_list" | "unordered_list" | "list_item"; children: DoorV44RichNode[] };
export interface DoorV44Subject {
  subject_id: string; display_label: string; short_label: string; cta_label: string;
  second_person_label: string; possessive_label: string; plural_label: string; subject_kind: DoorV44SubjectKind;
}
export interface DoorV44Action { pattern_id: string; target: "#intake" }
export interface DoorV44Disclosure { id: string; content_hash: string; purpose: string }
export interface DoorV44SourceRef { source_id: string; cite: boolean; claim_ids: string[]; note: string }
export interface DoorV44ClaimRef { claim_id: string; source_ids: string[]; content_hash: string }
export interface DoorV44CapabilityRef {
  capability_id: string; live_status: DoorV44CapabilityStatus; production_receipt: string | null;
}
export interface DoorV44Visual {
  id: string; asset_id: string; role: "decision_observation" | "safe_vs_sealed" | "why_not_diy" | "extent" | "elapsed_time";
  claim_ids: string[]; title: string; description: string; caption: DoorV44RichText; alt: string;
  inline_hash: string; raster_hash: string; width: number; height: number; mime: "image/png" | "image/webp";
  authored_status: "fixture" | "reviewed"; review_receipt: string | null; plate_class: string;
}
export interface DoorV44Intake {
  heading: DoorV44RichText; lede: string; field_label: string; placeholder: string; help: string;
  prompts: Array<{ id: string; kind: "known_reading" | "photograph_label" | "know_nothing";
    evidence_type: "reading" | "nameplate" | "location_material" | "description"; text: string }>;
  so_far_label: string; so_far_items: string[]; submit_action: "hero_start"; disclosure: DoorV44Disclosure;
  attribution: { page_id: string; intent_cluster_id: string; search_opportunity_id: string; problem_family_hint: string; landing_path: string };
  media_controls: Array<{ kind: "photo" | "video" | "audio"; capability_id: string }>;
}
export interface DoorV44Head {
  page: { title: string; meta_description: string; og_description: string };
  site: { name_token: "{{site.name}}"; origin: string };
  brand: { a: string; b: string; warn: string; theme: string };
  nav: { category_page_id: string; category_label: string; cta_action: "hero_start" };
  crumb: { family_page_id: string; family_label: string; problem_label: string };
  accents: { map: Array<{ text: string; color_class: string }> };
}
export interface DoorV44Sections {
  hero: { badge_problem: string; badge_tail: string; h1: DoorV44RichText; answer: DoorV44RichText;
    cap_last: DoorV44RichText; value_heading: string; value_claim: string;
    value_rows: Array<{ id: string; generic: string; ours: DoorV44RichText }>; value_foot: DoorV44RichText };
  stats: { heading: DoorV44RichText; cards: Array<{ id: string; icon_id: string; icon_class: string;
    value: DoorV44RichText; statement: string; note: string; source_class: string; claim_id: string;
    question_type: "simple" | "urgent" | "cost"; metric_family: string }>; source_note: DoorV44RichText; band: DoorV44RichText };
  observations: { heading: DoorV44RichText; columns: Array<{ label: string; mw_class: string }>;
    rows: Array<{ id: string; look: string; rules_out: string; protocol_check_id: string }> };
  common_causes: { heading: DoorV44RichText; columns: Array<{ label: string; mw_class: string }>;
    rows: Array<{ id: string; cause: string; notice: string; fix_class: "yes" | "care" | "never";
      fix_label: string; range: DoorV44RichText | null; omission_reason: string | null; claim_ids: string[] }> };
  safe_observations: { heading: DoorV44RichText; lede: string;
    checks: Array<{ id: string; heading: string; body: string; protocol_check_id: string }>;
    never_items: Array<{ id: string; text: string; hazard_id: string }>;
    stop_items: Array<{ id: string; text: string; hazard_id: string }>; cta_action: "hero_start" | "walkthrough_start";
    protocol_id: string; hazard_ids: string[]; eval_receipt_ids: string[] };
  visuals: { heading: DoorV44RichText };
  flip: { heading: DoorV44RichText; columns: Array<{ id: string; heading: string; body: string }> };
  general_vs_yours: { heading: DoorV44RichText; columns: Array<{ label: string; mw_class: string }>;
    rows: Array<{ id: string; where: string; gives: string; ours: string }> };
  capability: { heading: DoorV44RichText; columns: Array<{ label: string; mw_class: string }>;
    rows: Array<{ id: string; capability_id: string; ask: string; tells: string; chip_class: string;
      chip_label: "CAN ANSWER" | "CAN OFTEN ANSWER" | "CAN ANSWER WHAT IT CHANGES" | "CAN NARROW" | "STILL NEEDS TESTING" }>;
    band_hook: DoorV44RichText };
  job_packet: { heading: DoorV44RichText; cta_action: "packet_start";
    example_rows: Array<{ id: string; key: "problem" | "context" | "equipment" | "location_material" | "ruled_out" | "still_to_test"; value: string }>;
    band_hook: string };
  repair_record: { heading: DoorV44RichText; cards: Array<{ id: string; color_class: string; icon_id: string;
    scope_chip: "National first" | "Best available scope" | "Where labels are available" | "Local as density grows";
    kicker: string; value: "Building the repair record"; copy: string; public_fact_id: null }> };
  faq: { heading: DoorV44RichText; questions: Array<{ id: string;
    kind: "urgent" | "diy" | "cost" | "lead_privacy" | "other"; question: string; answer: DoorV44RichText }> };
  related?: { links: Array<{ page_id: string; label: string }> };
  closer: { heading: DoorV44RichText; body: string; cta_action: "hero_start" };
  sources: { intro_tail: string; note_lead: string };
}
export interface DoorV44Spec {
  $schema: "https://schemas.propertyresponsenetwork.com/doorspec/2.0.0.json";
  schema_version: "doorspec/2.0.0";
  identity: { tenant_id: string; page_id: string; page_version: number; opportunity_id: string;
    canonical_intent_id: string; intent_cluster_id: string; family_id: string; locale: "en-US";
    geography_scope: "national"; slug: string; canonical_path: string };
  versions: { template: string; theme: string; taxonomy: string; prompt_identities: Array<{ capability: string; name: string; version: string; hash: string }>; source_bundle: string };
  intent: { primary_decision: string; primary_query: string; query_aliases: string[]; sub_intents: string[];
    problem_state: "symptom" | "known_cause" | "comparison" | "urgent" | "cost" | "prevention"; page_eligibility_receipt: string };
  subject: DoorV44Subject;
  layout: { order_profile_id: "order-b"; conditional_sections: { related: boolean; nameplate_help: boolean;
    media_controls: boolean; prices: boolean; local_stats: boolean; founders_offer: boolean } };
  head: DoorV44Head; actions: { hero_start: DoorV44Action; packet_start: DoorV44Action; walkthrough_start?: DoorV44Action };
  intake: DoorV44Intake; claims: DoorV44ClaimRef[]; sources: DoorV44SourceRef[];
  capabilities: DoorV44CapabilityRef[]; visuals: DoorV44Visual[]; sections: DoorV44Sections;
  related_page_ids: string[]; release: { index_policy: DoorV44IndexPolicy; approved_content_at: string | null };
}
export interface DoorV44ValidationContext {
  schema_bundle: readonly unknown[]; mode: "fixture" | "live"; tenant_id: string; content_baseline_id: "ac-v43";
  versions: { template: string; schema: string; theme: string; taxonomy: string; source_bundle: string };
  prompt_identities: DoorV44Spec["versions"]["prompt_identities"];
  origin: string; index_policy: DoorV44IndexPolicy; approved_content_at: string | null; evaluated_at: string;
  disclosure: DoorV44Disclosure;
  subjects: Array<DoorV44Subject & { allowed_pattern_ids: string[]; allowed_family_ids: string[] }>;
  action_patterns: Array<{ pattern_id: string; target: "#intake"; subject_kinds: DoorV44SubjectKind[] }>;
  sources: Array<{ source_id: string; content_hash: string; reviewed: boolean; expires_at: string | null; claim_ids: string[] }>;
  claims: DoorV44ClaimRef[];
  pages: Array<{ page_id: string; tenant_id: string; canonical_path: string; family_id: string; live: boolean; redirect_to: string | null }>;
  families: Array<{ family_id: string; source_family_id: string; reviewed: boolean; protocol_ids: string[]; protocol_check_ids: string[]; hazard_ids: string[]; eval_receipt_ids: string[] }>;
  eligibilities: Array<{ receipt_id: string; tenant_id: string; page_id: string; opportunity_id: string; canonical_intent_id: string; intent_cluster_id: string; family_id: string; primary_decision: string; primary_query: string }>;
  capabilities: Array<{ capability_id: string; live_status: DoorV44CapabilityStatus; verified_at: string | null;
    expires_at: string | null; production_receipt: string | null; media_kinds: Array<"photo" | "video" | "audio"> }>;
  visual_assets: Array<DoorV44Visual & { tenant_id: string }>;
  icon_ids: string[];
  input_hashes: Record<string, string>;
}
export type DoorV44LoadResult = { ok: true; spec: DoorV44Spec; input_hashes: Record<string, string> }
  | { ok: false; errors: DoorV44Diagnostic[] };
