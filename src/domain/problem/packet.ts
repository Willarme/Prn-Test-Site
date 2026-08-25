import type {
  EvidenceObject,
  FactClaim,
  JobPacket,
  ProblemRecord,
} from "@/domain/problem/contracts";
import { DEFAULT_TENANT_ID, JobPacket as JobPacketSchema } from "@/domain/problem/contracts";
import { ACTIVE_PACKET_COPY, type PacketCopyPackage } from "@/domain/problem/packet-copy";
import type { GenerateJobPacketArgs } from "@/domain/problem/packet-assembly";
import { SAFETY_RULES } from "@/domain/problem/safety";
import type { DiagnosisAnswer, IntakeAnswer, IntakePlaybook } from "@/domain/intake/playbook";
import { emitPlatformEvent } from "@/platform/events/emit";
import { capability_call } from "@/platform/gateway";
import type { AgentRunTrigger } from "@/platform/runs/ledger";

/**
 * A02 — THE PRODUCTION PACKET SURFACE.
 *
 * ─── WHY A NEW FILE, AND WHY IT DOES NOT TOUCH THE TWO IT WRAPS ────────────
 *
 * `fixture-engine.ts` carries a promise to the rest of the repo — swap the
 * fixture builder for the production one "without touching pages, intake, or
 * results" — and BOTH halves of it are bound by PATH STRING in the capability
 * registry (HO-3/HO-4, pre-answer 8). `packet-assembly.ts` is the richest
 * shipped implementation and the live path. Neither is edited to make A02 an
 * agent. This file is what was missing between them.
 *
 * ─── WHAT WAS MISSING ──────────────────────────────────────────────────────
 *
 * Before this, a packet was built by calling a function. Three consequences,
 * all of them governance holes rather than bugs:
 *
 *   1. NO GOVERNED DOOR. A kill switch on A02 stopped nothing, because nothing
 *      asked. Every build now goes through `capability_call()`, which gives the
 *      registry lookup, the kill-switch gate, the allowed-capability check, an
 *      Agent Run Ledger row and a `capability.invoked` envelope — the four
 *      primitives A00 shipped, instead of A02 re-implementing them.
 *   2. NO REGENERATION EVENT. `regeneratePacket()` silently produced new
 *      versions. Regeneration is a customer telling us the first packet was not
 *      good enough — the trial's highest-signal negative feedback — and it had
 *      no instrument at all.
 *   3. NO RECORD OF WHAT THE PACKET RESTED ON. The canon basis fields existed
 *      nowhere; a packet could not say which evidence or which claims produced
 *      it.
 *
 * ─── THE THREE LIVE CALL SITES (HO-4) ──────────────────────────────────────
 *
 * The A02 spec names none of them. They are api/intake/route.ts (first
 * generation), platform/intake/complete.ts (regeneration after the customer
 * adds detail), and platform/gateway/index.ts (the executor). All three are
 * reconciled onto this one function — see tests/a02.three-call-sites.test.ts.
 *
 * ─── NO MODEL, AND THAT IS THE DESIGNED STATE ──────────────────────────────
 *
 * Pre-answer 1 rules "do NOT wire one" for A02. So the packet is 100%
 * deterministic, cost is $0 by definition rather than by omission, `model_id`
 * is null because there is no model to name, and nothing here reads a vendor
 * key. Wiring one later changes the gateway's executor table and the registry's
 * implementation_ref — not this file and not a call site.
 *
 * ─── PERSISTENCE AND RLS (condition 5) ─────────────────────────────────────
 *
 * "Server-role-only writes" is struck doctrine and no line here reinstates it.
 * This module performs NO direct database access: it returns a packet and the
 * caller stores it through RuntimeStore, which is the seam where
 * db/client.ts's PlatformClientProvider gets threaded when a
 * homeowner-authenticated client exists. Nothing here imports the service
 * client, and a test asserts it.
 */

/** Which surface records the first-generation lifecycle envelopes. */
export type PacketLifecycleEmitter =
  /**
   * A02 emits them, agent-attributed. The default, and what any caller without
   * its own event batch should use.
   */
  | "a02"
  /**
   * The CALLER records them inside its own atomic journey write. The intake
   * route does exactly this: its envelopes carry `guest_session_id` and
   * `landing_path` — real attribution this function cannot see — and they land
   * in the same transaction as the journey itself. A02 then emits nothing for
   * that generation, because one generation must produce one event.
   */
  | "caller";

export interface BuildPacketInput {
  problem: ProblemRecord;
  /** The customer_text evidence. Its content is the verbatim description. */
  textEvidence: EvidenceObject;
  /** Everything attached, for media_count and evidence_basis. */
  allEvidence?: EvidenceObject[];
  /**
   * THE UNDOCUMENTED CONSUMPTION SEAM (Trial Spec Audit seam table). The A02
   * spec never names these three as inputs, and they are what the live packet
   * path has consumed since commit 937e44a. Supplying any of them selects the
   * full assembly; omitting all of them produces the base narrative.
   */
  playbook?: IntakePlaybook | null;
  answers?: IntakeAnswer[];
  diagnosis?: DiagnosisAnswer[];
  /** 1 for a first generation; N+1 for a regeneration. */
  version?: number;
  now: string;
  /** Journey id, for the ledger's input_ids and the event context. */
  request_id?: string | null;
  /** The version this one replaces. Present ⇒ this is a regeneration. */
  previous?: JobPacket | null;
  /** A01's FactClaims, when it produced any. Absent ⇒ not recorded, NOT "none". */
  claims?: readonly FactClaim[];
  tenant_id?: string;
  copy?: PacketCopyPackage;
  /** Deterministic id source, so a test can pin packet ids. */
  new_id?: () => string;
  trigger?: AgentRunTrigger;
  lifecycle_events?: PacketLifecycleEmitter;
}

export interface BuildPacketOutcome {
  ok: boolean;
  /** Null only when governance refused the run (kill switch, permission). */
  packet: JobPacket | null;
  /** Agent Run Ledger id — also written onto the packet as generation_run_id. */
  run_id: string | null;
  regenerated: boolean;
  /** Names of the envelopes THIS call emitted. Empty when the caller owns them. */
  events_emitted: string[];
  /** Why a refusal happened, when ok is false. */
  refusal: string | null;
}

/** The registered capability_key. `build_job_packet` is its A00-spec alias. */
export const A02_CAPABILITY_KEY = "generate_job_packet";
export const A02_AGENT_ID = "A02";

/**
 * Build one packet version through the governed door.
 *
 * NEVER THROWS. A governance refusal is a typed outcome with a null packet, and
 * telemetry failures are swallowed by emitPlatformEvent's own contract — a
 * homeowner never loses their packet to an event that could not be written.
 */
export async function buildPacket(input: BuildPacketInput): Promise<BuildPacketOutcome> {
  const copy = input.copy ?? ACTIVE_PACKET_COPY;
  const allEvidence = input.allEvidence ?? [input.textEvidence];
  const version = input.version ?? (input.previous ? input.previous.packet_version + 1 : 1);
  const regenerated = version > 1 || input.previous != null;
  const tenantId = input.tenant_id ?? input.problem.tenant_id ?? DEFAULT_TENANT_ID;

  /**
   * FULL ASSEMBLY WHEN THERE IS ANYTHING TO ASSEMBLE. The seam is honoured, not
   * bypassed: answers, media and the diagnosis trail go in exactly as
   * packet-assembly.ts has always consumed them.
   */
  const wantsAssembly =
    input.playbook !== undefined ||
    (input.answers?.length ?? 0) > 0 ||
    (input.diagnosis?.length ?? 0) > 0 ||
    allEvidence.length > 1 ||
    version > 1;

  const args: GenerateJobPacketArgs = wantsAssembly
    ? {
        assemble: true,
        problem: input.problem,
        textEvidence: input.textEvidence,
        allEvidence,
        playbook: input.playbook ?? null,
        answers: input.answers ?? [],
        diagnosis: input.diagnosis ?? [],
        version,
        now: input.now,
        copy,
      }
    : { problem: input.problem, evidence: input.textEvidence, now: input.now, copy };

  const call = await capability_call<JobPacket>({
    agent_id: A02_AGENT_ID,
    capability: A02_CAPABILITY_KEY,
    args,
    trigger: input.trigger ?? "request",
    // IDS ONLY — never the description, never an answer's text.
    input_ids: [
      ...(input.request_id ? [input.request_id] : []),
      input.problem.problem_id,
      ...allEvidence.map((e) => e.evidence_id),
    ],
  });

  if (!call.ok) {
    return {
      ok: false,
      packet: null,
      run_id: call.run_id,
      regenerated,
      events_emitted: [],
      refusal: call.reason,
    };
  }

  const safetyRule =
    SAFETY_RULES.find((r) => r.safety_rule_id === input.problem.safety_rule_id) ?? null;

  const packet = JobPacketSchema.parse({
    ...call.output,
    ...(input.new_id ? { job_packet_id: input.new_id() } : {}),
    tenant_id: tenantId,
    /**
     * THE CANON BASIS FIELDS, populated from what actually exists.
     *
     * `evidence_basis` is every evidence id this build read — real today.
     * `claim_basis` is A01's FactClaims and is OMITTED when A01 handed none
     * over, because absent means "not recorded" and an empty array would claim
     * "this packet rests on no facts". A01's production surface is not wired
     * into the live intake path this wave, so in production this is absent and
     * that is the honest value.
     */
    evidence_basis: allEvidence.map((e) => e.evidence_id),
    ...(input.claims ? { claim_basis: input.claims.map((c) => c.claim_id) } : {}),
    generation_run_id: call.run_id,
    status: "current" as const,
    /**
     * FORWARD POINTER LEFT NULL, DELIBERATELY. Setting `superseded_by` on the
     * PREVIOUS packet needs an UPDATE path RuntimeStore does not have — it has
     * savePacket (append) and a newest-version-wins read. The backward chain is
     * already complete and lossless: version N implies N-1. Inventing an update
     * method to write a pointer nothing reads would be the expensive half of a
     * feature with none of the value.
     * TODO-ASK-OWNER (Joshua): whether the forward chain is worth a store
     * method before a second consumer of the version history exists.
     */
    superseded_by: null,
    /** The record beside the display — see the contract note on these two. */
    uncertainty_notes: [...call.output.what_remains_unknown],
    safety_notes: safetyRule ? [safetyRule.approved_response] : [],
    template_version: copy.template_version,
    /** Null because there is no model in this path, not because it was unset. */
    model_id: null,
    privacy_marking: "USER_PRIVATE" as const,
  });

  const emitted: string[] = [];
  const context = {
    problem_id: packet.problem_id,
    job_packet_id: packet.job_packet_id,
    packet_version: String(packet.packet_version),
    ...(input.request_id ? { request_id: input.request_id } : {}),
  };

  if (regenerated) {
    /**
     * ALWAYS EMITTED BY A02, even when the caller owns the first-generation
     * envelopes — because no caller has ever emitted this one. Regeneration ran
     * silently until this commit.
     */
    await emitPlatformEvent({
      event_name: "packet.regenerated",
      agent_id: A02_AGENT_ID,
      agent_run_id: call.run_id,
      context,
      versions: { schema: packet.schema_version, template: copy.template_version },
      tenant_id: tenantId,
      cost_usd: 0,
    });
    emitted.push("packet.regenerated");
  } else if ((input.lifecycle_events ?? "a02") === "a02") {
    /**
     * WHY BOTH, AND WHY HERE. `problem.intake_completed` and `packet.generated`
     * are different facts (see names.ts) that happen at the same instant ONLY
     * because the trial builds the packet synchronously at the end of intake.
     * The definition does not depend on that: if generation ever moves off the
     * completion moment, this emitter moves and the meaning does not change.
     */
    await emitPlatformEvent({
      event_name: "problem.intake_completed",
      agent_id: A02_AGENT_ID,
      agent_run_id: call.run_id,
      context: {
        problem_id: packet.problem_id,
        ...(input.request_id ? { request_id: input.request_id } : {}),
      },
      tenant_id: tenantId,
    });
    await emitPlatformEvent({
      event_name: "packet.generated",
      agent_id: A02_AGENT_ID,
      agent_run_id: call.run_id,
      context,
      versions: { schema: packet.schema_version, template: copy.template_version },
      tenant_id: tenantId,
      cost_usd: 0,
    });
    emitted.push("problem.intake_completed", "packet.generated");
  }

  return { ok: true, packet, run_id: call.run_id, regenerated, events_emitted: emitted, refusal: null };
}
