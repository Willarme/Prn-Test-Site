import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntakeSession } from "@/domain/intake/contracts";
import type { DiagnosisAnswer, IntakeAnswer } from "@/domain/intake/playbook";
import type { ConsentEvent, DisclosureVersion } from "@/domain/privacy/contracts";
import type {
  DerivationRecord,
  EvidenceObject,
  FactClaim,
  JobPacket,
  ProblemRecord,
} from "@/domain/problem/contracts";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import type { PageSpec } from "@/domain/search/pages";
import type { EventEnvelope } from "@/platform/events/envelope";
import { applyQualityGuard } from "@/platform/quality/ingest";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";
import type {
  AskAnswer,
  Email,
  Feedback,
  JobAddress,
  JobAddressRow,
  KeepClaim,
  LinkRevocation,
  MagicLink,
  Signup,
} from "@/platform/stores/interfaces";
import { requestScopedClient, requireServiceClient, serviceConfigured } from "@/platform/db/client";
import { projectJourneySafety } from "@/domain/problem/journey-safety";

export type {
  AskAnswer,
  Email,
  Feedback,
  JobAddress,
  JobAddressRow,
  KeepClaim,
  LinkRevocation,
  MagicLink,
  Signup,
} from "@/platform/stores/interfaces";

/**
 * Runtime store — the one place customer journeys, events, publish state and
 * the owner audit trail are read/written. Two interchangeable backends:
 *
 *  - SupabaseRuntimeStore: used whenever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *    are configured. Server-side only, over HTTP (serverless-safe).
 *    Customer-facing reads AND writes — recordJourney, attachEvidence,
 *    saveIntakeAnswers, saveDiagnosisAnswer, savePacket, getJourney,
 *    listEvidence, listIntakeAnswers, listDiagnosisAnswers, all keyed by
 *    request_id — go through the request-scoped client by DEFAULT (T1-33 /
 *    A00 condition d). Postgres RLS, not application code, is what stops
 *    one request from reading OR forging a row under another's request_id.
 *    Everything else (admin reads/writes, telemetry, publish state, shared
 *    disclosure content) stays on the service role; see
 *    docs/security/SERVICE-KEY-AUDIT.md for the one-line justification
 *    behind every remaining service-key call site.
 *  - FileRuntimeStore: local JSON fallback for development without a database.
 *
 * Callers never know which backend they got (#22A: one capability, many adapters).
 */
export type SessionRow = IntakeSession & { request_id: string };

export interface Journey {
  session: SessionRow;
  problem: ProblemRecord;
  packet: JobPacket;
}

export interface AuditEntry {
  at: string;
  action: string;
  target: string;
  detail: string | null;
  /**
   * HOW LONG THE OWNER SPENT ON IT — added by A02's build, 2026-08-25, for A10
   * (Trial Spec Audit §4 item 5).
   *
   * A10's Owner Hours is "the number the whole one-person-company constraint
   * answers to", and the audit's verdict on it is blunt: it is PERMANENTLY
   * uncomputable, because `appendAudit` carried `{at, action, target, detail}`
   * and no duration anywhere in the repo. Audit rows are append-only history —
   * a duration not recorded when the owner did the work cannot be recovered
   * later — so the field has to exist BEFORE the trial runs, not when A10 is
   * built.
   *
   * OPTIONAL, so every existing caller keeps working unchanged and a caller
   * with nothing honest to record writes nothing rather than a zero. Absent
   * means "not measured"; 0 would mean "took no time", which is never true.
   */
  duration_ms?: number | null;
}

/** One-shot warning flag for the admin_audit.duration_ms compatibility shim. */
let auditDurationMissLogged = false;

export interface RecordJourneyInput {
  session: SessionRow;
  consent: ConsentEvent;
  problem: ProblemRecord;
  evidence: EvidenceObject;
  packet: JobPacket;
  events: EventEnvelope[];
  /**
   * A01'S DURABLE FACTS — written inside the SAME journey write as the record
   * they are about (finding 1, 2026-08-25).
   *
   * They arrive here rather than through a method of their own because a claim
   * that outlives its ProblemRecord, or a record whose `claim_ids` point at rows
   * that were never written, is a broken provenance chain — and the chain is the
   * entire reason these objects exist. One write, or neither.
   *
   * OPTIONAL, because a caller with nothing to record must write nothing:
   * absent means "this path established no facts", which is a different
   * statement from "this path established none" only in that the second would
   * be a claim. Every existing caller keeps working unchanged.
   */
  claims?: readonly FactClaim[];
  derivation?: DerivationRecord | null;
}

export interface RuntimeStore {
  readonly kind: "supabase" | "file";
  recordJourney(input: RecordJourneyInput): Promise<void>;
  /** Persist the exact disclosure text once, so consent can always be reproduced. */
  ensureDisclosure(disclosure: DisclosureVersion): Promise<void>;
  recordEvents(events: EventEnvelope[]): Promise<void>;
  getJourney(requestId: string): Promise<Journey | null>;
  listJourneys(limit?: number): Promise<Journey[]>;
  countEvents(eventName: string): Promise<number>;
  totals(): Promise<{ journeys: number; packets: number; consents: number }>;
  getPublishedPageIds(): Promise<Set<string>>;
  setPublished(spec: PageSpec, published: boolean): Promise<void>;
  listStagedSpecs(): Promise<PageSpec[]>;
  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(limit?: number): Promise<AuditEntry[]>;

  // --- post-description intake (details + guided diagnosis) ---
  /**
   * Attach new evidence (photo/video) to the journey ProblemRecord. requestId
   * scopes the write to the request-scoped seam (migration 00006).
   */
  attachEvidence(problemId: string, requestId: string, evidence: EvidenceObject): Promise<void>;
  saveIntakeAnswers(answers: IntakeAnswer[]): Promise<void>;
  listIntakeAnswers(requestId: string): Promise<IntakeAnswer[]>;
  saveDiagnosisAnswer(answer: DiagnosisAnswer): Promise<void>;
  listDiagnosisAnswers(requestId: string): Promise<DiagnosisAnswer[]>;
  /** requestId (when known) routes the read through the request-scoped client. */
  listEvidence(problemId: string, requestId?: string): Promise<EvidenceObject[]>;
  /** Store a regenerated packet version (newest version wins on read). */
  savePacket(packet: JobPacket, requestId: string): Promise<void>;

  // --- A01 provenance (finding 1) ------------------------------------------
  /** A01's FactClaims for one problem, in the order they were established. */
  listClaims(problemId: string): Promise<FactClaim[]>;
  /** The DerivationRecords naming what produced those claims. */
  listDerivations(problemId: string): Promise<DerivationRecord[]>;

  // --- A02 version chain (finding 3) ---------------------------------------
  /**
   * Mark one packet version superseded and point it at the version that
   * replaced it. The forward half of the chain; the backward half (version N
   * implies N-1) was always there.
   */
  supersedePacket(previousPacketId: string, supersededBy: string): Promise<void>;

  // --- loop surfaces (campaign track F2b, 2026-09-05) ----------------------
  // The rows behind the scoped links (src/platform/links/tokens.ts), the Home
  // Memory claim, the Trust Network ask, the feedback popup, the mail outbox,
  // the job address and the product-page vote. File store: dev-db collections
  // of the same names. Supabase: migration 00020_loop_surfaces.sql, tables of
  // the same names. Every method is implemented on BOTH backends; nothing
  // no-ops.

  /** Revocation ledger: the link stops opening, the record stays (decision 8, A). */
  revokeLink(link_id: string, request_id: string, at: string): Promise<void>;
  isLinkRevoked(link_id: string): Promise<boolean>;
  /** "Keep this": one contact field attached to a record that already exists (§16.1). */
  saveKeepClaim(claim: KeepClaim): Promise<void>;
  getKeepClaim(request_id: string): Promise<KeepClaim | null>;
  saveMagicLink(link: MagicLink): Promise<void>;
  /**
   * Single use: returns the link and stamps consumed_at the FIRST time; null
   * on every later call and for an unknown id (the caller cannot tell the two
   * apart, by design).
   */
  consumeMagicLink(magic_id: string, at: string, request_id?: string): Promise<MagicLink | null>;
  saveAskAnswer(answer: AskAnswer): Promise<void>;
  listAskAnswers(request_id: string): Promise<AskAnswer[]>;
  saveFeedback(feedback: Feedback): Promise<void>;
  enqueueEmail(email: Email): Promise<void>;
  getEmail(email_id: string): Promise<Email | null>;
  markEmailSent(email_id: string, at: string, provider_id: string | null): Promise<void>;
  /** Append-only: a corrected address is a new row; getJobAddress returns the newest. */
  saveJobAddress(request_id: string, address: JobAddress): Promise<void>;
  getJobAddress(request_id: string): Promise<JobAddress | null>;
  /** A vote with the same vote_id CORRECTS the earlier one (never duplicates). */
  saveSignup(signup: Signup): Promise<void>;
}

/**
 * THE TENANT, APPLIED AT THE WRITE BOUNDARY (finding 2, 2026-08-25).
 *
 * `tenant_id` has been optional on ProblemRecord and EvidenceObject since A01's
 * build, reserved by A00 approval condition 1 — and NOTHING POPULATED IT. A
 * field that is never written is not reserved, it is decorative: the column
 * would ship empty and the expensive version of this fix is adding a NOT NULL
 * tenant to populated homeowner rows later.
 *
 * It is defaulted HERE, at the store, for the same reason A09's guard hooks
 * here: one place covers every writer and a new caller cannot forget. A record
 * that already names a tenant keeps it — this fills a blank, it never
 * overwrites. THERE IS NO TENANT LOGIC ANYWHERE: nothing reads this to route,
 * filter, or authorise, and this function is the whole of the mechanism.
 */
function withTenant<T extends { tenant_id?: string }>(record: T): T {
  return record.tenant_id ? record : { ...record, tenant_id: DEFAULT_TENANT_ID };
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

function throwOn(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/**
 * A COLUMN OR TABLE THIS BUILD WRITES THAT THE DATABASE DOES NOT HAVE YET.
 *
 * Migrations are applied as a separate, human-coordinated step in this project
 * (every migration since 00006 says so in its own header), so between a commit
 * and that apply the schema is genuinely older than the code. That window is
 * not hypothetical: driving the running app on 2026-08-25 turned a homeowner's
 * intake into a 503 reading "Could not find the 'tenant_id' column of
 * 'evidence_object'" — a telemetry-grade field taking down the customer path.
 *
 * The shim below is the SAME one `appendAudit` already carries for migration
 * 00013's `duration_ms`, and it is deletable on exactly the same terms: the day
 * `npm run db:migrate -- --status` reports 00014 and 00015 applied, nothing
 * here is load-bearing.
 */
function missingSchema(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  return /schema cache|column .* does not exist|relation .* does not exist|PGRST20[45]|42P01|42703|does not exist/i.test(
    `${error.message} ${error.code ?? ""}`
  );
}

/** One warning per pending migration per process, never one per request. */
const pendingMigrationLogged = new Set<string>();
function warnPending(what: string, migration: string): void {
  if (pendingMigrationLogged.has(migration)) return;
  pendingMigrationLogged.add(migration);
  console.warn(
    `[runtime-store] ${what} — apply supabase/migrations/${migration}. Proceeding without it; the customer journey is unaffected.`
  );
}

class SupabaseRuntimeStore implements RuntimeStore {
  readonly kind = "supabase" as const;
  /** Elevated client — internal operations only (writes, admin reads, telemetry). */
  private db = requireServiceClient();

  /**
   * The DEFAULT path for customer-facing reads AND writes: a client scoped
   * to this one request_id (migration 00006's RLS policies — USING for
   * reads/updates, WITH CHECK for inserts/updates — enforce the boundary in
   * Postgres, both that a caller can only see their own rows and that they
   * can only ever write a row stamped with their own request_id). Falls
   * back to the service client only when SUPABASE_ANON_KEY /
   * SUPABASE_JWT_SECRET are not yet configured, so a deploy that hasn't
   * added the new env vars keeps serving customers exactly as it does today.
   */
  private scopedClient(requestId: string): SupabaseClient {
    return requestScopedClient(requestId) ?? this.db;
  }

  /**
   * Insert a row that carries `tenant_id`, on a database that may not have the
   * column yet. The tenant is the FIRST thing dropped and the only thing
   * dropped — every other error still throws exactly as before, because a
   * failed evidence write is a lost homeowner record and must not be swallowed.
   */
  private async insertWithOptionalTenant(
    db: SupabaseClient,
    table: "evidence_object" | "problem_record",
    row: Record<string, unknown>,
    what: string
  ): Promise<void> {
    const first = (await db.from(table).insert(row)).error;
    if (!first) return;
    if (!missingSchema(first)) throwOn(first, what);
    warnPending(`${table}.tenant_id is not present`, "00015_core_record_tenancy.sql");
    const { tenant_id: _dropped, ...withoutTenant } = row;
    throwOn((await db.from(table).insert(withoutTenant)).error, what);
  }

  async recordJourney(input: RecordJourneyInput): Promise<void> {
    const { session, consent, packet, events } = input;
    const problem = withTenant(input.problem);
    const evidence = withTenant(input.evidence);
    // Every insert below carries the SAME request_id the caller's JWT claim
    // (migration 00019's WITH CHECK policies) will match — a request-scoped
    // client cannot forge a row under someone else's request_id even at
    // creation time, before any of these rows exist yet. The chain's tenant
    // defaulting and optional-tenant fallback ride along unchanged.
    const db = this.scopedClient(session.request_id);
    // Raw evidence first, then the record that references it, then the packet
    // derived from it: the provenance chain is never written out of order.
    await this.insertWithOptionalTenant(
      db,
      "evidence_object",
      {
        evidence_id: evidence.evidence_id,
        tenant_id: evidence.tenant_id,
        kind: evidence.kind,
        content: evidence.content,
        privacy: evidence.privacy,
        captured_at: evidence.captured_at,
        request_id: session.request_id,
      },
      "insert evidence"
    );
    await this.insertWithOptionalTenant(
      db,
      "problem_record",
      {
        problem_id: problem.problem_id,
        tenant_id: problem.tenant_id,
        schema_version: problem.schema_version,
        status: problem.status,
        source_channel: problem.source_channel,
        intake_session_id: problem.intake_session_id,
        problem_summary: problem.problem_summary,
        service_category: problem.service_category,
        service_category_confidence: problem.service_category_confidence,
        safety_state: problem.safety_state,
        safety_rule_id: problem.safety_rule_id,
        evidence_ids: problem.evidence_ids,
        claim_ids: problem.claim_ids,
        clarifiers_asked: problem.clarifiers_asked,
        created_at: problem.created_at,
        updated_at: problem.updated_at,
        request_id: session.request_id,
      },
      "insert problem"
    );
    throwOn(
      (
        await db.from("job_packet").insert({
          job_packet_id: packet.job_packet_id,
          packet_version: packet.packet_version,
          schema_version: packet.schema_version,
          problem_id: packet.problem_id,
          packet,
          generated_at: packet.generated_at,
          engine: packet.engine,
          request_id: session.request_id,
        })
      ).error,
      "insert packet"
    );
    throwOn(
      (
        await db.from("consent_event").insert({
          consent_event_id: consent.consent_event_id,
          person_id: consent.person_id,
          guest_session_id: consent.guest_session_id,
          problem_id: consent.problem_id,
          scope: consent.scope,
          action: consent.action,
          disclosure_version_id: consent.disclosure_version_id,
          surface: consent.surface,
          trace_id: consent.trace_id,
          occurred_at: consent.occurred_at,
          request_id: session.request_id,
        })
      ).error,
      "insert consent"
    );
    throwOn(
      (
        await db.from("intake_session").insert({
          intake_session_id: session.intake_session_id,
          schema_version: session.schema_version,
          guest_session_id: session.guest_session_id,
          request_id: session.request_id,
          attribution: session.attribution,
          consent_event_ids: session.consent_event_ids,
          playbook_id: session.playbook_id ?? null,
          entered_at: session.entered_at,
          intake_started_at: session.intake_started_at,
        })
      ).error,
      "insert session"
    );
    /**
     * A01's claims and the derivation that produced them — after the record and
     * the evidence they both reference, so the chain is never written out of
     * order, and BEFORE the fail-soft telemetry below, because these are
     * durable facts rather than instrumentation.
     */
    /**
     * AND THE TABLES MAY NOT EXIST YET (migration 00014). A pending migration
     * must not turn a homeowner's intake into a 503 — #14A 13.4 is "never lose
     * their work", and their work is the record, the evidence and the packet,
     * all three of which are already committed above. So a missing table is
     * warned about once, loudly, naming the migration, and the journey
     * continues. Every OTHER failure still throws.
     *
     * THE HONEST COST, STATED: until 00014 is applied on a Supabase deployment,
     * A01 produces claims and a derivation that are returned, evented and NOT
     * PERSISTED. On the file-backed store — which is what the trial actually
     * runs on — they are persisted today.
     */
    if (input.claims && input.claims.length > 0) {
      const error = (await this.db.from("fact_claim").insert(input.claims.map((c) => withTenant(c))))
        .error;
      if (error && !missingSchema(error)) throwOn(error, "insert claims");
      if (error) warnPending("fact_claim does not exist", "00014_fact_claim_provenance.sql");
    }
    if (input.derivation) {
      const error = (await this.db.from("derivation_record").insert(withTenant(input.derivation)))
        .error;
      if (error && !missingSchema(error)) throwOn(error, "insert derivation");
      if (error) warnPending("derivation_record does not exist", "00014_fact_claim_provenance.sql");
    }
    // Telemetry must never invalidate a journey that is already committed:
    // a failed event insert would send the customer a retry that duplicates
    // their ProblemRecord and their consent row.
    try {
      await this.recordEvents(events);
    } catch {
      /* best effort */
    }
  }

  async ensureDisclosure(disclosure: DisclosureVersion): Promise<void> {
    // Insert-if-absent: the table grants INSERT only, never UPDATE, so a
    // published disclosure version can never be rewritten after the fact.
    const { error } = await this.db
      .from("disclosure_version")
      .upsert(disclosure, { onConflict: "disclosure_version_id", ignoreDuplicates: true });
    if (error) throw new Error(`record disclosure: ${error.message}`);
  }

  async recordEvents(events: EventEnvelope[]): Promise<void> {
    if (events.length === 0) return;
    throwOn(
      (
        await this.db.from("event_envelope").insert(
          events.map((e) => ({
            event_id: e.event_id,
            event_name: e.event_name,
            event_version: e.event_version,
            occurred_at: e.occurred_at,
            actor: e.actor,
            guest_session_id: e.guest_session_id,
            context: e.context,
            source: e.source,
            versions: e.versions,
            result: e.result,
            privacy_class: e.privacy_class,
            trace_id: e.trace_id,
            agent_run_id: e.agent_run_id,
            action_request_id: e.action_request_id,
          }))
        )
      ).error,
      "insert events"
    );
  }

  async getJourney(requestId: string): Promise<Journey | null> {
    const db = this.scopedClient(requestId);
    const { data: session, error } = await db
      .from("intake_session")
      .select("*")
      .eq("request_id", requestId)
      .maybeSingle();
    if (error) throw new Error(`load session: ${error.message}`);
    if (!session) return null;
    const { data: problem, error: problemError } = await db
      .from("problem_record")
      .select("*")
      .eq("intake_session_id", session.intake_session_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (problemError) throw new Error(`load problem: ${problemError.message}`);
    if (!problem) return null;
    const { data: packetRow, error: packetError } = await db
      .from("job_packet")
      .select("packet")
      .eq("problem_id", problem.problem_id)
      .order("packet_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (packetError) throw new Error(`load packet: ${packetError.message}`);
    if (!packetRow) return null;
    return projectJourneySafety({
      session: session as SessionRow,
      problem: problem as ProblemRecord,
      packet: packetRow.packet as JobPacket,
    }, await this.listEvidence(problem.problem_id, requestId));
  }

  async listJourneys(limit = 100): Promise<Journey[]> {
    const { data: sessions, error } = await this.db
      .from("intake_session")
      .select("*")
      .order("entered_at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(sessions)) throw new Error("Session records are unavailable");
    const out: Journey[] = [];
    for (const session of sessions) {
      const { data: problem, error: problemError } = await this.db
        .from("problem_record")
        .select("*")
        .eq("intake_session_id", session.intake_session_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (problemError) throw new Error(`list journey problems: ${problemError.message}`);
      if (!problem) continue;
      // Same packet selection rule as getJourney: newest version wins.
      const { data: packetRow, error: packetError } = await this.db
        .from("job_packet")
        .select("packet")
        .eq("problem_id", problem.problem_id)
        .order("packet_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (packetError) throw new Error(`list journey packets: ${packetError.message}`);
      if (!packetRow) continue;
      out.push({
        session: session as SessionRow,
        problem: problem as ProblemRecord,
        packet: packetRow.packet as JobPacket,
      });
    }
    return out;
  }

  async countEvents(eventName: string): Promise<number> {
    const { count, error } = await this.db
      .from("event_envelope")
      .select("event_id", { count: "exact", head: true })
      .eq("event_name", eventName);
    if (error || !Number.isSafeInteger(count) || (count as number) < 0) throw new Error("Event count is unavailable");
    return count as number;
  }

  async totals(): Promise<{ journeys: number; packets: number; consents: number }> {
    const counts = await Promise.all(
      ["intake_session", "job_packet", "consent_event"].map(async (table) => {
        const { count, error } = await this.db.from(table).select("*", { count: "exact", head: true });
        if (error || !Number.isSafeInteger(count) || (count as number) < 0) throw new Error(`count ${table}: unavailable`);
        return count as number;
      })
    );
    return { journeys: counts[0], packets: counts[1], consents: counts[2] };
  }

  async getPublishedPageIds(): Promise<Set<string>> {
    const { data, error } = await this.db.from("published_page").select("page_id");
    if (error || !Array.isArray(data) || data.some(r => typeof r?.page_id !== "string" || !r.page_id)) throw new Error("Published-page records are unavailable");
    return new Set(data.map((r) => r.page_id as string));
  }

  async setPublished(spec: PageSpec, published: boolean): Promise<void> {
    if (published) {
      throwOn(
        (
          await this.db.from("published_page").upsert({
            page_id: spec.page_id,
            page_spec_id: spec.page_spec_id,
            canonical_path: spec.canonical_path,
            published_at: new Date().toISOString(),
          })
        ).error,
        "publish page"
      );
    } else {
      throwOn(
        (await this.db.from("published_page").delete().eq("page_id", spec.page_id)).error,
        "unpublish page"
      );
    }
  }

  async listStagedSpecs(): Promise<PageSpec[]> {
    const { data, error } = await this.db.from("staged_page_spec").select("spec");
    if (error) throw new Error(`list staged: ${error.message}`);
    return (data ?? []).map((r) => r.spec as PageSpec);
  }

  /**
   * FORWARD-COMPATIBLE WITH A COLUMN THAT MAY NOT BE APPLIED YET.
   *
   * `duration_ms` arrives with migration 00013. Migrations are applied as a
   * separate, human-coordinated step, so between this commit and that apply the
   * column does not exist — and a plain insert carrying it would FAIL, turning
   * an owner's publish click into a 500 over a telemetry field. So the duration
   * is sent when it is known, and a schema-cache/unknown-column rejection
   * retries once without it. Every other error still throws exactly as before.
   *
   * The shim is deletable the day `npm run db:migrate -- --status` reports
   * 00013 applied; it is not load-bearing for anything but that window.
   */
  async appendAudit(entry: AuditEntry): Promise<void> {
    const { duration_ms, ...core } = entry;
    if (duration_ms == null) {
      throwOn((await this.db.from("admin_audit").insert(core)).error, "append audit");
      return;
    }
    const first = (await this.db.from("admin_audit").insert({ ...core, duration_ms })).error;
    if (!first) return;
    const missingColumn = /duration_ms|schema cache|column .* does not exist|PGRST204/i.test(
      `${first.message} ${first.code ?? ""}`
    );
    if (!missingColumn) throwOn(first, "append audit");
    if (!auditDurationMissLogged) {
      auditDurationMissLogged = true;
      console.warn(
        "[runtime-store] admin_audit.duration_ms not present — apply supabase/migrations/00013_admin_audit_duration.sql. Recording the entry without its duration."
      );
    }
    throwOn((await this.db.from("admin_audit").insert(core)).error, "append audit");
  }

  async listAudit(limit = 50): Promise<AuditEntry[]> {
    const { data, error } = await this.db
      .from("admin_audit")
      .select("at, action, target, detail")
      .order("at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) throw new Error("Owner audit records are unavailable");
    return data as AuditEntry[];
  }

  async attachEvidence(_problemId: string, requestId: string, raw: EvidenceObject): Promise<void> {
    const evidence = withTenant(raw);
    const db = this.scopedClient(requestId);
    await this.insertWithOptionalTenant(
      db,
      "evidence_object",
      {
        evidence_id: evidence.evidence_id,
        tenant_id: evidence.tenant_id,
        kind: evidence.kind,
        content: evidence.content,
        privacy: evidence.privacy,
        captured_at: evidence.captured_at,
        mime: evidence.mime ?? null,
        bytes: evidence.bytes ?? null,
        duration_seconds: evidence.duration_seconds ?? null,
        field_key: evidence.field_key ?? null,
        request_id: requestId,
      },
      "insert evidence"
    );
    // Migration 00026 joins this evidence to the matching problem atomically;
    // a read/replace array here loses IDs when two admitted uploads finish.
  }

  async saveIntakeAnswers(answers: IntakeAnswer[]): Promise<void> {
    if (answers.length === 0) return;
    // Every answer in one call always belongs to the same request (both
    // callers — intake create, /api/intake/answer — pass a single-request
    // batch); scope the write to it.
    const db = this.scopedClient(answers[0].request_id);
    throwOn((await db.from("intake_answer").insert(answers)).error, "insert answers");
  }

  async listIntakeAnswers(requestId: string): Promise<IntakeAnswer[]> {
    const { data, error } = await this.scopedClient(requestId)
      .from("intake_answer")
      .select("request_id, field_key, value_text, evidence_id, source, answered_at")
      .eq("request_id", requestId)
      .order("answered_at", { ascending: true });
    if (error) throw new Error(`list answers: ${error.message}`);
    return (data ?? []) as IntakeAnswer[];
  }

  async saveDiagnosisAnswer(answer: DiagnosisAnswer): Promise<void> {
    throwOn(
      (await this.scopedClient(answer.request_id).from("diagnosis_answer").insert(answer)).error,
      "insert diagnosis answer"
    );
  }

  async listDiagnosisAnswers(requestId: string): Promise<DiagnosisAnswer[]> {
    const { data, error } = await this.scopedClient(requestId)
      .from("diagnosis_answer")
      .select("request_id, step_id, answer, evidence_id, answered_at")
      .eq("request_id", requestId)
      .order("answered_at", { ascending: true });
    if (error) throw new Error(`list diagnosis: ${error.message}`);
    return (data ?? []) as DiagnosisAnswer[];
  }

  async listEvidence(problemId: string, requestId?: string): Promise<EvidenceObject[]> {
    const db = requestId ? this.scopedClient(requestId) : this.db;
    const { data: problem, error: problemError } = await db
      .from("problem_record")
      .select("evidence_ids, request_id")
      .eq("problem_id", problemId)
      .maybeSingle();
    if (problemError) throw new Error(`list evidence owner: ${problemError.message}`);
    // Validate the problem's owner even when the deployment falls back to its
    // service client. A request id alone must not make a foreign problem valid.
    if (!problem || (requestId && problem.request_id !== requestId)) return [];
    const ids: string[] = problem.evidence_ids ?? [];
    const ownerId: string | null = requestId ?? problem.request_id ?? null;
    const evidence = new Map<string, EvidenceObject>();
    if (ids.length > 0) {
      const { data, error } = await db.from("evidence_object").select("*").in("evidence_id", ids);
      if (error) throw new Error(`list evidence: ${error.message}`);
      for (const row of data ?? []) {
        // Linked legacy rows may predate request_id. A row explicitly owned by
        // another request is never usable evidence for this problem.
        if (row.request_id && row.request_id !== ownerId) throw new Error("Journey evidence ownership does not match.");
        evidence.set(row.evidence_id, row as EvidenceObject);
      }
    }
    if (ownerId) {
      // attachEvidence writes the owned row before updating the denormalized
      // id array. Concurrent attachments can overwrite that array; every owned
      // observation must still participate in safety on the next read.
      const { data, error } = await db.from("evidence_object").select("*").eq("request_id", ownerId);
      if (error) throw new Error(`list owned evidence: ${error.message}`);
      for (const row of data ?? []) {
        if (row.request_id !== ownerId) throw new Error("Journey evidence ownership does not match.");
        evidence.set(row.evidence_id, row as EvidenceObject);
      }
    }
    return [...evidence.values()].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  }

  async savePacket(packet: JobPacket, requestId: string): Promise<void> {
    throwOn(
      (
        await this.scopedClient(requestId).from("job_packet").insert({
          job_packet_id: packet.job_packet_id,
          packet_version: packet.packet_version,
          schema_version: packet.schema_version,
          problem_id: packet.problem_id,
          packet,
          generated_at: packet.generated_at,
          engine: packet.engine,
          request_id: requestId,
        })
      ).error,
      "insert packet version"
    );
  }

  /**
   * A TABLE THAT DOES NOT EXIST YET READS AS EMPTY, and empty is the truthful
   * answer: nothing was stored there. It is not the same as "this problem has
   * no claims", and the warning says which migration would tell them apart.
   */
  async listClaims(problemId: string): Promise<FactClaim[]> {
    const { data, error } = await this.db
      .from("fact_claim")
      .select("*")
      .eq("problem_id", problemId)
      .order("created_at", { ascending: true });
    if (error && missingSchema(error)) {
      warnPending("fact_claim does not exist", "00014_fact_claim_provenance.sql");
      return [];
    }
    if (error) throw new Error(`list claims: ${error.message}`);
    return (data ?? []) as FactClaim[];
  }

  async listDerivations(problemId: string): Promise<DerivationRecord[]> {
    const { data, error } = await this.db
      .from("derivation_record")
      .select("*")
      .eq("problem_id", problemId)
      .order("created_at", { ascending: true });
    if (error && missingSchema(error)) {
      warnPending("derivation_record does not exist", "00014_fact_claim_provenance.sql");
      return [];
    }
    if (error) throw new Error(`list derivations: ${error.message}`);
    return (data ?? []) as DerivationRecord[];
  }

  /**
   * THE FORWARD POINTER. The packet body is the jsonb column, so the two fields
   * are rewritten inside it — read, merge, write, and only for the one row.
   * A version that is already superseded is left exactly as it is: the first
   * successor is the true one, and a re-run must not rewrite history.
   */
  async supersedePacket(previousPacketId: string, supersededBy: string): Promise<void> {
    const { data, error } = await this.db
      .from("job_packet")
      .select("packet")
      .eq("job_packet_id", previousPacketId)
      .maybeSingle();
    if (error) throw new Error(`load packet to supersede: ${error.message}`);
    if (!data) return;
    const previous = data.packet as JobPacket;
    if (previous.status === "superseded") return;
    const updated: JobPacket = {
      ...previous,
      status: "superseded",
      superseded_by: supersededBy,
    };
    throwOn(
      (
        await this.db
          .from("job_packet")
          .update({ packet: updated })
          .eq("job_packet_id", previousPacketId)
      ).error,
      "supersede packet"
    );
  }

  // --- loop surfaces (migration 00020_loop_surfaces.sql) -------------------
  //
  // Request-keyed rows go through the request-scoped client exactly as the
  // journey tables do (00020 carries the same request-scoped policies as
  // 00019). The lookups that arrive WITHOUT a request_id — a link id, a magic
  // id, an email id, a vote — are server-side capability lookups and use the
  // service client, with a written reason on each.
  //
  // THE MIGRATION WINDOW. 00020 is applied as a separate, human-coordinated
  // step (Melissa, before the next deploy). Until then every WRITE below
  // throws, loudly, naming the migration — a claim, an answer or a revocation
  // that did not land must never be reported as done. READS on a missing table
  // return the truthful empty answer with the same one-per-process warning the
  // fact_claim reads carry: nothing was stored there, because nothing could be.

  async revokeLink(link_id: string, request_id: string, at: string): Promise<void> {
    const row: LinkRevocation = { link_id, request_id, revoked_at: at };
    const error = (await this.scopedClient(request_id).from("link_revocations").insert(row)).error;
    if (error && missingSchema(error)) {
      throw new Error(
        "revoke link: link_revocations does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "revoke link");
  }

  /**
   * Service client: the verifier holds a link id and nothing else yet. A
   * missing table cannot establish revocation state, so authorization fails
   * closed until the ledger is available.
   */
  async isLinkRevoked(link_id: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("link_revocations")
      .select("link_id")
      .eq("link_id", link_id)
      .limit(1);
    if (error && missingSchema(error)) {
      throw new Error("Revocation ledger is unavailable; apply migration 00020 before opening shared links.");
    }
    if (error) throw new Error(`check link revocation: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("Revocation ledger returned an invalid response.");
    return data.length > 0;
  }

  async saveKeepClaim(claim: KeepClaim): Promise<void> {
    const error = (await this.scopedClient(claim.request_id).from("keep_claims").insert(claim)).error;
    if (error && missingSchema(error)) {
      throw new Error(
        "save keep claim: keep_claims does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "save keep claim");
  }

  async getKeepClaim(request_id: string): Promise<KeepClaim | null> {
    const { data, error } = await this.scopedClient(request_id)
      .from("keep_claims")
      .select("request_id, contact, contact_kind, claimed_at, magic_link_id")
      .eq("request_id", request_id)
      .order("claimed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error && missingSchema(error)) {
      warnPending("keep_claims does not exist", "00020_loop_surfaces.sql");
      return null;
    }
    if (error) throw new Error(`load keep claim: ${error.message}`);
    return (data as KeepClaim | null) ?? null;
  }

  async saveMagicLink(link: MagicLink): Promise<void> {
    const error = (await this.scopedClient(link.request_id).from("magic_links").insert(link)).error;
    if (error && missingSchema(error)) {
      throw new Error(
        "save magic link: magic_links does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "save magic link");
  }

  /**
   * Service client: the only thing the caller holds is the magic id from the
   * URL. Single use is enforced by the database, not by a read-then-write:
   * the UPDATE matches only a row whose consumed_at is still null, so two
   * concurrent clicks cannot both succeed.
   */
  async consumeMagicLink(magic_id: string, at: string, request_id?: string): Promise<MagicLink | null> {
    let query = this.db
      .from("magic_links")
      .update({ consumed_at: at })
      .eq("magic_id", magic_id)
      .is("consumed_at", null);
    if (request_id) query = query.eq("request_id", request_id);
    const { data, error } = await query
      .select("magic_id, request_id, contact, created_at, consumed_at")
      .maybeSingle();
    if (error && missingSchema(error)) {
      warnPending("magic_links does not exist", "00020_loop_surfaces.sql");
      return null;
    }
    if (error) throw new Error(`consume magic link: ${error.message}`);
    return (data as MagicLink | null) ?? null;
  }

  async saveAskAnswer(answer: AskAnswer): Promise<void> {
    const error = (await this.scopedClient(answer.request_id).from("ask_answers").insert(answer)).error;
    if (error && missingSchema(error)) {
      throw new Error(
        "save ask answer: ask_answers does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "save ask answer");
  }

  async listAskAnswers(request_id: string): Promise<AskAnswer[]> {
    const { data, error } = await this.scopedClient(request_id)
      .from("ask_answers")
      .select(
        "ask_id, request_id, friend_name, friend_contact, provider_name, provider_contact, reason, created_at"
      )
      .eq("request_id", request_id)
      .order("created_at", { ascending: true });
    if (error && missingSchema(error)) {
      warnPending("ask_answers does not exist", "00020_loop_surfaces.sql");
      return [];
    }
    if (error) throw new Error(`list ask answers: ${error.message}`);
    return (data ?? []) as AskAnswer[];
  }

  async saveFeedback(feedback: Feedback): Promise<void> {
    const error = (await this.scopedClient(feedback.request_id).from("feedback").insert(feedback))
      .error;
    if (error && missingSchema(error)) {
      throw new Error(
        "save feedback: feedback does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "save feedback");
  }

  /** Service client: the outbox is the server's own, read back by email id at /mail/<id>. */
  async enqueueEmail(email: Email): Promise<void> {
    const row = { ...email, request_id: email.request_id ?? null };
    const error = (await this.db.from("email_outbox").insert(row)).error;
    if (error && missingSchema(error)) {
      throw new Error(
        "enqueue email: email_outbox does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "enqueue email");
  }

  async getEmail(email_id: string): Promise<Email | null> {
    const { data, error } = await this.db
      .from("email_outbox")
      .select("email_id, request_id, to, subject, text, html, mode, created_at, sent_at, provider_id")
      .eq("email_id", email_id)
      .maybeSingle();
    if (error && missingSchema(error)) {
      warnPending("email_outbox does not exist", "00020_loop_surfaces.sql");
      return null;
    }
    if (error) throw new Error(`load email: ${error.message}`);
    return (data as Email | null) ?? null;
  }

  async markEmailSent(email_id: string, at: string, provider_id: string | null): Promise<void> {
    const error = (
      await this.db.from("email_outbox").update({ sent_at: at, provider_id }).eq("email_id", email_id)
    ).error;
    if (error && missingSchema(error)) {
      throw new Error(
        "mark email sent: email_outbox does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "mark email sent");
  }

  async saveJobAddress(request_id: string, address: JobAddress): Promise<void> {
    const row: JobAddressRow = { ...address, request_id, saved_at: new Date().toISOString() };
    const error = (await this.scopedClient(request_id).from("job_addresses").insert(row)).error;
    if (error && missingSchema(error)) {
      throw new Error(
        "save job address: job_addresses does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "save job address");
  }

  async getJobAddress(request_id: string): Promise<JobAddress | null> {
    const { data, error } = await this.scopedClient(request_id)
      .from("job_addresses")
      .select("street, city_state_zip, property_type, storeys")
      .eq("request_id", request_id)
      .order("saved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error && missingSchema(error)) {
      warnPending("job_addresses does not exist", "00020_loop_surfaces.sql");
      return null;
    }
    if (error) throw new Error(`load job address: ${error.message}`);
    return (data as JobAddress | null) ?? null;
  }

  /**
   * Service client: a vote belongs to no journey. A vote_id that arrives twice
   * corrects the earlier row (upsert on the browser's key); without one it is
   * a plain insert.
   */
  async saveSignup(signup: Signup): Promise<void> {
    const row = {
      signup_id: signup.signup_id,
      page: signup.page,
      vote: signup.vote,
      name: signup.name ?? null,
      email: signup.email ?? null,
      phone: signup.phone ?? null,
      zip: signup.zip ?? null,
      reasons: signup.reasons ?? [],
      vote_id: signup.vote_id ?? null,
      browser_at: signup.browser_at ?? null,
      created_at: signup.created_at,
    };
    const error = signup.vote_id
      ? (await this.db.from("signups").upsert(row, { onConflict: "vote_id" })).error
      : (await this.db.from("signups").insert(row)).error;
    if (error && missingSchema(error)) {
      throw new Error(
        "save signup: signups does not exist — apply supabase/migrations/00020_loop_surfaces.sql"
      );
    }
    throwOn(error, "save signup");
  }
}

// ---------------------------------------------------------------------------
// Local file backend (development without a database)
// ---------------------------------------------------------------------------

class FileRuntimeStore implements RuntimeStore {
  readonly kind = "file" as const;

  async recordJourney(input: RecordJourneyInput): Promise<void> {
    updateDevDb((db) => {
      db.intake_sessions.push(input.session);
      db.consent_events.push(input.consent);
      db.problems.push(withTenant(input.problem));
      db.evidence.push(withTenant(input.evidence));
      db.packets.push(input.packet);
      db.events.push(...input.events);
      for (const claim of input.claims ?? []) db.fact_claims.push(withTenant(claim));
      if (input.derivation) db.derivation_records.push(withTenant(input.derivation));
    });
  }

  async ensureDisclosure(): Promise<void> {
    /* the local file store keeps the active disclosure in code */
  }

  async recordEvents(events: EventEnvelope[]): Promise<void> {
    updateDevDb((db) => {
      db.events.push(...events);
    });
  }

  async getJourney(requestId: string): Promise<Journey | null> {
    const db = readDevDb();
    const session = db.intake_sessions.find((s) => s.request_id === requestId);
    if (!session) return null;
    const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id);
    if (!problem) return null;
    const packet = [...db.packets]
      .filter((k) => k.problem_id === problem.problem_id)
      .sort((a, b) => b.packet_version - a.packet_version)[0];
    if (!packet) return null;
    return projectJourneySafety({ session, problem, packet }, db.evidence.filter(e => problem.evidence_ids.includes(e.evidence_id)));
  }

  async listJourneys(limit = 100): Promise<Journey[]> {
    const db = readDevDb({ requiredCollections: ["intake_sessions", "problems", "packets"] });
    const out: Journey[] = [];
    for (const session of [...db.intake_sessions].reverse().slice(0, limit)) {
      const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id);
      const packet = problem
        ? [...db.packets]
            .filter((k) => k.problem_id === problem.problem_id)
            .sort((a, b) => b.packet_version - a.packet_version)[0]
        : undefined;
      if (problem && packet) out.push({ session, problem, packet });
    }
    return out;
  }

  async countEvents(eventName: string): Promise<number> {
    return readDevDb().events.filter((e) => e.event_name === eventName).length;
  }

  async totals(): Promise<{ journeys: number; packets: number; consents: number }> {
    const db = readDevDb({ requiredCollections: ["intake_sessions", "packets", "consent_events"] });
    return {
      journeys: db.intake_sessions.length,
      packets: db.packets.length,
      consents: db.consent_events.length,
    };
  }

  async getPublishedPageIds(): Promise<Set<string>> {
    return new Set(readDevDb({ requiredCollections: ["published_page_ids"] }).published_page_ids);
  }

  async setPublished(spec: PageSpec, published: boolean): Promise<void> {
    updateDevDb((db) => {
      const set = new Set(db.published_page_ids);
      if (published) set.add(spec.page_id);
      else set.delete(spec.page_id);
      db.published_page_ids = [...set];
    });
  }

  async listStagedSpecs(): Promise<PageSpec[]> {
    return readDevDb().staged_specs;
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    updateDevDb((db) => {
      db.admin_audit.push(entry);
    });
  }

  async listAudit(limit = 50): Promise<AuditEntry[]> {
    return [...readDevDb({ requiredCollections: ["admin_audit"] }).admin_audit].reverse().slice(0, limit);
  }

  async attachEvidence(problemId: string, _requestId: string, raw: EvidenceObject): Promise<void> {
    const evidence = withTenant(raw);
    updateDevDb((db) => {
      db.evidence.push(evidence);
      const p = db.problems.find((x) => x.problem_id === problemId);
      if (p && !p.evidence_ids.includes(evidence.evidence_id)) {
        p.evidence_ids.push(evidence.evidence_id);
        p.updated_at = evidence.captured_at;
      }
    });
  }

  async saveIntakeAnswers(answers: IntakeAnswer[]): Promise<void> {
    updateDevDb((db) => {
      db.intake_answers.push(...answers);
    });
  }

  async listIntakeAnswers(requestId: string): Promise<IntakeAnswer[]> {
    return readDevDb().intake_answers.filter((a) => a.request_id === requestId) as IntakeAnswer[];
  }

  async saveDiagnosisAnswer(answer: DiagnosisAnswer): Promise<void> {
    updateDevDb((db) => {
      db.diagnosis_answers.push(answer);
    });
  }

  async listDiagnosisAnswers(requestId: string): Promise<DiagnosisAnswer[]> {
    return readDevDb().diagnosis_answers.filter((a) => a.request_id === requestId) as DiagnosisAnswer[];
  }

  async listEvidence(problemId: string, _requestId?: string): Promise<EvidenceObject[]> {
    const db = readDevDb();
    const p = db.problems.find((x) => x.problem_id === problemId);
    if (!p) return [];
    return db.evidence.filter((e) => p.evidence_ids.includes(e.evidence_id));
  }

  async savePacket(packet: JobPacket, _requestId: string): Promise<void> {
    updateDevDb((db) => {
      db.packets.push(packet);
    });
  }

  async listClaims(problemId: string): Promise<FactClaim[]> {
    return readDevDb().fact_claims.filter((c) => c.problem_id === problemId);
  }

  async listDerivations(problemId: string): Promise<DerivationRecord[]> {
    return readDevDb().derivation_records.filter((d) => d.problem_id === problemId);
  }

  async supersedePacket(previousPacketId: string, supersededBy: string): Promise<void> {
    updateDevDb((db) => {
      const previous = db.packets.find((p) => p.job_packet_id === previousPacketId);
      // Already superseded: the first successor is the true one, and a re-run
      // must not rewrite history.
      if (!previous || previous.status === "superseded") return;
      previous.status = "superseded";
      previous.superseded_by = supersededBy;
    });
  }

  // --- loop surfaces (dev-db collections of the same names) ----------------

  async revokeLink(link_id: string, request_id: string, at: string): Promise<void> {
    updateDevDb((db) => {
      if (!db.link_revocations.some(row => row.link_id === link_id)) db.link_revocations.push({ link_id, request_id, revoked_at: at });
    });
  }

  async isLinkRevoked(link_id: string): Promise<boolean> {
    return readDevDb({ strictRevocationLedger: true }).link_revocations.some((r) => r.link_id === link_id);
  }

  async saveKeepClaim(claim: KeepClaim): Promise<void> {
    updateDevDb((db) => {
      db.keep_claims.push(claim);
    });
  }

  async getKeepClaim(request_id: string): Promise<KeepClaim | null> {
    const mine = readDevDb().keep_claims.filter((c) => c.request_id === request_id);
    return mine.length > 0 ? mine[mine.length - 1] : null;
  }

  async saveMagicLink(link: MagicLink): Promise<void> {
    updateDevDb((db) => {
      db.magic_links.push(link);
    });
  }

  async consumeMagicLink(magic_id: string, at: string, request_id?: string): Promise<MagicLink | null> {
    let consumed: MagicLink | null = null;
    updateDevDb((db) => {
      const link = db.magic_links.find((l) => l.magic_id === magic_id);
      // Already consumed and unknown look the same to the caller, by design.
      if (!link || link.consumed_at !== null || (request_id && link.request_id !== request_id)) return;
      link.consumed_at = at;
      consumed = { ...link };
    });
    return consumed;
  }

  async saveAskAnswer(answer: AskAnswer): Promise<void> {
    updateDevDb((db) => {
      db.ask_answers.push(answer);
    });
  }

  async listAskAnswers(request_id: string): Promise<AskAnswer[]> {
    return readDevDb().ask_answers.filter((a) => a.request_id === request_id);
  }

  async saveFeedback(feedback: Feedback): Promise<void> {
    updateDevDb((db) => {
      db.feedback.push(feedback);
    });
  }

  async enqueueEmail(email: Email): Promise<void> {
    updateDevDb((db) => {
      db.email_outbox.push({ ...email, request_id: email.request_id ?? null });
    });
  }

  async getEmail(email_id: string): Promise<Email | null> {
    return readDevDb().email_outbox.find((e) => e.email_id === email_id) ?? null;
  }

  async markEmailSent(email_id: string, at: string, provider_id: string | null): Promise<void> {
    updateDevDb((db) => {
      const email = db.email_outbox.find((e) => e.email_id === email_id);
      if (!email) return;
      email.sent_at = at;
      email.provider_id = provider_id;
    });
  }

  async saveJobAddress(request_id: string, address: JobAddress): Promise<void> {
    updateDevDb((db) => {
      db.job_addresses.push({ ...address, request_id, saved_at: new Date().toISOString() });
    });
  }

  async getJobAddress(request_id: string): Promise<JobAddress | null> {
    const mine = readDevDb().job_addresses.filter((a) => a.request_id === request_id);
    if (mine.length === 0) return null;
    const { street, city_state_zip, property_type, storeys } = mine[mine.length - 1];
    return { street, city_state_zip, property_type, storeys };
  }

  async saveSignup(signup: Signup): Promise<void> {
    updateDevDb((db) => {
      // The browser's vote_id corrects an earlier row from the same browser;
      // a replaced row is a corrected row, and the file is the ledger.
      if (signup.vote_id) {
        const i = db.signups.findIndex((s) => s.vote_id === signup.vote_id);
        if (i >= 0) {
          db.signups[i] = signup;
          return;
        }
      }
      db.signups.push(signup);
    });
  }
}

/**
 * Which backend. Honours PRN_RUNTIME_STORE=file through serviceConfigured()
 * (src/platform/db/client.ts): with it set, this is false even when the
 * Supabase env is present, so a local demo or a test run never writes a
 * customer-like row into the trial project.
 */
export function supabaseConfigured(): boolean {
  return serviceConfigured();
}

let cached: RuntimeStore | null = null;

/**
 * A09 (Data Quality, 2026-08-24) wraps the selected backend in its ingest
 * guard HERE rather than asking each caller to validate. That is the whole
 * point of hooking at the store boundary (Loop Spec Audit pre-answer 3): one
 * wrapper covers every writer and cannot be bypassed by a new caller who
 * forgets, and no domain module needed an edit.
 *
 * The guard writes AFTER the inner write, returns its result untouched, and
 * swallows every failure of its own — delete platform/quality and the customer
 * journey behaves identically. `applyQualityGuard` is imported here as a
 * function only; nothing in platform/quality imports this module at module
 * scope, so there is no load-time cycle.
 */
export function runtimeStore(): RuntimeStore {
  if (!cached) {
    const backend = supabaseConfigured() ? new SupabaseRuntimeStore() : new FileRuntimeStore();
    cached = applyQualityGuard(backend);
  }
  return cached;
}

/** The backend without A09's guard — for tests that need the raw store. */
export function unguardedRuntimeStore(): RuntimeStore {
  return supabaseConfigured() ? new SupabaseRuntimeStore() : new FileRuntimeStore();
}

/** Test seam: forces re-selection of the backend. */
export function resetRuntimeStore(): void {
  cached = null;
}
