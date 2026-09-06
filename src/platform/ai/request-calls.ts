import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPolicySetting } from "@/platform/policy/store";
import { fileStoreForced } from "@/platform/db/client";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";

export interface RequestCallIdentity {
  /** Server-issued journey identity, never a client-supplied budget key. */
  request_id: string;
  tenant_id: string;
}

export interface RequestCallPolicy {
  key: "intake.max_ai_calls_per_request";
  version: number;
  max_calls: number;
}

export interface RequestCallReservation {
  id: string;
  capability: string;
  policy_version: number;
  used: number;
  max_calls: number;
}

/** One reservation admits at most ONE HTTP attempt. No refunds: a crash,
 * timeout, provider error or even an explicit zero-attempt provider refusal
 * conservatively consumes the admission. Repair turns need another admission.
 * Implementations must serialize across every process sharing the store.
 * There is deliberately no shared/serverless adapter in this build. */
export interface RequestCallLedger {
  reserve(identity: RequestCallIdentity, policy: RequestCallPolicy, capability: string): Promise<RequestCallReservation | null>;
}

export function requestCallPolicy(): RequestCallPolicy {
  const setting = getPolicySetting<number>("intake.max_ai_calls_per_request");
  if (!setting || !Number.isSafeInteger(setting.value) || setting.value < 0 ||
      !Number.isSafeInteger(setting.version) || setting.version < 1) {
    throw new Error("Request model-call policy is unavailable");
  }
  return { key: "intake.max_ai_calls_per_request", version: setting.version, max_calls: setting.value };
}

function canonicalId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

export function validRequestCallIdentity(value: Partial<RequestCallIdentity>): value is RequestCallIdentity {
  return canonicalId(value.request_id) && canonicalId(value.tenant_id);
}

/** A local disk is not a shared serverless counter. Never substitute /tmp. */
export function requestCallsRequireSharedStore(): boolean {
  // Merely lacking database credentials does not opt a runtime into local
  // durability. Local model work must explicitly use the existing file mode.
  return !fileStoreForced() || Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY || process.env.K_SERVICE || process.env.NEXT_RUNTIME === "edge" ||
    process.env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda"));
}

interface RequestCallFile {
  schema_version: 1;
  identity_hash: string;
  reservations: RequestCallReservation[];
}

/** Local persistent adapter. Counters never reset at midnight or expire with
 * the daily spend ledger. A missing initialized file is an unavailable budget,
 * not a new one. Runtime data contains hashed identities and admission facts,
 * never homeowner text, media, credentials or prompts. */
export class FileRequestCallLedger implements RequestCallLedger {
  constructor(private readonly root = join(
    process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data", "runtime"),
    "request-ai-calls",
  )) {}

  async reserve(identity: RequestCallIdentity, policy: RequestCallPolicy, capability: string): Promise<RequestCallReservation | null> {
    if (requestCallsRequireSharedStore()) throw new Error("A shared request-call store is required in this runtime");
    if (!validRequestCallIdentity(identity) || policy.key !== "intake.max_ai_calls_per_request" || !Number.isSafeInteger(policy.max_calls) || policy.max_calls < 0 ||
        !Number.isSafeInteger(policy.version) || policy.version < 1 || !capability) {
      throw new Error("Invalid request-call admission");
    }
    const hash = createHash("sha256").update(JSON.stringify([identity.tenant_id, identity.request_id])).digest("hex");
    const target = join(this.root, `${hash}.json`);
    return withFileLock(target, () => {
      const marker = `${target}.initialized`;
      let state: RequestCallFile;
      try {
        const raw = readFileSync(target, "utf8");
        // Adopt old state before parsing, so damaged history cannot later turn
        // into a fresh allowance merely by disappearing.
        if (!existsSync(marker)) writeFileAtomic(marker, "request-ai-calls-v1\n");
        state = JSON.parse(raw) as RequestCallFile;
        if (!state || state.schema_version !== 1 || state.identity_hash !== hash || !Array.isArray(state.reservations) ||
            state.reservations.length === 0 || // this writer never persists an empty initialized history
            state.reservations.some((r, index) => !r || typeof r.id !== "string" || !r.id ||
              typeof r.capability !== "string" || !r.capability || r.used !== index + 1 ||
              !Number.isSafeInteger(r.max_calls) || r.max_calls < r.used ||
              !Number.isSafeInteger(r.policy_version) || r.policy_version < 1) ||
            new Set(state.reservations.map(r => r.id)).size !== state.reservations.length) {
          throw new Error("Invalid request-call history");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || existsSync(marker)) throw error;
        state = { schema_version: 1, identity_hash: hash, reservations: [] };
      }
      if (state.reservations.length >= policy.max_calls) return null;
      const reservation: RequestCallReservation = {
        id: randomUUID(), capability, policy_version: policy.version,
        used: state.reservations.length + 1, max_calls: policy.max_calls,
      };
      state.reservations.push(reservation);
      // Marker first: an interrupted first write fails closed on the next call.
      if (!existsSync(marker)) writeFileAtomic(marker, "request-ai-calls-v1\n");
      writeFileAtomic(target, JSON.stringify(state) + "\n");
      return reservation;
    });
  }
}
