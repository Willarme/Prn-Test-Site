import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceObject, ProblemRecord } from "@/domain/problem/contracts";
import {
  cleanConsentEvent,
  cleanEventEnvelope,
  cleanJobPacket,
  cleanProblemRecord,
} from "@/platform/quality/fixtures";
import { applyQualityGuard } from "@/platform/quality/ingest";
import {
  currentFindings,
  qualityCounters,
  resetQualityCountersForTests,
} from "@/platform/quality/issues";
import {
  qualityFilteredJourneyTotals,
  qualityKpiSnapshot,
  resetQualityKpiForTests,
} from "@/platform/quality/kpi";
import { activeQuarantine } from "@/platform/quality/quarantine";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import {
  resetRuntimeStore,
  runtimeStore,
  unguardedRuntimeStore,
  type RecordJourneyInput,
  type RuntimeStore,
} from "@/platform/stores/runtime";
import { getPolicySetting } from "@/platform/policy/store";

/**
 * A09 §9 step 3 failable check, first half: "injecting a known-bad write
 * triggers an ingest-time issue within the same request cycle (no polling
 * delay)."
 *
 * And the constraint that makes it safe to run inline: the guard must be
 * incapable of changing what the customer sees or of breaking their journey.
 */

const noDb = () => null;
const AT = "2026-08-24T12:00:00Z";

function evidence(): EvidenceObject {
  return {
    evidence_id: "ev_clean_0001",
    kind: "customer_text",
    content: "fixture text",
    privacy: "private",
    captured_at: AT,
  };
}

function journey(problem: ProblemRecord = cleanProblemRecord()): RecordJourneyInput {
  return {
    session: {
      intake_session_id: "is_clean_0001",
      schema_version: "1.0.0",
      guest_session_id: "gs_clean_0001",
      request_id: "rq_clean_0001",
      attribution: {
        page_id: null,
        intent_cluster_id: null,
        search_opportunity_id: null,
        problem_family_hint: null,
        experiment_id: null,
        variant: null,
        referrer: null,
        landing_path: "/start",
      },
      consent_event_ids: ["ce_clean_0001"],
      entered_at: AT,
      intake_started_at: AT,
    },
    consent: cleanConsentEvent(),
    problem,
    evidence: evidence(),
    packet: cleanJobPacket(),
    events: [],
  };
}

function guarded(): RuntimeStore {
  return applyQualityGuard(unguardedRuntimeStore(), { clientProvider: noDb, enabled: true });
}

/**
 * A defect that leaves the journey's own joins intact — a blank id inside the
 * evidence list. Chosen deliberately for the "the write still happens" cases:
 * a record whose intake_session_id is null is unreadable through getJourney by
 * construction, which would prove nothing about whether A09 dropped it.
 */
function badProblem(): ProblemRecord {
  return cleanProblemRecord({ evidence_ids: ["ev_clean_0001", ""] });
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-ingest-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  resetRuntimeStore();
});

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a09-ingest-case-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  resetQualityCountersForTests();
  resetQualityKpiForTests();
  resetAgentRunLedgerForTests();
  resetRuntimeStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the guard is applied at the store boundary, not opted into", () => {
  it("runtimeStore() returns a guarded store — a new caller cannot bypass validation", async () => {
    resetRuntimeStore();
    const store = runtimeStore();
    await store.recordJourney(journey(cleanProblemRecord({ intake_session_id: null })));
    expect((await currentFindings({ clientProvider: noDb })).length).toBeGreaterThan(0);
  });

  it("delegates EVERY RuntimeStore method — a class instance's prototype is not lost", async () => {
    const store = guarded();
    const inner = unguardedRuntimeStore();
    for (const key of Object.keys(inner) as (keyof RuntimeStore)[]) {
      expect(store[key], String(key)).toBeDefined();
    }
    for (const method of [
      "ensureDisclosure",
      "getJourney",
      "listJourneys",
      "countEvents",
      "totals",
      "getPublishedPageIds",
      "setPublished",
      "listStagedSpecs",
      "appendAudit",
      "listAudit",
      "attachEvidence",
      "saveIntakeAnswers",
      "listIntakeAnswers",
      "saveDiagnosisAnswer",
      "listDiagnosisAnswers",
      "listEvidence",
      "savePacket",
      "recordJourney",
      "recordEvents",
    ] as const) {
      expect(typeof store[method], method).toBe("function");
    }
    // The passthroughs really do reach the backend.
    expect(await store.totals()).toEqual({ journeys: 0, packets: 0, consents: 0 });
  });
});

describe("a known-bad write is caught in the SAME request cycle", () => {
  it("raises a finding synchronously, with no polling delay", async () => {
    const store = guarded();
    await store.recordJourney(journey(cleanProblemRecord({ intake_session_id: null })));

    // No await on a queue, no timer: the finding exists the instant the write
    // call resolves.
    const findings = await currentFindings({ clientProvider: noDb });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule_id).toBe("problem_record.packet_ready_requires_session");
    expect(findings[0].source).toBe("ingest");
    expect(findings[0].severity).toBe("high");
    expect(findings[0].entity_id).toBe("pr_clean_0001");
  });

  it("quarantines the high-severity record it just caught", async () => {
    const store = guarded();
    await store.recordJourney(journey(cleanProblemRecord({ intake_session_id: null })));
    const markers = await activeQuarantine({ clientProvider: noDb });
    expect(markers).toHaveLength(1);
    expect(markers[0].entity_type).toBe("problem_record");
    expect(markers[0].entity_id).toBe("pr_clean_0001");
  });

  it("raises NOTHING for a clean journey — the guard is not an outage", async () => {
    const store = guarded();
    await store.recordJourney(journey());
    expect(await currentFindings({ clientProvider: noDb })).toEqual([]);
    expect(await activeQuarantine({ clientProvider: noDb })).toEqual([]);
    const snapshot = await qualityKpiSnapshot({ clientProvider: noDb });
    expect(snapshot.data_completeness_pass_rate).toBe(1);
    expect(snapshot.data_completeness_sample).toBe(4);
  });

  it("catches a bad packet on savePacket too", async () => {
    const store = guarded();
    await store.savePacket(cleanJobPacket({ packet_version: 0 }));
    const findings = await currentFindings({ clientProvider: noDb });
    expect(findings.map((f) => f.rule_id)).toContain("job_packet.version_positive");
  });
});

describe("the write still happens — A09 contains, it never rejects", () => {
  it("persists the bad record exactly as written; nothing is dropped", async () => {
    const store = guarded();
    const bad = badProblem();
    await store.recordJourney(journey(bad));
    const stored = await store.getJourney("rq_clean_0001");
    expect(stored).not.toBeNull();
    expect(stored!.problem.problem_id).toBe(bad.problem_id);
    // The damage is still there, verbatim — quarantine, never repair-on-write.
    expect(stored!.problem.evidence_ids).toEqual(["ev_clean_0001", ""]);
  });

  it("serves a quarantined record UNCHANGED on the customer read path", async () => {
    const store = guarded();
    await store.recordJourney(journey(badProblem()));
    expect(await activeQuarantine({ clientProvider: noDb })).toHaveLength(1);

    // /results and /complete read through getJourney. Wave 0 must not break a
    // live homeowner journey — pre-answer 10 is parked with Melissa, not
    // decided here.
    const journeyRow = await store.getJourney("rq_clean_0001");
    expect(journeyRow).not.toBeNull();
    expect(journeyRow!.packet.job_packet_id).toBe("jp_clean_0001");
    expect(getPolicySetting<boolean>("quality.quarantine_customer_reads")!.value).toBe(false);
  });

  it("REMOVES the quarantined journey from the KPI totals the cockpit renders", async () => {
    const store = guarded();
    await store.recordJourney(journey(badProblem()));
    const totals = await qualityFilteredJourneyTotals({ clientProvider: noDb });
    expect(totals.excluded_by_quarantine).toBe(1);
    expect(totals.journeys).toBe(0);
    expect(totals.packets).toBe(0);
    // The raw store still holds it — excluded from a count, never deleted.
    expect(await unguardedRuntimeStore().totals()).toMatchObject({ journeys: 1 });
  });

  it("counts a clean journey normally", async () => {
    const store = guarded();
    await store.recordJourney(journey());
    const totals = await qualityFilteredJourneyTotals({ clientProvider: noDb });
    expect(totals.excluded_by_quarantine).toBe(0);
    expect(totals.journeys).toBe(1);
  });
});

describe("the guard can never break a request", () => {
  it("swallows its own failure and still completes the customer write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exploding = () => {
      throw new Error("quality subsystem is broken");
    };
    const store = applyQualityGuard(unguardedRuntimeStore(), {
      clientProvider: exploding as never,
      enabled: true,
    });
    await expect(store.recordJourney(journey())).resolves.toBeUndefined();
    expect(await store.getJourney("rq_clean_0001")).not.toBeNull();
  });

  it("is switchable off, and then writes nothing of its own", async () => {
    const store = applyQualityGuard(unguardedRuntimeStore(), {
      clientProvider: noDb,
      enabled: false,
    });
    await store.recordJourney(journey(badProblem()));
    expect(await currentFindings({ clientProvider: noDb })).toEqual([]);
    expect(recentAgentRuns().filter((r) => r.agent_id === "A09")).toHaveLength(0);
    // ...and the customer write still landed.
    expect(await store.getJourney("rq_clean_0001")).not.toBeNull();
  });

  it("names the switch as configuration, not a constant", () => {
    expect(getPolicySetting<boolean>("quality.ingest_validation_enabled")!.value).toBe(true);
  });
});

describe("no recursion: A09 never validates its own telemetry", () => {
  it("skips its own six event names, so record -> emit -> record cannot loop", async () => {
    const store = guarded();
    await store.recordEvents([
      cleanEventEnvelope({ event_id: "ev_a09", event_name: "data_quality.issue_detected", context: { problem_id: "pr_nope" } }),
    ]);
    expect(await currentFindings({ clientProvider: noDb })).toEqual([]);
  });

  it("still validates everybody else's events", async () => {
    const store = guarded();
    await store.recordEvents([
      cleanEventEnvelope({ event_id: "ev_other", event_name: "problem.created", context: {} }),
    ]);
    // Nothing to resolve and nothing unregistered — clean, but it WAS checked.
    const snapshot = await qualityKpiSnapshot({ clientProvider: noDb });
    expect(snapshot.data_completeness_sample).toBe(1);
  });

  it("writes no ledger row per event — that would be unbounded amplification", async () => {
    const store = guarded();
    await store.recordEvents([cleanEventEnvelope({ event_id: "ev_1", context: {} })]);
    await store.recordEvents([cleanEventEnvelope({ event_id: "ev_2", context: {} })]);
    expect(recentAgentRuns().filter((r) => r.agent_id === "A09")).toHaveLength(0);
  });
});

describe("one Agent Run Ledger row per validation batch", () => {
  it("writes exactly one A09 row for one guarded journey write", async () => {
    const store = guarded();
    await store.recordJourney(journey());
    const runs = recentAgentRuns().filter((r) => r.agent_id === "A09");
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger).toBe("request");
    expect(runs[0].capabilities_used).toEqual(["quality.validate_ingest"]);
    expect(runs[0].tenant_id).toBe("prn");
    expect(runs[0].cost_usd).toBe(0);
    expect(runs[0].outputs_summary).toMatchObject({ verdict: "clean", subjects_checked: 4 });
  });

  it("reports findings_recorded, not clean, when something was caught", async () => {
    const store = guarded();
    await store.recordJourney(journey(cleanProblemRecord({ intake_session_id: null })));
    const run = recentAgentRuns().filter((r) => r.agent_id === "A09")[0];
    expect(run.outputs_summary).toMatchObject({ verdict: "findings_recorded", findings_created: 1 });
    expect(run.errors).toBeUndefined();
  });

  it("reports COULD_NOT_VERIFY, never clean, when its own write did not land", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = () =>
      ({
        from: () => ({
          insert: async () => ({ error: { message: "relation does not exist" } }),
          select: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "no" } }) }), limit: async () => ({ data: null, error: { message: "no" } }) }),
        }),
      }) as never;
    const store = applyQualityGuard(unguardedRuntimeStore(), {
      clientProvider: broken,
      enabled: true,
    });
    await store.recordJourney(journey(cleanProblemRecord({ intake_session_id: null })));
    const run = recentAgentRuns().filter((r) => r.agent_id === "A09")[0];
    expect(run.outputs_summary).toMatchObject({ verdict: "could_not_verify" });
    expect(run.errors?.[0]).toMatch(/lost writes/);
    expect(qualityCounters().findings_write_failed).toBeGreaterThan(0);
  });

  it("carries entity IDs only — no customer text reaches the ledger", async () => {
    const store = guarded();
    const marker = "MY PIPE EXPLODED IN THE PURPLE BATHROOM";
    await store.recordJourney(
      journey(cleanProblemRecord({ problem_summary: marker, intake_session_id: null }))
    );
    const serialized = JSON.stringify(recentAgentRuns().filter((r) => r.agent_id === "A09"));
    expect(serialized).not.toContain("PURPLE BATHROOM");
    const findings = JSON.stringify(await currentFindings({ clientProvider: noDb }));
    expect(findings).not.toContain("PURPLE BATHROOM");
  });
});
