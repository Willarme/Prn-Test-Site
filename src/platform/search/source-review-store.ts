import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateSourceReview } from "@/domain/search/source-review";
import binding from "../../../content/door-template/v43/binding.json";

/** Fixed repository-owned input. No request-configurable path or upload adapter. */
export function collectSourceReview(now = new Date()) {
  return evaluateSourceReview(JSON.parse(readFileSync(
    join(process.cwd(), "content/source-evidence/ac-blowing-warm-air.json"), "utf8")), now);
}

export function publicSourceReview(now = new Date()) {
  const review = collectSourceReview(now);
  return {
    schema_version: 1, page_id: review.bundle.page_id,
    binding_sha256: review.bundle.binding_sha256, receipt_sha256: review.bundle.bundle_sha256,
    reviewed_at: review.bundle.reviewed_at, expires_at: review.bundle.expires_at,
    evidence_status: review.fresh ? "CURRENT_REVIEW_WITH_OPEN_GAPS" : "EXPIRED_REQUIRES_REVIEW",
    verification_method: "Dated HTTP captures and exact claim review; no live fetch on this request.",
    full_release_approved: false,
    sources: review.bundle.sources.map(row => ({
      source_id: row.source_id, url: row.url, final_url: row.final_url, http_status: row.http_status,
      publisher: binding.source_bindings.find(source => source.source_id === row.source_id)!.publisher,
      title: binding.source_bindings.find(source => source.source_id === row.source_id)!.title,
      captured_at: row.captured_at, content_sha256: row.content_sha256, evidence_class: row.evidence_class,
      published_at: row.published_at, modified_at: row.modified_at, date_basis: row.date_basis, summary: row.summary,
    })),
    claims: review.claims.map(row => ({
      claim_id: row.claim_id, claim_sha256: row.claim_sha256,
      display_text: binding.claim_bindings.find(claim => claim.claim_id === row.claim_id)!.text,
      display_value: binding.metric_cards.find(metric => metric.metric_id === row.claim_id)?.value ?? null,
      source_ids: row.source_captures.map(capture => capture.source_id),
      support_status: row.status, current: row.current, reviewed_at: row.reviewed_at,
      expires_at: row.expires_at, reason: row.reason, gaps: row.gaps,
    })),
    capability_claims: binding.claim_bindings.filter(row => row.claim_type === "capability").map(row => ({
      claim_id: row.claim_id, display_text: row.text, capability_ids: row.capability_ids,
      evidence_status: "CLAIMED_ON_PAGE_PENDING_RUNTIME_VERIFICATION",
      manifest_path: "/capabilities/home-problem-analyzer.json",
    })),
    findings: review.bundle.findings.map(row => ({
      finding_id: row.finding_id, severity: row.severity, sections: row.sections, reason: row.reason,
    })),
  };
}
