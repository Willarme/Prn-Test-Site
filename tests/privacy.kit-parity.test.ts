import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConsentAction, ConsentEvent } from "@/domain/privacy/contracts";
import { RiskClass, CapabilityStatus } from "@/platform/capabilities/contracts";

const KIT = join(
  process.cwd(),
  "docs",
  "canon",
  "build-kit",
  "PRN_Black_Car_Coding_Agent_Build_Kit_REV_D",
  "schemas"
);

function kitSchema(name: string) {
  return JSON.parse(readFileSync(join(KIT, name), "utf-8"));
}

const validConsent = {
  consent_event_id: "ce_1",
  person_id: null,
  guest_session_id: "gs_1",
  problem_id: null,
  scope: "intake.data_processing",
  action: "GRANT",
  disclosure_version_id: "dv_1",
  surface: "start_request_form",
  trace_id: null,
  occurred_at: "2026-08-14T12:00:00Z",
};

describe("ConsentEvent parity with build-kit consent_event.schema.json", () => {
  const kit = kitSchema("consent_event.schema.json");

  it("accepts a valid consent event", () => {
    expect(ConsentEvent.safeParse(validConsent).success).toBe(true);
  });

  it("requires every field the kit marks required", () => {
    for (const field of kit.required as string[]) {
      const broken: Record<string, unknown> = { ...validConsent };
      delete broken[field];
      expect(ConsentEvent.safeParse(broken).success, `missing ${field} must fail`).toBe(false);
    }
  });

  it("matches the kit's consent action enum exactly", () => {
    expect([...ConsentAction.options].sort()).toEqual(
      [...(kit.properties.action.enum as string[])].sort()
    );
  });
});

describe("Capability contracts parity with build-kit capability_definition.schema.json", () => {
  const kit = kitSchema("capability_definition.schema.json");

  it("matches the kit risk-class enum exactly", () => {
    expect([...RiskClass.options].sort()).toEqual(
      [...(kit.properties.risk_class.enum as string[])].sort()
    );
  });

  it("matches the kit capability status enum exactly", () => {
    expect([...CapabilityStatus.options].sort()).toEqual(
      [...(kit.properties.status.enum as string[])].sort()
    );
  });
});
