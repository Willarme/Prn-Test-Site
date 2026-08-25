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
 * How a capability is currently implemented (A00 spec §4): the point of the
 * registry is that an agent's IDENTITY never changes when its IMPLEMENTATION
 * does — today's deterministic stand-ins swap for models later without
 * touching any call site.
 */
export const CapabilityImplementationKind = z.enum([
  "deterministic",
  "model",
  "external_adapter",
]);
export type CapabilityImplementationKind = z.infer<typeof CapabilityImplementationKind>;

/**
 * Typed business operation registry entry (#22A via kit 16/25). UI, API, MCP
 * and agents all call the same capability; adapters never own business logic.
 * FUTURE_DISABLED entries may be registered but must never be executable.
 *
 * A00 (Wave 0) extends this EXISTING contract in place rather than creating a
 * parallel registry — the spec's proposed CapabilityDefinition fields land
 * here as optional implementation-binding metadata:
 *  - `current_implementation` / `implementation_ref`: which concrete code
 *    currently answers this capability (e.g. the fixture engine functions or
 *    the DataForSeoAdapter);
 *  - `owning_agent_ids`: which agents may call it (mirrors the Agent
 *    Registry's `allowed_capabilities`);
 *  - `aliases`: A00-spec capability names that map onto an existing key
 *    (e.g. spec "classify_problem" → existing "classify_home_problem"), so
 *    the platform gateway can resolve spec names without renaming anything
 *    an existing reader depends on.
 */
/**
 * AN IMPLEMENTATION THAT EXISTS BESIDE THE CURRENT ONE, not instead of it
 * (AI model wiring, 2026-08-25).
 *
 * `current_implementation` answers "what runs today". When a model is wired
 * behind a capability that already has a deterministic implementation, the
 * deterministic one does NOT stop being the answer: it stays the default, it
 * stays the fallback for every refusal path, and it stays what runs while the
 * capability's flag is off — which is its shipped state. Overwriting
 * `current_implementation` would have said the opposite, and said it in the one
 * place a reader goes to find out what is actually running.
 *
 * So a model registers as an ALTERNATE, carrying the two facts that decide
 * whether it may run at all:
 *
 *   enabled_policy_key   the capability key in the runtime AiPolicy document
 *                        whose `enabled` flag turns this implementation on. It
 *                        ships false; a deploy is not required to change it.
 *   handles_customer_data whether this implementation would send a homeowner's
 *                        own words to a third party. It is what the privacy rule
 *                        reads — a TRUE here means the call is refused unless the
 *                        model's config says `allows_customer_data: true`.
 */
export const AlternateImplementation = z.object({
  kind: CapabilityImplementationKind,
  ref: z.string().min(1),
  enabled_policy_key: z.string().min(1),
  handles_customer_data: z.boolean(),
  /** What answers this capability when the alternate is off, refused or failing. */
  falls_back_to: z.string().min(1),
});
export type AlternateImplementation = z.infer<typeof AlternateImplementation>;

export const CapabilityDefinition = z.object({
  capability_key: z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/),
  version: z.string().min(1),
  risk_class: RiskClass,
  status: CapabilityStatus,
  input_schema_ref: z.string().min(1),
  output_schema_ref: z.string().min(1),
  required_scopes: z.array(z.string().min(1)),
  current_implementation: CapabilityImplementationKind.optional(),
  implementation_ref: z.string().min(1).optional(),
  owning_agent_ids: z.array(z.string().regex(/^A\d{2}$/)).optional(),
  aliases: z.array(z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/)).optional(),
  alternate_implementations: z.array(AlternateImplementation).optional(),
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
