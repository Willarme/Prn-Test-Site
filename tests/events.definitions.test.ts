import { afterEach, describe, expect, it } from "vitest";
import {
  EventDefinition,
  MetricDefinition,
  RETENTION_CLASS_PLACEHOLDER,
  analyzeEventChange,
  analyzeMetricChange,
} from "@/platform/events/definitions";
import {
  dictionaryConfig,
  nameDistance,
  normalizeName,
  resetDictionaryConfigForTests,
  setDictionaryConfig,
} from "@/platform/events/config";
import { getPolicySetting } from "@/platform/policy/store";

/**
 * A08 build step 1 (spec §9): EventDefinition + MetricDefinition schemas,
 * strict, with at least one ACCEPTING and one REJECTING example per schema.
 */

afterEach(() => {
  resetDictionaryConfigForTests();
});

const validEvent = {
  event_name: "packet.generated",
  definition_version: 1,
  description: "A job packet was produced for a problem record.",
  owning_agent_or_domain: "packet",
  required_envelope_fields: ["context.problem_id"],
  payload_schema_ref: null,
  privacy_class: "internal",
  retention_class: RETENTION_CLASS_PLACEHOLDER,
  status: "approved",
  tenant_id: "prn",
};

const validMetric = {
  metric_key: "seo.pages_published",
  definition_version: 1,
  display_name: "Pages published",
  formula_description: "Count of page.published events in the window.",
  metric_type: "count",
  source_events: ["page.published"],
  metric_window: "rolling_7d",
  status: "approved",
  tenant_id: "prn",
};

describe("EventDefinition schema", () => {
  it("accepts a well-formed definition", () => {
    expect(EventDefinition.safeParse(validEvent).success).toBe(true);
  });

  it("rejects a name that breaks the configured domain.action convention", () => {
    expect(EventDefinition.safeParse({ ...validEvent, event_name: "packetgenerated" }).success).toBe(
      false
    );
    expect(EventDefinition.safeParse({ ...validEvent, event_name: "Packet.Generated" }).success).toBe(
      false
    );
  });

  it("rejects unknown keys — strict, matching the build kit's schema convention", () => {
    expect(EventDefinition.safeParse({ ...validEvent, payload: { anything: 1 } }).success).toBe(
      false
    );
  });

  it("rejects a required field the shipped envelope does not have", () => {
    expect(
      EventDefinition.safeParse({ ...validEvent, required_envelope_fields: ["landing_context"] })
        .success
    ).toBe(false);
    expect(
      EventDefinition.safeParse({ ...validEvent, required_envelope_fields: ["trace_id"] }).success
    ).toBe(true);
  });

  it("rejects a missing retention_class — presence is enforced even though values are the owner's", () => {
    const { retention_class: _drop, ...withoutRetention } = validEvent;
    expect(EventDefinition.safeParse(withoutRetention).success).toBe(false);
  });

  it("rejects a fourth privacy vocabulary — only the shipped three values", () => {
    expect(EventDefinition.safeParse({ ...validEvent, privacy_class: "public_record" }).success).toBe(
      false
    );
  });

  it("rejects a deprecation with no forward alias — history is never simply deleted", () => {
    expect(EventDefinition.safeParse({ ...validEvent, status: "deprecated" }).success).toBe(false);
    expect(
      EventDefinition.safeParse({
        ...validEvent,
        status: "deprecated",
        deprecated_by: "packet.created",
      }).success
    ).toBe(true);
  });

  it("carries an optional tenant_id and defaults to nothing more than a reserved field", () => {
    const { tenant_id: _drop, ...withoutTenant } = validEvent;
    expect(EventDefinition.safeParse(withoutTenant).success).toBe(true);
    expect(EventDefinition.parse(validEvent).tenant_id).toBe("prn");
  });
});

describe("MetricDefinition schema", () => {
  it("accepts a well-formed definition", () => {
    expect(MetricDefinition.safeParse(validMetric).success).toBe(true);
  });

  it("rejects a rate metric with no denominator_event — blocks silent denominator drift", () => {
    expect(
      MetricDefinition.safeParse({ ...validMetric, metric_type: "rate" }).success
    ).toBe(false);
    expect(
      MetricDefinition.safeParse({
        ...validMetric,
        metric_type: "rate",
        denominator_event: "intake.started",
      }).success
    ).toBe(true);
  });

  it("rejects a ratio metric with no denominator_event", () => {
    expect(MetricDefinition.safeParse({ ...validMetric, metric_type: "ratio" }).success).toBe(false);
  });

  it("rejects approving a metric whose type is still TBD", () => {
    expect(MetricDefinition.safeParse({ ...validMetric, metric_type: "TBD" }).success).toBe(false);
    expect(
      MetricDefinition.safeParse({ ...validMetric, metric_type: "TBD", status: "proposed" }).success
    ).toBe(true);
  });

  it("rejects an approved metric with no source events — no untraceable numbers", () => {
    expect(MetricDefinition.safeParse({ ...validMetric, source_events: [] }).success).toBe(false);
  });

  it("rejects an un-TEST-labeled target — a target is a business commitment", () => {
    expect(MetricDefinition.safeParse({ ...validMetric, target: 0.4 }).success).toBe(false);
    expect(
      MetricDefinition.safeParse({ ...validMetric, target: 0.4, target_is_test_figure: true })
        .success
    ).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(MetricDefinition.safeParse({ ...validMetric, formula: "x/y" }).success).toBe(false);
  });

  it("rejects a deprecated metric with no successor", () => {
    expect(MetricDefinition.safeParse({ ...validMetric, status: "deprecated" }).success).toBe(false);
  });
});

describe("dictionary configuration (A08 §10: config, not constants)", () => {
  it("defaults to the convention the shipped test already enforces", () => {
    expect(dictionaryConfig().event_name_pattern.source).toBe("^[a-z_]+\\.[a-z_]+$");
  });

  it("is genuinely swappable without a rewrite", () => {
    setDictionaryConfig({ event_name_pattern: /^[a-z_]+$/ });
    expect(EventDefinition.safeParse({ ...validEvent, event_name: "packet_generated" }).success).toBe(
      true
    );
  });

  it("keeps the numeric tunables in the A00 policy store", () => {
    expect(getPolicySetting<number>("events.near_duplicate_max_distance")?.value).toBe(2);
    expect(getPolicySetting<number>("events.dictionary_audit_cadence_hours")?.value).toBe(24);
  });

  it("normalizes names before comparing them", () => {
    expect(normalizeName("  Packet.Generated ")).toBe("packet.generated");
    expect(nameDistance("packet.generated", "packet.generate")).toBe(1);
    expect(nameDistance("packet.generated", "  Packet.Generated ")).toBe(0);
  });
});

describe("backward-compatibility analysis (pre-answer 3)", () => {
  const before = EventDefinition.parse(validEvent);

  it("calls a description edit additive", () => {
    const after = EventDefinition.parse({ ...validEvent, description: "Reworded." });
    expect(analyzeEventChange(before, after).change_class).toBe("additive");
  });

  it("calls removing a required field breaking", () => {
    const after = EventDefinition.parse({ ...validEvent, required_envelope_fields: [] });
    const analysis = analyzeEventChange(before, after);
    expect(analysis.change_class).toBe("breaking");
    expect(analysis.differences[0]).toMatch(/required field removed/);
  });

  it("calls newly requiring a field breaking — it breaks every existing producer", () => {
    const after = EventDefinition.parse({
      ...validEvent,
      required_envelope_fields: ["context.problem_id", "trace_id"],
    });
    expect(analyzeEventChange(before, after).change_class).toBe("breaking");
  });

  it("calls a denominator or metric_window change breaking", () => {
    const m0 = MetricDefinition.parse(validMetric);
    const m1 = MetricDefinition.parse({ ...validMetric, metric_window: "rolling_28d" });
    expect(analyzeMetricChange(m0, m1).change_class).toBe("breaking");

    const rate0 = MetricDefinition.parse({
      ...validMetric,
      metric_type: "rate",
      denominator_event: "intake.started",
    });
    const rate1 = MetricDefinition.parse({
      ...validMetric,
      metric_type: "rate",
      denominator_event: "page.viewed",
    });
    expect(analyzeMetricChange(rate0, rate1).change_class).toBe("breaking");
  });

  it("calls adding a source event additive but removing one breaking", () => {
    const m0 = MetricDefinition.parse(validMetric);
    const added = MetricDefinition.parse({
      ...validMetric,
      source_events: ["page.published", "page.staged"],
    });
    expect(analyzeMetricChange(m0, added).change_class).toBe("additive");
    expect(analyzeMetricChange(added, m0).change_class).toBe("breaking");
  });
});
