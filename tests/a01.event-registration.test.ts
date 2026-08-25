import { describe, expect, it } from "vitest";
import {
  A01_EVENT_NAMES,
  CORE_EVENT_NAMES,
  EVENT_NAMES,
} from "@/platform/events/names";
import { listEventDefinitions, seedDictionary, seedGroupOf } from "@/platform/events/dictionary";

/**
 * A01 STEP 8 — ONE NEW NAME, REGISTERED THROUGH A08'S MACHINERY.
 *
 * The discipline being pinned is the restraint, not the addition. A01's spec
 * proposes six event names and none of them exist in the dictionary; five turned
 * out to be synonyms of names already shipping. The failure mode this suite
 * guards is the easy one — a build session emitting all six and quietly growing
 * A08's contract by five names nobody ratified.
 */
describe("A01 — event registration", () => {
  it("mints exactly ONE name", () => {
    expect(A01_EVENT_NAMES).toEqual(["problem.fact_extracted"]);
  });

  it("does not touch CORE_EVENT_NAMES", () => {
    expect(CORE_EVENT_NAMES).not.toContain("problem.fact_extracted");
    // 14A §18.2 verbatim, and it stays 56.
    expect(CORE_EVENT_NAMES.length).toBe(56);
  });

  it("emits none of the five synonyms — they map onto shipped names instead", () => {
    for (const proposed of [
      "problem.intake_started",
      "clarification.asked",
      "clarification.answered",
      "safety.flagged",
      "problem.classified",
    ]) {
      expect(EVENT_NAMES as readonly string[]).not.toContain(proposed);
    }
    // …and the names it emits instead are all already here.
    for (const shipped of [
      "intake.started",
      "intake.evidence_added",
      "intake.clarifier_asked",
      "intake.clarifier_answered",
      "safety.triggered",
      "problem.created",
      "problem.updated",
      "consent.granted",
    ]) {
      expect(EVENT_NAMES as readonly string[]).toContain(shipped);
    }
  });

  it("passes the shipped domain.action convention", () => {
    for (const name of A01_EVENT_NAMES) expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it("has a seeded EventDefinition in the same commit, or seeding throws", async () => {
    await seedDictionary();
    const def = listEventDefinitions().find((d) => d.event_name === "problem.fact_extracted");
    expect(def).toBeDefined();
    expect(def?.owning_agent_or_domain).toBe("A01");
    expect(def?.status).toBe("approved");
    expect(def?.definition_version).toBe(1);
    expect(seedGroupOf("problem.fact_extracted")).toBe("a01");
  });

  it("requires ids and classifications in context — never the fact's value", () => {
    const def = listEventDefinitions().find((d) => d.event_name === "problem.fact_extracted");
    expect(def?.required_envelope_fields).toEqual([
      "context.problem_id",
      "context.claim_id",
      "context.claim_class",
      "context.provenance",
    ]);
    // A key that would carry a homeowner's own words must not be required — or
    // present. The envelope is a spine, not a copy of the evidence.
    for (const key of def?.required_envelope_fields ?? []) {
      // The `context.` prefix is the envelope's, not the key's — strip it
      // before checking, or every key "contains text".
      expect(key.replace(/^context\./, "")).not.toMatch(
        /value|free_text|object|description|content|summary/
      );
    }
    expect(def?.description).not.toMatch(/verbatim/i);
  });
});
