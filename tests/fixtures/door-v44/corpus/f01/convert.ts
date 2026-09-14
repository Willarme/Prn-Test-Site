import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pins from "./source-pins.json";
import type { DoorV44RichText, DoorV44Spec } from "@/domain/search/door-v44/types";
import { compileDoorV44Schemas, doorV44Hash, stableDoorJson } from "@/domain/search/door-v44/schema-engine";

const SPEC = "content/door-template/v43/spec/ac-blowing-warm-air/";
const rawHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type Mapping = { source_file: string; source_pointer: string; source_value: unknown; source_value_sha256: string;
  disposition: string; candidate_pointers: string[]; operations: string[] };
type Use = { target: string; operation: string };
const escapePointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
function at(value: unknown, pointer: string): unknown {
  return pointer.split("/").slice(1).reduce<unknown>((current, key) => (current as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")], value);
}
/** Pinned-source text projection, not a general HTML parser or a visual-fidelity claim. */
export function f01VisibleText(value: string): string {
  const entities: Record<string, string> = { amp: "&", nbsp: " ", middot: "·", deg: "°", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", quot: '"', apos: "'", ndash: "–", mdash: "—", rarr: "→", copy: "©" };
  return value.replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_whole, name: string) => {
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(/^#x/i.test(name) ? 2 : 1), /^#x/i.test(name) ? 16 : 10));
    if (!(name in entities)) throw new Error("F01_ENTITY_UNSUPPORTED");
    return entities[name];
  }).replace(/\s+/g, " ").trim();
}

/** Frozen source -> explicitly blocked derivative. This function supplies no reviewed context. */
export function convertF01(root = process.cwd()) {
  const buffers = new Map<string, Buffer>();
  for (const pin of pins.files) {
    const bytes = readFileSync(join(root, pin.path));
    const hash = rawHash(bytes);
    const lf = bytes.toString("utf8").replace(/\r\n/g, "\n");
    const uniformRepresentation = !pin.binary && rawHash(lf) === pin.lf_sha256
      && (bytes.equals(Buffer.from(lf)) || bytes.equals(Buffer.from(lf.replace(/\n/g, "\r\n"))));
    if (hash !== pin.raw_sha256 && !uniformRepresentation) {
      throw new Error("F01_SOURCE_HASH_MISMATCH");
    }
    buffers.set(pin.path, bytes);
  }
  const sources = Object.fromEntries(pins.files.filter(pin => pin.path.startsWith(SPEC) && pin.path.endsWith(".json"))
    .map(pin => [pin.path.slice(SPEC.length, -5), JSON.parse(buffers.get(pin.path)!.toString("utf8")) as unknown]));
  const uses = new Map<string, Use[]>();
  const source = (ns: string, pointer: string) => at(sources[ns], pointer);
  const rows = (ns: string, pointer: string): unknown[] => source(ns, pointer) as unknown[];
  function take<T>(ns: string, pointer: string, target: string, operation: string, transform: (value: unknown) => T): T {
    const key = ns + "#" + pointer;
    uses.set(key, [...(uses.get(key) ?? []), { target, operation }]);
    return transform(source(ns, pointer));
  }
  const copy = <T>(ns: string, pointer: string, target: string): T => take(ns, pointer, target, "copy", value => structuredClone(value) as T);
  const text = (ns: string, pointer: string, target: string): string => take(ns, pointer, target, "visible_text_entities_and_markup", value => f01VisibleText(value as string));
  const rich = (ns: string, pointer: string, target: string): DoorV44RichText => take(ns, pointer, target, "visible_text_to_single_AST_node_inline_style_deferred", value => [{ type: "text", value: f01VisibleText(value as string) }]);
  const columns = (ns: string, target: string) => rows(ns, "/columns").map((_, i) => ({
    label: text(ns, `/columns/${i}/label`, `${target}/${i}/label`), mw_class: copy<string>(ns, `/columns/${i}/mw_class`, `${target}/${i}/mw_class`),
  }));
  const id = (kind: string, index: number) => `fixture.f01.${kind}.${index + 1}`;
  const claimRows: Array<{ claim_id: string; source_ids: string[]; content_hash: string }> = [];
  const claimCandidates: Array<{ claim_id: string; source_file: string; source_pointer: string; source_ids: string[]; basis: string; reviewed: false }> = [];
  function claim(ns: string, pointer: string, sourceNumbers: number[]): string {
    const claimId = `unreviewed.f01.${ns}.${claimRows.length + 1}`;
    const sourceIds = sourceNumbers.map(number => `f01.source.${number}`);
    claimRows.push({ claim_id: claimId, source_ids: sourceIds, content_hash: doorV44Hash({ source_file: SPEC + ns + ".json", source_pointer: pointer, source_value: source(ns, pointer) }) });
    claimCandidates.push({ claim_id: claimId, source_file: SPEC + ns + ".json", source_pointer: pointer, source_ids: sourceIds,
      basis: "Source-fragment identity and historical citation association only; no factual or methodology approval.", reviewed: false });
    return claimId;
  }
  const statsClaims = [[1, 2, 3, 4], [5], [6, 7]].map((numbers, i) => claim("stats", `/cards/${i}`, numbers));
  const causeClaims = rows("common_causes", "/rows").map((_, i) => {
    const refs = [...(source("common_causes", `/rows/${i}/range_html`) as string).matchAll(/href="#src-(\d+)"/g)].map(match => Number(match[1]));
    return refs.length ? [claim("common_causes", `/rows/${i}`, refs)] : [];
  });
  const identity: DoorV44Spec["identity"] = {
    tenant_id: "fixture.tenant", page_id: "fixture.f01", page_version: 1, opportunity_id: "fixture.opportunity.f01",
    canonical_intent_id: "fixture.intent.f01", intent_cluster_id: "fixture.cluster.f01", family_id: "F01", locale: "en-US",
    geography_scope: "national", slug: copy("page", "/slug", "/identity/slug"), canonical_path: "/problems/ac-blowing-warm-air",
  };
  const visualEvidence: Array<{ candidate_pointer: string; source_svg: string; source_png: string; svg_title_locator: string; svg_description_locator: string; inline_hash: string; raster_hash: string; width: number; height: number;
    visual_review: "NOT_SUPPLIED"; inline_raster_parity: "NOT_VERIFIED" }> = [];
  const candidate: DoorV44Spec = {
    $schema: "https://schemas.propertyresponsenetwork.com/doorspec/2.0.0.json", schema_version: "doorspec/2.0.0", identity,
    versions: { template: "door-v44.0.0", theme: "door-v44-t01@1.0.0", taxonomy: "subject-taxonomy/1.0.0", prompt_identities: [], source_bundle: "f01.frozen-source-unreviewed.v1" },
    intent: { primary_decision: "What changes the next step for AC blowing warm air?", primary_query: "AC blowing warm air", query_aliases: [],
      sub_intents: ["Urgency", "Evidence to collect", "Limits of remote advice"], problem_state: "symptom", page_eligibility_receipt: "unresolved.f01.eligibility" },
    subject: { subject_id: "fixture.subject.ac", display_label: "AC", short_label: "AC", cta_label: "AC", second_person_label: "your AC",
      possessive_label: "your AC's", plural_label: "AC systems", subject_kind: "equipment" },
    layout: { order_profile_id: "order-b", conditional_sections: { related: false, nameplate_help: true, media_controls: false, prices: true, local_stats: false, founders_offer: false } },
    head: {
      page: { title: copy("page", "/title", "/head/page/title"), meta_description: copy("page", "/meta_description", "/head/page/meta_description"),
        og_description: copy("page", "/og_description", "/head/page/og_description") },
      site: { name_token: "{{site.name}}", origin: "https://fixture.example" },
      brand: { a: copy("brand", "/a", "/head/brand/a"), b: copy("brand", "/b", "/head/brand/b"), warn: copy("brand", "/warn", "/head/brand/warn"), theme: "door-v44-t01@1.0.0" },
      nav: { category_page_id: "fixture.family.f01", category_label: text("nav", "/category_label", "/head/nav/category_label"), cta_action: "hero_start" },
      crumb: { family_page_id: "fixture.family.f01", family_label: text("crumb", "/family_label", "/head/crumb/family_label"), problem_label: text("crumb", "/problem_label", "/head/crumb/problem_label") },
      accents: { map: rows("accents", "/map").flatMap((row, i) => (row as [string, string[]])[1].map((_, j) => ({
        text: copy("accents", `/map/${i}/1/${j}`, `/head/accents/map/${i * 2 + j}/text`), color_class: "blue",
      }))) },
    },
    actions: { hero_start: { pattern_id: "START_KNOWN_OBJECT", target: "#intake" }, packet_start: { pattern_id: "BUILD_KNOWN_OBJECT_PACKET", target: "#intake" }, walkthrough_start: { pattern_id: "WALK_KNOWN_OBJECT", target: "#intake" } },
    intake: {
      heading: rich("intake", "/h2_html", "/intake/heading"), lede: text("intake", "/lede", "/intake/lede"), field_label: text("intake", "/field_label", "/intake/field_label"),
      placeholder: text("intake", "/placeholder", "/intake/placeholder"), help: text("intake", "/help", "/intake/help"),
      prompts: rows("intake", "/prompts").map((_, i) => ({ id: id("prompt", i), kind: copy("intake", `/prompts/${i}/_type`, `/intake/prompts/${i}/kind`),
        evidence_type: (["reading", "nameplate", "description"] as const)[i], text: text("intake", `/prompts/${i}/text`, `/intake/prompts/${i}/text`) })),
      so_far_label: text("intake", "/so_far_label", "/intake/so_far_label"), so_far_items: rows("intake", "/so_far_items").map((_, i) => text("intake", `/so_far_items/${i}`, `/intake/so_far_items/${i}`)),
      submit_action: "hero_start", disclosure: { id: "unresolved.active_disclosure", content_hash: "UNRESOLVED", purpose: "Unresolved controlled intake disclosure; no consent supplied." },
      attribution: { page_id: identity.page_id, intent_cluster_id: identity.intent_cluster_id, search_opportunity_id: identity.opportunity_id, problem_family_hint: "F01", landing_path: identity.canonical_path }, media_controls: [],
    },
    claims: claimRows,
    sources: rows("sources", "/list").map((_, i) => ({ source_id: `f01.source.${i + 1}`, cite: copy("sources", `/list/${i}/cite`, `/sources/${i}/cite`),
      claim_ids: claimRows.filter(row => row.source_ids.includes(`f01.source.${i + 1}`)).map(row => row.claim_id), note: text("sources", `/list/${i}/note`, `/sources/${i}/note`) })),
    capabilities: rows("capability-registry", "/capabilities").map((_, i) => ({ capability_id: copy("capability-registry", `/capabilities/${i}/capability_id`, `/capabilities/${i}/capability_id`), live_status: "UNVERIFIED", production_receipt: null })),
    visuals: rows("visuals", "/plates").map((_, i) => {
      const svgPath = SPEC + source("visuals", `/plates/${i}/file`);
      const svg = buffers.get(svgPath)!.toString("utf8");
      const pngPath = "public" + source("visuals", `/plates/${i}/png/path`);
      const png = buffers.get(pngPath)!;
      if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("F01_RASTER_FORMAT_MISMATCH");
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      if (width !== source("visuals", `/plates/${i}/png/width`) || height !== source("visuals", `/plates/${i}/png/height`)) throw new Error("F01_RASTER_DIMENSION_MISMATCH");
      const title = f01VisibleText(svg.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)![1]);
      const description = f01VisibleText(svg.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/)![1]);
      const inline_hash = rawHash(svg.replace(/\r\n/g, "\n")), raster_hash = rawHash(png);
      visualEvidence.push({ candidate_pointer: `/visuals/${i}`, source_svg: svgPath, source_png: pngPath, svg_title_locator: "/svg/title", svg_description_locator: "/svg/desc",
        inline_hash, raster_hash, width, height, visual_review: "NOT_SUPPLIED", inline_raster_parity: "NOT_VERIFIED" });
      return { id: id("visual", i), asset_id: id("asset", i), role: (["decision_observation", "safe_vs_sealed", "why_not_diy"] as const)[i], claim_ids: [],
        title, description, caption: rich("visuals", `/plates/${i}/caption_html`, `/visuals/${i}/caption`), alt: title, inline_hash, raster_hash, width, height,
        mime: "image/png", authored_status: "fixture", review_receipt: null, plate_class: `plate-${i + 1}` };
    }),
    sections: {
      hero: { badge_problem: text("hero", "/badge_problem", "/sections/hero/badge_problem"), badge_tail: text("hero", "/badge_tail", "/sections/hero/badge_tail"),
        h1: rich("hero", "/h1_html", "/sections/hero/h1"), answer: rich("hero", "/answer_body_html", "/sections/hero/answer"), cap_last: rich("hero", "/cap_last_html", "/sections/hero/cap_last"),
        value_heading: text("hero", "/vp_head_strong", "/sections/hero/value_heading"), value_claim: text("hero", "/vp_claim_pos", "/sections/hero/value_claim"),
        value_rows: rows("hero", "/value_rows").map((_, i) => ({ id: id("value", i), generic: text("hero", `/value_rows/${i}/generic`, `/sections/hero/value_rows/${i}/generic`), ours: rich("hero", `/value_rows/${i}/ours_html`, `/sections/hero/value_rows/${i}/ours`) })),
        value_foot: rich("hero", "/vp_foot_html", "/sections/hero/value_foot") },
      stats: { heading: rich("stats", "/heading_html", "/sections/stats/heading"), cards: rows("stats", "/cards").map((_, i) => ({ id: id("stat", i), icon_id: id("icon.stat", i),
        icon_class: copy("stats", `/cards/${i}/icon_class`, `/sections/stats/cards/${i}/icon_class`), value: rich("stats", `/cards/${i}/value_html`, `/sections/stats/cards/${i}/value`),
        statement: text("stats", `/cards/${i}/statement`, `/sections/stats/cards/${i}/statement`), note: text("stats", `/cards/${i}/note`, `/sections/stats/cards/${i}/note`),
        source_class: text("stats", `/cards/${i}/source_class`, `/sections/stats/cards/${i}/source_class`), claim_id: statsClaims[i], question_type: (["simple", "cost", "urgent"] as const)[i], metric_family: id("metric", i) })),
        source_note: rich("stats", "/stat_src_html", "/sections/stats/source_note"), band: rich("stats", "/band_html", "/sections/stats/band") },
      observations: { heading: rich("observations", "/heading_html", "/sections/observations/heading"), columns: columns("observations", "/sections/observations/columns"),
        rows: rows("observations", "/rows").map((_, i) => ({ id: id("observation", i), look: text("observations", `/rows/${i}/look`, `/sections/observations/rows/${i}/look`),
          rules_out: text("observations", `/rows/${i}/rules_out`, `/sections/observations/rows/${i}/rules_out`), protocol_check_id: `unresolved.f01.observation.${i + 1}` })) },
      common_causes: { heading: rich("common_causes", "/heading_html", "/sections/common_causes/heading"), columns: columns("common_causes", "/sections/common_causes/columns"),
        rows: rows("common_causes", "/rows").map((_, i) => ({ id: id("cause", i), cause: text("common_causes", `/rows/${i}/cause`, `/sections/common_causes/rows/${i}/cause`),
          notice: text("common_causes", `/rows/${i}/notice`, `/sections/common_causes/rows/${i}/notice`), fix_class: copy("common_causes", `/rows/${i}/fix_class`, `/sections/common_causes/rows/${i}/fix_class`),
          fix_label: text("common_causes", `/rows/${i}/fix_label`, `/sections/common_causes/rows/${i}/fix_label`), range: rich("common_causes", `/rows/${i}/range_html`, `/sections/common_causes/rows/${i}/range`), omission_reason: null, claim_ids: causeClaims[i] })) },
      safe_observations: { heading: rich("safe_observations", "/heading_html", "/sections/safe_observations/heading"), lede: text("safe_observations", "/lede", "/sections/safe_observations/lede"),
        checks: rows("safe_observations", "/checks").map((_, i) => ({ id: id("check", i), heading: text("safe_observations", `/checks/${i}/h`, `/sections/safe_observations/checks/${i}/heading`),
          body: text("safe_observations", `/checks/${i}/p`, `/sections/safe_observations/checks/${i}/body`), protocol_check_id: `unresolved.f01.check.${i + 1}` })),
        never_items: rows("safe_observations", "/never_items").map((_, i) => ({ id: id("never", i), text: text("safe_observations", `/never_items/${i}`, `/sections/safe_observations/never_items/${i}/text`), hazard_id: "unresolved.f01.hazard" })),
        stop_items: rows("safe_observations", "/stop_items").map((_, i) => ({ id: id("stop", i), text: text("safe_observations", `/stop_items/${i}`, `/sections/safe_observations/stop_items/${i}/text`), hazard_id: "unresolved.f01.hazard" })),
        cta_action: "walkthrough_start", protocol_id: "unresolved.f01.protocol", hazard_ids: ["unresolved.f01.hazard"], eval_receipt_ids: [] },
      visuals: { heading: rich("visuals", "/heading_html", "/sections/visuals/heading") },
      flip: { heading: rich("flip", "/heading_html", "/sections/flip/heading"), columns: rows("flip", "/columns").map((_, i) => ({ id: id("flip", i),
        heading: text("flip", `/columns/${i}/head`, `/sections/flip/columns/${i}/heading`), body: text("flip", `/columns/${i}/body`, `/sections/flip/columns/${i}/body`) })) },
      general_vs_yours: { heading: rich("general_vs_yours", "/heading_html", "/sections/general_vs_yours/heading"), columns: columns("general_vs_yours", "/sections/general_vs_yours/columns"),
        rows: rows("general_vs_yours", "/rows").map((_, i) => ({ id: id("comparison", i), where: text("general_vs_yours", `/rows/${i}/where`, `/sections/general_vs_yours/rows/${i}/where`),
          gives: text("general_vs_yours", `/rows/${i}/gives`, `/sections/general_vs_yours/rows/${i}/gives`), ours: text("general_vs_yours", `/rows/${i}/ours`, `/sections/general_vs_yours/rows/${i}/ours`) })) },
      capability: { heading: rich("capability", "/heading_html", "/sections/capability/heading"), columns: columns("capability", "/sections/capability/columns"),
        rows: rows("capability", "/rows").map((_, i) => ({ id: id("capability", i), capability_id: copy("capability-registry", `/capabilities/${i}/capability_id`, `/sections/capability/rows/${i}/capability_id`),
          ask: text("capability", `/rows/${i}/ask`, `/sections/capability/rows/${i}/ask`), tells: text("capability", `/rows/${i}/tells`, `/sections/capability/rows/${i}/tells`),
          chip_class: copy("capability", `/rows/${i}/chip_class`, `/sections/capability/rows/${i}/chip_class`), chip_label: copy("capability", `/rows/${i}/chip_label`, `/sections/capability/rows/${i}/chip_label`) })),
        band_hook: rich("capability", "/band_hook_html", "/sections/capability/band_hook") },
      job_packet: { heading: rich("job_packet", "/heading_html", "/sections/job_packet/heading"), cta_action: "packet_start", example_rows: rows("job_packet", "/example_rows").map((_, i) => ({
        id: id("packet", i), key: take("job_packet", `/example_rows/${i}/key`, `/sections/job_packet/example_rows/${i}/key`, "governed_packet_key_Thermostat_becomes_context", value => ({ Problem: "problem", Thermostat: "context", Equipment: "equipment", "Ruled out": "ruled_out", "Still to test": "still_to_test" })[value as string] as DoorV44Spec["sections"]["job_packet"]["example_rows"][number]["key"]),
        value: text("job_packet", `/example_rows/${i}/value`, `/sections/job_packet/example_rows/${i}/value`),
      })), band_hook: text("job_packet", "/band_2_hook", "/sections/job_packet/band_hook") },
      repair_record: { heading: rich("repair_record", "/heading_html", "/sections/repair_record/heading"), cards: rows("repair_record", "/cards").map((_, i) => ({ id: id("record", i),
        color_class: copy("repair_record", `/cards/${i}/color_class`, `/sections/repair_record/cards/${i}/color_class`), icon_id: id("icon.record", i),
        scope_chip: copy("repair_record", `/cards/${i}/scope_chip`, `/sections/repair_record/cards/${i}/scope_chip`), kicker: text("repair_record", `/cards/${i}/kicker`, `/sections/repair_record/cards/${i}/kicker`),
        value: copy("repair_record", `/cards/${i}/value`, `/sections/repair_record/cards/${i}/value`), copy: text("repair_record", `/cards/${i}/copy`, `/sections/repair_record/cards/${i}/copy`), public_fact_id: null })) },
      faq: { heading: rich("faq", "/heading_html", "/sections/faq/heading"), questions: rows("faq", "/questions").map((_, i) => ({ id: id("faq", i),
        kind: (["other", "urgent", "diy", "cost", "lead_privacy"] as const)[i], question: text("faq", `/questions/${i}/q`, `/sections/faq/questions/${i}/question`), answer: rich("faq", `/questions/${i}/a_html`, `/sections/faq/questions/${i}/answer`) })) },
      closer: { heading: rich("closer", "/heading_html", "/sections/closer/heading"), body: text("closer", "/body", "/sections/closer/body"), cta_action: "hero_start" },
      sources: { intro_tail: text("sources", "/intro_tail", "/sections/sources/intro_tail"), note_lead: text("sources", "/note_lead", "/sections/sources/note_lead") },
    },
    related_page_ids: [], release: { index_policy: "staged_noindex", approved_content_at: null },
  };
  const sourceMap: Mapping[] = [];
  function leaves(ns: string, value: unknown, pointer: string): void {
    if (value !== null && typeof value === "object" && Object.keys(value).length) {
      Object.entries(value).forEach(([key, child]) => leaves(ns, child, pointer + "/" + escapePointer(key)));
      return;
    }
    const mapped = uses.get(ns + "#" + pointer) ?? [];
    const documentation = pointer.split("/").some(part => part.startsWith("_"));
    const disposition = mapped.length ? "candidate_mapped" : documentation ? "source_documentation_preserved"
      : ns === "related" ? "governed_related_omission" : ns === "sources" ? "source_context_evidence_unreviewed"
        : ns === "capability-registry" ? "capability_evidence_unverified"
          : ns === "visuals" ? "existing_asset_or_layout_evidence"
            : /\/(?:icon_svg|orn|orn_numeral|pre|post)$/.test(pointer) || ns === "accents" ? "layout_or_icon_evidence_not_rendered"
              : ns === "site" ? "environment_origin_replaced_for_fixture"
                : /\/(?:cta|submit|category_href|family_href)$/.test(pointer) ? "governed_action_or_page_reference"
                  : "UNACCOUNTED";
    sourceMap.push({ source_file: SPEC + ns + ".json", source_pointer: pointer, source_value: value, source_value_sha256: doorV44Hash(value),
      disposition, candidate_pointers: mapped.map(row => row.target), operations: mapped.map(row => row.operation) });
  }
  Object.entries(sources).forEach(([ns, value]) => leaves(ns, value, ""));
  if (sourceMap.some(row => row.disposition === "UNACCOUNTED")) throw new Error("F01_SOURCE_FIELD_UNACCOUNTED");
  const differences = sourceMap.flatMap(row => row.candidate_pointers.map((pointer, i) => ({ source_file: row.source_file, source_pointer: row.source_pointer,
    candidate_pointer: pointer, operation: row.operations[i], source_value: row.source_value, candidate_value: at(candidate, pointer) }))
    .filter(row => stableDoorJson(row.source_value) !== stableDoorJson(row.candidate_value)));
  const mappedTargets = sourceMap.flatMap(row => row.candidate_pointers);
  const candidateAdditions: Array<{ pointer: string; value: unknown; basis: string }> = [];
  function addedLeaves(value: unknown, pointer: string): void {
    if (mappedTargets.some(target => pointer === target || pointer.startsWith(target + "/"))) return;
    if (value !== null && typeof value === "object" && Object.keys(value).length) {
      Object.entries(value).forEach(([key, child]) => addedLeaves(child, pointer + "/" + escapePointer(key)));
      return;
    }
    const basis = pointer.startsWith("/visuals/") ? "Existing SVG/PNG evidence plus typed slot identity/role; no new illustration or review. Sequential plate classes replace implicit legacy slots; styling parity is unverified."
      : pointer.startsWith("/claims/") || /^\/sources\/\d+\/(source_id|claim_ids)/.test(pointer) ? "Historical source-fragment/citation association; see claim_candidates. No factual approval."
        : pointer.startsWith("/capabilities/") ? "Frozen pending-runtime status maps to UNVERIFIED with null production receipt."
          : pointer.startsWith("/head/accents/") ? "Legacy accent map documentation explicitly says brand-blue; selector scope remains source evidence."
            : "System-authored typed identity, classification, governed reference, isolation or unresolved-evidence field under c6ff9a; never personal approval or production activation.";
    candidateAdditions.push({ pointer, value, basis });
  }
  addedLeaves(candidate, "");
  function schemaFiles(path: string): unknown[] {
    return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap(entry => entry.isDirectory() ? schemaFiles(join(path, entry.name))
      : entry.name.endsWith(".json") ? [JSON.parse(readFileSync(join(path, entry.name), "utf8")) as unknown] : []);
  }
  const schema = compileDoorV44Schemas(schemaFiles(join(root, "content/door-template/v44/schemas")));
  if (!schema.ok) throw new Error("F01_SCHEMA_COMPILE_FAILED");
  const schemaErrors = schema.validate(candidate);
  const report = {
    version: "f01-source-conversion/1.0.0", status: "BLOCKED_CONTROL_DERIVATIVE", fixture_id: "F01", candidate_hash: doorV44Hash(candidate),
    exact_control_pass: false, release_ready: false, compiler_pass: false, source_pin_hash: doorV44Hash(pins),
    source_namespace_count: Object.keys(sources).length, source_leaf_count: sourceMap.length, mapped_leaf_count: sourceMap.filter(row => row.disposition === "candidate_mapped").length,
    source_map: sourceMap, differences, candidate_additions: candidateAdditions, claim_candidates: claimCandidates, visual_evidence: visualEvidence,
    schema_hash: schema.schema_hash, schema_errors: schemaErrors,
    governed_differences: [
      { id: "RELATED_OMITTED", authority: "Guide §18 F01; §21 step4", source_file: SPEC + "related.json", source_pointer: "/links", source_value: source("related", "/links"), candidate_value: [], reason: "The legacy /no-hot-water stub is omitted from the derivative, with the original retained here and in frozen v43." },
      { id: "FIXTURE_ENVIRONMENT", authority: "Guide §18 synthetic nonpublic fixtures", reason: "Synthetic identifiers and origin, staged_noindex and null approved date are isolation fields, not production eligibility or approvals." },
      { id: "NO_ACTIVE_MEDIA", authority: "Guide H14; frozen capability-registry pending-runtime status", reason: "Media controls are absent; preserved prose still advertises unverified abilities and must block compilation/release." },
      { id: "GOVERNED_ACTIONS", authority: "Guide §13 subject/action compiler", reason: "CTA fields reference governed actions. The source Start with MY AC, right now wording remains mapped evidence; dropping its suffix is not exact-control parity." },
      { id: "SEMANTIC_TEXT_PROJECTION", authority: "Guide §15 disallows legacy raw HTML", reason: "Visible words/entities are retained in single text AST nodes. Emphasis, source-footnote anchors and layout markup are retained in source mapping only; full inline/class fidelity remains open." },
      { id: "LOGICAL_IDS", authority: "Guide §15 stable unit/reference IDs", reason: "Fixture IDs, proposed question/evidence/image roles and source-fragment hashes are system conversion metadata. Unresolved review/eligibility/protocol/hazard/disclosure IDs confer no approval. No production review records are supplied." },
    ],
    blockers: [
      { code: "FROZEN_METADATA_OVER_BOUND", pointers: ["/head/page/title", "/head/page/meta_description"], detail: "Original title71/description174 exceed schema65/160; values are intentionally unchanged." },
      { code: "FROZEN_SOCIAL_DESCRIPTION_MISMATCH", pointers: ["/head/page/og_description"], detail: "Original OG description differs from meta description; not silently harmonized." },
      { code: "FROZEN_CAPABILITY_QUESTION_FORM", pointers: ["/sections/capability/rows/8/ask"], detail: "The original provider question contains neither my nor your, which the current schema requires. Original question retained." },
      { code: "REVIEWED_PROTOCOL_HAZARD_ELIGIBILITY_ABSENT", pointers: ["/sections/safe_observations", "/intent/page_eligibility_receipt"], detail: "No reviewed AC modules, safety evaluation or eligibility receipt is fabricated." },
      { code: "CAPABILITIES_UNVERIFIED", pointers: ["/capabilities", "/intake"], detail: "All nine source capabilities remain UNVERIFIED/null; preserved source claims and nameplate prompt cannot advertise a live ability." },
      { code: "SOURCE_FACT_CLOSURE_UNREVIEWED", pointers: ["/claims", "/sources", "/sections/stats", "/sections/common_causes"], detail: "Historical source citations and numeric prose are retained. Source8–11 cite:false, uncited retail cost, fact-label/methodology and source freshness still need independent review." },
      { code: "DISCLOSURE_UNRESOLVED", pointers: ["/intake/disclosure"], detail: "Controlled active disclosure is not supplied by source conversion; placeholder is never consent." },
      { code: "PROMPT_AND_ILLUSTRATION_CLAIMS_UNRESOLVED", pointers: ["/versions/prompt_identities", "/visuals"], detail: "No generation prompt or reviewed illustration claim binding exists in this conversion. Empty lists intentionally fail current required schema bounds." },
      { code: "FROZEN_INLINE_AND_THEME_FIDELITY_OPEN", pointers: ["/sections", "/head/accents"], detail: "Text projection is not complete inline emphasis, citation-anchor, icon, theme or rendered control parity." },
    ],
  };
  return { candidate, report };
}
