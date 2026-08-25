import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
}

export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

function emptyDay(day: string): DailySpend {
  return { day, total_usd: 0, by_capability: {}, calls: 0, figure_label: TEST_FIGURE_LABEL };
}

/** How many days of history the file keeps. Enough to answer "what did last week cost". */
const RETAIN_DAYS = 45;

type SpendFile = Record<string, { total_usd: number; by_capability: Record<string, number>; calls: number }>;

export const AI_SPEND_PATH = join(process.cwd(), "data", "runtime", "ai-spend.json");

export class FileSpendLedger implements SpendLedger {
  /**
   * Serializes read-modify-write so two concurrent calls in one process cannot
   * both read the same total and each write it back plus their own cost — which
   * is precisely how a cap gets overshot by exactly one call.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string = AI_SPEND_PATH) {}

  private target(): string {
    return process.env.VERCEL ? "/tmp/prn-runtime/ai-spend.json" : this.filePath;
  }

  private async load(): Promise<SpendFile> {
    try {
      const raw = await readFile(this.target(), "utf-8");
      const parsed = JSON.parse(raw) as SpendFile;
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      // A missing or unreadable file reads as ZERO SPEND, which is the only
      // number it can honestly report — and the caller's cap still applies to
      // every call it is about to make.
      return {};
    }
  }

  async read(day: string): Promise<DailySpend> {
    const file = await this.load();
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

  async record(day: string, capability: string, usd: number): Promise<DailySpend> {
    const run = this.queue.then(async () => {
      const file = await this.load();
      const row = file[day] ?? { total_usd: 0, by_capability: {}, calls: 0 };
      row.total_usd = Math.round((row.total_usd + usd) * 1e6) / 1e6;
      row.by_capability[capability] =
        Math.round(((row.by_capability[capability] ?? 0) + usd) * 1e6) / 1e6;
      row.calls += 1;
      file[day] = row;

      for (const key of Object.keys(file).sort().slice(0, Math.max(0, Object.keys(file).length - RETAIN_DAYS))) {
        delete file[key];
      }

      const path = this.target();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(file, null, 2) + "\n", "utf-8");

      return {
        day,
        total_usd: row.total_usd,
        by_capability: { ...row.by_capability },
        calls: row.calls,
        figure_label: TEST_FIGURE_LABEL,
      };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** In-memory ledger for tests. Same contract, no disk. */
export class MemorySpendLedger implements SpendLedger {
  private days = new Map<string, DailySpend>();

  async read(day: string): Promise<DailySpend> {
    const found = this.days.get(day);
    return found ? { ...found, by_capability: { ...found.by_capability } } : emptyDay(day);
  }

  async record(day: string, capability: string, usd: number): Promise<DailySpend> {
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
