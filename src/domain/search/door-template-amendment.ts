import { createHash } from "node:crypto";
import originalBinding from "../../../content/door-template/v43/binding.json";
import amendment from "../../../content/door-template/amendments/v43-copy-2026-09-06-r1.json";

/** Independently reviewed amendment; the original v43 source/reference pins remain intact. */
export const V43_COPY_AMENDMENT_SHA256 = "d3c0334191addd6b4f6394701ba59cbfb224b8905aba8f8c9f756c037eaa0601";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const lf = (value: string) => value.replace(/\r\n/g, "\n");
export type V43CopyAmendment = typeof amendment;

export function reviewV43CopyAmendment(input: unknown = amendment): V43CopyAmendment {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Missing reviewed v43 copy amendment");
  const { amendment_sha256, ...payload } = input as V43CopyAmendment;
  // The pinned digest authenticates the complete, exact known schema and values,
  // including counts, original hashes, approval scope, authored date and outputs.
  if (amendment_sha256 !== V43_COPY_AMENDMENT_SHA256 || sha(JSON.stringify(payload)) !== V43_COPY_AMENDMENT_SHA256) {
    throw new Error("Unreviewed v43 copy amendment or damaged amendment digest");
  }
  return structuredClone(input as V43CopyAmendment);
}

function replaceExact(source: string, replacement: { from: string; to: string; count: number }, where: string): string {
  if (source.split(replacement.from).length - 1 !== replacement.count) throw new Error("Copy amendment replacement count mismatch: " + where);
  return source.split(replacement.from).join(replacement.to);
}

function replaceLeaves(value: unknown, from: string, to: string, count: { value: number }): unknown {
  if (typeof value === "string") {
    count.value += value.split(from).length - 1;
    return value.split(from).join(to);
  }
  if (Array.isArray(value)) return value.map(row => replaceLeaves(row, from, to, count));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, replaceLeaves(row, from, to, count)]));
  return value;
}

/** Applies only the explicit, counted wording edits after a complete base HTML hash check. */
export function amendV43Html(source: string, input: unknown = amendment): string {
  const review = reviewV43CopyAmendment(input);
  let html = lf(source);
  if (sha(html) !== review.base.rendered_sha256) throw new Error("Copy amendment requires the exact original v43 rendering");
  for (const row of review.replacements) html = replaceExact(html, row.rendered, row.id);
  html = replaceExact(html, {
    from: '"dateModified": "' + review.base.content_date + '"',
    to: '"dateModified": "' + review.result.content_date + '"', count: 1,
  }, "authored amendment date");
  if (sha(html) !== review.result.rendered_sha256) throw new Error("Amended v43 rendering differs from reviewed output");
  return html;
}

/** The original kit drawing stays immutable; callers receive an amended in-memory derivative. */
export function amendV43SourceAsset(assetId: string, source: string, input: unknown = amendment): string {
  const review = reviewV43CopyAmendment(input);
  const original = originalBinding.visual_assets.find(row => row.asset_id === assetId);
  let value = lf(source);
  if (!original || sha(value) !== original.source_sha256) throw new Error("Copy amendment requires the exact original v43 source asset");
  const asset = review.assets.find(row => row.asset_id === assetId);
  if (!asset) return value;
  for (const row of review.replacements) value = value.split(row.rendered.from).join(row.rendered.to);
  if (sha(value) !== asset.amended_sha256) throw new Error("Amended v43 source asset differs from reviewed output");
  return value;
}

export function getAmendedV43Binding(base = originalBinding, input: unknown = amendment) {
  const review = reviewV43CopyAmendment(input);
  const { binding_sha256, ...basePayload } = base;
  if (binding_sha256 !== review.base.binding_sha256 || sha(JSON.stringify(basePayload)) !== review.base.binding_sha256 ||
      base.reference_sha256 !== review.base.reference_sha256 || base.source_tree_sha256 !== review.base.source_tree_sha256 ||
      base.rendered_sha256 !== review.base.rendered_sha256) throw new Error("Copy amendment requires the exact original v43 binding");
  let result = structuredClone(base);
  for (const row of review.replacements) {
    const count = { value: 0 };
    result = replaceLeaves(result, row.binding.from, row.binding.to, count) as typeof base;
    if (count.value !== row.binding.count) throw new Error("Binding amendment replacement count mismatch: " + row.id);
  }
  for (const asset of review.assets) {
    const target = result.visual_assets.find(row => row.asset_id === asset.asset_id);
    if (!target || target.source_sha256 !== asset.base_sha256) throw new Error("Amended asset identity mismatch");
    target.source_sha256 = asset.amended_sha256;
  }
  result.content_date = review.result.content_date;
  result.rendered_sha256 = review.result.rendered_sha256;
  const amended = { ...result, amendment: {
    amendment_id: review.amendment_id, base_binding_sha256: review.base.binding_sha256, source_modified_at: review.source_modified_at,
  } };
  const { binding_sha256: _oldHash, ...payload } = amended;
  amended.binding_sha256 = sha(JSON.stringify(payload));
  if (amended.binding_sha256 !== review.result.binding_sha256 || JSON.stringify(amended.section_order) !== JSON.stringify(review.result.section_order)) {
    throw new Error("Amended v43 binding differs from reviewed output");
  }
  if (amended.claim_bindings.length !== review.claims.length || review.claims.some(claim => {
    const before = base.claim_bindings.find(row => row.claim_id === claim.claim_id);
    const after = amended.claim_bindings.find(row => row.claim_id === claim.claim_id);
    return !before || !after || sha(before.text) !== claim.before_sha256 || sha(after.text) !== claim.after_sha256;
  })) throw new Error("Amended v43 exact claim hashes differ from the reviewed amendment");
  return amended;
}
