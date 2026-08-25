import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import { PLATFORM_POLICY_SETTINGS } from "@/platform/policy/store";

/**
 * A01 STEP 11 — THE CONSTRAINTS THAT APPLY TO EVERYTHING A01 ADDED.
 *
 * Four rules that are easy to hold and easy to break silently, checked against
 * A01's OWN new surface rather than against the repo in general — the global
 * versions of some of these already exist and would keep passing while a new
 * A01 file quietly violated them.
 */

/** Every file this build added or substantially changed. */
const A01_FILES = [
  "src/domain/problem/capabilities.ts",
  "src/domain/problem/claims.ts",
  "src/domain/problem/contracts.ts",
  "src/domain/problem/evidence-caps.ts",
  "src/domain/problem/language-corpus.ts",
  "src/domain/problem/safety.ts",
  "src/domain/problem/safety-package.ts",
  "src/domain/problem/taxonomy.ts",
  "src/domain/problem/untrusted-evidence.ts",
];

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf-8");
}

describe("A01 — C8: the RLS seam", () => {
  it("no new A01 module imports the service client directly", () => {
    // A00's approval struck "service-role-only" as settled doctrine: data access
    // ACCEPTS a PlatformClientProvider so a request-scoped, homeowner-
    // authenticated client can be threaded through later without restructuring.
    for (const file of A01_FILES) {
      const content = read(file);
      expect(content, file).not.toMatch(/serviceClientProvider/);
      expect(content, file).not.toMatch(/createClient\(/);
      expect(content, file).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("A01 added no data-access module at all this wave — and that is the record", () => {
    /**
     * A01 writes the first homeowner-OWNED rows in the product, so it is the
     * first place a real request-scoped RLS policy could exist. Nothing here
     * persists FactClaim or DerivationRecord yet: they are produced, returned
     * and evented, and the durable table is deliberately not minted in the same
     * change as the object.
     *
     * TODO-ASK-OWNER (Joshua): a fact_claim / derivation_record migration needs
     * an owner-scoped policy decision, not just a CREATE TABLE — who reads a
     * homeowner's claims, under whose credential, and whether the homeowner can
     * read their own. Copying 00003's deny-all + service-role grant would make
     * the answer "nobody but us, forever" by default, on the one table where
     * that default is worth a conversation.
     */
    for (const file of A01_FILES) {
      const content = read(file);
      expect(content, file).not.toMatch(/\.from\("[a-z_]+"\)/);
    }
  });
});

describe("A01 — C12: autonomy stays TBD", () => {
  it("A01's registry row carries autonomy_level TBD, not L2", () => {
    const a01 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A01");
    expect(a01).toBeDefined();
    // The spec asserts "L2" as decided; A00's approval ships TBD on every agent
    // because canon carries two non-identical autonomy scales and the owners
    // have not picked one. L2 stays a prose description of behaviour.
    expect(a01?.autonomy_level).toBe("TBD");
  });

  it("nothing A01 added writes an autonomy level anywhere", () => {
    for (const file of A01_FILES) {
      expect(read(file), file).not.toMatch(/autonomy_level/);
    }
  });
});

describe("A01 — no unlabeled dollars", () => {
  it("A01's policy key carries no dollar figure", () => {
    const photos = PLATFORM_POLICY_SETTINGS.find(
      (s) => s.key === "intake.max_photos_per_request"
    );
    expect(photos).toBeDefined();
    expect(photos?.key).not.toMatch(/usd|dollar/);
    expect(photos?.is_test_figure).toBeUndefined();
  });

  it("no A01 module states a price, and every cost it records is a real zero", () => {
    let checked = 0;
    for (const file of A01_FILES) {
      const content = read(file);
      // No currency literals of any kind.
      expect(content, file).not.toMatch(/\$\s?\d/);
      /**
       * Any cost_usd it WRITES is 0 — the deterministic path's true cost. A
       * model figure arrives from callModel already TEST-labelled.
       *
       * Only assignments count. `cost_usd: number | null;` is a type
       * declaration, and reading a declaration as a written value is how a
       * check ends up measuring the wrong thing.
       */
      for (const m of content.matchAll(/cost_usd:\s*([^;\n]+),/g)) {
        const written = m[1].trim();
        checked += 1;
        expect(
          ["0", "null", "costUsd"].some((ok) => written.startsWith(ok)),
          `${file}: ${m[0]}`
        ).toBe(true);
      }
    }
    // A check that inspected nothing is not a check.
    expect(checked).toBeGreaterThan(0);
  });
});

describe("A01 — nothing leaked into the wrong tree", () => {
  it("the customer contracts still do not appear under domain/search or platform/search", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    for (const dir of ["src/domain/search", "src/platform/search"]) {
      for (const file of walk(join(process.cwd(), dir))) {
        const content = readFileSync(file, "utf-8");
        expect(content, file).not.toMatch(/from "@\/domain\/problem/);
        expect(content, file).not.toMatch(/\bFactClaim\b/);
        expect(content, file).not.toMatch(/\bDerivationRecord\b/);
      }
    }
  });

  it("and A01 wrote nothing into source_fact_bundle_ids (HO-1)", () => {
    // WRITES, not mentions. claims.ts names the field in the comment recording
    // why A01 declines the hand-off, and a check that forbade the word would
    // forbid explaining the decision.
    for (const file of A01_FILES) {
      expect(read(file), file).not.toMatch(/source_fact_bundle_ids\s*[:=]/);
    }
  });
});
