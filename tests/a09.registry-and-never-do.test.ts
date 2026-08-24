import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import { APPROVAL_KINDS } from "@/platform/approvals/kinds";
import { currentEventDefinition } from "@/platform/events/dictionary";
import { A09_EVENT_NAMES, EVENT_NAMES } from "@/platform/events/names";
import { getPolicySetting } from "@/platform/policy/store";
import { A09_EMITTED_EVENT_NAMES } from "@/platform/quality/events";
import { INVARIANT_RULES } from "@/platform/quality/invariants";
import {
  KPI_READ_PATHS_HONOURING_QUARANTINE,
  CUSTOMER_READ_PATHS_DELIBERATELY_UNFILTERED,
} from "@/platform/quality/quarantine";
import {
  AUTO_REPAIR_ALLOW_LIST,
  FORBIDDEN_TARGET_FIELDS,
  REPAIR_KINDS,
} from "@/platform/quality/repairs";
import { NEVER_REPAIRABLE_ENTITY_TYPES } from "@/platform/quality/types";

/**
 * A09's registry declaration, and the things A09 must NEVER do — asserted by
 * reading the source, so a future edit that quietly crosses one of these lines
 * fails here rather than in production.
 */

const a09 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A09")!;

const QUALITY_DIR = join(process.cwd(), "src", "platform", "quality");
const qualityFiles = readdirSync(QUALITY_DIR).map((f) => join(QUALITY_DIR, f));

function sourceOf(file: string): string {
  return readFileSync(file, "utf-8");
}

/** Source with comments stripped — a prose mention is not a wiring. */
function codeOf(file: string): string {
  return sourceOf(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("A09 registry entry", () => {
  it("keeps autonomy_level TBD — OD-10 makes graduation a process gate, not a machine gate", () => {
    expect(a09.autonomy_level).toBe("TBD");
  });

  it("uses the shipped kill-switch ref convention, not a new one", () => {
    expect(a09.kill_switch_ref).toBe("agent:A09");
  });

  it("declares NO capabilities — A09 makes no model or gateway call in Wave 0", () => {
    expect(a09.allowed_capabilities).toEqual([]);
  });

  it("enumerates what the built modules read and write", () => {
    expect(a09.data_access).toContain("event_envelope");
    expect(a09.data_access).toContain("data_quality_issue");
    expect(a09.write_access).toContain("data_quality_issue");
    expect(a09.write_access).toContain("quarantine_marker");
    expect(a09.write_access).toContain("approval_item");
  });

  it("has NO customer-evidence table in WRITE scope", () => {
    for (const table of [
      "evidence_object",
      "intake_answer",
      "diagnosis_answer",
      "consent_event",
      "disclosure_version",
      "job_packet",
      "published_page",
      "staged_page_spec",
      "page_spec",
    ]) {
      expect(a09.write_access, `${table} must never be writable by A09`).not.toContain(table);
    }
  });

  it("keeps the consent ledger readable and never writable", () => {
    expect(a09.data_access).toContain("consent_event");
    expect(a09.write_access).not.toContain("consent_event");
    expect(NEVER_REPAIRABLE_ENTITY_TYPES).toContain("consent_event");
  });

  it("names its cadence and its gate as configuration, not constants", () => {
    expect(a09.schedule).toMatch(/quality\.reconciliation_cadence_hours/);
    expect(getPolicySetting<number>("quality.reconciliation_cadence_hours")).not.toBeNull();
    expect(getPolicySetting<boolean>("quality.ingest_validation_enabled")).not.toBeNull();
    expect(getPolicySetting<boolean>("quality.auto_repair_enabled")).not.toBeNull();
  });

  it("sets no budget dollar figure", () => {
    expect(a09.budgets.ai_api_dollars_per_day).toBeUndefined();
    expect(Object.keys(a09.budgets)).toEqual([]);
  });
});

describe("NEVER: alter page publish state or page content (condition 8)", () => {
  it("no A09 module calls setPublished or writes the published-page store", () => {
    for (const file of qualityFiles) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/setPublished\s*\(/);
      expect(code, file).not.toMatch(/published_page_ids/);
      expect(code, file).not.toMatch(/staged_specs\s*\.\s*(push|splice)/);
    }
  });

  it("no A09 module writes a PageSpec's lifecycle or content", () => {
    for (const file of qualityFiles) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/assertTransition|canTransition\s*\(\s*[^)]*\)\s*=/);
      expect(code, file).not.toMatch(/\.qa\s*=|\.content_blocks\s*=|\.indexed\s*=/);
    }
  });

  it("forbids every publish/content field as a repair target", () => {
    for (const field of ["status", "indexed", "canonical_path", "content_blocks", "qa"]) {
      expect(FORBIDDEN_TARGET_FIELDS).toContain(field);
    }
    for (const kind of REPAIR_KINDS) {
      expect(FORBIDDEN_TARGET_FIELDS, kind.repair_kind).not.toContain(kind.target_field);
      expect(kind.applies_to, kind.repair_kind).not.toBe("page_spec");
    }
  });

  it("ships no repair class enabled — Joshua names the first one, at review", () => {
    expect(AUTO_REPAIR_ALLOW_LIST).toEqual([]);
    expect(getPolicySetting<boolean>("quality.auto_repair_enabled")!.value).toBe(false);
  });

  it("leaves the shipped publish route untouched by A09", () => {
    const route = sourceOf(
      join(process.cwd(), "src", "app", "api", "admin", "pages", "publish", "route.ts")
    );
    expect(route).not.toMatch(/platform\/quality/);
  });
});

describe("NEVER: write to the consent ledger", () => {
  it("no A09 module writes consent_event or disclosure_version", () => {
    for (const file of qualityFiles) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/from\(["']consent_event["']\)/);
      expect(code, file).not.toMatch(/from\(["']disclosure_version["']\)/);
      expect(code, file).not.toMatch(/consent_events\s*\.\s*(push|splice)/);
      expect(code, file).not.toMatch(/ensureDisclosure\s*\(/);
    }
  });

  it("marks every consent rule detect-only", () => {
    for (const rule of INVARIANT_RULES.filter((r) => r.applies_to === "consent_event")) {
      expect(rule.detect_only, rule.rule_id).toBe(true);
    }
  });
});

describe("NEVER: a bare-string event emission or a second name family", () => {
  it("emits exactly six names, every one of them registered and approved", () => {
    expect(A09_EMITTED_EVENT_NAMES).toHaveLength(6);
    for (const name of A09_EMITTED_EVENT_NAMES) {
      expect(EVENT_NAMES as readonly string[], name).toContain(name);
      expect(currentEventDefinition(name)?.status, name).toBe("approved");
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("emits from ONE module, so the whole surface is auditable in one place", () => {
    for (const file of qualityFiles) {
      if (file.endsWith("events.ts")) continue;
      expect(codeOf(file), file).not.toMatch(/validateAndEmit|emitPlatformEvent/);
    }
  });

  it("registers no repair.* / reconciliation.* / data.* family from canon doc 20", () => {
    expect(EVENT_NAMES.some((n) => n.startsWith("repair."))).toBe(false);
    expect(EVENT_NAMES.some((n) => n.startsWith("reconciliation."))).toBe(false);
    expect(EVENT_NAMES.some((n) => n.startsWith("data."))).toBe(false);
    for (const name of A09_EVENT_NAMES) expect(name.startsWith("data_quality.")).toBe(true);
  });

  it("files into the shipped approval_kind vocabulary, inventing none", () => {
    const repairs = codeOf(join(QUALITY_DIR, "repairs.ts"));
    for (const kind of ["data.repair", "data.identity_merge"]) {
      expect(APPROVAL_KINDS as readonly string[]).toContain(kind);
      expect(repairs).toMatch(new RegExp(kind.replace(".", "\\.")));
    }
  });
});

describe("NEVER: change what a customer sees", () => {
  it("no customer-facing route or component imports A09", () => {
    const customerSurfaces = [
      join("src", "app", "start", "page.tsx"),
      join("src", "app", "complete", "[request_id]", "page.tsx"),
      join("src", "app", "results", "[request_id]", "page.tsx"),
      join("src", "app", "page.tsx"),
      join("src", "app", "api", "intake", "route.ts"),
    ];
    for (const rel of customerSurfaces) {
      const source = sourceOf(join(process.cwd(), rel));
      expect(source, rel).not.toMatch(/platform\/quality/);
    }
  });

  it("keeps the customer read paths out of the quarantine filter, deliberately", () => {
    expect(CUSTOMER_READ_PATHS_DELIBERATELY_UNFILTERED).toContain("stores/runtime.ts:getJourney");
    expect(KPI_READ_PATHS_HONOURING_QUARANTINE.length).toBeGreaterThan(0);
    // The parked homeowner-visibility question has a knob, and it is OFF.
    expect(getPolicySetting<boolean>("quality.quarantine_customer_reads")!.value).toBe(false);
  });

  it("parks the melissa-owned questions as TODO-ASK-OWNER markers, never as decisions", () => {
    const marked = [
      join(QUALITY_DIR, "quarantine.ts"),
      join(QUALITY_DIR, "invariants.ts"),
      join(process.cwd(), "src", "platform", "policy", "store.ts"),
    ];
    for (const file of marked) {
      expect(sourceOf(file), file).toMatch(/TODO-ASK-OWNER/);
    }
  });
});

describe("NEVER: a dollar figure or a secret", () => {
  it("names no dollar amount anywhere in A09", () => {
    for (const file of qualityFiles) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/\$\s?\d/);
      expect(code, file).not.toMatch(/usd_per|price|_dollars/i);
      // The only permitted values are 0 (the deterministic no-model cost) and
      // null (no cost recorded). Neither is a figure; anything else would be.
      const costs = code.match(/cost_usd:\s*([^,\n]+)/g) ?? [];
      for (const c of costs) expect(c, file).toMatch(/cost_usd:\s*(0|null)/);
    }
  });

  it("hard-codes no credential-shaped literal", () => {
    for (const file of walk(QUALITY_DIR)) {
      expect(sourceOf(file), file).not.toMatch(
        /(api[_-]?key|password|secret|token)\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']/i
      );
    }
  });
});

describe("NEVER: import the service client directly (condition 6)", () => {
  it("every A09 data module accepts a PlatformClientProvider instead", () => {
    for (const file of qualityFiles) {
      const code = codeOf(file);
      if (!/from\("@supabase\/supabase-js"\)|createClient/.test(code)) continue;
      expect(code, file).not.toMatch(/createClient\s*\(/);
    }
    expect(codeOf(join(QUALITY_DIR, "store.ts"))).toMatch(/PlatformClientProvider/);
    expect(codeOf(join(QUALITY_DIR, "issues.ts"))).toMatch(/PlatformClientProvider/);
  });
});
