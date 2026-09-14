import { createHash } from "node:crypto";
import patterns from "../../../../content/door-template/v44/taxonomy/cta-patterns.json";
import compatibility from "../../../../content/door-template/v44/contracts/compatibility.json";
import dom from "../../../../content/door-template/v44/contracts/dom-attributes.json";
import { loadDoorV44Spec } from "./loader";
import { doorV44Hash, isPlainDoorJson, sortDoorV44Diagnostics, stableDoorJson } from "./schema-engine";
import { compileDoorV44Assets } from "./compiler-assets";
import { doorV44ArtifactHash } from "./artifact-hash";
import { renderDoorV44Document } from "./render";
import { doorV44Constant, DOOR_V44_CONSTANTS_SHA256 } from "./template-constants";
import type { DoorV44ConstantKey } from "./template-constants";
import { validateDoorV44Wording, DOOR_V44_WORDING_DERIVATIVE_SHA256, DOOR_V44_WORDING_RULES_SHA256 } from "./wording";
import type { DoorV44CompilerContext, DoorV44CompileResult, DoorV44VisibleComponent } from "./compiler-types";
import type { DoorV44Document, DoorV44Element } from "./render-types";
import type { DoorV44Diagnostic, DoorV44RichNode, DoorV44Spec } from "./types";

type Child = DoorV44Element | string;
const e = (tag: DoorV44Element["tag"], children: Child[] = [], attrs: Record<string, string> = {}): DoorV44Element => ({ tag, attrs, children });
const rawHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const isoDate = (value: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const flatten = (nodes: readonly DoorV44RichNode[]): string => nodes.map(n => n.type === "text" ? n.value
  : n.type === "fact_ref" || n.type === "source_ref" ? n.label : n.type === "line_break" ? "\n" : flatten(n.children)).join("");
const unique = <T>(rows: readonly T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;
const equalSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(value => b.includes(value));

/** The semantic reviewer binds a decision verdict to exact proposed visible intent, not a mutable page id. */
export function doorV44IntentReviewHash(spec: DoorV44Spec): string {
  return doorV44Hash({ decision: spec.intent.primary_decision, query: spec.intent.primary_query,
    aliases: spec.intent.query_aliases, title: spec.head.page.title, h1: flatten(spec.sections.hero.h1), answer: flatten(spec.sections.hero.answer) });
}

function safeSourceUrl(value: string): boolean {
  try {
    if (typeof value !== "string" || /[\s\\]/.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && url.href === value;
  } catch { return false; }
}

function validContext(context: DoorV44CompilerContext): boolean {
  if (!isPlainDoorJson(context)) return false;
  if (!equalSet(Object.keys(context), ["validation", "site", "disclosure_text", "disclosure_text_sha256", "source_records", "fact_records", "asset_records", "visible_approvals", "intent_review"])) return false;
  if (!context.site || !equalSet(Object.keys(context.site), ["name", "current_year"]) || !context.site.name?.trim()
    || !Number.isInteger(context.site.current_year) || context.site.current_year < 2000 || context.site.current_year > 9999) return false;
  if (!context.disclosure_text?.trim() || context.disclosure_text.length > 10000 || !HASH.test(context.disclosure_text_sha256)
    || rawHash(context.disclosure_text) !== context.disclosure_text_sha256) return false;
  if (![context.source_records, context.fact_records, context.asset_records, context.visible_approvals].every(Array.isArray)) return false;
  if (!unique(context.source_records, r => r.source_id) || !unique(context.fact_records, r => r.claim_id)
    || !unique(context.asset_records, r => r.asset_id) || !unique(context.visible_approvals, r => r.component_id)) return false;
  return !!context.intent_review && typeof context.intent_review.receipt_id === "string" && context.intent_review.receipt_id.length > 0
    && HASH.test(context.intent_review.content_hash);
}

/** Pure compilation of an immutable candidate. No file, network, model, database, publish or ambient clock operations. */
export async function compileDoorV44Page(raw: unknown, context: DoorV44CompilerContext): Promise<DoorV44CompileResult> {
  try { return await compileCandidate(raw, context); }
  catch { return { ok: false, errors: [{ code: "COMPILER_INPUT_INVALID", pointer: "/context" }] }; }
}

async function compileCandidate(raw: unknown, context: DoorV44CompilerContext): Promise<DoorV44CompileResult> {
  try { if (!validContext(context)) throw new Error(); }
  catch { return { ok: false, errors: [{ code: "COMPILER_CONTEXT_INVALID", pointer: "/context" }] }; }
  const loaded = loadDoorV44Spec(raw, context.validation);
  if (!loaded.ok) return loaded;
  const spec = loaded.spec;
  const errors: DoorV44Diagnostic[] = [];
  const fail = (code: string, pointer: string) => errors.push({ code, pointer });
  const now = Date.parse(context.validation.evaluated_at);
  if (context.intent_review.content_hash !== doorV44IntentReviewHash(spec)
    || (context.validation.mode === "live" && context.intent_review.receipt_id.startsWith("fixture"))) fail("INTENT_REVIEW_MISMATCH", "/context/intent_review");
  const sources = new Map(context.source_records.map(row => [row.source_id, row]));
  const facts = new Map(context.fact_records.map(row => [row.claim_id, row]));
  for (const [index, source] of spec.sources.entries()) {
    const record = sources.get(source.source_id);
    const trusted = context.validation.sources.find(row => row.source_id === source.source_id);
    if (!record || !trusted || record.content_hash !== trusted.content_hash || !record.title?.trim() || !record.publisher?.trim()
      || !safeSourceUrl(record.url) || record.url !== record.canonical_url || record.http_status !== 200 || record.redirect_to !== null
      || !isoDate(record.checked_at) || !isoDate(record.expires_at) || Date.parse(record.checked_at) > now || Date.parse(record.expires_at) <= now) {
      fail("SOURCE_RECORD_INVALID", `/sources/${index}`);
    }
  }
  for (const [index, claim] of spec.claims.entries()) {
    const record = facts.get(claim.claim_id);
    if (!record || record.content_hash !== claim.content_hash || !Array.isArray(record.permitted_labels) || !record.permitted_labels.length
      || !record.permitted_labels.every(value => typeof value === "string" && value.trim())
      || ![record.publisher, record.geography, record.window, record.denominator, record.sample_size, record.methodology_id].every(v => typeof v === "string" && v.trim())
      || !isoDate(record.observed_at) || Date.parse(record.observed_at) > now) fail("FACT_PROVENANCE_MISSING", `/claims/${index}`);
  }
  const live = new Set(spec.capabilities.filter(row => row.live_status === "VERIFIED_LIVE").map(row => row.capability_id));
  if (!live.has(dom.form["data-capability-id"])) fail("INTAKE_CAPABILITY_UNVERIFIED", "/intake");
  if (errors.length) return { ok: false, errors: sortDoorV44Diagnostics(errors) };
  const decoded = await compileDoorV44Assets(spec.visuals, context.asset_records, context.validation.origin);
  if (!decoded.ok) return decoded;
  const assets = new Map(decoded.assets.map(asset => [asset.asset_id, asset]));
  const usedClaims = new Set<string>();
  const usedSources = new Set<string>();
  const constants = new Map<string, string>();
  const wordingBlocks: Array<{ text: string; role: "prose" | "hero" | "cta" | "legal" | "accessible" | "stat_value"; money_evidence?: "sourced"; permitted_intent_terms?: string[] }> = [];
  const reviewedIntentTerms = [...new Map([spec.intent.primary_query, ...spec.intent.query_aliases]
    .filter(term => term.trim().split(/\s+/).length >= 2).map(term => [term.toLowerCase(), term])).values()];
  const text = (value: string, pointer: string, claimIds: readonly string[] = [], role: "prose" | "hero" | "cta" | "legal" | "accessible" | "stat_value" = "prose"): string => {
    wordingBlocks.push({ text: value, role, ...(claimIds.length ? { money_evidence: "sourced" as const } : {}),
      ...(role === "hero" && reviewedIntentTerms.length ? { permitted_intent_terms: reviewedIntentTerms } : {}) });
    if (/\p{N}/u.test(value) && !claimIds.some(id => facts.get(id)?.permitted_labels.includes(value))) fail("NUMERIC_PROVENANCE_MISSING", pointer);
    for (const id of claimIds) { usedClaims.add(id); spec.claims.find(row => row.claim_id === id)?.source_ids.forEach(source => usedSources.add(source)); }
    return value;
  };
  const c = (key: DoorV44ConstantKey): DoorV44Element => {
    const value = doorV44Constant(key); constants.set(key, value);
    return e("span", [value], { "data-constant-key": key });
  };
  const rich = (nodes: DoorV44RichNode[], pointer: string, inline = false, role: "prose" | "hero" | "stat_value" = "prose", nested = false): Child[] => {
    if (!nested) {
      const hasFact = (items: DoorV44RichNode[]): boolean => items.some(node => node.type === "fact_ref" || ("children" in node && hasFact(node.children)));
      wordingBlocks.push({ text: flatten(nodes), role, ...(hasFact(nodes) ? { money_evidence: "sourced" } : {}),
        ...(role === "hero" && reviewedIntentTerms.length ? { permitted_intent_terms: reviewedIntentTerms } : {}) });
    }
    return nodes.flatMap((node, index): Child[] => {
    const p = `${pointer}/${index}`;
    if (node.type === "text") return [text(node.value, p + "/value", [], role)];
    if (node.type === "line_break") return [e("br")];
    if (node.type === "source_ref") {
      usedSources.add(node.source_id);
      if (/\p{N}/u.test(node.label) && node.label !== sources.get(node.source_id)?.title) fail("NUMERIC_PROVENANCE_MISSING", p + "/label");
      wordingBlocks.push({ text: node.label, role: "prose" });
      return [e("a", [node.label], { href: `#source-${node.source_id}`, "data-source-id": node.source_id })];
    }
    if (node.type === "fact_ref") {
      if (!facts.get(node.claim_id)?.permitted_labels.includes(node.label)) fail("FACT_LABEL_MISMATCH", p + "/label");
      return [e("span", [text(node.label, p + "/label", [node.claim_id], role)], { "data-claim-id": node.claim_id })];
    }
    if (inline && ["ordered_list", "unordered_list", "list_item"].includes(node.type)) fail("HEADING_AST_INVALID", p);
    const tag = { paragraph: inline ? "span" : "p", sentence: "span", strong: "strong", emphasis: "em", ordered_list: "ol", unordered_list: "ul", list_item: "li" }[node.type] as DoorV44Element["tag"];
    return [e(tag, rich(node.children, p + "/children", inline || ["strong", "em"].includes(tag), role, true))];
  }); };
  const p = (value: string, pointer: string, claimIds: readonly string[] = [], role: "prose" | "hero" = "prose") => e("p", [text(value, pointer, claimIds, role)]);
  const action = (key: keyof DoorV44Spec["actions"], submit = false): DoorV44Element => {
    const selected = spec.actions[key];
    const pattern = patterns.rows.find(row => row.pattern_id === selected?.pattern_id);
    if (!selected || !pattern || pattern.target !== selected.target || !pattern.subject_kinds.includes(spec.subject.subject_kind)) {
      fail("ACTION_MISMATCH", "/actions/" + key); return e("span");
    }
    const label = pattern.pattern.replace("{subject.cta_label}", spec.subject.cta_label);
    wordingBlocks.push({ text: label, role: "cta" });
    return submit ? e("button", [label], { type: "submit", id: "startBtn", "aria-label": label })
      : e("a", [label], { href: selected.target, "aria-label": label });
  };
  const counts: Record<string, number> = {
    observations: spec.sections.observations.rows.length, causes: spec.sections.common_causes.rows.length,
    safe_checks: spec.sections.safe_observations.checks.length, visuals: spec.visuals.length, faq: spec.sections.faq.questions.length,
  };
  const heading = (nodes: DoorV44RichNode[], pointer: string, countKey?: string): DoorV44Element => e("h2", [
    ...(countKey ? [e("span", [String(counts[countKey])], { "data-count": String(counts[countKey]), "data-metric-slot": countKey }), " — "] : []), ...rich(nodes, pointer, true),
  ]);
  const modules = new Map<string, DoorV44Element>();
  const section = (name: string, nodes: Child[]) => modules.set(name, e("section", nodes, { id: name.toLowerCase().replaceAll("_", "-"), "data-section": name }));
  const table = (columns: Array<{ label: string; mw_class: string }>, rows: Array<{ id: string; cells: Child[][] }>, pointer: string): DoorV44Element => e("table", [
    e("thead", [e("tr", columns.map((col, i) => e("th", [text(col.label, `${pointer}/columns/${i}/label`)], { scope: "col", class: col.mw_class })))]),
    e("tbody", rows.map(row => e("tr", row.cells.map(cell => e("td", cell)), { id: row.id }))),
  ]);

  const intake = e("section", [c("intake_start"), c("intake_duration"), heading(spec.intake.heading, "/intake/heading"), p(spec.intake.lede, "/intake/lede"),
    e("ul", spec.intake.prompts.map((prompt, index) => e("li", [text(prompt.text, `/intake/prompts/${index}/text`)], { id: prompt.id }))),
    p(spec.intake.so_far_label, "/intake/so_far_label"), e("ul", spec.intake.so_far_items.map((item, i) => e("li", [text(item, `/intake/so_far_items/${i}`)]))),
    e("form", [e("label", [text(spec.intake.field_label, "/intake/field_label")], { for: "problem-description" }),
      e("textarea", [], { id: "problem-description", name: "problem_description", required: "", maxlength: "12000",
        placeholder: text(spec.intake.placeholder, "/intake/placeholder"), "aria-describedby": "problem-description-help free-note" }),
      e("p", [text(spec.intake.help, "/intake/help")], { id: "problem-description-help" }),
      ...spec.intake.media_controls.map(control => {
        const names = { photo: "photos", video: "video", audio: "voice_note" } as const;
        const kind = names[control.kind];
        const config = dom.conditional_media_fields[kind];
        return e("label", [c(control.kind === "photo" ? "upload_photos" : control.kind === "video" ? "upload_video" : "upload_audio"), e("input", [], { type: "file", id: "media-" + kind,
          name: kind, accept: config.accept, ...(kind === "photos" ? { multiple: "" } : {}), "data-capability-id": control.capability_id })]);
      }),
      ...Object.entries(spec.intake.attribution).map(([name, value]) => e("input", [], { type: "hidden", name, value })),
      e("input", [], { type: "hidden", name: "disclosure_id", value: spec.intake.disclosure.id }),
      e("p", [context.disclosure_text], { id: "free-note" }), action("hero_start", true), e("p", [], { id: "intake-status", role: "status", "aria-live": "polite" }),
    ], { ...dom.form }),
  ], { id: "intake", "data-section": "INTAKE" });
  wordingBlocks.push({ text: context.disclosure_text, role: "legal" });
  const hero = spec.sections.hero;
  section("HERO", [e("div", [p(hero.badge_problem, "/sections/hero/badge_problem", [], "hero"), p(hero.badge_tail, "/sections/hero/badge_tail", [], "hero"),
    e("h1", rich(hero.h1, "/sections/hero/h1", true, "hero")), c("hero_answer"), e("div", rich(hero.answer, "/sections/hero/answer", false, "hero"), { id: "direct-answer" }),
    ...rich(hero.cap_last, "/sections/hero/cap_last", false, "hero"), e("div", [c("hero_value_eyebrow"), p(hero.value_heading, "/sections/hero/value_heading", [], "hero"),
      p(hero.value_claim, "/sections/hero/value_claim", [], "hero"), e("ul", hero.value_rows.map((row, i) => e("li", [
        p(row.generic, `/sections/hero/value_rows/${i}/generic`, [], "hero"), ...rich(row.ours, `/sections/hero/value_rows/${i}/ours`, false, "hero"),
      ], { id: row.id }))), ...rich(hero.value_foot, "/sections/hero/value_foot", false, "hero")], { id: "vp" })]), intake]);
  const stats = spec.sections.stats;
  section("STAT_CARDS", [c("stats_eyebrow"), heading(stats.heading, "/sections/stats/heading"), ...stats.cards.map((row, i) => e("article", [
    ...rich(row.value, `/sections/stats/cards/${i}/value`, false, "stat_value"), p(row.statement, `/sections/stats/cards/${i}/statement`, [row.claim_id]),
    p(row.note, `/sections/stats/cards/${i}/note`, [row.claim_id]), p(row.source_class, `/sections/stats/cards/${i}/source_class`),
  ], { id: row.id, class: row.icon_class, "data-claim-id": row.claim_id })), ...rich(stats.source_note, "/sections/stats/source_note"),
  ...rich(stats.band, "/sections/stats/band"), e("a", [c("stats_sources")], { href: "#sources-and-review" })]);
  const obs = spec.sections.observations;
  section("WHAT_CHANGES_THE_ANSWER", [c("observations_eyebrow"), heading(obs.heading, "/sections/observations/heading", "observations"),
    table(obs.columns, obs.rows.map((row, i) => ({ id: row.id, cells: [[text(row.look, `/sections/observations/rows/${i}/look`)], [text(row.rules_out, `/sections/observations/rows/${i}/rules_out`)]] })), "/sections/observations")]);
  const causes = spec.sections.common_causes;
  const priceColumn = spec.layout.conditional_sections.prices;
  section("COMMON_POSSIBILITIES", [c("causes_eyebrow"), heading(causes.heading, "/sections/common_causes/heading", "causes"),
    table(priceColumn ? causes.columns : causes.columns.slice(0, 3), causes.rows.map((row, i) => ({ id: row.id, cells: [
      [text(row.cause, `/sections/common_causes/rows/${i}/cause`, row.claim_ids)], [text(row.notice, `/sections/common_causes/rows/${i}/notice`, row.claim_ids)],
      [e("span", [text(row.fix_label, `/sections/common_causes/rows/${i}/fix_label`)], { class: row.fix_class })],
      ...(priceColumn ? [row.range ? rich(row.range, `/sections/common_causes/rows/${i}/range`) : [text(row.omission_reason ?? "", `/sections/common_causes/rows/${i}/omission_reason`)]] : []),
    ] })), "/sections/common_causes")]);
  const safe = spec.sections.safe_observations;
  section("SAFE_OBSERVATIONS", [heading(safe.heading, "/sections/safe_observations/heading", "safe_checks"), p(safe.lede, "/sections/safe_observations/lede"),
    e("ol", safe.checks.map((row, i) => e("li", [e("h3", [text(row.heading, `/sections/safe_observations/checks/${i}/heading`)]), p(row.body, `/sections/safe_observations/checks/${i}/body`)], { id: row.id }))),
    ...(["never_items", "stop_items"] as const).map(group => e("div", [e("h3", [c(group === "never_items" ? "safe_never_heading" : "safe_stop_heading")]),
      e("ul", safe[group].map((row, i) => e("li", [text(row.text, `/sections/safe_observations/${group}/${i}/text`)], { id: row.id })))])), action(safe.cta_action)]);
  section("VISUALS", [c("visuals_eyebrow"), heading(spec.sections.visuals.heading, "/sections/visuals/heading", "visuals"), ...spec.visuals.map((visual, i) => {
    const asset = assets.get(visual.asset_id)!;
    return e("figure", [e("h3", [text(visual.title, `/visuals/${i}/title`, visual.claim_ids)]), e("picture", [e("img", [], {
      src: asset.url, width: String(asset.width), height: String(asset.height), alt: text(visual.alt, `/visuals/${i}/alt`, visual.claim_ids, "accessible"), loading: "lazy", decoding: "async",
    })]), p(visual.description, `/visuals/${i}/description`, visual.claim_ids), e("figcaption", rich(visual.caption, `/visuals/${i}/caption`))], { id: visual.id, class: visual.plate_class, "data-visual-id": visual.id });
  })]);
  const flip = spec.sections.flip;
  const flipKeys = ["flip_usual", "flip_shift", "flip_us"] as const;
  flip.columns.forEach((row, i) => { if (row.heading !== doorV44Constant(flipKeys[i])) fail("TEMPLATE_CONSTANT_MISMATCH", `/sections/flip/columns/${i}/heading`); });
  section("THE_FLIP", [c("flip_eyebrow"), heading(flip.heading, "/sections/flip/heading"), ...flip.columns.map((row, i) => e("article", [
    e("h3", [c(flipKeys[i])]), p(row.body, `/sections/flip/columns/${i}/body`),
  ], { id: row.id }))]);
  const compare = spec.sections.general_vs_yours;
  section("GENERAL_VS_YOURS", [c("comparison_eyebrow"), heading(compare.heading, "/sections/general_vs_yours/heading"),
    table(compare.columns, compare.rows.map((row, i) => ({ id: row.id, cells: ["where", "gives", "ours"].map(key => [text(row[key as "where" | "gives" | "ours"], `/sections/general_vs_yours/rows/${i}/${key}`)]) })), "/sections/general_vs_yours")]);
  const capability = spec.sections.capability;
  // Unverified rows may state the explicit testing boundary. HIDDEN/PREVIEW rows never advertise a future ability.
  const renderedCapabilities = capability.rows.filter(row => live.has(row.capability_id)
    || (row.chip_label === "STILL NEEDS TESTING" && spec.capabilities.find(item => item.capability_id === row.capability_id)?.live_status === "UNVERIFIED"));
  if (renderedCapabilities.length < 5 || renderedCapabilities.length > 10 || new Set(renderedCapabilities.map(row => row.chip_label)).size < 3) {
    fail("CAPABILITY_RENDER_SHAPE", "/sections/capability/rows");
  }
  section("CAPABILITY_QUESTIONS", [heading(capability.heading, "/sections/capability/heading"), table(capability.columns,
    renderedCapabilities.map(row => { const i = capability.rows.indexOf(row); return { id: row.id, cells: [
      [text(row.ask, `/sections/capability/rows/${i}/ask`)], [text(row.tells, `/sections/capability/rows/${i}/tells`)],
      [e("span", [row.chip_label], { class: row.chip_class, "data-capability-id": row.capability_id })],
    ] }; }), "/sections/capability"), ...rich(capability.band_hook, "/sections/capability/band_hook")]);
  const packet = spec.sections.job_packet;
  const packetKeys = { problem: "packet_row_problem", context: "packet_row_context", equipment: "packet_row_equipment", location_material: "packet_row_location_material", ruled_out: "packet_row_ruled_out", still_to_test: "packet_row_still_to_test" } as const;
  section("JOB_PACKET", [c("packet_eyebrow"), c("packet_name"), heading(packet.heading, "/sections/job_packet/heading"), c("packet_example"), e("dl", packet.example_rows.flatMap((row, i) => [
    e("dt", [c(packetKeys[row.key])], { id: row.id }), e("dd", [text(row.value, `/sections/job_packet/example_rows/${i}/value`)]),
  ])), p(packet.band_hook, "/sections/job_packet/band_hook"), action(packet.cta_action)]);
  const repair = spec.sections.repair_record;
  section("REPAIR_RECORD", [heading(repair.heading, "/sections/repair_record/heading"), ...repair.cards.map((row, i) => e("article", [
    p(row.scope_chip, `/sections/repair_record/cards/${i}/scope_chip`), p(row.kicker, `/sections/repair_record/cards/${i}/kicker`), c("record_building"),
    p(row.copy, `/sections/repair_record/cards/${i}/copy`),
  ], { id: row.id, class: row.color_class })), e("a", [c("record_methodology")], { href: "#record-methodology" }),
    e("div", [e("h3", [c("record_methodology_heading")]), e("p", [c("record_methodology_body")])], { id: "record-methodology" })]);
  section("FAQ", [c("faq_eyebrow"), heading(spec.sections.faq.heading, "/sections/faq/heading", "faq"), ...spec.sections.faq.questions.map((row, i) => e("article", [
    e("h3", [text(row.question, `/sections/faq/questions/${i}/question`)]), ...rich(row.answer, `/sections/faq/questions/${i}/answer`),
  ], { id: row.id }))]);
  const related = spec.sections.related?.links ?? [];
  if (related.length) section("RELATED", [c("related_eyebrow"), e("h2", [c("related_heading")]), e("ul", related.map((row, i) => e("li", [
    e("a", [text(row.label, `/sections/related/links/${i}/label`)], { href: context.validation.pages.find(page => page.page_id === row.page_id)!.canonical_path }),
  ])))]);
  section("CLOSER", [heading(spec.sections.closer.heading, "/sections/closer/heading"), p(spec.sections.closer.body, "/sections/closer/body"), action(spec.sections.closer.cta_action)]);

  for (const [i, claim] of spec.claims.entries()) if (!usedClaims.has(claim.claim_id)) fail("CITATION_UNUSED_CLAIM", `/claims/${i}`);
  const cited = spec.sources.filter(row => row.cite);
  if (!equalSet([...usedSources], cited.map(row => row.source_id))) fail("CITATION_CLOSURE", "/sources");
  const order = compatibility.order.filter(name => name !== "INTAKE" && (name !== "RELATED" || related.length));
  if (order.some(name => !modules.has(name))) fail("SECTION_ORDER_INVALID", "/layout/order_profile_id");
  const ledger = e("section", [e("h2", [c("source_heading")]), e("p", [c("source_intro")]), p(spec.sections.sources.intro_tail, "/sections/sources/intro_tail"),
    e("ol", cited.map(row => { const record = sources.get(row.source_id)!; return e("li", [e("a", [c("source_view"), " — ", record.title], { href: record.url }),
      e("p", [record.publisher]), p(row.note, "/sources/note"), ...row.claim_ids.map(id => { const fact = facts.get(id)!; return e("dl", Object.entries({
        source_publisher: fact.publisher, source_geography: fact.geography, source_window: fact.window, source_denominator: fact.denominator,
        source_sample_size: fact.sample_size, source_observed: fact.observed_at, source_methodology: fact.methodology_id,
      }).flatMap(([key, value]) => [e("dt", [c(key as DoorV44ConstantKey)]), e("dd", [value])]), { "data-claim-id": id }); }),
    ], { id: `source-${row.source_id}`, "data-source-id": row.source_id }); })), p(spec.sections.sources.note_lead, "/sections/sources/note_lead"),
    e("p", [c("source_date_policy")])], { id: "sources-and-review" });
  const canonical = new URL(spec.identity.canonical_path, context.validation.origin).href;
  const family = context.validation.pages.find(row => row.page_id === spec.head.crumb.family_page_id)!;
  const body = [e("header", [e("a", [context.site.name], { href: "/" }), e("p", [c("brand_no_account")]), e("nav", [e("a", [text(spec.head.nav.category_label, "/head/nav/category_label")], { href: family.canonical_path }), action("hero_start")], { "aria-label": "Main navigation" }),
    e("nav", [e("a", [c("hero_home")], { href: "/" }), e("a", [text(spec.head.crumb.family_label, "/head/crumb/family_label")], { href: family.canonical_path }), e("span", [text(spec.head.crumb.problem_label, "/head/crumb/problem_label")], { "aria-current": "page" })], { "aria-label": "Breadcrumb" })]),
    e("main", order.map(name => modules.get(name)!)), ledger,
    e("footer", [e("section", [e("h2", [c("notice_heading")]), e("p", [c("notice_body_before_links"), " ",
      e("a", [c("legal_terms")], { href: "/terms" }), " ", c("legal_and"), " ", e("a", [c("legal_privacy")], { href: "/privacy" }), ".",
    ])], { "aria-label": doorV44Constant("notice_region_label") }), e("p", [`© ${context.site.current_year} ${context.site.name}`, " · ", c("footer_country")])])];
  text(spec.head.page.title, "/head/page/title", [], "hero");
  text(spec.head.page.meta_description, "/head/page/meta_description");
  if (spec.head.page.og_description !== spec.head.page.meta_description) fail("SOCIAL_DESCRIPTION_MISMATCH", "/head/page/og_description");
  const wording = validateDoorV44Wording(wordingBlocks, { surface: "door" });
  wording.findings.filter(row => row.severity === "blocker").forEach(row => fail(row.code, row.pointer));
  if (errors.length) return { ok: false, errors: sortDoorV44Diagnostics(errors) };

  // Date provenance follows visible bytes/accessible names and present facts/assets, not ids, clocks or deploy metadata.
  const visible = (nodes: Child[]): unknown[] => nodes.flatMap((node): unknown[] => {
    if (typeof node === "string") return [node];
    if (node.tag === "input" && node.attrs?.type === "hidden") return [];
    return [Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key]) => ["alt", "aria-label", "placeholder", "title"].includes(key))), ...visible(node.children ?? [])];
  });
  const components: DoorV44VisibleComponent[] = [
    { component_id: "content", content_hash: doorV44Hash({ title: spec.head.page.title, description: spec.head.page.meta_description, visible: visible(body) }) },
    { component_id: "constants", content_hash: doorV44Hash([...constants].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) },
    { component_id: "disclosure", content_hash: context.disclosure_text_sha256 },
    ...spec.claims.map(row => ({ component_id: `claim:${row.claim_id}`, content_hash: row.content_hash })),
    ...decoded.assets.map(row => ({ component_id: `image:${row.asset_id}`, content_hash: row.sha256 })),
  ].sort((a, b) => a.component_id < b.component_id ? -1 : a.component_id > b.component_id ? 1 : 0);
  let date: string | null = null;
  if (context.validation.approved_content_at !== null) {
    if (!equalSet(components.map(row => row.component_id), context.visible_approvals.map(row => row.component_id))) fail("VISIBLE_APPROVAL_MISSING", "/context/visible_approvals");
    for (const [i, component] of components.entries()) {
      const approval = context.visible_approvals.find(row => row.component_id === component.component_id);
      if (!approval || approval.content_hash !== component.content_hash || !isoDate(approval.approved_at) || Date.parse(approval.approved_at) > now) fail("VISIBLE_APPROVAL_MISMATCH", `/context/visible_approvals/${i}`);
    }
    if (!errors.length) date = context.visible_approvals.map(row => row.approved_at).sort().at(-1)!;
    if (date !== context.validation.approved_content_at) fail("VISIBLE_DATE_MISMATCH", "/release/approved_content_at");
  } else if (context.visible_approvals.length) fail("VISIBLE_DATE_MISMATCH", "/context/visible_approvals");
  if (errors.length) return { ok: false, errors: sortDoorV44Diagnostics(errors) };
  if (date) ledger.children!.push(e("p", [c("review_date_label"), " ", e("time", [date.slice(0, 10)], { datetime: date })]));
  const social = [...spec.visuals].filter(row => row.role === "decision_observation").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
  if (!social) return { ok: false, errors: [{ code: "SOCIAL_IMAGE_ROLE_MISSING", pointer: "/visuals" }] };
  const socialAsset = assets.get(social.asset_id)!;
  const robots = spec.release.index_policy === "staged_noindex" ? "noindex,nofollow" : spec.release.index_policy === "trial_noindex" ? "noindex,follow" : "index,follow";
  const contextBeforeProvenance = { ...context, validation: { ...context.validation,
    input_hashes: Object.fromEntries(Object.entries(context.validation.input_hashes).filter(([key]) => key !== "build_provenance_sha256")) } };
  const inputHashes = { ...loaded.input_hashes,
    ...(context.validation.input_hashes.build_provenance_sha256 ? { context_before_provenance_sha256: doorV44Hash(contextBeforeProvenance),
      source_records_sha256: doorV44Hash(context.source_records), fact_records_sha256: doorV44Hash(context.fact_records),
      asset_records_sha256: doorV44Hash(context.asset_records) } : {}),
    compiler_context_sha256: doorV44Hash(context), constants_sha256: DOOR_V44_CONSTANTS_SHA256,
    actions_sha256: doorV44Hash(patterns), dom_sha256: doorV44Hash(dom), order_sha256: doorV44Hash(compatibility),
    wording_derivative_sha256: DOOR_V44_WORDING_DERIVATIVE_SHA256, wording_rules_sha256: DOOR_V44_WORDING_RULES_SHA256 };
  const receiptId = "d44_" + doorV44Hash({ inputs: inputHashes, compiler: "door-v44-compiler/1.0.0" });
  const document: DoorV44Document = {
    title: spec.head.page.title, description: spec.head.page.meta_description, canonical_url: canonical, robots,
    site_name: context.site.name, lang: "en-US", receipt_id: receiptId, date_modified: date,
    social_image: { url: socialAsset.url, alt: social.alt, width: socialAsset.width, height: socialAsset.height, mime: socialAsset.mime }, body,
    structured_data: [{ "@context": "https://schema.org", "@graph": [
      { "@type": "WebPage", "@id": canonical + "#webpage", url: canonical, name: spec.head.page.title, description: spec.head.page.meta_description,
        ...(date ? { dateModified: date } : {}), inLanguage: "en-US", citation: cited.map(row => sources.get(row.source_id)!.url),
        primaryImageOfPage: { "@id": canonical + "#image-" + social.id }, mainEntity: { "@id": canonical + "#faq" } },
      { "@type": "BreadcrumbList", "@id": canonical + "#breadcrumb", itemListElement: [
        { "@type": "ListItem", position: 1, name: context.site.name, item: context.validation.origin + "/" },
        { "@type": "ListItem", position: 2, name: spec.head.crumb.family_label, item: new URL(family.canonical_path, context.validation.origin).href },
        { "@type": "ListItem", position: 3, name: spec.head.crumb.problem_label, item: canonical },
      ] },
      { "@type": "FAQPage", "@id": canonical + "#faq", mainEntity: spec.sections.faq.questions.map(row => ({ "@type": "Question", "@id": canonical + "#" + row.id,
        name: row.question, acceptedAnswer: { "@type": "Answer", text: flatten(row.answer) } })) },
      ...spec.visuals.map(visual => { const asset = assets.get(visual.asset_id)!; return { "@type": "ImageObject", "@id": canonical + "#image-" + visual.id,
        contentUrl: asset.url, url: asset.url, name: visual.title, description: visual.description, caption: flatten(visual.caption),
        width: asset.width, height: asset.height, encodingFormat: asset.mime }; }),
    ] }],
  };
  const rendered = renderDoorV44Document(document);
  if (!rendered.ok) return rendered;
  const artifactHash = doorV44ArtifactHash({ tenant_id: spec.identity.tenant_id, page_id: spec.identity.page_id, page_version: spec.identity.page_version,
    canonical_intent_id: spec.identity.canonical_intent_id, canonical_url: canonical,
    html_hash: rendered.html_hash, semantic_hash: rendered.semantic_hash, input_hashes: inputHashes }, decoded.assets);
  return { ok: true, html: rendered.html, document: JSON.parse(stableDoorJson(document)) as DoorV44Document, assets: decoded.assets,
    receipt: { receipt_id: receiptId, compiler_version: "door-v44-compiler/1.0.0", content_baseline_id: "ac-v43", tenant_id: spec.identity.tenant_id, page_id: spec.identity.page_id,
      page_version: spec.identity.page_version, canonical_intent_id: spec.identity.canonical_intent_id, input_hashes: inputHashes, html_hash: rendered.html_hash, semantic_hash: rendered.semantic_hash,
      artifact_hash: artifactHash, canonical_url: canonical, robots, date_modified: date, visible_components: components,
      source_ids: cited.map(row => row.source_id), claim_ids: spec.claims.map(row => row.claim_id), section_order: order,
      derived_counts: counts, rendered_capability_ids: renderedCapabilities.map(row => row.capability_id),
      constants: [...constants].map(([key, value]) => ({ key, value })), mode: context.validation.mode, release_ready: false,
      pending_checks: ["A06_INDEPENDENT_QA", "FROZEN_CONTROL_FIDELITY", "T01_THEME_AND_VISUAL_MATRIX", "FULL_F01_F11_CORPUS", "SECOND_HOST_REPRODUCTION", "INTAKE_ROUTE_INTEGRATION", "PRODUCTION_VERSION_REGISTRY_AND_PUBLISH_ROLLBACK", "REVIEWED_IMAGE_RENDER_PARITY", "HOSTED_ROUTE_IMAGE_INDEX_CHECKS"],
      wording_findings: wording.findings,
    } };
}
