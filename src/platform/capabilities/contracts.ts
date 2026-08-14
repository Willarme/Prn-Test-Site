import { z } from "zod";

/**
 * Risk classes R0–R6 per kit capability_definition.schema.json. The kit leaves
 * the scale implicit; this proposed mapping is recorded in OPEN_DECISIONS.md
 * for owner confirmation (non-blocking):
 *  R0 read public data · R1 read own private data · R2 write own records ·
 *  R3 outbound message / external side effect · R4 publish public content ·
 *  R5 money / transactions · R6 irreversible or legal-impact change.
 */
export const RiskClass = z.enum(["R0", "R1", "R2", "R3", "R4", "R5", "R6"]);
export type RiskClass = z.infer<typeof RiskClass>;

export const CapabilityStatus = z.enum(["LIVE", "TEST", "FUTURE_DISABLED", "RETIRED"]);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

/**
 * Typed business operation registry entry (#22A via kit 16/25). UI, API, MCP
 * and agents all call the same capability; adapters never own business logic.
 * FUTURE_DISABLED entries may be registered but must never be executable.
 */
export const CapabilityDefinition = z.object({
  capability_key: z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/),
  version: z.string().min(1),
  risk_class: RiskClass,
  status: CapabilityStatus,
  input_schema_ref: z.string().min(1),
  output_schema_ref: z.string().min(1),
  required_scopes: z.array(z.string().min(1)),
});
export type CapabilityDefinition = z.infer<typeof CapabilityDefinition>;

/** Safe trial scopes from kit 16_AI_NATIVE_22A_COMPATIBILITY.md, plus admin/agent scopes (slice additions). */
export const TRIAL_SCOPES = [
  "public.guidance.read",
  "property.own.read",
  "property.own.write",
  "problem.own.read",
  "problem.own.write",
  "trust.own.read",
  "trust.request.send",
  "trust.home_person.write",
  "provider.recommendation.read",
  // Slice additions — internal only, never exposed to external agents:
  "admin.full",
  "agent.internal",
] as const;
