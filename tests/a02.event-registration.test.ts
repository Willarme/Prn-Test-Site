import { describe, expect, it } from "vitest";
import {
  A02_EVENT_NAMES,
  CORE_EVENT_NAMES,
  EVENT_NAMES,
} from "@/platform/events/names";
import { listEventDefinitions, seedDictionary, seedGroupOf } from "@/platform/events/dictionary";

/**
 * A02 STEP 2 — TWO NEW NAMES, REGISTERED THROUGH A08'S MACHINERY.
 *
 * The discipline being pinned is again the restraint. A02's spec orders three
 * names emitted that the dictionary does not carry, and the easy failure is to
 * mint all three — growing A08's contract by a name (`packet.shared`) that
 * duplicates one already shipping since #14A §18.2.
 */
describe("A02 — event registration", () => {
  it("mints exactly TWO names", () => {
    expect([...A02_EVENT_NAMES]).toEqual(["problem.intake_completed", "packet.regenerated"]);
  });

  it("does NOT mint packet.shared — packet.share_opened already means that", () => {
    expect(EVENT_NAMES as readonly string[]).not.toContain("packet.shared");
    expect(EVENT_NAMES as readonly string[]).toContain("packet.share_opened");
  });

  it("does not touch CORE_EVENT_NAMES", () => {
    for (const name of A02_EVENT_NAMES) {
      expect(CORE_EVENT_NAMES as readonly string[]).not.toContain(name);
    }
    expect(CORE_EVENT_NAMES.length).toBe(56);
  });

  it("leaves the four packet names A02 already had exactly where they were", () => {
    for (const shipped of [
      "packet.generated",
      "packet.viewed",
      "packet.downloaded",
      "packet.share_opened",
    ]) {
      expect(CORE_EVENT_NAMES as readonly string[]).toContain(shipped);
    }
  });

  it("passes the shipped domain.action convention", () => {
    for (const name of A02_EVENT_NAMES) expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it("has a seeded EventDefinition for each, in the same commit", async () => {
    await seedDictionary();
    for (const name of A02_EVENT_NAMES) {
      const def = listEventDefinitions().find((d) => d.event_name === name);
      expect(def, name).toBeDefined();
      expect(def?.owning_agent_or_domain).toBe("A02");
      expect(def?.status).toBe("approved");
      expect(def?.definition_version).toBe(1);
      expect(seedGroupOf(name)).toBe("a02");
    }
  });

  it("requires IDS ONLY in context — never a packet's words", async () => {
    await seedDictionary();
    const required = A02_EVENT_NAMES.flatMap(
      (n) => listEventDefinitions().find((d) => d.event_name === n)?.required_envelope_fields ?? []
    );
    expect(required.length).toBeGreaterThan(0);
    for (const key of required) {
      expect(key.replace(/^context\./, "")).not.toMatch(
        /value|free_text|description|content|summary|statement|script/
      );
    }
  });

  it("states in the definition WHY each is not a synonym of packet.generated", async () => {
    await seedDictionary();
    const completed = listEventDefinitions().find(
      (d) => d.event_name === "problem.intake_completed"
    );
    const regen = listEventDefinitions().find((d) => d.event_name === "packet.regenerated");
    expect(completed?.description).toMatch(/packet\.generated/);
    expect(regen?.description).toMatch(/packet\.generated/);
  });

  it("carries a TODO-ASK-OWNER rather than declaring the spellings settled", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/platform/events/names.ts", "utf-8");
    expect(src).toMatch(/A02 CUSTOMER VALUE[\s\S]*TODO-ASK-OWNER \(Joshua\)/);
  });
});
