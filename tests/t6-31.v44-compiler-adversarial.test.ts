import { beforeAll, describe, expect, it } from "vitest";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import type { DoorV44CompilerContext } from "@/domain/search/door-v44/compiler-types";
import type { DoorV44Spec } from "@/domain/search/door-v44/types";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

let baseline: { spec: DoorV44Spec; context: DoorV44CompilerContext };
beforeAll(async () => {
  baseline = await compilerFixture();
  const result = await compileDoorV44Page(baseline.spec, baseline.context);
  expect(result.ok, JSON.stringify(result)).toBe(true);
});
function fixture() { return structuredClone(baseline); }
async function rejected(mutate: (spec: DoorV44Spec, context: DoorV44CompilerContext) => void, code?: string) {
  const { spec, context } = fixture();
  mutate(spec, context);
  const result = await compileDoorV44Page(spec, context);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Adversarial input was accepted");
  expect(result.errors.length).toBeGreaterThan(0);
  if (code) expect(result.errors.map((error) => error.code)).toContain(code);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_TEST_VALUE");
  expect(result.errors.every((error) => Object.keys(error).sort().join(",") === "code,pointer")).toBe(true);
}

describe("independent compiler adversarial regressions", () => {
  it.each(["cap_last", "value_claim"] as const)("applies the hero wording boundary to %s as well as the reviewed title", async (field) => {
    await rejected((spec) => {
      if (field === "cap_last") spec.sections.hero.cap_last = [{ type: "text", value: "No account, no card." }];
      else spec.sections.hero.value_claim = "No account, no card.";
    }, "WORDING_R01_NEGATION");
  });

  it("rejects a required capability module reduced below five rows by hidden-state filtering", async () => {
    await rejected((spec, context) => {
      const hidden = spec.capabilities.find((row) => row.live_status === "UNVERIFIED")!;
      expect(hidden).toBeDefined();
      hidden.live_status = "HIDDEN";
      context.validation.capabilities.find((row) => row.capability_id === hidden.capability_id)!.live_status = "HIDDEN";
      expect(spec.sections.capability.rows).toHaveLength(5);
    }, "CAPABILITY_RENDER_SHAPE");
  });

  it("cannot disguise an unreceipted number as a source-link label", async () => {
    await rejected((spec) => {
      spec.sections.closer.heading = [{ type: "source_ref", source_id: spec.sources[0].source_id, label: "99 percent of households" }];
    }, "NUMERIC_PROVENANCE_MISSING");
  });

  it("allows a numeric source title only when the label matches that reviewed title exactly", async () => {
    const { spec, context } = fixture();
    context.source_records[0].title = "Synthetic manual 2026";
    spec.sections.closer.heading = [{ type: "source_ref", source_id: spec.sources[0].source_id, label: "Synthetic manual 2026" }];
    const result = await compileDoorV44Page(spec, context);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    spec.sections.closer.heading = [{ type: "source_ref", source_id: spec.sources[0].source_id, label: "Synthetic manual 2027" }];
    const changed = await compileDoorV44Page(spec, context);
    expect(changed.ok).toBe(false);
  });

  it.each([
    [["imple", "mentation guide"], "WORDING_R16_BACKSTAGE"],
    [["jo", "b Packet"], "WORDING_R39_NAME_CASE"],
  ] as const)("checks visible wording across split inline nodes %j", async (parts, code) => {
    await rejected((spec) => {
      spec.sections.closer.heading = parts.map((value) => ({ type: "text", value }));
    }, code);
  });

  it("retains symptom-query authority without extending it to a separate denial", async () => {
    const { spec, context } = fixture();
    const result = await compileDoorV44Page(spec, context);
    expect(result.ok).toBe(true);
    await rejected((spec) => {
      spec.sections.hero.value_heading = "Dishwasher not draining: not another pitch.";
    }, "WORDING_R01_NEGATION");
  });

  it.each(["source_records", "fact_records", "asset_records", "visible_approvals"] as const)("fails closed on malformed nested %s without throwing or leaking a payload", async (field) => {
    await rejected((_spec, context) => {
      Object.assign(context, { [field]: [{ PRIVATE_TEST_VALUE: true }] });
    });
  });
});
