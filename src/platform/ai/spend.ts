import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";
import { join } from "node:path";
import { TEST_FIGURE_LABEL } from "@/platform/ai/models";

/**
 * THE DAY'S SPEND — persisted, because a budget a restart resets is not a budget.
 *
 * This is the one piece of A00's fail-soft doctrine that had to be argued with.
 * Every platform write in this repo is fail-soft by contract: a missing table is
 * logged and the caller proceeds. That is right for telemetry and right for the
 * run ledger — losing an audit row must never break a homeowner's intake. It is
 * WRONG for a spend counter. A swallowed spend write means the next call reads a
 * total that is too low, and a cap that fails open is worse than no cap, because
 * it reports a number the owner believes. A09's build made the same argument
 * about quarantine writes and reached the same conclusion.
 *
 * So the durable record is a FILE, not a table:
 *   - data/runtime/ is already the repo's home for local runtime state and is
 *     already gitignored, so a spend record is never committed;
 *   - a file survives a process restart, which a table written-but-not-applied
 *     (migrations 00006+) does not;
 *   - and it has no dependency on a database nobody has provisioned yet.
 *
 * ⚠ THE SERVERLESS CAVEAT, said plainly rather than papered over. On Vercel the
 * repo tree is read-only and the writable path is /tmp, which is per-instance and
 * ephemeral. So on a serverless deployment this ledger bounds spend PER INSTANCE
 * between cold starts, not globally. That is a real limit and it is why
 * `SpendLedger` is an interface: a shared-store implementation drops in without
 * touching callModel. TODO-ASK-OWNER (Joshua): a global cap in a serverless
 * deployment needs a shared counter — the natural home is the `ai_spend` table,
 * once migrations are actually applied to a live database.
 *
 * EVERY FIGURE HERE IS TEST — it is PRN-derived spend, not a vendor quote.
 */

export interface DailySpend {
  /** YYYY-MM-DD, UTC. */
  day: string;
  /** TEST. Total recorded spend for the day, all capabilities. */
  total_usd: number;
  /** TEST. Per-capability totals. */
  by_capability: Record<string, number>;
  calls: number;
  /** Always TEST — see the header. */
  figure_label: string;
}

export interface SpendLedger {
  read(day: string): Promise<DailySpend>;
  /** Append one call's cost and return the day's NEW totals. */
  record(day: string, capability: string, usd: number): Promise<DailySpend>;
  /** Older accounting-only ledgers remain readable; callModel refuses to spend
   * through one until it supplies atomic admission and settlement. */
  reserve?(input: SpendAdmission): Promise<SpendReservation | null>;
  settle?(reservation: SpendReservation, actualUsd: number, uncertainUsd: number, countCall?: boolean): Promise<DailySpend>;
}

export interface SpendAdmission {
  day: string;
  capability: string;
  usd: number;
  global_cap_usd: number;
  capability_cap_usd: number;
  /** A caller that enforces the returned ceiling may use the smaller remaining
   * daily allowance. It must not assume the requested amount was granted. */
  allow_partial?: boolean;
}

export interface SpendReservation {
  id: string;
  day: string;
  capability: string;
  usd: number;
}

interface ReservationRow {
  capability: string;
  usd: number;
  held_usd: number;
  settled_usd?: number;
  counted?: boolean;
}

export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

function emptyDay(day: string): DailySpend {
  return { day, total_usd: 0, by_capability: {}, calls: 0, figure_label: TEST_FIGURE_LABEL };
}

/** How many days of history the file keeps. Enough to answer "what did last week cost". */
const RETAIN_DAYS = 45;

type SpendFile = Record<string, {
  total_usd: number;
  by_capability: Record<string, number>;
  calls: number;
  reservations?: Record<string, ReservationRow>;
}>;

function money(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("invalid spend amount");
  return Math.max(0, Math.ceil(value * 1e6 - 1e-9) / 1e6);
}

function snapshot(file: SpendFile, day: string): DailySpend {
  const row = file[day];
  return row ? { day, total_usd: row.total_usd, by_capability: { ...row.by_capability }, calls: row.calls, figure_label: TEST_FIGURE_LABEL } : emptyDay(day);
}

/** Pending calls and uncertain completed calls do not expire at midnight or
 * after a crash. Every admission counts all held amounts until reconciled. */
function reserveIn(file: SpendFile, input: SpendAdmission): SpendReservation | null {
  let usd = money(input.usd);
  money(input.global_cap_usd);
  money(input.capability_cap_usd);
  const globalCap = input.global_cap_usd;
  const capabilityCap = input.capability_cap_usd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || !input.capability) throw new Error("invalid spend admission");
  const row = file[input.day] ?? { total_usd: 0, by_capability: {}, calls: 0 };
  let held = 0;
  let capabilityHeld = 0;
  for (const day of Object.values(file)) {
    for (const r of Object.values(day.reservations ?? {})) {
      held += r.held_usd;
      if (r.capability === input.capability) capabilityHeld += r.held_usd;
    }
  }
  const total = money(row.total_usd + held);
  const capabilityTotal = money((row.by_capability[input.capability] ?? 0) + capabilityHeld);
  if (input.allow_partial) {
    const available = Math.floor((Math.min(globalCap - total, capabilityCap - capabilityTotal) + 1e-10) * 1e6) / 1e6;
    if (available <= 0) return null;
    usd = Math.min(usd, available);
  }
  if (total >= globalCap || capabilityTotal >= capabilityCap ||
      money(total + usd) > globalCap || money(capabilityTotal + usd) > capabilityCap) return null;
  const reservation = { id: randomUUID(), day: input.day, capability: input.capability, usd };
  row.reservations ??= {};
  row.reservations[reservation.id] = { capability: input.capability, usd, held_usd: usd };
  file[input.day] = row;
  return reservation;
}

function settleIn(file: SpendFile, reservation: SpendReservation, actualUsd: number, uncertainUsd: number, countCall: boolean): DailySpend {
  const actual = money(actualUsd);
  const held = money(uncertainUsd);
  const row = file[reservation.day];
  const saved = row?.reservations?.[reservation.id];
  if (!saved || saved.capability !== reservation.capability || saved.usd !== reservation.usd || held > saved.usd) {
    throw new Error("invalid spend reservation");
  }
  if (saved.settled_usd !== undefined) {
    if (saved.settled_usd !== actual || saved.held_usd !== held || saved.counted !== countCall) throw new Error("spend reservation already settled differently");
    return snapshot(file, reservation.day);
  }
  row.total_usd = money(row.total_usd + actual);
  row.by_capability[saved.capability] = money((row.by_capability[saved.capability] ?? 0) + actual);
  if (countCall) row.calls += 1;
  saved.held_usd = held;
  saved.settled_usd = actual;
  saved.counted = countCall;
  return snapshot(file, reservation.day);
}

export const AI_SPEND_PATH = join(process.cwd(), "data", "runtime", "ai-spend.json");

export class FileSpendLedger implements SpendLedger {
  /**
   * Serializes same-process writes; the file lock also protects other processes.
   * Admission, settlement and accounting share the same cross-process lock.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string = AI_SPEND_PATH) {}

  private target(): string {
    return process.env.VERCEL ? "/tmp/prn-runtime/ai-spend.json" : this.filePath;
  }

  private load(): SpendFile {
    const marker = `${this.target()}.initialized`;
    let raw: string;
    try {
      raw = readFileSync(this.target(), "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !existsSync(marker)) return {};
      throw error; // unknown spend cannot authorize another billed call
    }
    // The caller holds the ledger lock. Adopt existing history before parsing:
    // even damaged history must not become a fresh budget if it disappears.
    // Marker-write faults must propagate; they are never a first-use read.
    if (!existsSync(marker)) writeFileAtomic(marker, "spend-ledger-v1\n");
    const parsed = JSON.parse(raw) as SpendFile;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid spend ledger");
    for (const row of Object.values(parsed)) {
      if (!row || !Number.isFinite(row.total_usd) || row.total_usd < 0 || !Number.isSafeInteger(row.calls) || row.calls < 0 ||
          !row.by_capability || typeof row.by_capability !== "object" || Object.values(row.by_capability).some(n => !Number.isFinite(n) || n < 0)) {
        throw new Error("invalid spend ledger row");
      }
      if (row.reservations !== undefined) {
        if (!row.reservations || typeof row.reservations !== "object" || Array.isArray(row.reservations)) throw new Error("invalid spend reservations");
        for (const r of Object.values(row.reservations)) {
          if (!r || typeof r.capability !== "string" || !r.capability || !Number.isFinite(r.usd) || r.usd < 0 ||
              !Number.isFinite(r.held_usd) || r.held_usd < 0 || r.held_usd > r.usd ||
              (r.settled_usd !== undefined && (!Number.isFinite(r.settled_usd) || r.settled_usd < 0 || typeof r.counted !== "boolean"))) {
            throw new Error("invalid spend reservation");
          }
        }
      }
    }
    return parsed;
  }

  async read(day: string): Promise<DailySpend> {
    const file = withFileLock(this.target(), () => this.load());
    const row = file[day];
    if (!row) return emptyDay(day);
    return {
      day,
      total_usd: row.total_usd,
      by_capability: { ...row.by_capability },
      calls: row.calls,
      figure_label: TEST_FIGURE_LABEL,
    };
  }

  private persist(file: SpendFile): void {
    const keys = Object.keys(file).sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - RETAIN_DAYS))) {
      // An old unresolved reservation is still money at risk, not free history.
      if (!Object.values(file[key].reservations ?? {}).some(r => r.held_usd > 0 || r.settled_usd === undefined)) delete file[key];
    }
    const path = this.target();
    if (!existsSync(`${path}.initialized`)) writeFileAtomic(`${path}.initialized`, "spend-ledger-v1\n");
    writeFileAtomic(path, JSON.stringify(file, null, 2) + "\n");
  }

  async reserve(input: SpendAdmission): Promise<SpendReservation | null> {
    return withFileLock(this.target(), () => {
      const file = this.load();
      const reservation = reserveIn(file, input);
      if (reservation) this.persist(file);
      return reservation;
    });
  }

  async settle(reservation: SpendReservation, actualUsd: number, uncertainUsd: number, countCall = true): Promise<DailySpend> {
    return withFileLock(this.target(), () => {
      const file = this.load();
      const result = settleIn(file, reservation, actualUsd, uncertainUsd, countCall);
      this.persist(file);
      return result;
    });
  }

  async record(day: string, capability: string, usd: number): Promise<DailySpend> {
    money(usd);
    const run = this.queue.then(() => withFileLock(this.target(), () => {
      const file = this.load();
      const row = file[day] ?? { total_usd: 0, by_capability: {}, calls: 0 };
      row.total_usd = Math.round((row.total_usd + usd) * 1e6) / 1e6;
      row.by_capability[capability] =
        Math.round(((row.by_capability[capability] ?? 0) + usd) * 1e6) / 1e6;
      row.calls += 1;
      file[day] = row;

      this.persist(file);

      return {
        day,
        total_usd: row.total_usd,
        by_capability: { ...row.by_capability },
        calls: row.calls,
        figure_label: TEST_FIGURE_LABEL,
      };
    }));
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** In-memory ledger for tests. Same contract, no disk. */
export class MemorySpendLedger implements SpendLedger {
  private days = new Map<string, DailySpend>();
  private reservations: SpendFile = {};

  async reserve(input: SpendAdmission): Promise<SpendReservation | null> {
    for (const [day, row] of this.days) {
      this.reservations[day] = { ...row, by_capability: { ...row.by_capability }, reservations: this.reservations[day]?.reservations };
    }
    return reserveIn(this.reservations, input);
  }

  async settle(reservation: SpendReservation, actualUsd: number, uncertainUsd: number, countCall = true): Promise<DailySpend> {
    const existing = this.days.get(reservation.day);
    if (existing) Object.assign(this.reservations[reservation.day], { ...existing, by_capability: { ...existing.by_capability } });
    const result = settleIn(this.reservations, reservation, actualUsd, uncertainUsd, countCall);
    this.days.set(reservation.day, result);
    return { ...result, by_capability: { ...result.by_capability } };
  }

  async read(day: string): Promise<DailySpend> {
    const found = this.days.get(day);
    return found ? { ...found, by_capability: { ...found.by_capability } } : emptyDay(day);
  }

  async record(day: string, capability: string, usd: number): Promise<DailySpend> {
    money(usd);
    const current = this.days.get(day) ?? emptyDay(day);
    const next: DailySpend = {
      day,
      total_usd: Math.round((current.total_usd + usd) * 1e6) / 1e6,
      by_capability: {
        ...current.by_capability,
        [capability]: Math.round(((current.by_capability[capability] ?? 0) + usd) * 1e6) / 1e6,
      },
      calls: current.calls + 1,
      figure_label: TEST_FIGURE_LABEL,
    };
    this.days.set(day, next);
    return { ...next, by_capability: { ...next.by_capability } };
  }
}

let active: SpendLedger | null = null;

export function spendLedger(): SpendLedger {
  if (!active) active = new FileSpendLedger();
  return active;
}

/** Test seam. */
export function setSpendLedgerForTests(ledger: SpendLedger | null): void {
  active = ledger;
}
