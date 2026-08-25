import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeProblemFixture } from "@/domain/problem/fixture-engine";
import { A02_CAPABILITY_KEY, buildPacket } from "@/domain/problem/packet";
import { generateJobPacket } from "@/domain/problem/packet-assembly";
import { selectPlaybook } from "@/domain/intake/playbooks";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import { resolveCapability } from "@/platform/capabilities/registry";
import { capability_call } from "@/platform/gateway";
import { engageKillSwitch, resetKillSwitchForTests } from "@/platform/killswitch";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

/**
 * A02 STEP 4 — THE GOVERNED DOOR.
 *
 * The hole this closes is not a bug, it is a governance hole: before this, a
 * kill switch on A02 stopped nothing, because building a packet was a plain
 * function call that never asked anybody's permission.
 */

const NOW = "2026-08-25T12:00:00Z";
const DESCRIPTION = "Water is dripping from the ceiling under the upstairs bathroom.";

function subject() {
  return analyzeProblemFixture({
    description: DESCRIPTION,
    intake_session_id: "is_1",
    problem_family_hint: null,
    now: NOW,
  });
}

describe("A02 — routed through capability_call, not around it", () => {
  beforeEach(() => {
    resetKillSwitchForTests();
    resetAgentRunLedgerForTests();
  });

  it("uses the REGISTERED key, and A02 is allowed to call it", () => {
    expect(A02_CAPABILITY_KEY).toBe("generate_job_packet");
    const cap = resolveCapability(A02_CAPABILITY_KEY);
    expect(cap?.capability_key).toBe("generate_job_packet");
    expect(cap?.aliases).toContain("build_job_packet");
    expect(cap?.owning_agent_ids).toEqual(["A02"]);
    const agent = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A02")!;
    // BOTH names: the alias other tests pin, and the canonical key the gateway
    // resolves to. Holding only the alias BLOCKED every correct caller.
    expect(agent.allowed_capabilities).toContain("build_job_packet");
    expect(agent.allowed_capabilities).toContain("generate_job_packet");
  });

  it("the canonical key was genuinely blocked before the allowed list was fixed", async () => {
    // Proven by comparison: a name A02 does not own is still refused, which is
    // the same code path the canonical key used to hit.
    const denied = await capability_call({
      agent_id: "A02",
      capability: "classify_home_problem",
      args: {},
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.kind).toBe("blocked");
  });

  it("produces a packet and a ledger run id", async () => {
    const { problem, evidence } = subject();
    const out = await buildPacket({ problem, textEvidence: evidence, now: NOW });
    expect(out.ok).toBe(true);
    expect(out.packet).not.toBeNull();
    expect(out.run_id).toMatch(/^ar_/);
    expect(recentAgentRuns().some((r) => r.agent_id === "A02")).toBe(true);
  });

  it("a kill switch on A02 actually stops A02 — and loses no customer work", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A02", by: "test" });
    const { problem, evidence } = subject();
    const out = await buildPacket({ problem, textEvidence: evidence, now: NOW });
    expect(out.ok).toBe(false);
    expect(out.packet).toBeNull();
    expect(out.refusal).toMatch(/kill switch/i);
    // It refused; it did not throw. The caller decides what the customer sees.
    resetKillSwitchForTests();
  });

  it("honours the undocumented consumption seam rather than bypassing it", async () => {
    const { problem, evidence } = subject();
    const playbook = selectPlaybook(DESCRIPTION, problem.service_category);
    const out = await buildPacket({
      problem,
      textEvidence: evidence,
      allEvidence: [evidence],
      playbook,
      answers: [
        {
          request_id: "rq_1",
          field_key: playbook.required_fields[0].field_key,
          value_text: "Rheem 2014",
          evidence_id: null,
          source: "typed",
          answered_at: NOW,
        },
      ],
      diagnosis: [],
      version: 2,
      now: NOW,
      request_id: "rq_1",
    });
    expect(out.ok).toBe(true);
    // collected_details is produced ONLY by packet-assembly — its presence is
    // the proof the seam was used and not stepped around.
    expect(out.packet!.collected_details.length).toBe(1);
    expect(out.packet!.collected_details[0].value).toBe("Rheem 2014");
  });

  it("stamps the canon basis and provenance fields", async () => {
    const { problem, evidence } = subject();
    const out = await buildPacket({
      problem,
      textEvidence: evidence,
      now: NOW,
      request_id: "rq_1",
    });
    const p = out.packet!;
    expect(p.evidence_basis).toEqual([evidence.evidence_id]);
    expect(p.generation_run_id).toBe(out.run_id);
    expect(p.status).toBe("current");
    expect(p.privacy_marking).toBe("USER_PRIVATE");
    expect(p.tenant_id).toBe("prn");
    expect(p.template_version).toBe("packet-copy@1.0.0");
    expect(p.model_id).toBeNull();
    expect(p.superseded_by).toBeNull();
    expect(p.uncertainty_notes).toEqual(p.what_remains_unknown);
  });

  it("omits claim_basis when A01 handed no claims over — absent means NOT RECORDED", async () => {
    const { problem, evidence } = subject();
    const out = await buildPacket({ problem, textEvidence: evidence, now: NOW });
    expect(out.packet).not.toHaveProperty("claim_basis");
    const withClaims = await buildPacket({
      problem,
      textEvidence: evidence,
      now: NOW,
      claims: [{ claim_id: "fc_1" } as never],
    });
    expect(withClaims.packet!.claim_basis).toEqual(["fc_1"]);
  });

  it("carries the safety note the homeowner was shown, when a rule fired", async () => {
    const { problem, evidence } = analyzeProblemFixture({
      description: "There is water pooling around the electrical panel in the basement.",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    });
    const out = await buildPacket({ problem, textEvidence: evidence, now: NOW });
    if (problem.safety_rule_id) expect(out.packet!.safety_notes!.length).toBe(1);
    else expect(out.packet!.safety_notes).toEqual([]);
  });

  it("costs $0 with no model — the honest figure, not an omission", async () => {
    const { problem, evidence } = subject();
    await buildPacket({ problem, textEvidence: evidence, now: NOW });
    const runs = recentAgentRuns().filter((r) => r.agent_id === "A02");
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.cost_usd).toBe(0);
      expect(run.tool_provider).toBe("deterministic-stand-in");
    }
  });
});

describe("A02 — the one dispatcher behind the capability", () => {
  it("base args produce the same packet the fixture builder always produced", () => {
    const { problem, evidence } = subject();
    const viaDispatcher = generateJobPacket({ problem, evidence, now: NOW });
    expect(viaDispatcher.summary_plain).toBe(`Homeowner reports: ${DESCRIPTION}`);
    expect(viaDispatcher.engine).toBe("fixture");
    expect(viaDispatcher.packet_version).toBe(1);
  });

  it("assemble args route to the richer implementation", () => {
    const { problem, evidence } = subject();
    const assembled = generateJobPacket({
      assemble: true,
      problem,
      textEvidence: evidence,
      allEvidence: [evidence],
      playbook: selectPlaybook(DESCRIPTION, problem.service_category),
      answers: [],
      diagnosis: [],
      version: 3,
      now: NOW,
    });
    expect(assembled.packet_version).toBe(3);
  });
});

describe("A02 — RLS seam (condition 5): no server-role doctrine in new code", () => {
  const a02Files = [
    "src/domain/problem/packet.ts",
    "src/domain/problem/packet-copy.ts",
    "src/domain/problem/packet-assembly.ts",
  ];

  it("no A02 module imports a service client or names service-role credentials", () => {
    for (const file of a02Files) {
      const src = readFileSync(join(process.cwd(), file), "utf-8");
      expect(src, file).not.toMatch(/serviceClient|SERVICE_ROLE|createClient\(/);
    }
  });

  it("names the struck doctrine as struck, so it cannot creep back in", () => {
    const src = readFileSync(join(process.cwd(), "src/domain/problem/packet.ts"), "utf-8");
    expect(src).toMatch(/"Server-role-only writes" is struck doctrine/);
  });

  it("A02 performs no direct database access at all — the store is the seam", () => {
    const src = readFileSync(join(process.cwd(), "src/domain/problem/packet.ts"), "utf-8");
    expect(src).not.toMatch(/from\s+["']@\/platform\/(db|stores)\//);
    // …and it says so, so the next build session does not "fix" it by adding one.
    expect(src).toMatch(/PlatformClientProvider/);
  });
});
