import { describe, expect, it } from "vitest";
import { analyzeDoorV44Batch, doorV44DecisionBlocks } from "@/domain/search/door-v44/batch-analysis";
import type { DoorV44BatchInput } from "@/domain/search/door-v44/batch-analysis";
import type { DoorV44RichNode } from "@/domain/search/door-v44/types";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

async function fixture(id: string): Promise<DoorV44BatchInput> {
  const input = await compilerFixture("f04");
  const priorId = input.spec.identity.page_id;
  const identity = input.spec.identity;
  identity.page_id = id;
  identity.canonical_intent_id = id + ".intent";
  identity.canonical_path = "/problems/" + id.replaceAll(".", "-");
  identity.slug = id.replaceAll(".", "-");
  input.spec.intake.attribution.page_id = id;
  input.spec.intake.attribution.landing_path = identity.canonical_path;
  for (const row of input.context.validation.pages) {
    if (row.page_id === priorId) { row.page_id = id; row.canonical_path = identity.canonical_path; }
  }
  for (const row of input.context.validation.eligibilities) {
    if (row.page_id === priorId) { row.page_id = id; row.canonical_intent_id = identity.canonical_intent_id; }
  }
  return { spec: input.spec, context: input.context.validation };
}
function result(raw: unknown) {
  const report = analyzeDoorV44Batch(raw);
  expect(report.ok, JSON.stringify(report)).toBe(true);
  if (!report.ok) throw new Error("Invalid test fixture");
  return report;
}
function visit(nodes: DoorV44RichNode[], callback: (node: Extract<DoorV44RichNode, { type: "text" }>) => void) {
  for (const node of nodes) {
    if (node.type === "text") callback(node);
    if ("children" in node) visit(node.children, callback);
  }
}
describe("v44 batch decision-content triage", () => {
  it("blocks an exact copied dynamic body despite different page and intent IDs", async () => {
    const report = result([await fixture("fixture.left"), await fixture("fixture.right")]);
    expect(report.page_count).toBe(2);
    expect(report.pairs[0].noun_swap_clone).toBe(true);
    expect(report.disposition).toBe("BLOCKED");
    expect(report.pairs[0].dynamic_token_jaccard).toBe(1);
    expect(report.pairs[0].identical_sentence_share).toBe(1);
    expect(report.release_ready).toBe(false);
  });
  it("detects a subject-only substitution through trusted taxonomy labels", async () => {
    const a = await fixture("fixture.left");
    const b = await fixture("fixture.right");
    visit(a.spec.sections.hero.answer, node => { node.value = node.value.replace("This synthetic page", "The dishwasher page"); });
    visit(b.spec.sections.hero.answer, node => { node.value = node.value.replace("This synthetic page", "The refrigerator page"); });
    const rename = (value: unknown): unknown => typeof value === "string"
      ? value.replace(/dishwasher/gi, word => word === word.toUpperCase() ? "REFRIGERATOR" : "refrigerator")
      : Array.isArray(value) ? value.map(rename) : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rename(child)])) : value;
    b.spec.sections = rename(b.spec.sections) as typeof b.spec.sections;
    b.spec.intake = rename(b.spec.intake) as typeof b.spec.intake;
    const subject = b.spec.subject;
    for (const key of Object.keys(subject) as Array<keyof typeof subject>) {
      if (key !== "subject_kind" && key !== "subject_id") {
        subject[key] = subject[key].replace(/dishwasher/gi, word => word === word.toUpperCase() ? "REFRIGERATOR" : "refrigerator");
      }
    }
    const trusted = b.context.subjects.find(row => row.subject_id === subject.subject_id)!;
    Object.assign(trusted, subject);
    const report = result([a, b]);
    expect(report.pairs[0].noun_swap_clone).toBe(true);
    expect(report.pairs[0].dynamic_token_jaccard).toBeLessThan(1);
    expect(report.disposition).toBe("BLOCKED");
  });
  it("keeps near-copies in review instead of accepting a small wording change", async () => {
    const a = await fixture("fixture.left"), b = await fixture("fixture.right");
    b.spec.sections.observations.rows[0].look = "Distinct visible observation for an independent fixture boundary";
    const report = result([a, b]);
    expect(report.pairs[0].noun_swap_clone).toBe(false);
    expect(report.disposition).toBe("REVIEW_REQUIRED");
    expect(report.pairs[0].findings).toContain("DYNAMIC_TOKEN_SIMILARITY");
    expect(report.pairs[0].findings).toContain("IDENTICAL_SENTENCE_SHARE");
    expect(report.release_ready).toBe(false);
  });
  it("excludes page labels, CTA furniture, source metadata and generated counts", async () => {
    const input = await fixture("fixture.left");
    const blocks = doorV44DecisionBlocks(input.spec);
    const before = JSON.stringify(blocks);
    input.spec.head.nav.category_label = "PRIVATE_NAV_FURNITURE";
    input.spec.intake.so_far_label = "PRIVATE_INTAKE_FURNITURE";
    input.spec.sources[0].note = "PRIVATE_SOURCE_METADATA";
    expect(JSON.stringify(doorV44DecisionBlocks(input.spec))).toBe(before);
    expect(before).not.toContain("PRIVATE_");
  });
  it("binds the pair receipt to exact spec changes, including changes outside its heuristic", async () => {
    const a = await fixture("fixture.left"), b = await fixture("fixture.right");
    const before = result([a, b]);
    b.spec.sources[0].note = "Changed source annotation";
    const after = result([a, b]);
    expect(after.pairs[0].findings).toEqual(before.pairs[0].findings);
    expect(after.pairs[0].pair_hash).not.toBe(before.pairs[0].pair_hash);
    expect(after.input_hash).not.toBe(before.input_hash);
  });
  it("binds trusted module and context identities even when visible copy stays the same", async () => {
    const a = await fixture("fixture.left"), b = await fixture("fixture.right");
    const before = result([a, b]);
    b.context.families[0].source_family_id = "fixture.revised_family";
    b.context.input_hashes.source_bundle_sha256 = "b".repeat(64);
    const after = result([a, b]);
    expect(after.pairs[0].findings).toEqual(before.pairs[0].findings);
    expect(after.pairs[0].pair_hash).not.toBe(before.pairs[0].pair_hash);
    expect(after.input_hash).not.toBe(before.input_hash);
  });
  it.each(["stats", "capability", "intake"])("includes decision-bearing %s copy in the clone check", async field => {
    const a = await fixture("fixture.left"), b = await fixture("fixture.right");
    const distinction = "Cycle completion in the recorded account distinguishes timing from water location.";
    if (field === "stats") b.spec.sections.stats.cards[0].statement = distinction;
    if (field === "capability") b.spec.sections.capability.rows[0].tells = distinction;
    if (field === "intake") b.spec.intake.prompts[0].text = distinction;
    const report = result([a, b]);
    expect(report.pairs[0].noun_swap_clone).toBe(false);
    expect(report.disposition).toBe("REVIEW_REQUIRED");
  });
  it("citation label changes cannot make an exact copied body escape the clone blocker", async () => {
    const a = await fixture("fixture.left"), b = await fixture("fixture.right");
    function change(nodes: DoorV44RichNode[]) {
      for (const node of nodes) {
        if (node.type === "source_ref") node.label = "Different reference label";
        if ("children" in node) change(node.children);
      }
    }
    change(b.spec.sections.hero.answer);
    const report = result([a, b]);
    expect(report.pairs[0].noun_swap_clone).toBe(true);
    expect(report.pairs[0].dynamic_token_jaccard).toBe(1);
    expect(report.disposition).toBe("BLOCKED");
  });
  it("points at the actual nested spec or context object in batch diagnostics", async () => {
    const a = await fixture("fixture.left"), b = await fixture("fixture.right");
    b.spec.subject.display_label = "Changed subject";
    const specReport = analyzeDoorV44Batch([a, b]);
    expect(specReport.ok).toBe(false);
    if (!specReport.ok) expect(specReport.errors).toContainEqual({ code: "SUBJECT_MISMATCH", pointer: "/1/spec/subject" });
    b.context.mode = "bad" as "fixture";
    const contextReport = analyzeDoorV44Batch([a, b]);
    expect(contextReport.ok).toBe(false);
    if (!contextReport.ok) expect(contextReport.errors.some(row => row.pointer === "/1/context")).toBe(true);
  });
  it("is deterministic across batch order and preserves inputs", async () => {
    const a = await fixture("fixture.left"), b = await fixture("fixture.right");
    const snapshot = JSON.stringify([a, b]);
    expect(result([a, b])).toEqual(result([b, a]));
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
  it("rejects duplicate pages and canonical intents", async () => {
    const a = await fixture("fixture.left");
    const report = analyzeDoorV44Batch([a, structuredClone(a)]);
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.errors.map(row => row.code)).toEqual(["BATCH_DUPLICATE_PAGE", "BATCH_DUPLICATE_INTENT"]);
  });
  it("fails governed preflight before attempting similarity analysis", async () => {
    const a = await fixture("fixture.left"), b = await fixture("fixture.right");
    b.context.families = [];
    const report = analyzeDoorV44Batch([a, b]);
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.errors.some(row => row.code.includes("FAMILY"))).toBe(true);
  });
  it.each([null, [], [{}], [null, null], Array(101).fill(null)])("rejects malformed/bounded input %#", raw => {
    expect(analyzeDoorV44Batch(raw).ok).toBe(false);
  });
  it("does not execute accessors or expose their private values", async () => {
    const a = await fixture("fixture.left");
    let called = false;
    const b = { get spec() { called = true; return "PRIVATE_MARKER"; }, context: {} };
    const report = analyzeDoorV44Batch([a, b]);
    expect(report.ok).toBe(false);
    expect(called).toBe(false);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_MARKER");
  });
});
