import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_ORCHESTRATOR_STATUS } from "@/platform/workflows/orchestrator";

/**
 * A00 §9 step 9 — Durable Workflow Orchestrator is INTERFACE ONLY and
 * DEFERRED: it compiles, exports its contract, and nothing else in src/
 * imports it. When a real multi-step agent lands, this "unused" assertion is
 * the test that gets deleted — deliberately loud.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("A00 durable workflow orchestrator (deferred)", () => {
  it("is explicitly marked deferred", () => {
    expect(WORKFLOW_ORCHESTRATOR_STATUS).toBe("DEFERRED_INTERFACE_ONLY");
  });

  it("no Wave-0/1 code path imports it", () => {
    const src = join(process.cwd(), "src");
    const importers = walk(src).filter((f) => {
      if (f.replace(/\\/g, "/").includes("platform/workflows/")) return false;
      return /platform\/workflows/.test(readFileSync(f, "utf-8"));
    });
    expect(importers).toEqual([]);
  });
});
