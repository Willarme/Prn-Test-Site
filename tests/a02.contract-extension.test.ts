import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOB_PACKET_CANON_ALIASES,
  JobPacket,
  PacketStatus,
} from "@/domain/problem/contracts";
import { analyzeProblemFixture, buildJobPacketFixture } from "@/domain/problem/fixture-engine";

/**
 * A02 STEP 1 — THE FROZEN CONTRACT, EXTENDED AND NOT RENAMED.
 *
 * The failure this suite exists to catch is the one the audit predicted a
 * build session would walk straight into: obeying the A02 spec's §11 "do not
 * rename" list literally, which renames two LIVE fields and breaks the results
 * page, packet-assembly, the gateway and the capability registry at once.
 */

const NOW = "2026-08-25T12:00:00Z";

function livePacket() {
  const { problem, evidence } = analyzeProblemFixture({
    description: "Water is dripping from the ceiling under the upstairs bathroom.",
    intake_session_id: "is_1",
    problem_family_hint: null,
    now: NOW,
  });
  return buildJobPacketFixture(problem, evidence, NOW);
}

describe("A02 — the frozen JobPacket contract", () => {
  it("keeps the two live field names the spec would have renamed", () => {
    const shape = Object.keys(JobPacket.shape);
    expect(shape).toContain("job_packet_id");
    expect(shape).toContain("problem_id");
  });

  it("did NOT mint the spec's competing names alongside them", () => {
    const shape = Object.keys(JobPacket.shape);
    expect(shape).not.toContain("packet_id");
    expect(shape).not.toContain("source_problem_id");
  });

  it("records the canon divergence as data, pointing at fields that exist", () => {
    expect(JOB_PACKET_CANON_ALIASES.map((a) => a.canon_name)).toEqual([
      "packet_id",
      "source_problem_id",
    ]);
    for (const alias of JOB_PACKET_CANON_ALIASES) {
      expect(Object.keys(JobPacket.shape)).toContain(alias.shipped_name);
      expect(alias.reason.length).toBeGreaterThan(20);
    }
  });

  it("carries a TODO-ASK-OWNER for the divergence rather than deciding it", () => {
    const src = readFileSync(join(process.cwd(), "src/domain/problem/contracts.ts"), "utf-8");
    expect(src).toMatch(/TODO-ASK-OWNER \(Joshua\)[\s\S]*naming divergence/);
  });

  it("adds every missing canon field, and adds all of them OPTIONAL", () => {
    const added = [
      "superseded_by",
      "status",
      "claim_basis",
      "evidence_basis",
      "generation_run_id",
      "uncertainty_notes",
      "safety_notes",
      "template_version",
      "model_id",
      "privacy_marking",
      "tenant_id",
    ] as const;
    const shape = JobPacket.shape as Record<string, { isOptional(): boolean }>;
    for (const field of added) {
      expect(Object.keys(JobPacket.shape), `${field} exists`).toContain(field);
      expect(shape[field].isOptional(), `${field} is optional`).toBe(true);
    }
  });

  it("still parses a packet written before any of those fields existed", () => {
    // The exact shape the shipped fixture engine produces today: no new field
    // set at all. A required addition would have failed here — which is the
    // point, because rows like this already exist in the store and in cookies.
    const packet = livePacket();
    expect(JobPacket.safeParse(packet).success).toBe(true);
    for (const field of ["superseded_by", "status", "claim_basis", "tenant_id"]) {
      expect(packet as Record<string, unknown>).not.toHaveProperty(field);
    }
  });

  it("accepts a fully-populated canon packet too", () => {
    const parsed = JobPacket.safeParse({
      ...livePacket(),
      tenant_id: "prn",
      superseded_by: null,
      status: "current",
      claim_basis: ["fc_1"],
      evidence_basis: ["ev_1"],
      generation_run_id: "run_1",
      uncertainty_notes: ["Exact cause unverified."],
      safety_notes: [],
      template_version: "1.0.0",
      model_id: null,
      privacy_marking: "USER_PRIVATE",
    });
    expect(parsed.success).toBe(true);
  });

  it("does NOT invent incident_id (pre-answer 4 — nothing in the trial needs it)", () => {
    expect(Object.keys(JobPacket.shape)).not.toContain("incident_id");
  });

  it("PacketStatus names canon's three states and nothing else", () => {
    expect([...PacketStatus.options]).toEqual(["draft", "current", "superseded"]);
  });

  it("model_id null is the honest shipped value — the packet path calls no model", () => {
    const packet = JobPacket.parse({ ...livePacket(), model_id: null });
    expect(packet.model_id).toBeNull();
    expect(packet.engine).toBe("fixture");
  });
});
