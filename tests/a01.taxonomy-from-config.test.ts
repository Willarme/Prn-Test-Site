import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeProblemFixture, buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import {
  ACTIVE_PROBLEM_TAXONOMY,
  ProblemTaxonomy,
  familyLabel,
  problemTradeKeys,
  questionsForFamily,
} from "@/domain/problem/taxonomy";
import { PRN_TRIAL_VOCABULARY } from "@/domain/search/vocabulary";

/**
 * A01 STEP 6 — TAXONOMY FROM CONFIG, OUTPUT BYTE-IDENTICAL.
 *
 * The only claim worth proving twice: a client whose deployment does one trade
 * changes a config object and nothing else, and PRN's own packets did not move
 * a comma while that became true.
 */
const NOW = "2026-08-25T00:00:00Z";

function packetFor(description: string, taxonomy = ACTIVE_PROBLEM_TAXONOMY) {
  const { problem, evidence } = analyzeProblemFixture({
    description,
    intake_session_id: null,
    problem_family_hint: null,
    now: NOW,
  });
  return buildJobPacketFixture(problem, evidence, NOW, taxonomy);
}

describe("A01 — the problem taxonomy is configuration", () => {
  it("produces the questions the packet shipped with, in order, capped at five", () => {
    const hvac = packetFor("the ac is not cooling and the thermostat display is blank");
    expect(hvac.likely_service_category.value).toBe("Heating & cooling (HVAC)");
    expect(hvac.questions_for_provider).toEqual([
      "Is the thermostat set to the mode you expect (heat/cool), and does its display respond?",
      "Roughly how old is the system, if you know?",
      "Has the air filter been changed recently?",
      "When did this start, and has it gotten better or worse?",
      "Did anything unusual happen just before (weather, work in the home, power outage)?",
    ]);
    // Five, because the taxonomy says five — the `.slice(0, 5)` is now named.
    expect(hvac.questions_for_provider).toHaveLength(
      ACTIVE_PROBLEM_TAXONOMY.max_questions_for_provider
    );
  });

  it("a roofing description still gets the roofing label and the roofing questions", () => {
    const roof = packetFor("my roof is leaking after the storm and shingles came off");
    expect(roof.likely_service_category.value).toBe("Roofing");
    expect(roof.questions_for_provider[0]).toBe("Does it only appear during or after rain?");
  });

  it("an unclassifiable description gets generic questions only, and a null label", () => {
    const vague = packetFor("something in the house is behaving oddly and I am not sure what");
    expect(vague.likely_service_category.value).toBeNull();
    expect(vague.questions_for_provider).toEqual(ACTIVE_PROBLEM_TAXONOMY.generic_questions);
  });

  it("a client that does roofing ONLY changes a config object, not agent code", () => {
    const roofingOnly = ProblemTaxonomy.parse({
      taxonomy_id: "client_roofing_only_v1",
      version: 1,
      families: [
        {
          family: "roofing",
          label: "Roof repair",
          questions_for_provider: ["Which slope is it on?"],
        },
      ],
      generic_questions: ["When did you first notice it?"],
      max_questions_for_provider: 2,
    });
    const packet = packetFor("my roof is leaking after the storm", roofingOnly);
    expect(packet.likely_service_category.value).toBe("Roof repair");
    expect(packet.questions_for_provider).toEqual([
      "Which slope is it on?",
      "When did you first notice it?",
    ]);
    // A trade this client does not serve falls back to the family key rather
    // than borrowing PRN's label for it.
    expect(familyLabel("hvac", roofingOnly)).toBe("hvac");
    expect(questionsForFamily("hvac", roofingOnly)).toEqual(["When did you first notice it?"]);
    // …and PRN's own taxonomy is untouched by any of that.
    expect(packetFor("my roof is leaking after the storm").likely_service_category.value).toBe(
      "Roofing"
    );
  });

  it("the label half and the detection half agree — no family is unreachable", () => {
    const detectable = new Set(problemTradeKeys(PRN_TRIAL_VOCABULARY));
    for (const family of ACTIVE_PROBLEM_TAXONOMY.families) {
      expect(detectable, `${family.family} has a label but no detection pattern`).toContain(
        family.family
      );
    }
  });

  it("the literals are gone from the fixture engine, and the file was not split", () => {
    const engine = readFileSync(join(process.cwd(), "src/domain/problem/fixture-engine.ts"), "utf-8");
    expect(engine).not.toMatch(/Heating & cooling \(HVAC\)/);
    expect(engine).not.toMatch(/const FAMILY_LABELS/);
    expect(engine).not.toMatch(/\.slice\(0, 5\)/);
    // HO-3: both halves stay bound by path string in the capability registry.
    expect(engine).toMatch(/export function analyzeProblemFixture/);
    expect(engine).toMatch(/export function buildJobPacketFixture/);
  });
});
