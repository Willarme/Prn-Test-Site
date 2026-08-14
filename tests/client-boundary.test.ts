import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #23 §8.3: no vendor secret or vendor client may reach browser bundles.
 * Wave-level enforcement: nothing under src/app may import platform adapters,
 * stores, or node-only modules; and no source file may contain a literal that
 * looks like a real credential.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("client/server boundary", () => {
  it("src/app imports no adapters, stores, or vendor clients", () => {
    const appFiles = walk(join(process.cwd(), "src", "app"));
    for (const file of appFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/platform\/adapters/);
      expect(content).not.toMatch(/platform\/stores/);
      expect(content).not.toMatch(/dataforseo/i);
      expect(content).not.toMatch(/process\.env\.DATAFORSEO/);
    }
  });

  it("no source file hard-codes a credential-shaped literal", () => {
    const files = walk(join(process.cwd(), "src"));
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      // Real keys look like long opaque literals assigned to auth-ish names.
      expect(content).not.toMatch(/(api[_-]?key|password|secret|token)\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']/i);
    }
  });

  it("only the DataForSEO adapter file knows DataForSEO endpoints", () => {
    const files = walk(join(process.cwd(), "src")).filter(
      (f) => !f.replace(/\\/g, "/").endsWith("platform/adapters/dataforseo.ts")
    );
    for (const file of files) {
      expect(readFileSync(file, "utf-8")).not.toMatch(/api\.dataforseo\.com/);
    }
  });
});
