import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JobPacket } from "@/domain/problem/contracts";
import { analyzeProblemFixture, buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import {
  ACTIVE_PACKET_COPY,
  FORBIDDEN_PACKET_COPY_PATTERNS,
  PRN_TRIAL_PACKET_COPY,
  PacketCopyPackage,
  fillCopy,
} from "@/domain/problem/packet-copy";
import { assemblePacket } from "@/domain/problem/packet-assembly";
import { selectPlaybook } from "@/domain/intake/playbooks";

/**
 * A02 STEP 3 — WHITE-LABEL PACKET COPY (condition 8, pre-answer 12).
 *
 * Two things are pinned, and they pull in opposite directions on purpose:
 *   1. THE WORDS DID NOT CHANGE. Moving copy into config is worthless if the
 *      move quietly reworded a homeowner-facing sentence.
 *   2. THE ENFORCEMENT DID NOT VANISH. The z.literal was a real honesty
 *      guarantee; loosening it without replacing it would trade a promise for
 *      a configuration option.
 */

const NOW = "2026-08-25T12:00:00Z";
const DESCRIPTION = "Water is dripping from the ceiling under the upstairs bathroom.";

function packet() {
  const { problem, evidence } = analyzeProblemFixture({
    description: DESCRIPTION,
    intake_session_id: "is_1",
    problem_family_hint: null,
    now: NOW,
  });
  return { packet: buildJobPacketFixture(problem, evidence, NOW), problem, evidence };
}

describe("A02 — packet copy moved to config, words unchanged", () => {
  it("keeps the disclaimer byte-identical to the sentence the contract used to pin", () => {
    // The exact string that was `z.literal(...)` in contracts.ts before this build.
    expect(ACTIVE_PACKET_COPY.content.inference_disclaimer).toBe(
      "This is an inference from the description, not a diagnosis."
    );
    expect(packet().packet.likely_service_category.note).toBe(
      "This is an inference from the description, not a diagnosis."
    );
  });

  it("keeps every other moved string byte-identical", () => {
    const c = ACTIVE_PACKET_COPY.content;
    expect(c.raw_statement_prefix).toBe("Homeowner reports: ");
    expect(c.unknown_exact_cause).toBe("Exact cause — a qualified provider should verify on site.");
    expect(c.unknown_which_trade).toBe(
      "Which trade should handle this — the description fits more than one."
    );
    expect(c.unknown_parts).toBe("Whether parts will be needed, and which.");
    expect(c.safe_prep_notes).toEqual([
      "Know where your main shutoffs are (water, breaker panel).",
      "Clear access to the affected area so a provider can reach it easily.",
    ]);
    expect(ACTIVE_PACKET_COPY.sections.questions_for_provider).toBe(
      "What a provider will likely ask — have these ready"
    );
    expect(ACTIVE_PACKET_COPY.actions.download).toBe("Print / Save as PDF");
  });

  it("produces the same call script the hard-coded template produced", () => {
    expect(packet().packet.call_script).toBe(
      `Hi — something happened at my home and I have an organized summary ready. In short: ${DESCRIPTION}. I can send you the full Job Packet with details and photos. Are you able to take a look?`
    );
  });

  it("still truncates a long description at 140 characters with an ellipsis", () => {
    const long = "x".repeat(300);
    const { problem, evidence } = analyzeProblemFixture({
      description: long,
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    });
    const p = buildJobPacketFixture(problem, evidence, NOW);
    expect(p.call_script).toContain(`${"x".repeat(140)}…`);
  });

  it("stamps template_version so a stored packet records which words it used", () => {
    expect(packet().packet.template_version).toBe(ACTIVE_PACKET_COPY.template_version);
    expect(ACTIVE_PACKET_COPY.template_version).toBe("packet-copy@1.0.0");
  });
});

describe("A02 — the honesty enforcement that replaced the z.literal", () => {
  it("the schema now requires a disclaimer to be PRESENT, not to be one sentence", () => {
    const base = packet().packet;
    // Present and non-empty: fine (this is what a white-label client needs).
    expect(
      JobPacket.safeParse({
        ...base,
        likely_service_category: { ...base.likely_service_category, note: "Anders formuleret." },
      }).success
    ).toBe(true);
    // Absent or empty: refused.
    expect(
      JobPacket.safeParse({
        ...base,
        likely_service_category: { ...base.likely_service_category, note: "" },
      }).success
    ).toBe(false);
  });

  it("the copy PACKAGE refuses a savings promise", () => {
    const broken = structuredClone(PRN_TRIAL_PACKET_COPY) as Record<string, unknown>;
    (broken.content as Record<string, unknown>).inference_disclaimer =
      "We guarantee this will save you money.";
    expect(PacketCopyPackage.safeParse(broken).success).toBe(false);
  });

  it("the copy PACKAGE refuses a dollar figure anywhere in the packet", () => {
    const broken = structuredClone(PRN_TRIAL_PACKET_COPY) as Record<string, unknown>;
    (broken.sections as Record<string, unknown>).call_script = "Your $250 call script";
    expect(PacketCopyPackage.safeParse(broken).success).toBe(false);
  });

  it('the copy PACKAGE refuses the word "lead" on any surface, including a CTA', () => {
    const broken = structuredClone(PRN_TRIAL_PACKET_COPY) as Record<string, unknown>;
    (broken.actions as Record<string, unknown>).download = "Send this lead to a provider";
    expect(PacketCopyPackage.safeParse(broken).success).toBe(false);
  });

  it("the shipped package passes every rule it enforces on a client's", () => {
    const strings = [
      ...Object.values(ACTIVE_PACKET_COPY.content).flatMap((v) =>
        typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
      ),
      ...Object.values(ACTIVE_PACKET_COPY.sections),
      ...Object.values(ACTIVE_PACKET_COPY.actions),
    ] as string[];
    expect(strings.length).toBeGreaterThan(20);
    for (const value of strings) {
      for (const rule of FORBIDDEN_PACKET_COPY_PATTERNS) {
        expect(rule.pattern.test(value), `${value} vs ${rule.why}`).toBe(false);
      }
    }
  });

  it("is honest that the copy has NOT been owner-reviewed", () => {
    expect(ACTIVE_PACKET_COPY.owner_reviewed).toBe(false);
    const src = readFileSync(join(process.cwd(), "src/domain/problem/packet-copy.ts"), "utf-8");
    expect(src).toMatch(/TODO-ASK-OWNER \(Melissa\)/);
  });
});

describe("A02 — a white-label package actually swaps the words", () => {
  const clientCopy = PacketCopyPackage.parse({
    ...structuredClone(PRN_TRIAL_PACKET_COPY),
    packet_copy_id: "pkt_copy_client_b",
    template_version: "client-b@1.0.0",
    content: {
      ...structuredClone(PRN_TRIAL_PACKET_COPY.content),
      inference_disclaimer: "An informed guess from what you told us — not a professional opinion.",
      raw_statement_prefix: "In the owner's words: ",
    },
  });

  it("changes the disclaimer and the prefix without touching any engine code", () => {
    const { problem, evidence } = analyzeProblemFixture({
      description: DESCRIPTION,
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    });
    const p = buildJobPacketFixture(problem, evidence, NOW, undefined, clientCopy);
    expect(p.likely_service_category.note).toBe(
      "An informed guess from what you told us — not a professional opinion."
    );
    expect(p.summary_plain).toBe(`In the owner's words: ${DESCRIPTION}`);
    expect(p.template_version).toBe("client-b@1.0.0");
    // …and the homeowner's own words are STILL byte-identical (HC12).
    expect(p.observed_statements[0]).toBe(DESCRIPTION);
  });

  it("flows through the live assembly path too, not just the fixture builder", () => {
    const { problem, evidence } = analyzeProblemFixture({
      description: DESCRIPTION,
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    });
    const assembled = assemblePacket({
      problem,
      textEvidence: evidence,
      allEvidence: [evidence],
      playbook: selectPlaybook(DESCRIPTION, problem.service_category),
      answers: [],
      diagnosis: [],
      version: 2,
      now: NOW,
      copy: clientCopy,
    });
    expect(assembled.likely_service_category.note).toBe(
      "An informed guess from what you told us — not a professional opinion."
    );
    expect(assembled.template_version).toBe("client-b@1.0.0");
  });
});

describe("fillCopy", () => {
  it("substitutes known keys and leaves unknown placeholders alone", () => {
    expect(fillCopy("a {x} b {y}", { x: "1" })).toBe("a 1 b {y}");
  });
});
