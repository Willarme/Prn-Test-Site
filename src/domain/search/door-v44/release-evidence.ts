import { z } from "zod";
import { doorV44Hash, isPlainDoorJson, stableDoorJson } from "./schema-engine";

// Provider-native model IDs may include suffixes such as :free. Page/tenant
// identities use the separate, narrower scopeId contract below.
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/);
const actorId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/);
const scopeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const at = z.string().datetime();
const count = z.number().int().min(0).max(2147483646);
const pointer = z.string().max(500).regex(/^(?:\/[A-Za-z0-9_~./-]*)?$/);
const verdict = z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN", "WARN"]);
const finding = z.object({ code: id, pointer, severity: z.enum(["blocker", "review"]) }).strict();
export const DOOR_RELEASE_CHECK_IDS = ["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10", "H11", "H12", "H13", "H14", "H15", "H16", "H17", "H18", "opportunity", "family_preflight", "schema", "intent", "constants", "actions", "layout_counts", "source_claims", "capabilities", "safety", "structured_data", "assets_social", "provenance_dates", "wording", "security", "accessibility", "responsive", "interaction", "performance", "batch_quality", "template_corpus", "staged_preview", "hosted_runtime", "reproducibility"] as const;
export const DOOR_EVIDENCE_KINDS = ["artifact_integrity", "independent_critic", "check_matrix", "technical_assessment", "content_approval", "release_evaluation", "publish_action", "review", "revocation"] as const;
export const DOOR_RELEASE_DEPENDENCY_KINDS = ["template", "schema", "fixture_corpus", "prompt", "source", "capability", "theme", "disclosure"] as const;
export const doorEvidenceSubjectSchema = z.object({ tenant_id: scopeId, page_id: scopeId, page_version: count.min(1), reservation_id: hash, input_sha256: hash, artifact_hash: hash, compile_receipt_sha256: hash }).strict();
export const doorReleaseFenceSchema = z.object({ revision: count, dependency_revision: count, hold_revision: count, dependencies_sha256: hash, environment_sha256: hash, holds_sha256: hash }).strict();
const dependency = z.object({ kind: id, id, version: id, sha256: hash }).strict();
const environment = z.object({ id, manifest_sha256: hash, commit: z.string().regex(/^[a-f0-9]{40}$/), origin: z.string().url().refine(v => { try { const u = new URL(v); return u.origin === v && ["https:", "http:"].includes(u.protocol); } catch { return false; } }) }).strict();
const producer = z.object({ id, version: id, implementation_sha256: hash, run_id: id, actor_id: actorId, actor_kind: z.enum(["system", "human"]), trust_scope: z.enum(["governed_execution", "reviewed_repository", "human_action", "synthetic_test"]) }).strict();
const common = { format: z.literal("door-v44-evidence/1.0.0"), subject: doorEvidenceSubjectSchema, producer, environment, dependencies: z.array(dependency).max(1000), started_at: at, finished_at: at, expires_at: at,
  verdict, findings: z.array(finding).max(500), attachments: z.array(z.object({ id, sha256: hash, bytes: count, media_type: z.enum(["application/json", "text/plain", "image/png", "image/webp"]) }).strict()).max(100), receipt_sha256: hash };
const assessment = { eligible: z.boolean(), policy_sha256: hash, evidence_hashes: z.array(hash).max(1000), dependencies_sha256: hash, environment_sha256: hash, fence: doorReleaseFenceSchema };
export const doorEvidenceReceiptSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("artifact_integrity"), output: z.object({ artifact_read_verified: z.literal(true), semantic_verified: z.literal(true), input_verified: z.literal(true) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("independent_critic"), output: z.object({ provider: id, model_id: id, generation_id: id.nullable(), prompt_id: id, prompt_version: id, prompt_sha256: hash, policy_sha256: hash, projection_sha256: hash, writer_assignments_sha256: hash, repair_iteration: count.max(2), prior_attempt_sha256: hash.nullable(), schema_repaired: z.boolean(), cost_usd: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/), usage: z.object({ prompt_tokens: count, completion_tokens: count, total_tokens: count }).strict() }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("check_matrix"), output: z.object({ checks: z.array(z.object({ check_id: z.enum(DOOR_RELEASE_CHECK_IDS), verdict, result_sha256: hash }).strict()).min(1).max(DOOR_RELEASE_CHECK_IDS.length) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("technical_assessment"), output: z.object(assessment).strict() }).strict(),
  z.object({ ...common, kind: z.literal("content_approval"), output: z.object({ assessment_sha256: hash, decision: z.enum(["APPROVE", "REJECT"]) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("release_evaluation"), output: z.object({ ...assessment, assessment_sha256: hash, content_approval_sha256: hash }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("publish_action"), output: z.object({ release_evaluation_sha256: hash, content_approval_sha256: hash, expected_selection_revision: count, operation_id: scopeId, action: z.enum(["publish", "rollback", "unpublish"]), reason: z.string().min(1).max(500).refine(v => ![...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("review"), output: z.object({ reviewed_evidence_sha256: hash, accepted_findings: z.array(finding).min(1).max(500) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("revocation"), output: z.object({ target_receipt_sha256: hash, reason_code: id }).strict() }).strict(),
]);
export type DoorEvidenceSubject = z.infer<typeof doorEvidenceSubjectSchema>;
export type DoorEvidenceReceipt = z.infer<typeof doorEvidenceReceiptSchema>;
export type DoorReleaseFence = z.infer<typeof doorReleaseFenceSchema>;
type Payload<T> = T extends { receipt_sha256: string } ? Omit<T, "receipt_sha256"> : never;
export type DoorEvidencePayload = Payload<DoorEvidenceReceipt>;
export type DoorEvidenceKind = DoorEvidenceReceipt["kind"];
export type DoorEvidenceErrorCode = "DOOR_EVIDENCE_INVALID" | "DOOR_EVIDENCE_CONFLICT" | "DOOR_EVIDENCE_CORRUPT" | "DOOR_EVIDENCE_UNAVAILABLE";
export class DoorEvidenceError extends Error { constructor(public readonly code: DoorEvidenceErrorCode) { super(code); this.name = "DoorEvidenceError"; } }
const unique = (values: string[]) => new Set(values).size === values.length;
const ordered = (values: string[]) => values.every((v, i) => i === 0 || values[i - 1] < v);
export function doorEvidenceHash(payload: DoorEvidencePayload): string { return doorV44Hash(payload); }
export function parseDoorEvidenceReceipt(raw: unknown): DoorEvidenceReceipt {
  try {
    if (!isPlainDoorJson(raw)) throw new Error();
    const r = doorEvidenceReceiptSchema.parse(raw); const { receipt_sha256, ...body } = r;
    if (doorEvidenceHash(body) !== receipt_sha256 || Date.parse(r.started_at) > Date.parse(r.finished_at) || Date.parse(r.finished_at) >= Date.parse(r.expires_at)
      || !ordered(r.dependencies.map(d => `${d.kind}/${d.id}`)) || !ordered(r.attachments.map(a => a.id))
      || !unique(r.findings.map(f => `${f.code}:${f.pointer}`))) throw new Error();
    if ((["content_approval", "publish_action", "review"].includes(r.kind)) && (r.producer.actor_kind !== "human" || !["human_action", "synthetic_test"].includes(r.producer.trust_scope))) throw new Error();
    if (r.kind === "check_matrix" && !unique(r.output.checks.map(c => c.check_id))) throw new Error();
    if ((r.kind === "technical_assessment" || r.kind === "release_evaluation") && (!ordered(r.output.evidence_hashes) || r.output.eligible !== (r.verdict === "PASS") || r.output.dependencies_sha256 !== r.output.fence.dependencies_sha256 || r.output.environment_sha256 !== r.output.fence.environment_sha256)) throw new Error();
    if (r.kind === "independent_critic" && (r.output.usage.total_tokens !== r.output.usage.prompt_tokens + r.output.usage.completion_tokens || (r.output.repair_iteration === 0) !== (r.output.prior_attempt_sha256 === null))) throw new Error();
    return r;
  } catch { throw new DoorEvidenceError("DOOR_EVIDENCE_INVALID"); }
}
/** Internal server authoring primitive; a valid hash is not proof of executor authority. */
export function issueDoorEvidenceReceipt(payload: DoorEvidencePayload): DoorEvidenceReceipt { return parseDoorEvidenceReceipt({ ...payload, receipt_sha256: doorEvidenceHash(payload) }); }

export const doorReleasePolicySchema = z.object({ version: id, required_checks: z.array(z.enum(DOOR_RELEASE_CHECK_IDS)).length(DOOR_RELEASE_CHECK_IDS.length),
  producers: z.array(z.object({ id, version: id, implementation_sha256: hash, actor_kind: z.enum(["system", "human"]), trust_scope: z.enum(["governed_execution", "reviewed_repository", "human_action"]), kinds: z.array(z.enum(DOOR_EVIDENCE_KINDS)).min(1), check_ids: z.array(z.enum(DOOR_RELEASE_CHECK_IDS)) }).strict()).min(1).max(100),
  dependencies: z.array(dependency).max(1000), environment,
  max_evidence_age_seconds: z.number().int().min(1).max(31536000), holds: z.object({ public_publish: z.boolean(), door_pages_live: z.boolean(), trial_noindex: z.literal(true) }).strict(),
}).strict().superRefine((p, c) => {
  if (!unique(p.required_checks) || !unique(p.producers.map(p => p.id)) || !ordered(p.dependencies.map(d => `${d.kind}/${d.id}`)) || DOOR_RELEASE_DEPENDENCY_KINDS.some(kind => !p.dependencies.some(d => d.kind === kind)) || p.producers.some(p => !unique(p.kinds) || !unique(p.check_ids))) c.addIssue({ code: "custom", message: "invalid policy inventory" });
});
export type DoorReleasePolicy = z.infer<typeof doorReleasePolicySchema>;
export interface DoorReleaseResult { eligible: boolean; reasons: Array<{ code: string; pointer: string }>; evidence_hashes: string[]; valid_until: string; policy_sha256: string; dependencies_sha256: string; environment_sha256: string; fence: DoorReleaseFence }
/** One evaluator, two lifecycle phases. Inputs must be loaded by the trusted server
 * from immutable storage and current policy, never from a browser-supplied PASS. */
export function evaluateDoorRelease(input: { phase: "technical" | "publish"; subject: DoorEvidenceSubject; receipts: readonly DoorEvidenceReceipt[]; active_receipt_hashes: readonly string[]; writer: { models: Array<{ provider: string; model_id: string }>; assignments_sha256: string } | null; policy: DoorReleasePolicy; fence: DoorReleaseFence; now: string }): DoorReleaseResult {
  const reasons: DoorReleaseResult["reasons"] = []; const fail = (code: string, p = "") => { if (!reasons.some(r => r.code === code && r.pointer === p)) reasons.push({ code, pointer: p }); };
  let validUntil = input.now; let policyHash = "0".repeat(64); let dependencyHash = "0".repeat(64); let environmentHash = "0".repeat(64); const used = new Set<string>();
  try {
    z.enum(["technical", "publish"]).parse(input.phase);
    z.array(hash).max(1000).parse(input.active_receipt_hashes);
    z.object({ models: z.array(z.object({ provider: id, model_id: id }).strict()).max(100), assignments_sha256: hash }).strict().nullable().parse(input.writer);
    const policy = doorReleasePolicySchema.parse(input.policy); const subject = doorEvidenceSubjectSchema.parse(input.subject); const fence = doorReleaseFenceSchema.parse(input.fence); at.parse(input.now);
    const now = Date.parse(input.now); validUntil = new Date(now + policy.max_evidence_age_seconds * 1000).toISOString();
    policyHash = doorV44Hash(policy); dependencyHash = doorV44Hash(policy.dependencies); environmentHash = doorV44Hash(policy.environment);
    if (dependencyHash !== fence.dependencies_sha256 || environmentHash !== fence.environment_sha256 || doorV44Hash(policy.holds) !== fence.holds_sha256) fail("RELEASE_FENCE_MISMATCH");
    const records = input.receipts.map(parseDoorEvidenceReceipt); if (!unique(records.map(r => r.receipt_sha256))) fail("EVIDENCE_DUPLICATE");
    const sameSubject = (r: DoorEvidenceReceipt) => stableDoorJson(r.subject) === stableDoorJson(subject);
    const authority = (r: DoorEvidenceReceipt) => policy.producers.find(p => p.id === r.producer.id && p.version === r.producer.version && p.implementation_sha256 === r.producer.implementation_sha256 && p.actor_kind === r.producer.actor_kind && p.trust_scope === r.producer.trust_scope && p.kinds.includes(r.kind));
    const revoked = new Set(records.filter(r => r.kind === "revocation" && sameSubject(r) && authority(r) && Date.parse(r.finished_at) <= now).map(r => r.kind === "revocation" ? r.output.target_receipt_sha256 : ""));
    if (!unique([...input.active_receipt_hashes]) || input.active_receipt_hashes.some(h => !records.some(r => r.receipt_sha256 === h))) fail("EVIDENCE_SELECTION_INVALID");
    const candidates = records.filter(r => input.active_receipt_hashes.includes(r.receipt_sha256) && !["revocation", "publish_action", "release_evaluation"].includes(r.kind));
    const usable = candidates.filter(r => {
      const path = `/receipts/${r.receipt_sha256}`;
      if (!sameSubject(r)) { fail("EVIDENCE_SUBJECT_MISMATCH", path); return false; }
      if (!authority(r)) { fail("EVIDENCE_UNTRUSTED", path); return false; }
      if (revoked.has(r.receipt_sha256)) { fail("EVIDENCE_REVOKED", path); return false; }
      if (Date.parse(r.finished_at) > now || Date.parse(r.expires_at) <= now || now - Date.parse(r.finished_at) > policy.max_evidence_age_seconds * 1000) { fail("EVIDENCE_EXPIRED", path); return false; }
      if (doorV44Hash(r.dependencies) !== dependencyHash || doorV44Hash(r.environment) !== environmentHash) { fail("EVIDENCE_DEPENDENCY_CHANGED", path); return false; }
      used.add(r.receipt_sha256); const expires = Math.min(Date.parse(r.expires_at), Date.parse(r.finished_at) + policy.max_evidence_age_seconds * 1000); if (expires < Date.parse(validUntil)) validUntil = new Date(expires).toISOString(); return true;
    });
    const reviews = usable.filter(r => r.kind === "review" && r.verdict === "PASS" && !r.findings.length);
    const accepted = (r: DoorEvidenceReceipt) => r.verdict === "PASS" && !r.findings.length || r.verdict === "WARN" && r.findings.length > 0 && r.findings.every(f => f.severity === "review") && reviews.some(review => review.kind === "review" && review.output.reviewed_evidence_sha256 === r.receipt_sha256 && stableDoorJson(review.output.accepted_findings) === stableDoorJson(r.findings));
    if (!usable.some(r => r.kind === "artifact_integrity" && accepted(r))) fail("ARTIFACT_EVIDENCE_MISSING");
    const critics = usable.filter(r => r.kind === "independent_critic");
    if (!critics.length) fail("CRITIC_EVIDENCE_MISSING");
    if (records.some(r => r.kind === "independent_critic" && sameSubject(r) && authority(r) && r.verdict === "FAIL" && Date.parse(r.finished_at) <= now && !revoked.has(r.receipt_sha256))) fail("CRITIC_UNRESOLVED_FAILURE");
    for (const r of critics) {
      if (r.kind !== "independent_critic") continue;
      if (!accepted(r)) fail("CRITIC_NOT_PASS");
      if (!input.writer?.models.length || r.output.writer_assignments_sha256 !== input.writer.assignments_sha256 || input.writer.models.some(w => w.model_id === r.output.model_id)) fail("CRITIC_NOT_INDEPENDENT");
      if (r.output.repair_iteration > 0) {
        const prior = records.find(p => p.receipt_sha256 === r.output.prior_attempt_sha256);
        if (!prior || prior.kind !== "independent_critic" || prior.subject.tenant_id !== subject.tenant_id || prior.subject.page_id !== subject.page_id || prior.subject.page_version >= subject.page_version || !authority(prior) || prior.output.repair_iteration + 1 !== r.output.repair_iteration || Date.parse(prior.finished_at) > Date.parse(r.started_at)) fail("CRITIC_REPAIR_CHAIN_INVALID");
      }
    }
    for (const check of policy.required_checks) {
      const matches = usable.filter(r => r.kind === "check_matrix" && authority(r)?.check_ids.includes(check) && r.output.checks.some(c => c.check_id === check));
      if (!matches.length) fail("CHECK_EVIDENCE_MISSING", `/checks/${check}`);
      else if (matches.some(r => r.kind === "check_matrix" && (!accepted(r) || r.output.checks.some(c => c.check_id === check && c.verdict !== "PASS" && !(check === "batch_quality" && c.verdict === "WARN" && accepted(r)))))) fail("CHECK_NOT_PASS", `/checks/${check}`);
    }
    if (input.phase === "publish") {
      if (policy.holds.public_publish || !policy.holds.door_pages_live) fail("PUBLISH_HOLD");
      const baseHashes = usable.filter(r => !["technical_assessment", "content_approval"].includes(r.kind)).map(r => r.receipt_sha256).sort();
      const assessments = usable.filter(r => r.kind === "technical_assessment" && accepted(r) && r.output.eligible && r.output.policy_sha256 === policyHash && stableDoorJson(r.output.fence) === stableDoorJson(fence) && stableDoorJson(r.output.evidence_hashes) === stableDoorJson(baseHashes));
      if (!assessments.length) fail("TECHNICAL_ASSESSMENT_MISSING");
      const approvals = records.filter(r => r.kind === "content_approval" && sameSubject(r) && authority(r) && Date.parse(r.finished_at) <= now && !revoked.has(r.receipt_sha256)).sort((a, b) => b.finished_at.localeCompare(a.finished_at) || b.receipt_sha256.localeCompare(a.receipt_sha256));
      const latest = approvals[0];
      const approved = latest?.kind === "content_approval" && usable.some(r => r.receipt_sha256 === latest.receipt_sha256) && accepted(latest) && latest.output.decision === "APPROVE" && assessments.some(a => a.receipt_sha256 === latest.output.assessment_sha256 && Date.parse(a.finished_at) <= Date.parse(latest.started_at));
      if (!approved) fail("CONTENT_APPROVAL_MISSING");
    }
  } catch { fail("RELEASE_INPUT_INVALID"); }
  reasons.sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : 0);
  return { eligible: reasons.length === 0, reasons, evidence_hashes: [...used].sort(), valid_until: validUntil, policy_sha256: policyHash, dependencies_sha256: dependencyHash, environment_sha256: environmentHash, fence: input.fence };
}
export interface DoorPageEvidenceStore { appendReceipt(receipt: DoorEvidenceReceipt): Promise<DoorEvidenceReceipt>; getReceipt(tenant: string, page: string, hash: string): Promise<DoorEvidenceReceipt | null>; listReceipts(tenant: string, page: string, version: number): Promise<DoorEvidenceReceipt[]> }
export function doorEvidenceReferences(r: DoorEvidenceReceipt): Array<{ hash: string; kinds: DoorEvidenceKind[] }> {
  switch (r.kind) {
    case "independent_critic": return r.output.prior_attempt_sha256 ? [{ hash: r.output.prior_attempt_sha256, kinds: ["independent_critic"] }] : [];
    case "technical_assessment": return r.output.evidence_hashes.map(hash => ({ hash, kinds: ["artifact_integrity", "independent_critic", "check_matrix", "review"] }));
    case "content_approval": return [{ hash: r.output.assessment_sha256, kinds: ["technical_assessment"] }];
    case "release_evaluation": return [...r.output.evidence_hashes.map(hash => ({ hash, kinds: ["artifact_integrity", "independent_critic", "check_matrix", "review", "technical_assessment", "content_approval"] as DoorEvidenceKind[] })), { hash: r.output.assessment_sha256, kinds: ["technical_assessment"] }, { hash: r.output.content_approval_sha256, kinds: ["content_approval"] }];
    case "publish_action": return [{ hash: r.output.release_evaluation_sha256, kinds: ["release_evaluation"] }, { hash: r.output.content_approval_sha256, kinds: ["content_approval"] }];
    case "review": return [{ hash: r.output.reviewed_evidence_sha256, kinds: ["check_matrix", "independent_critic"] }];
    case "revocation": return [{ hash: r.output.target_receipt_sha256, kinds: DOOR_EVIDENCE_KINDS.filter(k => k !== "revocation") }];
    default: return [];
  }
}
