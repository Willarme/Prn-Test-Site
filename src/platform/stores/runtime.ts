import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IntakeSession } from "@/domain/intake/contracts";
import type { DiagnosisAnswer, IntakeAnswer } from "@/domain/intake/playbook";
import type { ConsentEvent, DisclosureVersion } from "@/domain/privacy/contracts";
import type { EvidenceObject, JobPacket, ProblemRecord } from "@/domain/problem/contracts";
import type { PageSpec } from "@/domain/search/pages";
import type { EventEnvelope } from "@/platform/events/envelope";
import { applyQualityGuard } from "@/platform/quality/ingest";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";

/**
 * Runtime store — the one place customer journeys, events, publish state and
 * the owner audit trail are read/written. Two interchangeable backends:
 *
 *  - SupabaseRuntimeStore: used whenever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *    are configured. Server-side only, service role, over HTTP (serverless-safe).
 *    Row-level security is deny-all, so nothing else can read these rows.
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
  /** Attach new evidence (photo/video) to the journey ProblemRecord. */
  attachEvidence(problemId: string, evidence: EvidenceObject): Promise<void>;
  saveIntakeAnswers(answers: IntakeAnswer[]): Promise<void>;
  listIntakeAnswers(requestId: string): Promise<IntakeAnswer[]>;
  saveDiagnosisAnswer(answer: DiagnosisAnswer): Promise<void>;
  listDiagnosisAnswers(requestId: string): Promise<DiagnosisAnswer[]>;
  listEvidence(problemId: string): Promise<EvidenceObject[]>;
  /** Store a regenerated packet version (newest version wins on read). */
  savePacket(packet: JobPacket): Promise<void>;
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

function client(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function throwOn(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

class SupabaseRuntimeStore implements RuntimeStore {
  readonly kind = "supabase" as const;
  private db = client();

  async recordJourney(input: RecordJourneyInput): Promise<void> {
    const { session, consent, problem, evidence, packet, events } = input;
    // Raw evidence first, then the record that references it, then the packet
    // derived from it: the provenance chain is never written out of order.
    throwOn(
      (
        await this.db.from("evidence_object").insert({
          evidence_id: evidence.evidence_id,
          kind: evidence.kind,
          content: evidence.content,
          privacy: evidence.privacy,
          captured_at: evidence.captured_at,
        })
      ).error,
      "insert evidence"
    );
    throwOn(
      (
        await this.db.from("problem_record").insert({
          problem_id: problem.problem_id,
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
        })
      ).error,
      "insert problem"
    );
    throwOn(
      (
        await this.db.from("job_packet").insert({
          job_packet_id: packet.job_packet_id,
          packet_version: packet.packet_version,
          schema_version: packet.schema_version,
          problem_id: packet.problem_id,
          packet,
          generated_at: packet.generated_at,
          engine: packet.engine,
        })
      ).error,
      "insert packet"
    );
    throwOn(
      (
        await this.db.from("consent_event").insert({
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
        })
      ).error,
      "insert consent"
    );
    throwOn(
      (
        await this.db.from("intake_session").insert({
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
    const { data: session, error } = await this.db
      .from("intake_session")
      .select("*")
      .eq("request_id", requestId)
      .maybeSingle();
    if (error) throw new Error(`load session: ${error.message}`);
    if (!session) return null;
    const { data: problem, error: problemError } = await this.db
      .from("problem_record")
      .select("*")
      .eq("intake_session_id", session.intake_session_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (problemError) throw new Error(`load problem: ${problemError.message}`);
    if (!problem) return null;
    const { data: packetRow, error: packetError } = await this.db
      .from("job_packet")
      .select("packet")
      .eq("problem_id", problem.problem_id)
      .order("packet_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (packetError) throw new Error(`load packet: ${packetError.message}`);
    if (!packetRow) return null;
    return {
      session: session as SessionRow,
      problem: problem as ProblemRecord,
      packet: packetRow.packet as JobPacket,
    };
  }

  async listJourneys(limit = 100): Promise<Journey[]> {
    const { data: sessions, error } = await this.db
      .from("intake_session")
      .select("*")
      .order("entered_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`list sessions: ${error.message}`);
    const out: Journey[] = [];
    for (const session of sessions ?? []) {
      const { data: problem } = await this.db
        .from("problem_record")
        .select("*")
        .eq("intake_session_id", session.intake_session_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!problem) continue;
      // Same packet selection rule as getJourney: newest version wins.
      const { data: packetRow } = await this.db
        .from("job_packet")
        .select("packet")
        .eq("problem_id", problem.problem_id)
        .order("packet_version", { ascending: false })
        .limit(1)
        .maybeSingle();
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
    if (error) throw new Error(`count events: ${error.message}`);
    return count ?? 0;
  }

  async totals(): Promise<{ journeys: number; packets: number; consents: number }> {
    const counts = await Promise.all(
      ["intake_session", "job_packet", "consent_event"].map(async (table) => {
        const { count } = await this.db.from(table).select("*", { count: "exact", head: true });
        return count ?? 0;
      })
    );
    return { journeys: counts[0], packets: counts[1], consents: counts[2] };
  }

  async getPublishedPageIds(): Promise<Set<string>> {
    const { data, error } = await this.db.from("published_page").select("page_id");
    if (error) throw new Error(`list published: ${error.message}`);
    return new Set((data ?? []).map((r) => r.page_id as string));
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
    if (error) throw new Error(`list audit: ${error.message}`);
    return (data ?? []) as AuditEntry[];
  }

  async attachEvidence(problemId: string, evidence: EvidenceObject): Promise<void> {
    throwOn(
      (
        await this.db.from("evidence_object").insert({
          evidence_id: evidence.evidence_id,
          kind: evidence.kind,
          content: evidence.content,
          privacy: evidence.privacy,
          captured_at: evidence.captured_at,
          mime: evidence.mime ?? null,
          bytes: evidence.bytes ?? null,
          field_key: evidence.field_key ?? null,
        })
      ).error,
      "insert evidence"
    );
    const { data: problem, error } = await this.db
      .from("problem_record")
      .select("evidence_ids")
      .eq("problem_id", problemId)
      .maybeSingle();
    if (error) throw new Error(`load problem: ${error.message}`);
    const ids = Array.from(new Set([...(problem?.evidence_ids ?? []), evidence.evidence_id]));
    throwOn(
      (
        await this.db
          .from("problem_record")
          .update({ evidence_ids: ids, updated_at: evidence.captured_at })
          .eq("problem_id", problemId)
      ).error,
      "update problem evidence"
    );
  }

  async saveIntakeAnswers(answers: IntakeAnswer[]): Promise<void> {
    if (answers.length === 0) return;
    throwOn((await this.db.from("intake_answer").insert(answers)).error, "insert answers");
  }

  async listIntakeAnswers(requestId: string): Promise<IntakeAnswer[]> {
    const { data, error } = await this.db
      .from("intake_answer")
      .select("request_id, field_key, value_text, evidence_id, source, answered_at")
      .eq("request_id", requestId)
      .order("answered_at", { ascending: true });
    if (error) throw new Error(`list answers: ${error.message}`);
    return (data ?? []) as IntakeAnswer[];
  }

  async saveDiagnosisAnswer(answer: DiagnosisAnswer): Promise<void> {
    throwOn((await this.db.from("diagnosis_answer").insert(answer)).error, "insert diagnosis answer");
  }

  async listDiagnosisAnswers(requestId: string): Promise<DiagnosisAnswer[]> {
    const { data, error } = await this.db
      .from("diagnosis_answer")
      .select("request_id, step_id, answer, evidence_id, answered_at")
      .eq("request_id", requestId)
      .order("answered_at", { ascending: true });
    if (error) throw new Error(`list diagnosis: ${error.message}`);
    return (data ?? []) as DiagnosisAnswer[];
  }

  async listEvidence(problemId: string): Promise<EvidenceObject[]> {
    const { data: problem } = await this.db
      .from("problem_record")
      .select("evidence_ids")
      .eq("problem_id", problemId)
      .maybeSingle();
    const ids: string[] = problem?.evidence_ids ?? [];
    if (ids.length === 0) return [];
    const { data, error } = await this.db.from("evidence_object").select("*").in("evidence_id", ids);
    if (error) throw new Error(`list evidence: ${error.message}`);
    return (data ?? []) as EvidenceObject[];
  }

  async savePacket(packet: JobPacket): Promise<void> {
    throwOn(
      (
        await this.db.from("job_packet").insert({
          job_packet_id: packet.job_packet_id,
          packet_version: packet.packet_version,
          schema_version: packet.schema_version,
          problem_id: packet.problem_id,
          packet,
          generated_at: packet.generated_at,
          engine: packet.engine,
        })
      ).error,
      "insert packet version"
    );
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
      db.problems.push(input.problem);
      db.evidence.push(input.evidence);
      db.packets.push(input.packet);
      db.events.push(...input.events);
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
    return { session, problem, packet };
  }

  async listJourneys(limit = 100): Promise<Journey[]> {
    const db = readDevDb();
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
    const db = readDevDb();
    return {
      journeys: db.intake_sessions.length,
      packets: db.packets.length,
      consents: db.consent_events.length,
    };
  }

  async getPublishedPageIds(): Promise<Set<string>> {
    return new Set(readDevDb().published_page_ids);
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
    return [...readDevDb().admin_audit].reverse().slice(0, limit);
  }

  async attachEvidence(problemId: string, evidence: EvidenceObject): Promise<void> {
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

  async listEvidence(problemId: string): Promise<EvidenceObject[]> {
    const db = readDevDb();
    const p = db.problems.find((x) => x.problem_id === problemId);
    if (!p) return [];
    return db.evidence.filter((e) => p.evidence_ids.includes(e.evidence_id));
  }

  async savePacket(packet: JobPacket): Promise<void> {
    updateDevDb((db) => {
      db.packets.push(packet);
    });
  }
}

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
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
