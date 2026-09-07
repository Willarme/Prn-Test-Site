import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { StoredPrintedEvidence, type PrintedEvidenceResult } from "@/domain/problem/printed-evidence";
import { printedAnswers, printedKeysForTarget } from "@/domain/intake/printed-readings";
import { requestScopedClient, requireServiceClient } from "@/platform/db/client";
import { runtimeStore } from "@/platform/stores/runtime";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";

/** Completion metadata is separate from printable answer values. Only bounded
 * typed OCR fields and gaps are kept; raw transcripts and images are rejected.
 * Legacy local records can omit tenant/status; every new record is tenant-bound.
 */
export interface LabelConfidenceRecord {
  request_id: string;
  tenant_id?: string;
  evidence_id: string;
  read_at: string;
  run_id: string | null;
  confidence: Record<string, "high" | "medium" | "low">;
  extraction_status?: "readable" | "unreadable" | "failed";
  reason?: string;
  printed_evidence?: PrintedEvidenceResult;
  target?: string;
}

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const schema = z.object({
  request_id: identifier, tenant_id: identifier.optional(), evidence_id: identifier,
  read_at: z.string().datetime(), run_id: z.string().min(1).max(160).nullable(),
  confidence: z.record(z.string().regex(/^[a-zA-Z0-9_]{1,80}$/), z.enum(["high", "medium", "low"]))
    .refine(value => Object.keys(value).length <= 32),
  extraction_status: z.enum(["readable", "unreadable", "failed"]).optional(),
  reason: z.string().max(500).optional(), printed_evidence: StoredPrintedEvidence.optional(),
  target: z.string().regex(/^[a-zA-Z0-9_:-]{1,80}$/).optional(),
}).strict();

function validRecord(value: unknown, requestId: string, tenantId: string, shared: boolean): value is LabelConfidenceRecord {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return false;
  const record = parsed.data;
  if (record.request_id !== requestId || (record.tenant_id ?? DEFAULT_TENANT_ID) !== tenantId ||
    shared && (record.tenant_id !== tenantId || !record.extraction_status)) return false;
  if (record.printed_evidence) {
    if (!record.target || !printedKeysForTarget(record.target).length || record.printed_evidence.evidence_id !== record.evidence_id) return false;
    const projection = printedAnswers(record.target, record.printed_evidence);
    if (projection.extraction_status !== record.extraction_status ||
      JSON.stringify(Object.entries(projection.confidence).sort()) !== JSON.stringify(Object.entries(record.confidence).sort())) return false;
  }
  return record.extraction_status !== "failed" && record.extraction_status !== "unreadable" || Object.keys(record.confidence).length === 0;
}

function hosted(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY ||
    process.env.K_SERVICE || process.env.NEXT_RUNTIME === "edge" || process.env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda"));
}

async function context(requestId: string, evidenceId?: string) {
  identifier.parse(requestId);
  if (evidenceId !== undefined) identifier.parse(evidenceId);
  const store = runtimeStore();
  // A forced local override must not accidentally permit ephemeral production
  // writes. Missing shared storage is an explicit unavailable result.
  if (hosted() && store.kind !== "supabase") throw new Error("Shared extraction completion storage is required");
  const journey = await store.getJourney(requestId);
  if (!journey || journey.session.request_id !== requestId) throw new Error("Extraction request ownership mismatch");
  const tenantId = identifier.parse(journey.problem.tenant_id ?? DEFAULT_TENANT_ID);
  const evidence = await store.listEvidence(journey.problem.problem_id, requestId);
  const photos = new Set(evidence.filter(item => item.kind === "photo" &&
    (item.tenant_id ?? DEFAULT_TENANT_ID) === tenantId && (store.kind === "supabase"
      // The relational request owner remains authoritative after concurrent
      // attachments lose an id from the problem's denormalized array.
      ? "request_id" in item && item.request_id === requestId
      : journey.problem.evidence_ids.includes(item.evidence_id))).map(item => item.evidence_id));
  if (evidenceId !== undefined && !photos.has(evidenceId)) throw new Error("Extraction evidence ownership mismatch");
  return { tenantId, photos, shared: store.kind === "supabase" };
}

function filePath(requestId: string): string {
  return join(process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data", "runtime"), "label-reads", `${requestId}.json`);
}

function localRead(requestId: string, tenantId: string): LabelConfidenceRecord[] {
  const path = filePath(requestId);
  const records: LabelConfidenceRecord[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) records.push(...parsed.filter(record => validRecord(record, requestId, tenantId, false)));
  } catch { /* Independent atomic completions can recover an aggregate miss. */ }
  try {
    const prefix = `${basename(path)}.`;
    const suffix = ".completion.json";
    for (const entry of readdirSync(dirname(path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(suffix)) continue;
      const evidenceId = entry.name.slice(prefix.length, -suffix.length);
      if (!identifier.safeParse(evidenceId).success) continue;
      try {
        const record: unknown = JSON.parse(readFileSync(join(dirname(path), entry.name), "utf8"));
        if (validRecord(record, requestId, tenantId, false) && record.evidence_id === evidenceId && record.extraction_status) records.push(record);
      } catch { /* Malformed data establishes no completed extraction. */ }
    }
  } catch { /* A missing directory establishes no completed extraction. */ }
  const latest = new Map<string, LabelConfidenceRecord>();
  for (const record of records) {
    const held = latest.get(record.evidence_id);
    if (!held || Date.parse(record.read_at) > Date.parse(held.read_at)) latest.set(record.evidence_id, record);
  }
  return [...latest.values()].sort((a, b) => Date.parse(a.read_at) - Date.parse(b.read_at));
}

/** Atomic admission per saved photo, shared across serverless instances. A
 * crashed attempt stays consumed; a new accepted capture may try again. */
export async function reserveLabelAttempt(requestId: string, evidenceId: string): Promise<boolean> {
  try {
    const ctx = await context(requestId, evidenceId);
    if (ctx.shared) {
      // Reader execution is a server decision; clients cannot reserve or forge
      // completions themselves. RPC checks request + tenant + saved photo again.
      const { data, error } = await requireServiceClient().rpc("reserve_label_extraction", {
        p_request_id: requestId, p_tenant_id: ctx.tenantId, p_evidence_id: evidenceId,
      });
      if (error || typeof data !== "boolean") return false;
      return data;
    }
    const file = `${filePath(requestId)}.${evidenceId}.attempt`;
    return withFileLock(file, () => {
      if (existsSync(file)) return false;
      writeFileAtomic(file, new Date().toISOString());
      return true;
    });
  } catch { return false; }
}

/** Save completion BEFORE derived answers. Shared failures never fall back to
 * disk. Identical retries are idempotent; a different result cannot overwrite
 * the completion for the same captured evidence. */
export async function writeLabelConfidence(input: LabelConfidenceRecord): Promise<boolean> {
  try {
    const ctx = await context(input.request_id, input.evidence_id);
    const record = { ...input, tenant_id: input.tenant_id ?? ctx.tenantId };
    if (!validRecord(record, input.request_id, ctx.tenantId, true)) return false;
    if (ctx.shared) {
      const { data, error } = await requireServiceClient().rpc("complete_label_extraction", {
        p_request_id: record.request_id, p_tenant_id: ctx.tenantId, p_evidence_id: record.evidence_id, p_record: record,
      });
      return !error && data === true;
    }
    const path = filePath(record.request_id);
    try {
      return withFileLock(path, () => {
        const existing = localRead(record.request_id, ctx.tenantId);
        const prior = existing.find(item => item.evidence_id === record.evidence_id);
        if (prior) return JSON.stringify(prior) === JSON.stringify(record);
        writeFileAtomic(path, JSON.stringify([...existing, record]));
        return true;
      });
    } catch {
      const fallback = `${path}.${record.evidence_id}.completion.json`;
      return withFileLock(fallback, () => {
        if (existsSync(fallback)) return JSON.stringify(JSON.parse(readFileSync(fallback, "utf8"))) === JSON.stringify(record);
        writeFileAtomic(fallback, JSON.stringify(record));
        return true;
      });
    }
  } catch { return false; }
}

/** Completed outcomes, including explicit gaps, oldest first. Shared read
 * errors throw so callers cannot mistake an outage for a successful read. */
export async function readLabelReadings(requestId: string): Promise<LabelConfidenceRecord[] | null> {
  if (!identifier.safeParse(requestId).success) return null;
  const ctx = await context(requestId);
  if (!ctx.photos.size) return null;
  let records: LabelConfidenceRecord[];
  if (ctx.shared) {
    const db = requestScopedClient(requestId) ?? requireServiceClient();
    const { data, error } = await db.from("label_extraction_completion").select("record")
      .eq("request_id", requestId).eq("tenant_id", ctx.tenantId).not("record", "is", null).order("read_at", { ascending: true });
    if (error || !Array.isArray(data)) throw new Error("Shared extraction completion read unavailable");
    if (data.some(row => !validRecord(row.record, requestId, ctx.tenantId, true) || !ctx.photos.has(row.record.evidence_id))) {
      throw new Error("Invalid shared extraction completion");
    }
    records = data.map(row => row.record);
    if (new Set(records.map(record => record.evidence_id)).size !== records.length) throw new Error("Duplicate shared extraction completion");
  } else records = localRead(requestId, ctx.tenantId).filter(record => ctx.photos.has(record.evidence_id));
  return records.length ? records : null;
}

export async function readLabelConfidence(requestId: string): Promise<LabelConfidenceRecord[] | null> {
  const readable = (await readLabelReadings(requestId))?.filter(record =>
    record.extraction_status === undefined || record.extraction_status === "readable");
  return readable?.length ? readable : null;
}
