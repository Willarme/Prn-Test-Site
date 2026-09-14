import type { DoorV44Diagnostic, DoorV44LoadResult, DoorV44RichNode, DoorV44Spec, DoorV44ValidationContext } from "./types";
import { compileDoorV44Schemas, doorV44Hash, isPlainDoorJson, sortDoorV44Diagnostics, stableDoorJson } from "./schema-engine";

const HASH = /^[a-f0-9]{64}$/;
const STABLE_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const NODE_TYPES = new Set(["paragraph", "sentence", "text", "strong", "emphasis", "source_ref", "fact_ref", "ordered_list", "unordered_list", "list_item", "line_break"]);
const CONTENT_CONTAINERS = new Set(["paragraph", "sentence", "strong", "emphasis"]);
const REFERENCE_PROPERTIES = new Set(["source_id", "claim_id", "page_id", "capability_id", "asset_id", "protocol_id", "protocol_check_id", "hazard_id"]);
const SUBJECT_KEYS = ["subject_id", "display_label", "short_label", "cta_label", "second_person_label", "possessive_label", "plural_label", "subject_kind"] as const;

function validDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}
function escapePointer(value: string): string { return value.replace(/~/g, "~0").replace(/\//g, "~1"); }
function sameSet(a: string[], b: string[]): boolean { return a.length === b.length && stableDoorJson([...a].sort()) === stableDoorJson([...b].sort()); }
function uniqueBy<T>(rows: T[], key: (row: T) => string): boolean { return new Set(rows.map(key)).size === rows.length; }
function richTextContent(nodes: DoorV44RichNode[]): string {
  return nodes.map((node, index) => {
    const separator = index > 0 && ["paragraph", "list_item"].includes(node.type) ? "\n" : "";
    const content = node.type === "text" ? node.value : node.type === "source_ref" || node.type === "fact_ref" ? node.label
      : node.type === "line_break" ? "\n" : richTextContent(node.children);
    return separator + content;
  }).join("");
}

function validContext(context: DoorV44ValidationContext): boolean {
  if (!isPlainDoorJson(context) || !["fixture", "live"].includes(context.mode) || !context.tenant_id || context.content_baseline_id !== "ac-v43") return false;
  if (!context.versions || !Object.values(context.versions).every((value) => typeof value === "string" && value.length > 0)) return false;
  if (!validDate(context.evaluated_at) || (context.approved_content_at !== null && !validDate(context.approved_content_at))) return false;
  if (!context.disclosure || !context.disclosure.id || !context.disclosure.content_hash || !context.disclosure.purpose) return false;
  if (!context.input_hashes || Object.keys(context.input_hashes).length === 0 || !Object.entries(context.input_hashes).every(([key, hash]) => STABLE_KEY.test(key) && HASH.test(hash))) return false;
  if (!["trial_noindex", "staged_noindex", "public_indexable"].includes(context.index_policy)) return false;
  if (context.mode === "fixture" && context.index_policy === "public_indexable") return false;
  if (context.index_policy === "public_indexable" && context.approved_content_at === null) return false;
  const origin = new URL(context.origin);
  if (!["https:", ...(context.mode === "fixture" ? ["http:"] : [])].includes(origin.protocol)
      || origin.origin !== context.origin || origin.username || origin.password) return false;
  if (![context.subjects, context.action_patterns, context.sources, context.claims, context.pages, context.families, context.capabilities, context.eligibilities, context.prompt_identities, context.visual_assets, context.icon_ids].every(Array.isArray)) return false;
  if (!uniqueBy(context.subjects, (row) => row.subject_id) || !uniqueBy(context.action_patterns, (row) => row.pattern_id)
      || !uniqueBy(context.sources, (row) => row.source_id) || !uniqueBy(context.claims, (row) => row.claim_id)
      || !uniqueBy(context.pages, (row) => row.page_id) || !uniqueBy(context.families, (row) => row.family_id)
      || !uniqueBy(context.capabilities, (row) => row.capability_id) || !uniqueBy(context.eligibilities, (row) => row.receipt_id)
      || !uniqueBy(context.visual_assets, (row) => row.asset_id)) return false;
  if (!context.sources.every((row) => HASH.test(row.content_hash) && typeof row.reviewed === "boolean" && Array.isArray(row.claim_ids)
      && (row.expires_at === null || validDate(row.expires_at)))) return false;
  if (!context.claims.every((row) => HASH.test(row.content_hash) && Array.isArray(row.source_ids))) return false;
  return true;
}

/** Pure, strict input boundary. It validates facts/modules supplied by the caller; it never discovers or approves them. */
export function loadDoorV44Spec(raw: unknown, context: DoorV44ValidationContext): DoorV44LoadResult {
  try {
    if (!validContext(context)) return { ok: false, errors: [{ code: "CONTEXT_INVALID", pointer: "/context" }] };
  } catch { return { ok: false, errors: [{ code: "CONTEXT_INVALID", pointer: "/context" }] }; }
  const compiled = compileDoorV44Schemas(context.schema_bundle);
  if (!compiled.ok) return compiled;
  const shapeErrors = compiled.validate(raw);
  if (shapeErrors.length) return { ok: false, errors: shapeErrors };
  const spec = raw as DoorV44Spec;
  const errors: DoorV44Diagnostic[] = [];
  const fail = (code: string, pointer: string) => { errors.push({ code, pointer }); };
  const now = Date.parse(context.evaluated_at);
  try {
    for (const [key, actual, expected] of [
      ["/schema_version", spec.schema_version, context.versions.schema],
      ["/versions/template", spec.versions.template, context.versions.template],
      ["/versions/theme", spec.versions.theme, context.versions.theme],
      ["/versions/taxonomy", spec.versions.taxonomy, context.versions.taxonomy],
      ["/versions/source_bundle", spec.versions.source_bundle, context.versions.source_bundle],
      ["/head/brand/theme", spec.head.brand.theme, spec.versions.theme],
    ]) if (actual !== expected) fail("VERSION_MISMATCH", key);
    const promptKey = (prompt: DoorV44Spec["versions"]["prompt_identities"][number]) => prompt.capability + "/" + prompt.name;
    if (!uniqueBy(spec.versions.prompt_identities, promptKey) || !uniqueBy(context.prompt_identities, promptKey)
        || !sameSet(spec.versions.prompt_identities.map(stableDoorJson), context.prompt_identities.map(stableDoorJson))) {
      fail("VERSION_MISMATCH", "/versions/prompt_identities");
    }
    if (context.input_hashes.schema_sha256 && context.input_hashes.schema_sha256 !== compiled.schema_hash) fail("VERSION_MISMATCH", "/context/input_hashes/schema_sha256");
    if (spec.identity.tenant_id !== context.tenant_id) fail("IDENTITY_MISMATCH", "/identity/tenant_id");
    if (spec.identity.canonical_path !== "/problems/" + spec.identity.slug) fail("IDENTITY_MISMATCH", "/identity/canonical_path");
    const current = context.pages.find((page) => page.page_id === spec.identity.page_id);
    if (!current || current.tenant_id !== spec.identity.tenant_id || current.canonical_path !== spec.identity.canonical_path
        || current.family_id !== spec.identity.family_id || current.redirect_to !== null) fail("IDENTITY_MISMATCH", "/identity/page_id");
    const eligibility = context.eligibilities.find((row) => row.receipt_id === spec.intent.page_eligibility_receipt);
    const eligibilityKeys = ["tenant_id", "page_id", "opportunity_id", "canonical_intent_id", "intent_cluster_id", "family_id"] as const;
    if (!eligibility || eligibilityKeys.some((key) => eligibility[key] !== spec.identity[key])
        || eligibility.primary_decision !== spec.intent.primary_decision || eligibility.primary_query !== spec.intent.primary_query) {
      fail("ELIGIBILITY_MISMATCH", "/intent/page_eligibility_receipt");
    }
    for (const [key, actual, expected] of [
      ["page_id", spec.intake.attribution.page_id, spec.identity.page_id],
      ["intent_cluster_id", spec.intake.attribution.intent_cluster_id, spec.identity.intent_cluster_id],
      ["search_opportunity_id", spec.intake.attribution.search_opportunity_id, spec.identity.opportunity_id],
      ["problem_family_hint", spec.intake.attribution.problem_family_hint, spec.identity.family_id],
      ["landing_path", spec.intake.attribution.landing_path, spec.identity.canonical_path],
    ]) if (actual !== expected) fail("IDENTITY_MISMATCH", "/intake/attribution/" + key);
    if (spec.head.site.origin !== context.origin) fail("ENVIRONMENT_MISMATCH", "/head/site/origin");
    if (spec.release.index_policy !== context.index_policy) fail("ENVIRONMENT_MISMATCH", "/release/index_policy");
    if (spec.release.approved_content_at !== context.approved_content_at) fail("ENVIRONMENT_MISMATCH", "/release/approved_content_at");
    if (context.approved_content_at && Date.parse(context.approved_content_at) > now) fail("ENVIRONMENT_MISMATCH", "/context/approved_content_at");
    if (stableDoorJson(spec.intake.disclosure) !== stableDoorJson(context.disclosure)) fail("DISCLOSURE_MISMATCH", "/intake/disclosure");

    const family = context.families.find((row) => row.family_id === spec.identity.family_id && row.reviewed);
    if (!family || !family.source_family_id) fail("FAMILY_UNSUPPORTED", "/identity/family_id");
    const safety = spec.sections.safe_observations;
    if (!family?.protocol_ids.includes(safety.protocol_id)) fail("PROTOCOL_MISSING", "/sections/safe_observations/protocol_id");
    if (!family?.hazard_ids.length || !sameSet(safety.hazard_ids, family.hazard_ids)) fail("HAZARD_MISSING", "/sections/safe_observations/hazard_ids");
    if (!family?.eval_receipt_ids.length || !sameSet(safety.eval_receipt_ids, family.eval_receipt_ids)) fail("EVAL_MISSING", "/sections/safe_observations/eval_receipt_ids");
    for (const group of ["never_items", "stop_items"] as const) {
      if (!safety[group].length) fail("HAZARD_MISSING", "/sections/safe_observations/" + group);
      safety[group].forEach((item, index) => {
        if (!safety.hazard_ids.includes(item.hazard_id)) fail("HAZARD_MISSING", "/sections/safe_observations/" + group + "/" + index + "/hazard_id");
      });
    }
    for (const [pointer, checks] of [
      ["/sections/observations/rows", spec.sections.observations.rows],
      ["/sections/safe_observations/checks", safety.checks],
    ] as const) checks.forEach((check, index) => {
      if (!family?.protocol_check_ids.includes(check.protocol_check_id)) fail("PROTOCOL_MISSING", pointer + "/" + index + "/protocol_check_id");
    });
    const subject = context.subjects.find((row) => row.subject_id === spec.subject.subject_id);
    if (!subject || SUBJECT_KEYS.some((key) => subject[key] !== spec.subject[key])
        || !subject.allowed_family_ids.includes(spec.identity.family_id)) fail("SUBJECT_MISMATCH", "/subject");
    for (const [key, action] of Object.entries(spec.actions)) {
      const pattern = context.action_patterns.find((row) => row.pattern_id === action.pattern_id);
      if (!pattern || !subject?.allowed_pattern_ids.includes(action.pattern_id) || !pattern.subject_kinds.includes(spec.subject.subject_kind)
          || pattern.target !== action.target) fail("ACTION_MISMATCH", "/actions/" + key);
    }
    if (spec.intake.submit_action !== spec.sections.closer.cta_action) fail("ACTION_MISMATCH", "/sections/closer/cta_action");
    if (!(spec.sections.safe_observations.cta_action in spec.actions)) fail("ACTION_MISMATCH", "/sections/safe_observations/cta_action");
    const nameplateFree = spec.subject.subject_kind === "current_problem";
    if (nameplateFree && spec.intake.prompts[1].evidence_type !== "location_material") fail("SUBJECT_MISMATCH", "/intake/prompts/1/evidence_type");
    if (nameplateFree && spec.sections.job_packet.example_rows.some((row) => row.key === "equipment")) fail("SUBJECT_MISMATCH", "/sections/job_packet/example_rows");
    if (nameplateFree && !spec.sections.job_packet.example_rows.some((row) => row.key === "location_material")) fail("SUBJECT_MISMATCH", "/sections/job_packet/example_rows");
    if (spec.layout.conditional_sections.nameplate_help !== (spec.intake.prompts[1].evidence_type === "nameplate")) fail("CONDITIONAL_MISMATCH", "/layout/conditional_sections/nameplate_help");
    // Neither module has an approved context authority in this contract yet.
    for (const key of ["local_stats", "founders_offer"] as const) if (spec.layout.conditional_sections[key]) fail("CONDITIONAL_MISMATCH", "/layout/conditional_sections/" + key);
    if (spec.layout.conditional_sections.prices !== spec.sections.common_causes.rows.some((row) => row.range !== null)) fail("CONDITIONAL_MISMATCH", "/layout/conditional_sections/prices");

    const sourceIds = new Set(spec.sources.map((row) => row.source_id));
    const claimIds = new Set(spec.claims.map((row) => row.claim_id));
    spec.sources.forEach((source, index) => {
      const pointer = "/sources/" + index;
      const reviewed = context.sources.find((row) => row.source_id === source.source_id);
      if (!reviewed) fail("REFERENCE_UNKNOWN", pointer + "/source_id");
      else {
        if (!reviewed.reviewed) fail("SOURCE_UNREVIEWED", pointer + "/source_id");
        if (reviewed.expires_at !== null && Date.parse(reviewed.expires_at) <= now) fail("SOURCE_EXPIRED", pointer + "/source_id");
        if (source.claim_ids.some((id) => !reviewed.claim_ids.includes(id) || !claimIds.has(id))) fail("CITATION_CLOSURE", pointer + "/claim_ids");
      }
    });
    spec.claims.forEach((claim, index) => {
      const pointer = "/claims/" + index;
      const reviewed = context.claims.find((row) => row.claim_id === claim.claim_id);
      if (!reviewed || reviewed.content_hash !== claim.content_hash || !sameSet(reviewed.source_ids, claim.source_ids)) fail("CLAIM_MISMATCH", pointer);
      claim.source_ids.forEach((id) => {
        const source = spec.sources.find((row) => row.source_id === id);
        if (!source || !source.cite || !source.claim_ids.includes(claim.claim_id)) fail("CITATION_CLOSURE", pointer + "/source_ids");
      });
    });

    const liveCapabilityIds = new Set<string>();
    spec.capabilities.forEach((capability, index) => {
      const trusted = context.capabilities.find((row) => row.capability_id === capability.capability_id);
      if (!trusted) { fail("REFERENCE_UNKNOWN", "/capabilities/" + index + "/capability_id"); return; }
      if (capability.live_status === "VERIFIED_LIVE") {
        if (trusted.live_status !== "VERIFIED_LIVE" || !trusted.production_receipt || capability.production_receipt !== trusted.production_receipt
            || !validDate(trusted.verified_at) || !validDate(trusted.expires_at)
            || Date.parse(trusted.verified_at) > now || Date.parse(trusted.expires_at) <= now
            || (context.mode === "live" && trusted.production_receipt.startsWith("fixture_"))) fail("CAPABILITY_UNVERIFIED", "/capabilities/" + index);
        else liveCapabilityIds.add(capability.capability_id);
      } else if (capability.production_receipt !== null || capability.live_status !== trusted.live_status) fail("CAPABILITY_UNVERIFIED", "/capabilities/" + index);
    });
    spec.sections.capability.rows.forEach((row, index) => {
      if (!spec.capabilities.some((item) => item.capability_id === row.capability_id)) fail("REFERENCE_UNKNOWN", "/sections/capability/rows/" + index + "/capability_id");
      if (row.chip_label !== "STILL NEEDS TESTING" && !liveCapabilityIds.has(row.capability_id)) fail("CAPABILITY_UNVERIFIED", "/sections/capability/rows/" + index);
    });
    if (new Set(spec.sections.capability.rows.map((row) => row.chip_label)).size < 3) fail("CAPABILITY_BOUNDARIES_MISSING", "/sections/capability/rows");
    if (!["simple", "urgent", "cost"].every((kind) => spec.sections.stats.cards.some((card) => card.question_type === kind))) fail("STAT_DIVERSITY", "/sections/stats/cards");
    const metricCounts = new Map<string, number>();
    for (const card of spec.sections.stats.cards) metricCounts.set(card.metric_family, (metricCounts.get(card.metric_family) ?? 0) + 1);
    if ([...metricCounts.values()].some((count) => count > 2)) fail("STAT_DIVERSITY", "/sections/stats/cards");
    for (const [pointer, cards] of [["/sections/stats/cards", spec.sections.stats.cards], ["/sections/repair_record/cards", spec.sections.repair_record.cards]] as const) {
      cards.forEach((card, index) => { if (!context.icon_ids.includes(card.icon_id)) fail("REFERENCE_UNKNOWN", pointer + "/" + index + "/icon_id"); });
    }
    spec.intake.media_controls.forEach((control, index) => {
      const capability = context.capabilities.find((row) => row.capability_id === control.capability_id);
      if (!liveCapabilityIds.has(control.capability_id) || !capability?.media_kinds.includes(control.kind)) fail("CAPABILITY_UNVERIFIED", "/intake/media_controls/" + index);
    });
    if (spec.layout.conditional_sections.media_controls !== (spec.intake.media_controls.length > 0)) fail("CONDITIONAL_MISMATCH", "/layout/conditional_sections/media_controls");
    spec.visuals.forEach((visual, index) => {
      const asset = context.visual_assets.find((row) => row.asset_id === visual.asset_id);
      if (!asset || asset.tenant_id !== spec.identity.tenant_id) fail("REFERENCE_UNKNOWN", "/visuals/" + index + "/asset_id");
      else {
        // Unit id and presentation placement belong to PageSpec. Reviewed image
        // metadata, captions, hashes and declared dimensions belong to its asset.
        const { tenant_id: _tenant, id: _assetUnit, plate_class: _assetClass, ...expected } = asset;
        const { id: _unit, plate_class: _class, ...actual } = visual;
        if (stableDoorJson(expected) !== stableDoorJson(actual)) fail("VISUAL_MISMATCH", "/visuals/" + index);
      }
      if (visual.alt !== visual.title) fail("VISUAL_MISMATCH", "/visuals/" + index + "/alt");
      if (context.mode === "live" && (visual.authored_status !== "reviewed" || !visual.review_receipt || visual.review_receipt.startsWith("fixture_"))) fail("VISUAL_UNREVIEWED", "/visuals/" + index);
    });

    for (const [pointer, id] of [["/head/nav/category_page_id", spec.head.nav.category_page_id], ["/head/crumb/family_page_id", spec.head.crumb.family_page_id]]) {
      const page = context.pages.find((row) => row.page_id === id);
      if (!page || page.tenant_id !== spec.identity.tenant_id || !page.live || page.redirect_to !== null || page.family_id !== spec.identity.family_id) fail("REFERENCE_UNKNOWN", pointer);
    }
    if (spec.head.nav.category_page_id !== spec.head.crumb.family_page_id || spec.head.nav.category_label !== spec.head.crumb.family_label) fail("IDENTITY_MISMATCH", "/head/crumb");
    if (spec.layout.conditional_sections.related !== (spec.related_page_ids.length > 0)
        || Boolean(spec.sections.related) !== (spec.related_page_ids.length > 0)) fail("CONDITIONAL_MISMATCH", "/layout/conditional_sections/related");
    if (!sameSet(spec.related_page_ids, spec.sections.related?.links.map((row) => row.page_id) ?? [])) fail("RELATED_INVALID", "/sections/related");
    spec.related_page_ids.forEach((id, index) => {
      const page = context.pages.find((row) => row.page_id === id);
      if (!page || page.page_id === spec.identity.page_id || !page.live || page.redirect_to !== null
          || page.family_id !== spec.identity.family_id || page.tenant_id !== spec.identity.tenant_id) fail("RELATED_INVALID", "/related_page_ids/" + index);
    });

    const ids = new Set<string>();
    const sourceReferences = new Set<string>();
    const claimReferences = new Set<string>();
    const knownKeys = new Set(compiled.coverage.property_names);
    function walk(value: unknown, pointer: string, astDepth = 0, parentType?: string): void {
      if (typeof value === "string") {
        if ([...value].some((character) => { const code = character.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || code === 127; })
            || /\s{2,}/.test(value)) fail("INVALID_TEXT", pointer);
        if (/<\s*\/?\s*[a-z!][^>]*>/i.test(value) || /&(?:lt|#0*60|#x0*3c);/i.test(value)
            || /(?:javascript|vbscript|data|file):/i.test(value) || /\{%|%\}/.test(value)) fail("MARKUP_FORBIDDEN", pointer);
        if ((/\{\{|\}\}/.test(value) && pointer !== "/head/site/name_token")
            || ((/https?:\/\/|ftp:\/\/|www\./i.test(value)) && !["/$schema", "/head/site/origin"].includes(pointer))) fail("MARKUP_FORBIDDEN", pointer);
        return;
      }
      if (Array.isArray(value)) {
        if (value.length > 0 && value.every((child) => child && typeof child === "object" && NODE_TYPES.has(child.type))) {
          const visible = richTextContent(value as DoorV44RichNode[]);
          if (!visible.trim()) fail("AST_EMPTY", pointer);
          if (/\s{2,}/.test(visible)) fail("INVALID_TEXT", pointer);
        }
        value.forEach((child, index) => walk(child, pointer + "/" + index, astDepth, parentType)); return;
      }
      if (value === null || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      const isNode = typeof row.type === "string" && NODE_TYPES.has(row.type);
      const depth = isNode ? astDepth + 1 : astDepth;
      if (isNode) {
        const node = row as unknown as DoorV44RichNode;
        if (depth > 4) fail("AST_DEPTH", pointer);
        if (parentType && ((["ordered_list", "unordered_list"].includes(parentType) && node.type !== "list_item")
            || (CONTENT_CONTAINERS.has(parentType) && ["ordered_list", "unordered_list", "list_item", "paragraph"].includes(node.type))
            || (node.type === "list_item" && !["ordered_list", "unordered_list"].includes(parentType)))) fail("AST_SHAPE", pointer);
        if (!parentType && node.type === "list_item") fail("AST_SHAPE", pointer);
        if (node.type === "source_ref") {
          sourceReferences.add(node.source_id);
          if (!sourceIds.has(node.source_id)) fail("REFERENCE_UNKNOWN", pointer + "/source_id");
        }
        if (node.type === "fact_ref") {
          claimReferences.add(node.claim_id);
          if (!claimIds.has(node.claim_id)) fail("REFERENCE_UNKNOWN", pointer + "/claim_id");
        }
      }
      if (typeof row.id === "string") {
        if (ids.has(row.id)) fail("ID_DUPLICATE", pointer + "/id");
        ids.add(row.id);
      }
      for (const [key, child] of Object.entries(row)) {
        const childPointer = knownKeys.has(key) ? pointer + "/" + escapePointer(key) : pointer;
        if (key === "claim_id" && !pointer.startsWith("/claims/") && typeof child === "string") {
          claimReferences.add(child);
          if (!claimIds.has(child)) fail("REFERENCE_UNKNOWN", childPointer);
        }
        if (key === "claim_ids" && Array.isArray(child)) child.forEach((id, index) => {
          if (typeof id === "string") {
            if (!pointer.startsWith("/sources/")) claimReferences.add(id);
            if (!claimIds.has(id)) fail("REFERENCE_UNKNOWN", childPointer + "/" + index);
          }
        });
        if (REFERENCE_PROPERTIES.has(key) && typeof child === "string" && child.length === 0) fail("REFERENCE_UNKNOWN", childPointer);
        walk(child, childPointer, depth, isNode ? String(row.type) : undefined);
      }
    }
    walk(spec, "");
    for (const [pointer, rows, key] of [
      ["/sources", spec.sources, "source_id"], ["/claims", spec.claims, "claim_id"],
      ["/capabilities", spec.capabilities, "capability_id"], ["/visuals", spec.visuals, "asset_id"],
    ] as const) if (!uniqueBy(rows as unknown as Record<string, unknown>[], (row) => String(row[key]))) fail("ID_DUPLICATE", pointer);
    spec.sources.forEach((source, index) => {
      const citedByClaim = spec.claims.some((claim) => claim.source_ids.includes(source.source_id) && claimReferences.has(claim.claim_id));
      if ((sourceReferences.has(source.source_id) || citedByClaim) && !source.cite) fail("CITATION_CLOSURE", "/sources/" + index + "/cite");
      if (source.cite && !sourceReferences.has(source.source_id) && !citedByClaim) fail("CITATION_CLOSURE", "/sources/" + index + "/cite");
    });
    if (errors.length) return { ok: false, errors: sortDoorV44Diagnostics(errors) };
    // Clone only after validation. Neither input nor explicitly injected context is mutated.
    const specClone = JSON.parse(stableDoorJson(spec)) as DoorV44Spec;
    const { schema_bundle: _schemaBundle, ...contextFields } = context;
    return { ok: true, spec: specClone, input_hashes: {
      ...context.input_hashes, spec_sha256: doorV44Hash(spec), schema_sha256: compiled.schema_hash,
      context_sha256: doorV44Hash({ ...contextFields, schema_sha256: compiled.schema_hash }),
    } };
  } catch {
    return { ok: false, errors: [{ code: "CONTEXT_INVALID", pointer: "/context" }] };
  }
}
