import { z } from "zod";
import type { DoorV44CompileResult } from "./compiler-types";
import type { DoorPageVersion } from "./page-version";
import type { DoorPageVersionInputRecord } from "./page-version-input";
import { verifyDoorPageVersionInputReceipt } from "./page-version-input";
import { verifyDoorV44SemanticContract } from "./semantic-contract";
import { doorV44Hash, isPlainDoorJson, stableDoorJson } from "./schema-engine";

export const DOOR_CRITIC_INPUT_VERSION = "door-v44-critic-input/1.0.0";
export const DOOR_CRITIC_MAX_INPUT_BYTES = 256 * 1024;
export const DOOR_CRITIC_CHECKS = ["voice_claim_policy", "content_usefulness", "intent_answered", "claim_grounding", "safety_boundary", "capability_truthfulness"] as const;
export const DoorCriticReply = z.object({
  artifact_hash: z.string().regex(/^[a-f0-9]{64}$/),
  input_projection_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  verdict: z.enum(["PASS", "FAIL"]), reason: z.string().min(1).max(600),
  findings: z.array(z.object({ check: z.enum(DOOR_CRITIC_CHECKS), severity: z.enum(["blocker", "major", "minor"]),
    pointer: z.string().min(1).max(500), message: z.string().min(1).max(400), repair_instructions: z.string().max(400).nullable() }).strict()).max(40),
}).strict();
export type DoorCriticReply = z.infer<typeof DoorCriticReply>;
export const DOOR_CRITIC_REPLY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["artifact_hash", "input_projection_sha256", "verdict", "reason", "findings"],
  properties: {
    artifact_hash: { type: "string", pattern: "^[a-f0-9]{64}$" }, input_projection_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    verdict: { type: "string", enum: ["PASS", "FAIL"] }, reason: { type: "string", minLength: 1, maxLength: 600 },
    findings: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false,
      required: ["check", "severity", "pointer", "message", "repair_instructions"], properties: {
        check: { type: "string", enum: [...DOOR_CRITIC_CHECKS] }, severity: { type: "string", enum: ["blocker", "major", "minor"] },
        pointer: { type: "string", minLength: 1, maxLength: 500 }, message: { type: "string", minLength: 1, maxLength: 400 },
        repair_instructions: { type: ["string", "null"], maxLength: 400 },
      } } },
  },
};

/** Project verified page content and governed sources/claims. This reads no raw
 * runtime requests or asset buffers; governed source text still needs its review. */
export function createDoorV44CriticInput(
  compiled: Extract<DoorV44CompileResult, { ok: true }>, saved: DoorPageVersionInputRecord, version: DoorPageVersion,
) {
  if (!verifyDoorV44SemanticContract(compiled).ok || !verifyDoorPageVersionInputReceipt(saved, compiled.receipt).ok
    || doorV44Hash(compiled.receipt) !== version.metadata.receipt_sha256 || stableDoorJson(compiled.receipt) !== stableDoorJson(version.metadata.receipt)
    || version.reservation_id !== saved.reservation_id || version.tenant_id !== saved.tenant_id || version.page_id !== saved.page_id || version.page_version !== saved.page_version) {
    throw new Error("DOOR_CRITIC_BINDING_INVALID");
  }
  const data = {
    format: DOOR_CRITIC_INPUT_VERSION,
    subject: { tenant_id: saved.tenant_id, page_id: saved.page_id, page_version: saved.page_version, reservation_id: saved.reservation_id,
      input_sha256: saved.input_sha256, artifact_hash: compiled.receipt.artifact_hash, compile_receipt_sha256: version.metadata.receipt_sha256 },
    spec: saved.spec, document: compiled.document,
    source_records: saved.context.source_records.filter(row => compiled.receipt.source_ids.includes(row.source_id)),
    fact_records: saved.context.fact_records.filter(row => compiled.receipt.claim_ids.includes(row.claim_id)),
    deterministic_evidence: { semantic_contract: "PASS", input_association: "PASS", wording_findings: compiled.receipt.wording_findings,
      pending_checks: compiled.receipt.pending_checks, mode: compiled.receipt.mode },
  };
  const serialized = stableDoorJson(data);
  if (Buffer.byteLength(serialized, "utf8") > DOOR_CRITIC_MAX_INPUT_BYTES) throw new Error("DOOR_CRITIC_INPUT_TOO_LARGE");
  const copied = JSON.parse(serialized) as typeof data;
  const pointers: string[] = [];
  const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
  function walk(value: unknown, pointer: string) {
    pointers.push(pointer);
    if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) walk(child, pointer + "/" + escape(key));
  }
  for (const key of ["spec", "document", "source_records", "fact_records"] as const) walk(copied[key], "/" + key);
  return { data: copied, serialized, input_projection_sha256: doorV44Hash(copied), allowed_pointers: new Set(pointers) };
}

export function validateDoorV44CriticReply(raw: unknown, input: ReturnType<typeof createDoorV44CriticInput>): DoorCriticReply {
  if (!isPlainDoorJson(raw)) throw new Error("DOOR_CRITIC_REPLY_BINDING_INVALID");
  const reply = DoorCriticReply.parse(raw);
  if (reply.artifact_hash !== input.data.subject.artifact_hash || reply.input_projection_sha256 !== input.input_projection_sha256
    || reply.findings.some(finding => !input.allowed_pointers.has(finding.pointer))) throw new Error("DOOR_CRITIC_REPLY_BINDING_INVALID");
  return { ...reply, verdict: reply.findings.some(finding => finding.severity !== "minor") ? "FAIL" : reply.verdict };
}
