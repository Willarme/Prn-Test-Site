import { createHash } from "node:crypto";
import dom from "../../../../content/door-template/v44/contracts/dom-attributes.json";
import compatibility from "../../../../content/door-template/v44/contracts/compatibility.json";
import { DOOR_V44_CONSTANTS, DOOR_V44_CONSTANTS_SHA256 } from "./template-constants";
import { doorV44ArtifactHash } from "./artifact-hash";
import { renderDoorV44Document } from "./render";
import { doorV44Hash, sortDoorV44Diagnostics, stableDoorJson } from "./schema-engine";
import type { DoorV44CompileResult } from "./compiler-types";
import type { DoorV44Element } from "./render-types";
import type { DoorV44Diagnostic } from "./types";

type Success = Extract<DoorV44CompileResult, { ok: true }>;
type Row = Record<string, unknown>;
type Entry = { node: DoorV44Element; pointer: string; ancestors: DoorV44Element[] };
export type DoorV44SemanticResult = { ok: true; errors: [] } | { ok: false; errors: DoorV44Diagnostic[] };
const record = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const equal = (a: unknown, b: unknown) => stableDoorJson(a) === stableDoorJson(b);
const sorted = (values: readonly string[]) => [...values].sort();
const sameSet = (a: readonly string[], b: readonly string[]) => new Set(a).size === a.length && new Set(b).size === b.length && equal(sorted(a), sorted(b));
const content = (node: DoorV44Element): string => (node.children ?? []).map(child => typeof child === "string" ? child : child.tag === "br" ? "\n" : content(child)).join("");
function descendants(node: DoorV44Element): DoorV44Element[] {
  return [node, ...(node.children ?? []).flatMap(child => typeof child === "string" ? [] : descendants(child))];
}
function graphRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.flatMap(graphRows);
  if (!record(value)) return [];
  return [value, ...Object.values(value).flatMap(graphRows)];
}
/** Descriptor-first JSON guard with compiler-sized raster/HTML exceptions. */
function safeCompiledJson(value: unknown): boolean {
  const ancestors = new Set<object>();
  let remaining = 100000;
  function check(current: unknown, path: string[], depth: number): boolean {
    if (--remaining < 0 || depth > 64) return false;
    if (current === null || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current);
    if (typeof current === "string") {
      const raster = path.length === 3 && path[0] === "assets" && path[2] === "base64";
      const html = path.length === 1 && path[0] === "html";
      return current.length <= (raster ? 16 * 1024 * 1024 : html ? 32 * 1024 * 1024 : 1000000);
    }
    if (typeof current !== "object" || ancestors.has(current)) return false;
    const array = Array.isArray(current), proto = Object.getPrototypeOf(current);
    if (proto !== Object.prototype && proto !== null && !(array && proto === Array.prototype)) return false;
    if (Object.getOwnPropertySymbols(current).length) return false;
    ancestors.add(current);
    let slots = 0;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
      if (!("value" in descriptor) || ["__proto__", "prototype", "constructor"].includes(key)) return false;
      if (array && key === "length") continue;
      if (!descriptor.enumerable || (array && !/^(?:0|[1-9]\d*)$/.test(key)) || !check(descriptor.value, [...path, key], depth + 1)) return false;
      slots++;
    }
    ancestors.delete(current);
    return !array || slots === current.length;
  }
  return check(value, [], 0);
}

/**
 * Independent consistency check over a compiler artifact's actual semantic tree.
 * It cannot authenticate source approvals or prove browser/visual/hosted acceptance.
 * Re-rendering is used only for byte/hash parity; semantic checks inspect the tree.
 */
export function verifyDoorV44SemanticContract(input: unknown): DoorV44SemanticResult {
  const errors: DoorV44Diagnostic[] = [];
  const fail = (code: string, pointer: string) => { errors.push({ code, pointer }); };
  try {
    if (!safeCompiledJson(input) || !record(input) || input.ok !== true || typeof input.html !== "string"
      || !record(input.receipt) || !Array.isArray(input.assets) || !record(input.document)
      || !sameSet(Object.keys(input), ["ok", "html", "document", "assets", "receipt"])) {
      return { ok: false, errors: [{ code: "SEMANTIC_INPUT_INVALID", pointer: "" }] };
    }
    const compiled = input as unknown as Success;
    const { document, receipt, assets } = compiled;
    if (![receipt.constants, receipt.source_ids, receipt.claim_ids, receipt.section_order, receipt.visible_components, receipt.rendered_capability_ids].every(Array.isArray)
      || !record(receipt.derived_counts) || !record(receipt.input_hashes)
      || receipt.compiler_version !== "door-v44-compiler/1.0.0" || receipt.content_baseline_id !== "ac-v43"
      || receipt.release_ready !== false || !Array.isArray(receipt.pending_checks) || receipt.pending_checks.length === 0) {
      return { ok: false, errors: [{ code: "SEMANTIC_INPUT_INVALID", pointer: "/receipt" }] };
    }
    const rendered = renderDoorV44Document(document);
    if (!rendered.ok) return { ok: false, errors: [{ code: "SEMANTIC_DOM_MISMATCH", pointer: "/document" }] };
    if (compiled.html !== rendered.html || receipt.html_hash !== hash(compiled.html)
      || receipt.html_hash !== rendered.html_hash || receipt.semantic_hash !== rendered.semantic_hash
      || receipt.artifact_hash !== doorV44ArtifactHash(receipt, assets)
      || receipt.input_hashes.constants_sha256 !== DOOR_V44_CONSTANTS_SHA256) fail("SEMANTIC_HASH_MISMATCH", "/receipt");
    if (receipt.receipt_id !== document.receipt_id || receipt.canonical_url !== document.canonical_url
      || receipt.robots !== document.robots || receipt.date_modified !== document.date_modified) fail("SEMANTIC_METADATA_MISMATCH", "/document");

    const entries: Entry[] = [];
    function walk(node: DoorV44Element, pointer: string, ancestors: DoorV44Element[]): void {
      entries.push({ node, pointer, ancestors });
      (node.children ?? []).forEach((child, index) => { if (typeof child !== "string") walk(child, pointer + "/children/" + index, [...ancestors, node]); });
    }
    document.body.forEach((node, index) => walk(node, "/document/body/" + index, []));
    const nodes = entries.map(entry => entry.node);
    const byId = (id: string) => nodes.filter(node => node.attrs?.id === id);
    const isHidden = (entry: Entry) => [...entry.ancestors, entry.node].some(node =>
      Object.prototype.hasOwnProperty.call(node.attrs ?? {}, "hidden") || node.attrs?.["aria-hidden"] === "true");
    for (const id of dom.fixed_ids) {
      const fixed = entries.filter(entry => entry.node.attrs?.id === id);
      if (fixed.length !== 1 || isHidden(fixed[0])) fail("SEMANTIC_DOM_MISMATCH", "/document/body");
    }
    if (nodes.filter(node => node.tag === "h1").length !== 1) fail("SEMANTIC_DOM_MISMATCH", "/document/body");

    const actualConstants = new Map<string, string>();
    const knownConstants = DOOR_V44_CONSTANTS.strings as Record<string, string>;
    for (const entry of entries.filter(entry => entry.node.attrs?.["data-constant-key"] !== undefined)) {
      const key = entry.node.attrs!["data-constant-key"];
      const value = content(entry.node);
      if (!Object.prototype.hasOwnProperty.call(knownConstants, key) || knownConstants[key] !== value || isHidden(entry)) {
        fail("SEMANTIC_CONSTANT_MISMATCH", entry.pointer);
      }
      if (actualConstants.has(key) && actualConstants.get(key) !== value) fail("SEMANTIC_CONSTANT_MISMATCH", entry.pointer);
      actualConstants.set(key, value);
    }
    for (const [key, metadata] of Object.entries(DOOR_V44_CONSTANTS.metadata)) {
      if (metadata.emission === "required" && !actualConstants.has(key)) fail("SEMANTIC_CONSTANT_MISMATCH", "/constants/" + key);
    }
    const observedConstants = receipt.constants.map(row => [row.key, row.value] as [string, string]);
    if (new Set(observedConstants.map(([key]) => key)).size !== observedConstants.length
      || !equal([...actualConstants].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0), observedConstants.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))) {
      fail("SEMANTIC_CONSTANT_MISMATCH", "/receipt/constants");
    }

    const forms = nodes.filter(node => node.tag === "form");
    const form = forms[0];
    if (forms.length !== 1 || !form || Object.entries(dom.form).some(([key, value]) => form.attrs?.[key] !== value)) fail("SEMANTIC_DOM_MISMATCH", "/document/body");
    if (form) {
      const controls = descendants(form).filter(node => ["input", "textarea", "select", "button"].includes(node.tag));
      for (const name of [...dom.required_field_names, "disclosure_id"]) {
        const found = controls.filter(node => node.attrs?.name === name);
        if (found.length !== 1 || Object.prototype.hasOwnProperty.call(found[0]?.attrs ?? {}, "disabled")) { fail("SEMANTIC_DOM_MISMATCH", "/document/body"); continue; }
        if (name === "problem_description") {
          if (found[0].tag !== "textarea" || !Object.prototype.hasOwnProperty.call(found[0].attrs ?? {}, "required")
            || found[0].attrs?.id !== "problem-description") fail("SEMANTIC_DOM_MISMATCH", "/document/body");
        } else if (found[0].tag !== "input" || found[0].attrs?.type !== "hidden" || !found[0].attrs?.value) fail("SEMANTIC_DOM_MISMATCH", "/document/body");
      }
      if (controls.find(node => node.attrs?.name === "page_id")?.attrs?.value !== receipt.page_id
        || controls.find(node => node.attrs?.name === "landing_path")?.attrs?.value !== new URL(document.canonical_url).pathname) fail("SEMANTIC_DOM_MISMATCH", "/document/body");
      const submit = controls.filter(node => node.tag === "button" && node.attrs?.type === "submit");
      const submitText = submit[0] ? content(submit[0]) : "";
      if (submit.length !== 1 || submit[0].attrs?.id !== "startBtn" || submit[0].attrs?.["aria-label"] !== submitText
        || !/^Start with (?:THIS PROBLEM|MY .+)$/.test(submitText) || Object.prototype.hasOwnProperty.call(submit[0].attrs ?? {}, "disabled")) fail("SEMANTIC_ACTION_MISMATCH", "/document/body");
      const subject = submitText.startsWith("Start with MY ") ? submitText.slice("Start with MY ".length) : null;
      const allowedLabels = [submitText, subject ? "Build the packet for MY " + subject : "Build the packet for THIS PROBLEM",
        subject ? "Walk me through MY " + subject + " instead" : "Walk me through THIS PROBLEM instead"];
      for (const node of nodes.filter(node => node.tag === "a" && node.attrs?.href === "#intake")) {
        if (!allowedLabels.includes(content(node)) || node.attrs?.["aria-label"] !== content(node)) fail("SEMANTIC_ACTION_MISMATCH", "/document/body");
      }
      const closer = nodes.find(node => node.attrs?.["data-section"] === "CLOSER");
      const returns = closer ? descendants(closer).filter(node => node.tag === "a" && node.attrs?.href === "#intake") : [];
      if (returns.length !== 1 || content(returns[0]) !== submitText) fail("SEMANTIC_ACTION_MISMATCH", "/document/body");
      const disclosure = byId("free-note")[0];
      if (!disclosure || !content(disclosure).trim() || receipt.visible_components.find(row => row.component_id === "disclosure")?.content_hash !== hash(content(disclosure))) fail("SEMANTIC_DOM_MISMATCH", "/document/body");
    }

    const mains = nodes.filter(node => node.tag === "main");
    const mainSections = mains[0]?.children?.filter((child): child is DoorV44Element => typeof child !== "string") ?? [];
    const actualOrder = mainSections.map(node => node.attrs?.["data-section"] ?? "");
    const relatedCount = nodes.filter(node => node.attrs?.["data-section"] === "RELATED").length;
    const expectedOrder = compatibility.order.filter(name => name !== "INTAKE" && (name !== "RELATED" || relatedCount === 1));
    if (mains.length !== 1 || mainSections.some(node => node.tag !== "section") || !equal(actualOrder, expectedOrder)
      || !equal(actualOrder, receipt.section_order) || relatedCount > 1
      || receipt.section_order.includes("RELATED") !== (relatedCount === 1)) fail("SEMANTIC_ORDER_MISMATCH", "/document/body");
    if (relatedCount === 1) {
      const related = nodes.find(node => node.attrs?.["data-section"] === "RELATED")!;
      const links = descendants(related).filter(node => node.tag === "a");
      if (!links.length || links.some(node => !content(node).trim() || !node.attrs?.href
        || new URL(node.attrs.href, document.canonical_url).href === document.canonical_url)) fail("SEMANTIC_ORDER_MISMATCH", "/document/body");
      for (const key of ["related_eyebrow", "related_heading"]) if (!actualConstants.has(key)) fail("SEMANTIC_CONSTANT_MISMATCH", "/constants/" + key);
    }
    const hero = mainSections[0];
    const second = hero?.children?.[1];
    if (!hero || hero.attrs?.["data-section"] !== "HERO" || !second || typeof second === "string"
      || second.attrs?.["data-section"] !== "INTAKE" || second.attrs?.id !== "intake"
      || nodes.filter(node => node.attrs?.["data-section"] === "INTAKE").length !== 1) fail("SEMANTIC_ORDER_MISMATCH", "/document/body");
    const section = (name: string) => mainSections.find(node => node.attrs?.["data-section"] === name);
    const sectionNodes = (name: string) => { const current = section(name); return current ? descendants(current) : []; };
    const tableRows = (name: string) => sectionNodes(name).filter(node => node.tag === "tbody").flatMap(node => (node.children ?? []).filter(child => typeof child !== "string" && child.tag === "tr")).length;
    const safeList = sectionNodes("SAFE_OBSERVATIONS").find(node => node.tag === "ol");
    const actualCounts: Record<string, number> = {
      observations: tableRows("WHAT_CHANGES_THE_ANSWER"), causes: tableRows("COMMON_POSSIBILITIES"),
      safe_checks: safeList?.children?.filter(child => typeof child !== "string" && child.tag === "li").length ?? 0,
      visuals: sectionNodes("VISUALS").filter(node => node.tag === "figure").length,
      faq: sectionNodes("FAQ").filter(node => node.tag === "article").length,
    };
    if (!equal(actualCounts, receipt.derived_counts)) fail("SEMANTIC_COUNT_MISMATCH", "/receipt/derived_counts");
    const counters = nodes.filter(node => node.attrs?.["data-count"] !== undefined);
    if (counters.length !== Object.keys(actualCounts).length) fail("SEMANTIC_COUNT_MISMATCH", "/document/body");
    for (const [key, value] of Object.entries(actualCounts)) {
      const matching = counters.filter(node => node.attrs?.["data-metric-slot"] === key);
      if (matching.length !== 1 || matching[0].attrs?.["data-count"] !== String(value) || content(matching[0]) !== String(value)) fail("SEMANTIC_COUNT_MISMATCH", "/document/body");
    }

    const ledger = byId("sources-and-review")[0];
    const ledgerRows = ledger ? descendants(ledger).filter(node => node.tag === "li" && node.attrs?.["data-source-id"]) : [];
    const sourceIds = ledgerRows.map(node => node.attrs!["data-source-id"]);
    const sourceUrls: string[] = [];
    for (const row of ledgerRows) {
      const links = descendants(row).filter(node => node.tag === "a" && node.attrs?.href?.startsWith("https://"));
      if (links.length !== 1 || row.attrs?.id !== "source-" + row.attrs?.["data-source-id"]) fail("SEMANTIC_CITATION_MISMATCH", "/document/body");
      else sourceUrls.push(links[0].attrs!.href);
    }
    if (!sameSet(sourceIds, receipt.source_ids)) fail("SEMANTIC_CITATION_MISMATCH", "/receipt/source_ids");
    for (const node of nodes.filter(node => node.tag === "a" && node.attrs?.["data-source-id"])) {
      if (!sourceIds.includes(node.attrs!["data-source-id"]) || node.attrs?.href !== "#source-" + node.attrs?.["data-source-id"]) fail("SEMANTIC_CITATION_MISMATCH", "/document/body");
    }
    const claimIds = [...new Set(nodes.map(node => node.attrs?.["data-claim-id"]).filter((id): id is string => !!id))];
    const ledgerClaims = [...new Set(ledgerRows.flatMap(row => descendants(row).map(node => node.attrs?.["data-claim-id"])).filter((id): id is string => !!id))];
    if (!sameSet(claimIds, receipt.claim_ids) || !sameSet(ledgerClaims, receipt.claim_ids)) fail("SEMANTIC_CITATION_MISMATCH", "/receipt/claim_ids");
    const graph = graphRows(document.structured_data);
    const webPages = graph.filter(row => row["@type"] === "WebPage");
    const page = webPages[0];
    if (webPages.length !== 1 || !page || page["@id"] !== document.canonical_url + "#webpage" || page.url !== document.canonical_url
      || page.name !== document.title || page.description !== document.description) fail("SEMANTIC_METADATA_MISMATCH", "/document/structured_data");
    if (!page || !Array.isArray(page.citation) || !sameSet(page.citation as string[], sourceUrls)) fail("SEMANTIC_CITATION_MISMATCH", "/document/structured_data");

    const faqs = graph.filter(row => row["@type"] === "FAQPage"), faq = faqs[0];
    const faqArticles = sectionNodes("FAQ").filter(node => node.tag === "article");
    const questions = faq && Array.isArray(faq.mainEntity) ? faq.mainEntity : [];
    if (faqs.length !== 1 || faq?.["@id"] !== document.canonical_url + "#faq"
      || !record(page?.mainEntity) || page.mainEntity["@id"] !== faq?.["@id"]
      || questions.length !== faqArticles.length || graph.filter(row => row["@type"] === "Question").length !== faqArticles.length
      || graph.filter(row => row["@type"] === "Answer").length !== faqArticles.length) fail("SEMANTIC_FAQ_MISMATCH", "/document/structured_data");
    for (const article of faqArticles) {
      const headings = descendants(article).filter(node => node.tag === "h3");
      const matched = questions.filter(row => record(row) && row["@id"] === document.canonical_url + "#" + article.attrs?.id);
      const question = matched[0];
      const answerText = (article.children ?? []).filter(child => child !== headings[0])
        .map(child => typeof child === "string" ? child : content(child)).join("");
      if (headings.length !== 1 || matched.length !== 1 || !record(question) || question["@type"] !== "Question"
        || question.name !== content(headings[0]) || !record(question.acceptedAnswer) || question.acceptedAnswer["@type"] !== "Answer"
        || question.acceptedAnswer.text !== answerText) fail("SEMANTIC_FAQ_MISMATCH", "/document/structured_data");
    }

    const dates = ledger ? descendants(ledger).filter(node => node.tag === "time") : [];
    if (document.date_modified === null) {
      if (dates.length || (page && Object.prototype.hasOwnProperty.call(page, "dateModified"))) fail("SEMANTIC_DATE_MISMATCH", "/document");
    } else if (dates.length !== 1 || dates[0].attrs?.datetime !== document.date_modified || content(dates[0]) !== document.date_modified.slice(0, 10)
      || page?.dateModified !== document.date_modified) fail("SEMANTIC_DATE_MISMATCH", "/document");
    if (document.date_modified !== null && !actualConstants.has("review_date_label")) fail("SEMANTIC_CONSTANT_MISMATCH", "/constants/review_date_label");

    // Compiler v1 hashes approved visible content before appending the derived
    // review-date row. Exclude only that ledger row here; its text/date/constant
    // are checked independently above. This avoids a date-provenance cycle.
    function visibleProjection(children: Array<DoorV44Element | string>, inLedger = false): unknown[] {
      return children.flatMap((node): unknown[] => {
        if (typeof node === "string") return [node];
        if (node.tag === "input" && node.attrs?.type === "hidden") return [];
        if (inLedger && node.tag === "p" && descendants(node).some(child => child.tag === "time")) return [];
        const attributes = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key]) => ["alt", "aria-label", "placeholder", "title"].includes(key)));
        return [attributes, ...visibleProjection(node.children ?? [], inLedger || node.attrs?.id === "sources-and-review")];
      });
    }
    const components = new Map(receipt.visible_components.map(row => [row.component_id, row.content_hash]));
    const expectedComponents = ["content", "constants", "disclosure", ...receipt.claim_ids.map(id => "claim:" + id), ...assets.map(asset => "image:" + asset.asset_id)];
    const contentHash = doorV44Hash({ title: document.title, description: document.description, visible: visibleProjection(document.body) });
    const constantHash = doorV44Hash([...actualConstants].filter(([key]) => key !== "review_date_label").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    if (components.size !== receipt.visible_components.length || !sameSet([...components.keys()], expectedComponents)
      || components.get("content") !== contentHash || components.get("constants") !== constantHash
      || assets.some(asset => components.get("image:" + asset.asset_id) !== asset.sha256)) fail("SEMANTIC_HASH_MISMATCH", "/receipt/visible_components");

    const figures = sectionNodes("VISUALS").filter(node => node.tag === "figure");
    const images = graph.filter(row => row["@type"] === "ImageObject");
    if (figures.length !== assets.length || images.length !== figures.length || new Set(assets.map(row => row.asset_id)).size !== assets.length) fail("SEMANTIC_IMAGE_MISMATCH", "/assets");
    for (const [index, asset] of assets.entries()) {
      const bytes = Buffer.from(asset.base64, "base64");
      if (bytes.toString("base64") !== asset.base64 || hash(bytes) !== asset.sha256 || new URL(asset.path, document.canonical_url).href !== asset.url
        || !figures.some(figure => descendants(figure).some(node => node.tag === "img" && node.attrs?.src === asset.url))) fail("SEMANTIC_IMAGE_MISMATCH", "/assets/" + index);
    }
    for (const figure of figures) {
      const nested = descendants(figure), imgs = nested.filter(node => node.tag === "img");
      const visualId = figure.attrs?.["data-visual-id"];
      const imageRows = images.filter(row => row["@id"] === document.canonical_url + "#image-" + visualId);
      const img = imgs[0], image = imageRows[0];
      const title = nested.find(node => node.tag === "h3"), caption = nested.find(node => node.tag === "figcaption"), description = nested.find(node => node.tag === "p");
      const asset = assets.find(row => row.url === img?.attrs?.src);
      if (imgs.length !== 1 || imageRows.length !== 1 || !visualId || figure.attrs?.id !== visualId || !asset || !title || !caption || !description
        || img.attrs?.alt !== content(title) || Number(img.attrs?.width) !== asset.width || Number(img.attrs?.height) !== asset.height
        || image.contentUrl !== asset.url || image.url !== asset.url || image.name !== img.attrs?.alt
        || image.width !== asset.width || image.height !== asset.height || image.encodingFormat !== asset.mime
        || image.caption !== content(caption) || image.description !== content(description)) fail("SEMANTIC_IMAGE_MISMATCH", "/document/body");
    }
    const social = document.social_image;
    const primary = record(page?.primaryImageOfPage) ? page.primaryImageOfPage["@id"] : undefined;
    const socialImage = images.find(row => row["@id"] === primary);
    if (!social || !socialImage || socialImage.contentUrl !== social.url || socialImage.name !== social.alt || socialImage.width !== social.width
      || socialImage.height !== social.height || socialImage.encodingFormat !== social.mime) fail("SEMANTIC_IMAGE_MISMATCH", "/document/social_image");
    return errors.length ? { ok: false, errors: sortDoorV44Diagnostics(errors) } : { ok: true, errors: [] };
  } catch {
    return { ok: false, errors: [{ code: "SEMANTIC_INPUT_INVALID", pointer: "" }] };
  }
}
