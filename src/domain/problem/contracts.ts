import { z } from "zod";
import { Id, IsoDateTime, SchemaVersion } from "@/domain/shared/primitives";

/**
 * ProblemRecord — canonical structured state of one home problem (#14A §10.2).
 * Field names align with the Build Kit's problem_record.schema.json (parity
 * tested). Raw customer evidence lives in EvidenceObject, SEPARATE from
 * structured facts and inference — never merged (#14A §1.2).
 */
export const ProblemStatus = z.enum(["draft", "clarifying", "packet_ready", "closed"]);
export const SourceChannel = z.enum(["web", "api", "mcp", "admin", "import"]);
export const SafetyState = z.enum(["normal", "review", "urgent"]);

export const ProblemRecord = z.object({
  problem_id: Id,
  schema_version: SchemaVersion,
  status: ProblemStatus,
  source_channel: SourceChannel,
  intake_session_id: Id.nullable(),
  problem_summary: z.string().nullable(),
  /** Inference, labeled as such — never presented as customer-stated fact. */
  service_category: z.string().nullable(),
  service_category_confidence: z.enum(["high", "medium", "low"]).nullable(),
  safety_state: SafetyState,
  safety_rule_id: Id.nullable(),
  evidence_ids: z.array(Id),
  claim_ids: z.array(Id),
  clarifiers_asked: z.array(z.object({ question: z.string(), answer: z.string().nullable() })),
  created_at: IsoDateTime,
  updated_at: IsoDateTime.nullable(),
});
export type ProblemRecord = z.infer<typeof ProblemRecord>;

/** Raw supplied evidence — private by default, preserved verbatim. */
export const EvidenceObject = z.object({
  evidence_id: Id,
  kind: z.enum(["customer_text", "photo", "video", "voice_transcript"]),
  /** Text content, or the PRIVATE storage reference for media. Never a public URL. */
  content: z.string(),
  privacy: z.literal("private"),
  captured_at: IsoDateTime,
  mime: z.string().nullable().optional(),
  bytes: z.number().int().min(0).nullable().optional(),
  /** Which required field this media satisfies, when applicable. */
  field_key: z.string().nullable().optional(),
});
export type EvidenceObject = z.infer<typeof EvidenceObject>;

/**
 * Job-Ready Packet (#14A §5.1). Every section that is inference carries an
 * inference label; the packet never invents facts, never guarantees savings,
 * and never claims a diagnosis.
 */
export const JobPacket = z.object({
  job_packet_id: Id,
  packet_version: z.number().int().positive(),
  schema_version: SchemaVersion,
  problem_id: Id,
  summary_plain: z.string().min(1),
  observed_statements: z.array(z.string()),
  symptoms_and_timing: z.string().nullable(),
  likely_service_category: z.object({
    value: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    note: z.literal("This is an inference from the description, not a diagnosis."),
  }),
  what_remains_unknown: z.array(z.string()),
  safe_prep_notes: z.array(z.string()),
  questions_for_provider: z.array(z.string()),
  call_script: z.string().min(1),
  /** Equipment/context details the customer supplied (label → value). */
  collected_details: z.array(z.object({ label: z.string(), value: z.string(), source: z.string() })).default([]),
  /** Number of photos/videos attached (the media itself stays private). */
  media_count: z.number().int().min(0).default(0),
  /** Guided-diagnosis findings, when the customer walked through it. */
  diagnosis: z
    .object({
      outcome_title: z.string(),
      likely_cause: z.string(),
      steps_answered: z.array(z.object({ step: z.string(), answer: z.string() })),
      provider_note: z.string(),
    })
    .nullable()
    .default(null),
  generated_at: IsoDateTime,
  engine: z.enum(["fixture", "production"]),
});
export type JobPacket = z.infer<typeof JobPacket>;
