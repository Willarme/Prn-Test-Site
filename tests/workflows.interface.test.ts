import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
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

/** A36 may read an allowlisted source file without importing its module. Parse
 * dependency syntax so inventory strings/comments cannot impersonate imports.
 * Resolve the repo's @ alias and relative paths; type-only dependencies remain
 * forbidden while this interface is deferred. This never evaluates source. */
function workflowDependencies(text: string, file: string, src: string): string[] {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const workflow = resolve(src, "platform/workflows").replace(/\\/g, "/");
  const literal = (node: ts.Node | undefined): string | null => {
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return literal(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left), right = literal(node.right);
      return left !== null && right !== null ? left + right : null;
    }
    // A static workflow-directory prefix already establishes the dependency,
    // even when the final module filename is selected dynamically.
    if (ts.isTemplateExpression(node)) return node.head.text;
    return null;
  };
  const record = (node: ts.Node | undefined) => {
    const specifier = literal(node)?.replace(/\\/g, "/");
    if (!specifier) return;
    const target = specifier.startsWith("@/") ? resolve(src, specifier.slice(2))
      : specifier.startsWith(".") ? resolve(dirname(file), specifier)
      : specifier.startsWith("src/") ? resolve(src, specifier.slice(4))
      : specifier.startsWith("platform/") ? resolve(src, specifier) : null;
    const normalized = target?.replace(/\\/g, "/");
    if (normalized === workflow || normalized?.startsWith(`${workflow}/`)) found.push(specifier);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) record(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) record(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) record(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const target = node.expression;
      if (target.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(target) && target.text === "require") ||
        (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === "require" && target.name.text === "resolve")) record(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe("A00 durable workflow orchestrator (deferred)", () => {
  it("is explicitly marked deferred", () => {
    expect(WORKFLOW_ORCHESTRATOR_STATUS).toBe("DEFERRED_INTERFACE_ONLY");
  });

  it("no Wave-0/1 code path imports it", () => {
    const src = join(process.cwd(), "src");
    const importers = walk(src).filter((f) => {
      if (f.replace(/\\/g, "/").includes("platform/workflows/")) return false;
      return workflowDependencies(readFileSync(f, "utf-8"), f, src).length > 0;
    });
    expect(importers).toEqual([]);
  });

  it.each([
    'const sourcePaths = ["src/platform/workflows/orchestrator.ts"];',
    '// import { engine } from "@/platform/workflows/orchestrator";',
    `const note = ${JSON.stringify('require("@/platform/workflows/orchestrator")')};`,
    'import { readFile } from "node:fs/promises"; readFile("src/platform/workflows/orchestrator.ts");',
  ])("distinguishes source inspection from a module dependency: %s", source => {
    const src = join(process.cwd(), "src");
    expect(workflowDependencies(source, join(src, "platform/readiness/baseline.ts"), src)).toEqual([]);
  });

  it.each([
    'import { engine } from "@/platform/workflows/orchestrator";',
    'import type { WorkflowOrchestrator } from "@/platform/workflows/orchestrator";',
    'import "@/platform/workflows/orchestrator";',
    'export { engine } from "@/platform/workflows/orchestrator";',
    'export * from "@/platform/workflows";',
    'import engine = require("@/platform/workflows/orchestrator");',
    'const engine = require("@/platform/workflows/orchestrator");',
    'const resolved = require.resolve("@/platform/workflows/orchestrator");',
    'const engine = import("@/platform/workflows/orchestrator");',
    'type Engine = import("@/platform/workflows/orchestrator").WorkflowOrchestrator;',
    'import { engine } from "../workflows/orchestrator";',
    'const engine = import("@/platform/" + "workflows/orchestrator");',
    'const engine = import(`@/platform/workflows/${name}`);',
  ])("keeps an actual deferred dependency forbidden: %s", source => {
    const src = join(process.cwd(), "src");
    expect(workflowDependencies(source, join(src, "platform/readiness/probe.ts"), src)).toHaveLength(1);
  });
});
