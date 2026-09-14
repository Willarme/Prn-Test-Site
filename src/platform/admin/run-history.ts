import { opendir, open, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { serviceClientProvider, type PlatformClientProvider } from "@/platform/db/client";
import { AgentRunRecord, recentAgentRuns } from "@/platform/runs/ledger";

export interface RunObservation {
  run_id: string;
  agent_id: string;
  trigger: string;
  created_at: string;
  provider: string | null;
  model: string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  error_count: number;
  capability_count: number;
}
export interface RunHistory {
  rows: RunObservation[];
  state: "available" | "partial" | "unavailable";
  source: "database" | "local receipts" | "process buffer";
  scanned: number;
  skipped: number;
  limit: number;
  observed_at: string;
}

/** Explicit projection: never expose arbitrary outputs, errors, inputs or private evidence. */
export function projectRun(record: AgentRunRecord): RunObservation {
  return {
    run_id: record.run_id, agent_id: record.agent_id, trigger: record.trigger,
    created_at: record.created_at, provider: record.tool_provider?.slice(0, 100) ?? null,
    model: record.tool_model_version?.slice(0, 160) ?? null,
    cost_usd: Number.isFinite(record.cost_usd) && record.cost_usd! >= 0 ? record.cost_usd! : null,
    latency_ms: Number.isFinite(record.latency_ms) && record.latency_ms! >= 0 ? record.latency_ms! : null,
    error_count: record.errors?.length ?? 0, capability_count: record.capabilities_used.length,
  };
}

async function readReceipt(filename: string): Promise<unknown> {
  const file = await open(filename, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 256_000) throw new Error("invalid receipt size");
    // Bound the actual read too, so a changing file cannot turn a stat check
    // into an unbounded allocation. Read one extra byte to detect overflow.
    const bytes = Buffer.alloc(256_001);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > 256_000) throw new Error("receipt too large");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } finally { await file.close(); }
}

/** Bounded durable read. A truncated scan says partial, never complete history. */
export async function readRunHistory(
  limit = 80,
  clientProvider: PlatformClientProvider = serviceClientProvider,
  fileRoot?: string,
): Promise<RunHistory> {
  const bounded = Math.max(1, Math.min(200, Math.floor(limit) || 80));
  const result: RunHistory = {
    rows: [], state: "available", source: "database", scanned: 0, skipped: 0,
    limit: bounded, observed_at: new Date().toISOString(),
  };
  try {
    const client = clientProvider();
    if (client) {
      const { data, error } = await client.from("agent_run_ledger").select(
        "run_id,agent_id,trigger_kind,created_at,tool_provider,tool_model_version,cost_usd,latency_ms,errors,capabilities_used",
      ).order("created_at", { ascending: false }).limit(bounded + 1);
      if (error || !Array.isArray(data)) throw new Error("run history unavailable");
      for (const row of data) {
        result.scanned++;
        if (!row || typeof row !== "object") { result.skipped++; continue; }
        const parsed = AgentRunRecord.safeParse({
          ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)),
          trigger: row.trigger_kind, input_ids: [], outputs_summary: null,
        });
        if (parsed.success && Number.isFinite(Date.parse(parsed.data.created_at))) result.rows.push(projectRun(parsed.data));
        else result.skipped++;
      }
    } else if (fileRoot || process.env.PRN_RUNTIME_STORE === "file") {
      result.source = "local receipts";
      const root = fileRoot ?? join(process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data/runtime"), "agent-runs");
      let directory;
      try {
        const stat = await lstat(root);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("invalid receipt directory");
        directory = await opendir(root);
      }
      catch (error) {
        // Absence cannot prove that an established receipt directory was
        // never removed. A real, empty directory is the verified-empty case.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...result, state: "partial" };
        throw error;
      }
      let entries = 0;
      for await (const entry of directory) {
        if (++entries > 2000) { result.state = "partial"; break; }
        if (!/^ar_[a-zA-Z0-9_-]+\.json$/.test(entry.name) || !entry.isFile()) { result.skipped++; continue; }
        result.scanned++;
        try {
          const filename = join(root, entry.name);
          const stat = await lstat(filename);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256_000) { result.skipped++; continue; }
          const parsed = AgentRunRecord.safeParse(await readReceipt(filename));
          if (parsed.success && `${parsed.data.run_id}.json` === entry.name && Number.isFinite(Date.parse(parsed.data.created_at))) result.rows.push(projectRun(parsed.data));
          else result.skipped++;
        } catch { result.skipped++; }
      }
    } else {
      result.source = "process buffer";
      result.state = "partial";
      result.rows = recentAgentRuns().map(projectRun);
      result.scanned = result.rows.length;
    }
    result.rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    if (result.rows.length > bounded) result.state = "partial";
    result.rows = result.rows.slice(0, bounded);
    if (result.skipped) result.state = "partial";
    return result;
  } catch {
    return { ...result, rows: [], state: "unavailable" };
  }
}
