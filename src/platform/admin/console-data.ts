import { runtimeStore, type Journey } from "@/platform/stores/runtime";
import { loadOpportunities } from "@/platform/admin/data";
import { readApprovalSnapshot } from "@/platform/approvals/center";
import { qualityKpiSnapshot } from "@/platform/quality/kpi";
import { currentFindings, isUnresolved } from "@/platform/quality/issues";
import type { Severity } from "@/platform/quality/types";
import { activeQuarantineKeys, quarantineKey } from "@/platform/quality/quarantine";
import { publishQueueSnapshot } from "@/platform/search/page-qa-gate";
import { aiPolicyStore } from "@/platform/ai/policy-store";
import { DEFAULT_AI_POLICY, type AiPolicy } from "@/platform/ai/policy";
import { spendLedger, utcDay } from "@/platform/ai/spend";
import { readKillSwitchSnapshot } from "@/platform/killswitch";
import { readRunHistory } from "@/platform/admin/run-history";

export interface Observation<T> {
  value: T | null;
  state: "available" | "unavailable";
  source: string;
  observed_at: string;
}

/** A failed source must not erase unrelated operations or become a reassuring zero. */
export async function observe<T>(source: string, read: () => Promise<T>): Promise<Observation<T>> {
  try { return { value: await read(), state: "available", source, observed_at: new Date().toISOString() }; }
  catch { return { value: null, state: "unavailable", source, observed_at: new Date().toISOString() }; }
}

/** The runtime safely disables AI on unreadable policy; that is not a verified settings read. */
export async function observeAiPolicy(): Promise<Observation<AiPolicy>> {
  const observation = await observe("Active AI policy", () => aiPolicyStore().getActive());
  return observation.value === DEFAULT_AI_POLICY
    ? { ...observation, value: null, state: "unavailable", source: "Active AI policy unavailable; safe disabled defaults in use" }
    : observation;
}

async function readConsoleFindings() {
  // exceptionQueue intentionally returns [] on an outage for older callers.
  // This independent observation needs the strict read to preserve its state.
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return (await currentFindings()).filter(isUnresolved)
    .sort((a, b) => order[a.severity] - order[b.severity] || Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 8);
}

export function summarizeRecentRequests(journeys: readonly Journey[], keys: ReadonlySet<string>, total: number) {
  if (!Number.isSafeInteger(total) || total < journeys.length) throw new Error("Request cohort could not be verified");
  const included = journeys.filter(j => ![
    quarantineKey("problem_record", j.problem.problem_id),
    quarantineKey("job_packet", j.packet.job_packet_id),
    quarantineKey("intake_session", j.session.intake_session_id),
  ].some(key => keys.has(key)));
  return {
    included: included.length, inspected: journeys.length, withheld: journeys.length - included.length,
    total_recorded: total, scope: total > journeys.length ? "complete records in the recent session sample" : "all complete records",
    latest: included.map(j => j.session.entered_at).filter(at => Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
    packets: new Set(included.map(j => j.packet.job_packet_id)).size,
  };
}

export async function readConsoleSnapshot() {
  const runtime = await observe("Runtime store", async () => runtimeStore());
  const store = () => {
    if (!runtime.value) throw new Error("Runtime store is unavailable");
    return runtime.value;
  };
  const [requests, releases, approvals, quality, findings, policy, spend, switches, runs, audit, published] = await Promise.all([
    observe("Runtime records + A09 quarantine", async () => {
      const [journeys, keys, totals] = await Promise.all([store().listJourneys(100), activeQuarantineKeys(), store().totals()]);
      return summarizeRecentRequests(journeys, keys, totals.journeys);
    }),
    observe("A06 current release gate", () => publishQueueSnapshot()),
    observe("Approval Center", () => readApprovalSnapshot()),
    observe("A09 findings and quarantine", () => qualityKpiSnapshot()),
    observe("A09 unresolved findings", readConsoleFindings),
    observeAiPolicy(),
    observe(`AI spend ledger · ${utcDay()} UTC`, () => spendLedger().read(utcDay())),
    observe("Kill-switch state", () => readKillSwitchSnapshot()),
    observe("Agent run ledger", () => readRunHistory(80)),
    observe("Owner action audit · latest 12", () => store().listAudit(12)),
    observe("Published-page records", async () => (await store().getPublishedPageIds()).size),
  ]);
  const research = loadOpportunities();
  return {
    observed_at: new Date().toISOString(), storage: runtime.value?.kind ?? "unavailable",
    requests, releases, approvals, quality, findings, policy, spend, switches, runs, audit, published,
    research: { count: research.summary.total, generated_at: research.generated_at, needs_enrichment: research.summary.needs_enrichment },
  };
}
export type ConsoleSnapshot = Awaited<ReturnType<typeof readConsoleSnapshot>>;
export interface ConsoleAttention { id: string; title: string; detail: string; href: string; severity: "danger" | "warning" | "neutral" }

/** Triage of observed evidence, not an invented company-health score. */
export function consoleAttention(data: ConsoleSnapshot): ConsoleAttention[] {
  const items: ConsoleAttention[] = [];
  const stops = data.switches.value?.verified ? data.switches.value.states.filter(s => s.engaged) : [];
  if (stops.length) items.push({ id: "paused", severity: "danger", title: `${stops.length} agent circuit${stops.length === 1 ? " is" : "s are"} paused`, detail: "Inspect the recorded reason before resuming work.", href: "/admin/system#kill-switches" });
  const quality = data.quality.value;
  if (quality && !quality.read_failed && quality.critical_open) items.push({ id: "critical", severity: "danger", title: `${quality.critical_open} critical data finding${quality.critical_open === 1 ? "" : "s"}`, detail: "Inspect the affected record and repair evidence.", href: "#data-quality" });
  const unavailable = [data.requests, data.releases, data.approvals, data.quality, data.findings, data.policy, data.spend, data.switches, data.audit, data.published].some(o => o.state === "unavailable");
  const uncertain = Boolean(quality?.could_not_verify || data.approvals.value?.verified === false || data.switches.value?.verified === false);
  if (unavailable || uncertain) items.push({ id: "reads", severity: "warning", title: "Some operating evidence is unavailable", detail: "Affected panels are marked unknown. Review connections and refresh after recovery.", href: "/admin/connections" });
  const runs = data.runs.value;
  if (data.runs.state === "unavailable" || !runs || runs.state === "unavailable") {
    items.push({ id: "runs", severity: "warning", title: "Run receipts could not be read", detail: "Agent activity is unverified. Inspect the receipt source before relying on this history.", href: "/admin/agents" });
  } else if (runs.skipped > 0) {
    items.push({ id: "runs", severity: "warning", title: "Run receipt evidence is incomplete", detail: `${runs.skipped} unreadable or excluded entries were skipped. Inspect the available agent receipts; excluded entries are not successful runs.`, href: "/admin/agents" });
  } else if (runs.state === "partial") {
    // A capped, readable history is a scope limit, not a connection outage.
    const bounded = runs.source !== "process buffer" && runs.rows.length === runs.limit;
    items.push({ id: "runs", severity: "neutral", title: bounded ? "Run history is a bounded window" : "Run history has limited coverage",
      detail: bounded ? `This view includes up to ${runs.limit} readable receipts. Older or unscanned activity is outside this window.` : "Only the available receipt source is represented. This does not establish complete historical activity.", href: "/admin/agents" });
  }
  const pending = data.approvals.value?.verified ? data.approvals.value.items.filter(a => a.status === "PENDING").length : null;
  if (pending) items.push({ id: "decisions", severity: "warning", title: `${pending} review item${pending === 1 ? "" : "s"} waiting`, detail: "Inspect the exact proposal, evidence and execution boundary.", href: "/admin/approvals" });
  const held = data.releases.value?.filter(r => !r.decision.release_eligible).length;
  if (held) items.push({ id: "release", severity: "neutral", title: `${held} page version${held === 1 ? "" : "s"} held from release`, detail: "The current A06 gate names the missing evidence for each version.", href: "/admin/pages" });
  if (!items.length) items.push({ id: "clear", severity: "neutral", title: "No exception in the available checks", detail: "This is an operating snapshot. Customer outcomes and company health still need real trial evidence.", href: "/admin/requests" });
  return items;
}

export function formatObservationTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
