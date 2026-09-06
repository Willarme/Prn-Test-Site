import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import original from "../../../content/door-template/v43/binding.json";
import { getAmendedV43Binding } from "./door-template-amendment";
import type { PageSpec } from "@/domain/search/pages";
import type { QaFinding } from "@/domain/search/qa-types";

/** A06 independently pins the inspected release, never A05's matcher/validator. */
export const V43_QA_PINS = {
  reference: "756fb95907fd3fb21f7bc9a86e854d0e90f8ef35455776b83a17b4935f8d8843",
  tree: "07d511adf4828ed43739c91616fca29005b06e71d7ad13ff37a31d5f310df0ca",
  binding: "3f14222350a5ae401381ab37b31b7b66c83dd05416a4fd2631b533db417518ea",
  rendered: "4eb1823eff991067a4922d3e068f57e71356073546e65eaa2e9143b057663cb5",
  content_date_receipt: "93e5e1ff781d1a513afd383575b6b0d9bb975a2b049cf008e70a7fe73bc0b3e2",
  source_modified_at: "2026-09-05T19:45:35Z",
  source_commit: "9b4d64044e2247633807acfea413e142363bd618",
} as const;
/** Separate pins for the approved derivative; never rebaseline the original kit. */
export const V43_QA_AMENDMENT_PINS = {
  amendment: "d3c0334191addd6b4f6394701ba59cbfb224b8905aba8f8c9f756c037eaa0601",
  binding: "fd85de29c6ac6c7b70bce416c59e974b305575b1a85ef2fc53e80a3f36b55f25",
  rendered: "4bd2a178679fed0dfd1a979c03ccd6e39ecc57ff45d4f49e4adb75a2efc3fa56",
  source_modified_at: "2026-09-06T17:28:56.224Z",
  asset_receipt: "d0aba512c373092063f2abb0b29d7b384090e52b8a79ef7b2d00379fcb40a7b8",
} as const;
const reviewed = getAmendedV43Binding();
export const V43_QA_RENDER_ORIGIN = "https://v43-preview.invalid";

/** Actual existing files measured 2026-09-06; this is local fidelity, not HTTP proof. */
export const V43_ASSET_PINS: Readonly<Record<string, { svg: string; png: string }>> = {
  "plate-1": { svg: "062160937fe42df2ea43f9862af51ab7b93805bcb514b4f34f1ee4a4074c7832", png: "965d46e0c22105b693ffe6672e7995a3084245850152b230a9f85ae0e147f535" },
  "plate-2": { svg: "b889cc7e1161e5334ff41ac8eb4639aadc2b99b5400e7834bdd047de909578fb", png: "f90f2d5352e0cd6e6d796a7cfe57a8940532dc0bcc1b5d7ce8944cc0ee9af391" },
  "plate-3": { svg: "5c72886833771575c61e9627ea9328896e9c69a18752dfed53e97b67a420e39d", png: "dce3de077486dec9e701ef7c0afbfcd42fcd1239dd1f5ef2a4931bd57c9127c5" },
};

export const DOOR_TEMPLATE_CHECK_IDS = [
  "door_template.integrity", "door_template.claim_binding", "door_template.source_verification",
  "door_template.asset_receipt", "door_template.capability_runtime", "door_template.production_release",
] as const;

export interface DoorSourceVerification {
  source_id: string;
  url: string;
  content_sha256: string;
  verified_at: string;
  expires_at: string;
  /** Exact claim texts independently verified against the captured source. */
  supported_claim_sha256: string[];
  verifier: string;
  receipt_sha256: string;
}

export interface DoorCapabilityVerification {
  capability_id: string;
  environment: string;
  origin: string;
  deployment_id: string;
  verified_at: string;
  expires_at: string;
  tested_claim_sha256: string;
  tested_inputs: string[];
  tested_outputs: string[];
  result: string;
  verified_by: string;
  receipt_sha256: string;
}

export interface DoorAssetEvidence {
  asset_id: string;
  source_sha256: string | null;
  svg_path: string;
  svg_sha256: string | null;
  raster_path: string;
  raster_sha256: string | null;
  encoding_format: string | null;
  width: number | null;
  height: number | null;
  /** Metadata extracted from the actual runtime renderer, not copied from PageSpec. */
  metadata: { content_url: string; encoding_format: string; width: number; height: number } | null;
}

export interface DoorTemplateEvidence {
  page_spec_id: string;
  collected_at: string;
  reference_sha256: string | null;
  source_tree_sha256: string | null;
  binding_sha256: string | null;
  rendered_sha256: string | null;
  base_binding_sha256: string | null;
  base_rendered_sha256: string | null;
  amendment_sha256: string | null;
  /** Raw server reads let A06 inspect the receipt and final HTML independently. */
  source_date_evidence_text: string | null;
  amendment_evidence_text: string | null;
  asset_amendment_evidence_text: string | null;
  final_rendered_html: string | null;
  assets: DoorAssetEvidence[];
  social: { og_image: string | null; twitter_image: string | null; width: number | null; height: number | null; encoding_format: string | null } | null;
  sources: DoorSourceVerification[];
  source_review_findings?: Array<{ id: string; reason: string }>;
  capabilities: DoorCapabilityVerification[];
  /** No production receipt adapter is installed yet. Missing means blocked. */
  production: null | {
    origin: string; deployment_id: string; verified_at: string; expires_at: string;
    canonical_path: string; content_sha256: string; public_release_authorized: boolean;
    crawler_checks_passed: boolean; image_render_parity_passed: boolean;
    browser_accessibility_checks_passed: boolean; links_and_sitemaps_passed: boolean;
    receipt_sha256: string;
  };
  errors: string[];
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const validHash = (value: string | null | undefined) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const time = (value: string) => Date.parse(value);
const isCurrent = (verified: string, expires: string, now: number, maxDays: number) =>
  Number.isFinite(time(verified)) && Number.isFinite(time(expires)) && time(verified) <= now &&
  time(expires) > now && time(expires) > time(verified) && now - time(verified) <= maxDays * 86400000 &&
  time(expires) - time(verified) <= maxDays * 86400000;

function htmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1].toLowerCase();
    if (Object.hasOwn(attributes, name)) throw new Error("Duplicate HTML metadata attribute");
    attributes[name] = match[2] ?? match[3];
  }
  return attributes;
}

function publicOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password &&
      !/^(localhost|127\.|0\.|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) &&
      !/\.(test|invalid|localhost|local|example)$/i.test(url.hostname);
  } catch { return false; }
}

/** Binding removal, stale versions and renaming only one side all fail closed. */
export function requiresV43DoorChecks(spec: PageSpec): boolean {
  return spec.door_template !== undefined || /^door-v43(?:$|[-@])/i.test(spec.template_id) ||
    spec.content_blocks.some((block) => block.block_id.startsWith("v43_"));
}

/** Only exact frozen fields qualify for replacing legacy shape/link checks. */
export function isReviewedV43Spec(spec: PageSpec): boolean {
  const fields = spec as unknown as Record<string, unknown>;
  return isDeepStrictEqual(spec.door_template, reviewed) &&
    Object.entries(reviewed.page_fields).every(([key, expected]) => isDeepStrictEqual(fields[key], expected));
}

export function runV43DoorChecks(spec: PageSpec, evidence?: DoorTemplateEvidence): QaFinding[] {
  if (!requiresV43DoorChecks(spec)) return [];
  const findings: QaFinding[] = [];
  const fail = (check: typeof DOOR_TEMPLATE_CHECK_IDS[number], where: string, message: string, repair: string) => {
    findings.push({ check, severity: "blocker", where, message, repair_instructions: repair });
  };
  const integrity = (where: string, message: string) => fail("door_template.integrity", where, message,
    "Restore the independently reviewed v43 binding, frozen copy/design and matching source-version receipts; run QA again.");

  const { binding_sha256: originalHash, ...originalPayload } = original;
  if (originalHash !== V43_QA_PINS.binding || sha(JSON.stringify(originalPayload)) !== V43_QA_PINS.binding) {
    integrity("original_binding", "A06's immutable original v43 binding no longer matches its independent fingerprint.");
  }
  const { binding_sha256: bindingHash, ...bindingPayload } = reviewed;
  if (bindingHash !== V43_QA_AMENDMENT_PINS.binding || sha(JSON.stringify(bindingPayload)) !== V43_QA_AMENDMENT_PINS.binding) {
    integrity("reviewed_binding", "A06's independent reviewed binding fingerprint no longer matches its artifact.");
  }
  if (!spec.door_template || !isDeepStrictEqual(spec.door_template, reviewed)) {
    integrity("door_template", "Missing or changed v43 template, copy, design, claim, source or capability binding.");
  }
  const fields = spec as unknown as Record<string, unknown>;
  for (const [key, expected] of Object.entries(reviewed.page_fields)) {
    if (!isDeepStrictEqual(fields[key], expected)) integrity(key, `Frozen v43 PageSpec field ${key} differs from the reviewed rendering contract.`);
  }
  if ((spec.tenant_id ?? "prn") !== "prn" || spec.intake_context.page_id !== spec.page_id ||
      spec.intake_context.intent_cluster_id !== spec.intent_cluster_id ||
      spec.intake_context.search_opportunity_id !== spec.search_opportunity_id ||
      spec.intake_context.problem_family_hint !== spec.problem_family) {
    integrity("intake_context", "The reviewed PRN door has a mismatched tenant or shared-intake attribution.");
  }
  const collected = evidence?.page_spec_id === spec.page_spec_id ? evidence : undefined;
  const now = collected ? time(collected.collected_at) : Date.now();
  if (!collected || !Number.isFinite(now)) integrity("evidence", "No valid server-collected v43 evidence is available for this exact page spec.");
  for (const [field, expected] of Object.entries({ reference_sha256: V43_QA_PINS.reference,
    source_tree_sha256: V43_QA_PINS.tree, base_binding_sha256: V43_QA_PINS.binding, base_rendered_sha256: V43_QA_PINS.rendered,
    amendment_sha256: V43_QA_AMENDMENT_PINS.amendment, binding_sha256: V43_QA_AMENDMENT_PINS.binding,
    rendered_sha256: V43_QA_AMENDMENT_PINS.rendered })) {
    if (collected?.[field as keyof DoorTemplateEvidence] !== expected) integrity(field, `Actual ${field} does not match the independently pinned v43 release.`);
  }
  for (const error of collected?.errors ?? []) integrity("evidence", error);

  // Inspect raw reads instead of trusting collector-authored date/canonical
  // scalars. The separate manifest's date is not a provenance authority.
  try {
    const text = collected?.source_date_evidence_text;
    if (!text || sha(text.replace(/\r\n/g, "\n")) !== V43_QA_PINS.content_date_receipt) {
      throw new Error("The content-date receipt is missing or does not match its independent hash.");
    }
    const receipt = JSON.parse(text) as Record<string, unknown>;
    if (receipt.source_modified_at !== V43_QA_PINS.source_modified_at || receipt.source_commit !== V43_QA_PINS.source_commit ||
        original.content_date !== V43_QA_PINS.source_modified_at.slice(0, 10)) {
      throw new Error("The content date does not identify the reviewed source commit.");
    }
  } catch {
    integrity("content_date_receipt", "The actual source-date evidence is missing, changed or inconsistent with the independently pinned source commit/date.");
  }
  try {
    if (!collected?.amendment_evidence_text) throw new Error("Missing amendment record");
    const { amendment_sha256, ...amendment } = JSON.parse(collected.amendment_evidence_text);
    if (amendment_sha256 !== V43_QA_AMENDMENT_PINS.amendment || sha(JSON.stringify(amendment)) !== V43_QA_AMENDMENT_PINS.amendment ||
        amendment.base.binding_sha256 !== V43_QA_PINS.binding || amendment.base.rendered_sha256 !== V43_QA_PINS.rendered ||
        amendment.base.reference_sha256 !== V43_QA_PINS.reference || amendment.base.source_tree_sha256 !== V43_QA_PINS.tree ||
        amendment.base.content_date_receipt_sha256 !== V43_QA_PINS.content_date_receipt ||
        amendment.result.binding_sha256 !== V43_QA_AMENDMENT_PINS.binding || amendment.result.rendered_sha256 !== V43_QA_AMENDMENT_PINS.rendered ||
        amendment.source_modified_at !== V43_QA_AMENDMENT_PINS.source_modified_at ||
        amendment.result.content_date !== reviewed.content_date || reviewed.content_date !== V43_QA_AMENDMENT_PINS.source_modified_at.slice(0, 10) ||
        !isDeepStrictEqual(amendment.result.section_order, original.section_order)) throw new Error("Amendment chain mismatch");
  } catch {
    integrity("copy_amendment_receipt", "The actual approved wording amendment is missing, altered or detached from the immutable base, exact outputs or authored date.");
  }
  try {
    if (!collected?.asset_amendment_evidence_text) throw new Error("Missing asset derivative record");
    const { receipt_sha256, ...receipt } = JSON.parse(collected.asset_amendment_evidence_text);
    if (receipt_sha256 !== V43_QA_AMENDMENT_PINS.asset_receipt || sha(JSON.stringify(receipt)) !== V43_QA_AMENDMENT_PINS.asset_receipt ||
        receipt.amendment_sha256 !== V43_QA_AMENDMENT_PINS.amendment || receipt.assets.length !== 1) throw new Error("Unreviewed asset receipt");
    const asset = receipt.assets[0], expected = reviewed.visual_assets[0];
    if (asset.asset_id !== expected.asset_id || asset.base_source_sha256 !== original.visual_assets[0].source_sha256 ||
        asset.amended_source_sha256 !== expected.source_sha256 || asset.public_svg_path !== expected.public_svg_path ||
        asset.public_svg_sha256 !== V43_ASSET_PINS[expected.asset_id].svg || asset.raster_path !== expected.raster_path ||
        asset.raster_sha256 !== V43_ASSET_PINS[expected.asset_id].png || asset.width !== expected.width || asset.height !== expected.height ||
        asset.encoding_format !== "image/png" || asset.has_alpha !== false) throw new Error("Asset derivative chain mismatch");
  } catch {
    integrity("asset_amendment_receipt", "The actual diagram derivative receipt is missing, altered or detached from the approved wording amendment and measured raster.");
  }
  try {
    const html = collected?.final_rendered_html;
    if (!html) throw new Error("No final rendered document");
    const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => htmlAttributes(match[0]))
      .filter((attributes) => attributes.rel?.toLowerCase().split(/\s+/).includes("canonical"));
    const ogUrls = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => htmlAttributes(match[0]))
      .filter((attributes) => attributes.property?.toLowerCase() === "og:url");
    const expected = new URL(spec.canonical_path, V43_QA_RENDER_ORIGIN).href;
    if (canonicals.length !== 1 || canonicals[0].href !== expected || ogUrls.length !== 1 || ogUrls[0].content !== expected) {
      integrity("rendered_canonical", "The final canonical/OG URL does not uniquely identify this PageSpec's exact served path and inspection origin.");
    }
    const pages: Array<Record<string, unknown>> = [];
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (htmlAttributes("<script " + match[1] + ">").type !== "application/ld+json") continue;
      const data = JSON.parse(match[2]) as Record<string, unknown>;
      const nodes = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
      for (const node of nodes) if (node?.["@type"] === "WebPage") pages.push(node);
    }
    if (pages.length !== 1 || pages[0].dateModified !== V43_QA_AMENDMENT_PINS.source_modified_at.slice(0, 10)) {
      integrity("rendered_date_modified", "The final WebPage dateModified is missing, ambiguous or differs from the hashed source-version date.");
    }
    if (pages.length !== 1 || pages[0].url !== expected || pages[0]["@id"] !== expected + "#webpage") {
      integrity("rendered_canonical", "The final WebPage URL/id disagrees with the PageSpec's canonical served path.");
    }
  } catch {
    integrity("rendered_metadata", "Final rendered canonical/date metadata is unavailable or malformed; claimed collector values cannot verify it.");
  }

  // These are immutable exact mappings. A source id attached to arbitrary new
  // prose, or a model PASS, can never substitute for reviewed claim support.
  for (const issue of collected?.source_review_findings ?? []) {
    fail("door_template.source_verification", `review:${issue.id}`, issue.reason,
      "Resolve the documented source conflict or coverage gap through a reviewed revision; preserve frozen copy and the release hold.");
  }
  for (const source of reviewed.source_bindings) {
    const receipt = collected?.sources.find((row) => row.source_id === source.source_id && row.url === source.url);
    const maxAge = /\$|\bcost|\bprice|\brange\b/i.test(source.inherited_note) ? 90 : 180;
    if (!receipt || !validHash(receipt.content_sha256) || !validHash(receipt.receipt_sha256) ||
        !receipt.verifier.trim() || !isCurrent(receipt.verified_at, receipt.expires_at, now, maxAge)) {
      fail("door_template.source_verification", source.source_id,
        `${source.source_id} has no current source-verification receipt; its inherited September 1 note has not been reverified.`,
        "Retain the inherited note, obtain an actual source capture and independent verification receipt, and run QA again.");
    }
  }
  for (const claim of reviewed.claim_bindings.filter((row) => row.claim_type !== "capability")) {
    if (claim.source_ids.length === 0) {
      fail("door_template.claim_binding", claim.claim_id,
        `Approved visible claim lacks a supporting source binding: ${claim.text}`,
        "Obtain claim-specific evidence and a reviewed binding revision. Preserve frozen copy while this release remains blocked.");
    }
    for (const sourceId of claim.source_ids) {
      const source = reviewed.source_bindings.find((row) => row.source_id === sourceId);
      const receipt = collected?.sources.find((row) => row.source_id === sourceId && row.url === source?.url);
      const maxAge = /\$|\bcost|\bprice|\brange\b/i.test(claim.text) ? 90 : 180;
      if (!source || !receipt || !validHash(receipt.content_sha256) || !validHash(receipt.receipt_sha256) ||
          !receipt.verifier.trim() || !isCurrent(receipt.verified_at, receipt.expires_at, now, maxAge) ||
          !receipt.supported_claim_sha256.includes(sha(claim.text))) {
        fail("door_template.source_verification", `${claim.claim_id}:${sourceId}`,
          `No current exact source-verification receipt supports ${claim.claim_id} from ${sourceId}; inherited September 1 notes remain unverified inputs.`,
          "Fetch and verify the exact claim against the named source, retain its capture/hash and expiration, and re-run release QA.");
      }
    }
  }
  // The unchanged stat-3 prose needs the separately reviewed Trane URL. A
  // receipt for its original Carrier citation alone cannot establish both attributions.
  const frozenCoil = reviewed.claim_bindings.find(row => row.claim_id === "stat-3")!;
  const trane = collected?.sources.find(row => row.source_id === "sup-trane-frozen-causes");
  if (!trane || trane.url !== "https://www.trane.com/residential/en/resources/blog/frozen-evaporator-coil-causes/" ||
      trane.content_sha256 !== "9cecca766f13e3007a8d1b82a5716d16f52b4066904efc3ed6594efec94811b9" ||
      !validHash(trane.receipt_sha256) || !trane.verifier.trim() || !isCurrent(trane.verified_at, trane.expires_at, now, 180) ||
      !trane.supported_claim_sha256.includes(sha(frozenCoil.text))) {
    fail("door_template.source_verification", "stat-3:sup-trane-frozen-causes", "The exact supplemental Trane capture and claim receipt are required for the amended page's two-manufacturer frozen-coil guidance.",
      "Restore the reviewed supplemental source evidence and re-run QA; do not relabel the original Trane URL.");
  }

  for (const asset of reviewed.visual_assets) {
    const actual = collected?.assets.find((row) => row.asset_id === asset.asset_id);
    const pins = V43_ASSET_PINS[asset.asset_id];
    let metadataPath: string | undefined;
    try { metadataPath = actual?.metadata ? new URL(actual.metadata.content_url).pathname : undefined; } catch { /* missing is a blocker */ }
    if (!actual || actual.source_sha256 !== asset.source_sha256 || actual.svg_path !== asset.public_svg_path ||
        actual.svg_sha256 !== pins.svg || actual.raster_path !== asset.raster_path || actual.raster_sha256 !== pins.png ||
        actual.encoding_format !== "image/png" || actual.width !== asset.width || actual.height !== asset.height ||
        metadataPath !== asset.raster_path || actual.metadata?.encoding_format !== "image/png" ||
        actual.metadata?.width !== asset.width || actual.metadata?.height !== asset.height) {
      fail("door_template.asset_receipt", asset.asset_id,
        `Image source/file/hash/format/dimensions or rendered ImageObject metadata does not match the reviewed receipt for ${asset.asset_id}.`,
        "Restore the exact reviewed asset and metadata, verify actual bytes and dimensions, then re-run QA; deployed image/render parity is a separate production requirement.");
    }
  }

  for (const capability of reviewed.capability_questions) {
    const claim = reviewed.claim_bindings.find((row) => row.claim_id === capability.capability_id)!;
    const receipt = collected?.capabilities.find((row) => row.capability_id === capability.capability_id);
    if (!receipt || receipt.environment !== "production" || receipt.result !== "PASS" ||
        !publicOrigin(receipt.origin) || !receipt.deployment_id.trim() || !receipt.verified_by.trim() ||
        !validHash(receipt.receipt_sha256) || !isCurrent(receipt.verified_at, receipt.expires_at, now, 30) ||
        receipt.tested_claim_sha256 !== sha(claim.text) ||
        ![...capability.required_inputs, ...capability.optional_inputs].every((input) => receipt.tested_inputs.includes(input)) ||
        !capability.possible_outputs.every((output) => receipt.tested_outputs.includes(output))) {
      fail("door_template.capability_runtime", capability.capability_id,
        `The page's ${capability.claimed_status} claim lacks matching production runtime proof: ${capability.question}`,
        "Verify the exact claimed behavior and advertised media/input/output paths on the production deployment; page-authored LIVE labels and local concept previews are not proof.");
    }
  }

  const preferred = reviewed.visual_assets.find((asset) => asset.og_image)!;
  const social = collected?.social;
  let socialPath: string | undefined;
  try { socialPath = social?.og_image ? new URL(social.og_image).pathname : undefined; } catch { /* blocked below */ }
  if (!social || socialPath !== preferred.raster_path || social.og_image !== social.twitter_image ||
      social.width !== preferred.width || social.height !== preferred.height || social.encoding_format !== "image/png") {
    fail("door_template.asset_receipt", "social_metadata", "Actual OG/Twitter image metadata does not identify the same reviewed raster and dimensions.",
      "Make OG, Twitter and ImageObject metadata identify the same real reviewed image asset, then re-run QA.");
  }

  const production = collected?.production;
  if (!production || !publicOrigin(production.origin) || !production.deployment_id.trim() ||
      !isCurrent(production.verified_at, production.expires_at, now, 7) || !validHash(production.receipt_sha256) ||
      production.canonical_path !== spec.canonical_path || production.content_sha256 !== V43_QA_AMENDMENT_PINS.rendered ||
      !production.public_release_authorized || !production.crawler_checks_passed || !production.image_render_parity_passed ||
      !production.browser_accessibility_checks_passed || !production.links_and_sitemaps_passed ||
      !spec.indexed || spec.noindex_reason !== null) {
    fail("door_template.production_release", "production",
      "v43 remains noindex and unreleased: production domain/activation, crawler/link/sitemap, standard-image parity and browser/accessibility receipts are not complete.",
      "Keep the preview unpublished. Complete the existing production release conditions on the authorized production machine; local QA cannot lift these holds.");
  }
  return findings;
}
