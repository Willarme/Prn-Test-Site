import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #23 §8.3 / #22A boundary rules, updated for the app slice:
 *  - BROWSER code ("use client" files) may never import stores, adapters, or
 *    touch env secrets — those are server-only.
 *  - Vendor endpoints/credentials exist ONLY in the DataForSeoAdapter file.
 *  - No source file hard-codes a credential-shaped literal.
 * Server components and API routes are server code and may use stores; that
 * is the architecture, not a leak.
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

const allSrc = walk(join(process.cwd(), "src"));
const clientFiles = allSrc.filter((f) => {
  const head = readFileSync(f, "utf-8").slice(0, 200);
  return /^\s*["']use client["']/.test(head);
});

describe("client/server boundary", () => {
  it("has client components to check (sanity)", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it("browser code imports no stores, adapters, or vendor clients", () => {
    for (const file of clientFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content, file).not.toMatch(/platform\/adapters/);
      expect(content, file).not.toMatch(/platform\/stores/);
      expect(content, file).not.toMatch(/dataforseo/i);
      expect(content, file).not.toMatch(/process\.env\./);
    }
  });

  it("no source file hard-codes a credential-shaped literal", () => {
    for (const file of allSrc) {
      const content = readFileSync(file, "utf-8");
      expect(content, file).not.toMatch(
        /(api[_-]?key|password|secret|token)\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']/i
      );
    }
  });

  it("only the DataForSEO adapter file knows DataForSEO endpoints", () => {
    const files = allSrc.filter(
      (f) => !f.replace(/\\/g, "/").endsWith("platform/adapters/dataforseo.ts")
    );
    for (const file of files) {
      expect(readFileSync(file, "utf-8"), file).not.toMatch(/api\.dataforseo\.com/);
    }
  });

  it("only owner-admin API routes can mutate publish state or policy", () => {
    const mutators = allSrc.filter((f) => {
      const c = readFileSync(f, "utf-8");
      return /setPublished\(|appendAudit\(|published_page_ids\s*=|admin_audit\.push|store\.save\(|policyStore\(\)\.save/.test(c);
    });
    for (const file of mutators) {
      const normalized = file.replace(/\\/g, "/");
      expect(
        normalized.includes("/app/api/admin/") ||
          normalized.includes("/platform/stores/") ||
          // A00: the Approval Center is the platform store for owner
          // decisions — resolveApproval() appends the decision to the admin
          // audit trail, and its callers are admin-gated surfaces only.
          normalized.endsWith("/platform/approvals/center.ts"),
        `${normalized} mutates owner state outside the admin API`
      ).toBe(true);
    }
  });

  it("page/layout server components render from domain contracts, never vendor adapters", () => {
    const pageFiles = allSrc.filter((f) => /app[\\/].*(page|layout)\.tsx$/.test(f));
    for (const file of pageFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content, file).not.toMatch(/platform\/adapters/);
    }
  });
});
