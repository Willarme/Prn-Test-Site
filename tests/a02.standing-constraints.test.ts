import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JobPacket } from "@/domain/problem/contracts";
import { analyzeProblemFixture, buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import { ACTIVE_PACKET_COPY } from "@/domain/problem/packet-copy";
import { assemblePacket } from "@/domain/problem/packet-assembly";
import { selectPlaybook } from "@/domain/intake/playbooks";
import { PLATFORM_POLICY_SETTINGS } from "@/platform/policy/store";
import { CAPABILITY_REGISTRY } from "@/platform/capabilities/registry";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";

/**
 * A02 STEP 9 — THE CONSTRAINTS THAT APPLY TO EVERYTHING A02 ADDED.
 *
 * Checked against A02's OWN surface rather than the repo in general: the global
 * versions of some of these already exist and would keep passing while a new
 * A02 file quietly violated them.
 */

/** Every file this build added or substantially changed. */
const A02_FILES = [
  "src/domain/problem/packet.ts",
  "src/domain/problem/packet-copy.ts",
  "src/domain/problem/packet-assembly.ts",
  "src/domain/problem/journey-cookie.ts",
  "src/domain/problem/contracts.ts",
  "src/platform/events/customer.ts",
  "src/app/api/packet-activity/route.ts",
];

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf-8");
}

const NOW = "2026-08-25T12:00:00Z";

function everyPacketString(): string[] {
  const out: string[] = [];
  for (const description of [
    "The AC is blowing warm air and the outside unit is silent",
    "Water is dripping through the kitchen ceiling",
    "Two outlets in the living room stopped working",
  ]) {
    const { problem, evidence } = analyzeProblemFixture({
      description,
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    });
    const playbook = selectPlaybook(description, problem.service_category);
    for (const packet of [
      buildJobPacketFixture(problem, evidence, NOW),
      assemblePacket({
        problem,
        textEvidence: evidence,
        allEvidence: [evidence],
        playbook,
        answers: [],
        diagnosis: [],
        version: 2,
        now: NOW,
      }),
    ]) {
      out.push(
        packet.summary_plain,
        packet.call_script,
        packet.likely_service_category.note,
        packet.likely_service_category.value ?? "",
        ...packet.what_remains_unknown,
        ...packet.safe_prep_notes,
        ...packet.questions_for_provider
      );
    }
  }
  return out;
}

describe("A02 — the packet never carries an unlabeled dollar figure", () => {
  it("no packet output contains a currency amount at all", () => {
    for (const value of everyPacketString()) {
      expect(value, value).not.toMatch(/\$\s?\d/);
      expect(value, value).not.toMatch(/\b\d+\s?(dollars|USD)\b/i);
    }
  });

  it("A02's own source carries no price constant, and no threshold was invented", () => {
    for (const file of A02_FILES) {
      /**
       * Cost ceilings are melissa-park (pre-answer 3): implement NO thresholds.
       * The only currency figure A02 may name anywhere is $0 — the honest value
       * of a path with no model in it. Any NON-zero amount in A02's source
       * would be an invented price wearing a code comment.
       */
      expect(read(file), file).not.toMatch(/\$\s?[1-9]/);
      expect(read(file), file).not.toMatch(/max_.*_usd|cost_ceiling|budget_usd/);
    }
    // …and no packet-shaped dollar setting appeared in the policy store either.
    for (const setting of PLATFORM_POLICY_SETTINGS) {
      if (/usd|dollar/.test(setting.key)) {
        expect(setting.key, setting.key).not.toMatch(/packet/);
      }
    }
  });

  it("logs cost as 0 with a deterministic provider rather than omitting it", () => {
    const src = read("src/domain/problem/packet.ts");
    expect(src).toMatch(/cost_usd: 0/);
    expect(src).not.toMatch(/cost_usd: null/);
  });
});

describe("A02 — the packet never claims a diagnosis or guarantees a saving", () => {
  it("the inference is labelled as an inference on every packet", () => {
    for (const description of ["The AC is blowing warm air", "Water under the sink"]) {
      const { problem, evidence } = analyzeProblemFixture({
        description,
        intake_session_id: null,
        problem_family_hint: null,
        now: NOW,
      });
      const packet = buildJobPacketFixture(problem, evidence, NOW);
      expect(packet.likely_service_category.note.length).toBeGreaterThan(10);
      expect(packet.likely_service_category.note).toMatch(/not a diagnosis/i);
    }
  });

  it("no packet string promises a saving, a guarantee, or a fix", () => {
    for (const value of everyPacketString()) {
      expect(value, value).not.toMatch(/\bguarantee(s|d)?\b/i);
      expect(value, value).not.toMatch(/\bsavings?\b|\bsave (you )?(money|time)\b/i);
      expect(value, value).not.toMatch(/\bwe (will|can) (fix|repair|diagnose)\b/i);
    }
  });

  it("the unknowns are still listed rather than resolved away", () => {
    const { problem, evidence } = analyzeProblemFixture({
      description: "Something is wrong with the boiler",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    });
    const packet = buildJobPacketFixture(problem, evidence, NOW);
    expect(packet.what_remains_unknown.length).toBeGreaterThan(0);
    expect(packet.what_remains_unknown.join(" ")).toMatch(/verify on site/i);
  });
});

describe('A02 — the word "lead" appears on no surface A02 owns', () => {
  it("not in the packet copy, not in a label, not in a CTA", () => {
    const copy = [
      ...Object.values(ACTIVE_PACKET_COPY.content).flatMap((v) =>
        typeof v === "string" ? [v] : Array.isArray(v) ? (v as string[]) : []
      ),
      ...Object.values(ACTIVE_PACKET_COPY.sections),
      ...Object.values(ACTIVE_PACKET_COPY.actions),
      ...everyPacketString(),
    ];
    for (const value of copy) {
      expect(value, value).not.toMatch(/\blead(s|ed|ing)?\b/i);
    }
  });

  it("not in A02's source, its comments, or any identifier it introduced", () => {
    /**
     * packet-copy.ts is excluded, and only it: that file DEFINES the rule —
     * FORBIDDEN_PACKET_COPY_PATTERNS names the word in order to refuse it, the
     * same way safety-package.ts names hazards in order to detect them. Its own
     * enforcement is proven separately in a02.packet-copy-config.test.ts, which
     * feeds it a CTA reading "Send this <the word> to a provider" and asserts
     * the package refuses to parse.
     */
    for (const file of A02_FILES.filter((f) => !f.endsWith("packet-copy.ts"))) {
      expect(read(file), file).not.toMatch(/\blead(s|ed|ing)?\b/i);
    }
  });

  it("not in A02's registry entries", () => {
    const a02 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A02")!;
    expect(JSON.stringify(a02)).not.toMatch(/\blead(s|ed|ing)?\b/i);
    const cap = CAPABILITY_REGISTRY.find((c) => c.capability_key === "generate_job_packet")!;
    expect(JSON.stringify(cap)).not.toMatch(/\blead(s|ed|ing)?\b/i);
  });
});

describe("A02 — nothing customer-visible changed except invisible instruments", () => {
  it("the packet's rendered words are the same words as before the build", () => {
    const { problem, evidence } = analyzeProblemFixture({
      description: "The AC won't turn on since yesterday evening",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    });
    const packet = buildJobPacketFixture(problem, evidence, NOW);
    expect(packet.summary_plain).toBe(
      "Homeowner reports: The AC won't turn on since yesterday evening"
    );
    expect(packet.likely_service_category.note).toBe(
      "This is an inference from the description, not a diagnosis."
    );
    expect(packet.safe_prep_notes).toEqual([
      "Know where your main shutoffs are (water, breaker panel).",
      "Clear access to the affected area so a provider can reach it easily.",
    ]);
  });

  it("the confidence display is untouched — three levels, rendered as words", () => {
    // Campaign track P2 (2026-09-05): PRN Master Build Spec MERGED §6.4 rules
    // the results page a TEMPLATE with no per-request value, so the packet —
    // and its confidence line — no longer renders there. The packet itself
    // (track P1, src/domain/packet) prints confidence per the Directions §7.3
    // closed vocabulary: three levels, words only, a digit refused by its
    // self-check. The constraint this case guards (words, never a number) is
    // unchanged; only where the words print has moved.
    const page = read("src/app/results/[request_id]/page.tsx");
    expect(page).not.toMatch(/inference_badge_template/);
    const types = read("src/domain/packet/types.ts");
    expect(types).toMatch(/ConfidenceWord = "Most consistent" \| "Possible" \| "Less likely"/);
    const selfCheck = read("src/domain/packet/self-check.ts");
    expect(selfCheck).toMatch(/a number in a confidence word/);
    expect(ACTIVE_PACKET_COPY.sections.inference_badge_template).toBe(
      "inference · {confidence} confidence"
    );
  });
});

describe("A02 — the parked questions are parked, not answered", () => {
  it("the section list is not declared final anywhere", () => {
    const copy = read("src/domain/problem/packet-copy.ts");
    expect(copy).toMatch(/NO SECTION LIST IS DECIDED HERE/);
    expect(copy).toMatch(/TODO-ASK-OWNER \(Melissa\)/);
    expect(ACTIVE_PACKET_COPY.owner_reviewed).toBe(false);
  });

  it("no AI model was wired for the packet path (pre-answer 1)", () => {
    const cap = CAPABILITY_REGISTRY.find((c) => c.capability_key === "generate_job_packet")!;
    expect(cap.current_implementation).toBe("deterministic");
    expect(cap.alternate_implementations ?? []).toEqual([]);
    for (const file of A02_FILES) {
      expect(read(file), file).not.toMatch(/callModel|platform\/ai\//);
    }
  });

  it("no incident_id was invented (pre-answer 4)", () => {
    // Absent as a FIELD, and recorded as a decision rather than an oversight —
    // the contract says out loud why it is not there.
    expect(Object.keys(JobPacket.shape)).not.toContain("incident_id");
    expect(read("src/domain/problem/contracts.ts")).toMatch(
      /`incident_id` is DELIBERATELY ABSENT/
    );
    for (const file of A02_FILES.filter((f) => !f.endsWith("contracts.ts"))) {
      expect(read(file), file).not.toMatch(/incident_id/);
    }
  });

  it("the three missing open decisions are on the owner's list", () => {
    const open = readFileSync(join(process.cwd(), "docs/canon/OPEN_DECISIONS.md"), "utf-8");
    expect(open).toMatch(/OD-18 — Does the Job Packet show a homeowner a CONFIDENCE LEVEL/);
    expect(open).toMatch(/OD-17 — What is the relationship between/);
    expect(open).toMatch(/OD-16 — The approval cadence for agent specs after A00/);
  });
});
