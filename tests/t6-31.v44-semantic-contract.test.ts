import { beforeAll, describe, expect, it, vi } from "vitest";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { verifyDoorV44SemanticContract } from "@/domain/search/door-v44/semantic-contract";
import { renderDoorV44Document } from "@/domain/search/door-v44/render";
import { doorV44ArtifactHash } from "@/domain/search/door-v44/artifact-hash";
import type { DoorV44CompileResult } from "@/domain/search/door-v44/compiler-types";
import type { DoorV44Element } from "@/domain/search/door-v44/render-types";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

type Success = Extract<DoorV44CompileResult, { ok: true }>;
let f04: Success;
let f08: Success;
let dated: Success;
function all(node: DoorV44Element): DoorV44Element[] {
  return [node, ...(node.children ?? []).flatMap(child => typeof child === "string" ? [] : all(child))];
}
function nodes(compiled: Success): DoorV44Element[] { return compiled.document.body.flatMap(all); }
function id(compiled: Success, value: string): DoorV44Element { return nodes(compiled).find(node => node.attrs?.id === value)!; }
function section(compiled: Success, value: string): DoorV44Element { return nodes(compiled).find(node => node.attrs?.["data-section"] === value)!; }
function graph(compiled: Success): Record<string, unknown>[] { return compiled.document.structured_data[0]["@graph"] as Record<string, unknown>[]; }
function rerender(compiled: Success): void {
  const rendered = renderDoorV44Document(compiled.document);
  if (rendered.ok) {
    compiled.html = rendered.html;
    compiled.receipt.html_hash = rendered.html_hash;
    compiled.receipt.semantic_hash = rendered.semantic_hash;
  }
  compiled.receipt.artifact_hash = doorV44ArtifactHash(compiled.receipt, compiled.assets);
}
function remove(compiled: Success, target: DoorV44Element): void {
  for (const node of nodes(compiled)) if (node.children?.includes(target)) {
    node.children = node.children.filter(child => child !== target); return;
  }
  compiled.document.body = compiled.document.body.filter(node => node !== target);
}
function reject(mutate: (compiled: Success) => void, code: string, source = f04): void {
  const raw = structuredClone(source);
  mutate(raw);
  // Updated renderer hashes are not independent proof of semantic correctness.
  rerender(raw);
  const result = verifyDoorV44SemanticContract(raw);
  expect(result.ok, JSON.stringify(result)).toBe(false);
  expect(result.errors.some(error => error.code === code), JSON.stringify(result)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER");
}
beforeAll(async () => {
  for (const name of ["f04", "f08"]) {
    const fixture = await compilerFixture(name);
    const result = await compileDoorV44Page(fixture.spec, fixture.context);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error("Compiler baseline failed");
    if (name === "f04") {
      f04 = result;
      const approved = "2026-09-12T12:00:00.000Z";
      fixture.context.visible_approvals = result.receipt.visible_components.map(row => ({ ...row, approved_at: approved }));
      fixture.spec.release.approved_content_at = approved;
      fixture.context.validation.approved_content_at = approved;
      const next = await compileDoorV44Page(fixture.spec, fixture.context);
      expect(next.ok, JSON.stringify(next)).toBe(true);
      if (!next.ok) throw new Error("Dated compiler baseline failed");
      dated = next;
    } else f08 = result;
  }
}, 20000);
describe("independent v44 compiled semantic contract", () => {
  it.each(["f04", "f08", "dated"])("accepts the real %s compiler artifact without browser/release claims", name => {
    const input = name === "f04" ? f04 : name === "f08" ? f08 : dated;
    const result = verifyDoorV44SemanticContract(input);
    expect(result, JSON.stringify(result)).toEqual({ ok: true, errors: [] });
    expect(input.receipt.release_ready).toBe(false);
  });
  it("is pure and deterministic with frozen input and no I/O or clock", () => {
    const raw = structuredClone(f04);
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
    const before = JSON.stringify(raw); freeze(raw);
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Network forbidden"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Clock forbidden"); });
    try {
      const first = verifyDoorV44SemanticContract(raw);
      expect(first).toEqual({ ok: true, errors: [] });
      expect(verifyDoorV44SemanticContract(raw)).toEqual(first);
      expect(JSON.stringify(raw)).toBe(before);
    } finally { network.mockRestore(); clock.mockRestore(); }
  });
  it("rejects altered constant text even if its receipt observation also changes", () => reject(raw => {
    const constant = nodes(raw).find(node => node.attrs?.["data-constant-key"] === "hero_answer")!;
    constant.children = ["PRIVATE_MARKER"];
    raw.receipt.constants.find(row => row.key === "hero_answer")!.value = "PRIVATE_MARKER";
  }, "SEMANTIC_CONSTANT_MISMATCH"));
  it("requires manifest constants even if removed from tree and receipt", () => reject(raw => {
    remove(raw, nodes(raw).find(node => node.attrs?.["data-constant-key"] === "hero_answer")!);
    raw.receipt.constants = raw.receipt.constants.filter(row => row.key !== "hero_answer");
  }, "SEMANTIC_CONSTANT_MISMATCH"));
  it("rejects extra or missing receipt observations", () => {
    reject(raw => { raw.receipt.constants.push({ key: "PRIVATE_MARKER", value: "PRIVATE_MARKER" }); }, "SEMANTIC_CONSTANT_MISMATCH");
    reject(raw => { raw.receipt.constants.pop(); }, "SEMANTIC_CONSTANT_MISMATCH");
  });
  it.each(["action", "method", "enctype", "data-capability-id", "data-input-schema-version"])("pins form attribute %s independently of serialized hashes", attribute => reject(raw => {
    const form = nodes(raw).find(node => node.tag === "form")!;
    form.attrs![attribute] = attribute === "action" ? "/api/other" : attribute === "method" ? "get" : attribute === "enctype" ? "text/plain" : "changed";
  }, "SEMANTIC_DOM_MISMATCH"));
  it.each(["hero", "direct-answer", "vp", "intake", "problem-description", "problem-description-help", "startBtn", "free-note", "sources-and-review"])("requires fixed ID %s exactly once", value => reject(raw => {
    id(raw, value).attrs!.id = "changed-" + value;
  }, "SEMANTIC_DOM_MISMATCH"));
  it.each(["problem_description", "page_id", "intent_cluster_id", "search_opportunity_id", "problem_family_hint", "landing_path", "disclosure_id"])("requires posted field %s", field => reject(raw => {
    const control = nodes(raw).find(node => node.attrs?.name === field)!;
    remove(raw, control);
  }, "SEMANTIC_DOM_MISMATCH"));
  it("checks required/disabled controls and posted page/path identity", () => {
    reject(raw => { delete id(raw, "problem-description").attrs!.required; }, "SEMANTIC_DOM_MISMATCH");
    reject(raw => { id(raw, "startBtn").attrs!.disabled = ""; }, "SEMANTIC_ACTION_MISMATCH");
    reject(raw => { nodes(raw).find(node => node.attrs?.name === "page_id")!.attrs!.value = "other.page"; }, "SEMANTIC_DOM_MISMATCH");
    reject(raw => { nodes(raw).find(node => node.attrs?.name === "landing_path")!.attrs!.value = "/problems/other"; }, "SEMANTIC_DOM_MISMATCH");
  });
  it("checks submit visible/accessibility labels and the return CTA", () => {
    reject(raw => { id(raw, "startBtn").attrs!["aria-label"] = "PRIVATE_MARKER"; }, "SEMANTIC_ACTION_MISMATCH");
    reject(raw => { const closer = all(section(raw, "CLOSER")).find(node => node.tag === "a")!; closer.children = ["Other label"]; closer.attrs!["aria-label"] = "Other label"; }, "SEMANTIC_ACTION_MISMATCH");
    reject(raw => { all(section(raw, "CLOSER")).find(node => node.tag === "a")!.attrs!.href = "/other"; }, "SEMANTIC_ACTION_MISMATCH");
  });
  it("pins actual disclosure bytes against their separate component hash", () => reject(raw => {
    id(raw, "free-note").children = ["Changed disclosure"];
  }, "SEMANTIC_DOM_MISMATCH"));
  it("checks approved visible-component hashes after an attacker refreshes HTML hashes", () => reject(raw => {
    id(raw, "direct-answer").children = ["Changed visible answer outside the receipt's content component."];
  }, "SEMANTIC_HASH_MISMATCH"));
  it("does not allow fixed core content to become hidden", () => reject(raw => {
    id(raw, "direct-answer").attrs!.hidden = "";
  }, "SEMANTIC_DOM_MISMATCH"));
  it("rejects main section reorder even when the receipt order is also rewritten", () => reject(raw => {
    const main = nodes(raw).find(node => node.tag === "main")!;
    [main.children![0], main.children![1]] = [main.children![1], main.children![0]];
    [raw.receipt.section_order[0], raw.receipt.section_order[1]] = [raw.receipt.section_order[1], raw.receipt.section_order[0]];
  }, "SEMANTIC_ORDER_MISMATCH"));
  it("requires INTAKE to remain HERO's second child", () => reject(raw => {
    section(raw, "HERO").children!.reverse();
  }, "SEMANTIC_ORDER_MISMATCH"));
  it("rejects an empty RELATED module even with a matching claimed order", () => reject(raw => {
    const main = nodes(raw).find(node => node.tag === "main")!;
    main.children!.splice(-1, 0, { tag: "section", attrs: { "data-section": "RELATED", id: "related" }, children: [] });
    raw.receipt.section_order.splice(-1, 0, "RELATED");
  }, "SEMANTIC_ORDER_MISMATCH"));
  it("derives counts from actual rows rather than trusting counter and receipt together", () => reject(raw => {
    const counter = nodes(raw).find(node => node.attrs?.["data-metric-slot"] === "observations")!;
    counter.attrs!["data-count"] = "9"; counter.children = ["9"];
    raw.receipt.derived_counts.observations = 9;
  }, "SEMANTIC_COUNT_MISMATCH"));
  it("requires every counter to remain present", () => reject(raw => {
    remove(raw, nodes(raw).find(node => node.attrs?.["data-count"])!);
  }, "SEMANTIC_COUNT_MISMATCH"));
  it("checks visible source ledger and JSON-LD URL closure", () => {
    reject(raw => { const source = all(id(raw, "sources-and-review")).find(node => node.tag === "li" && node.attrs?.["data-source-id"])!; all(source).find(node => node.tag === "a")!.attrs!.href = "https://fixture.example/changed"; }, "SEMANTIC_CITATION_MISMATCH");
    reject(raw => { graph(raw).find(row => row["@type"] === "WebPage")!.citation = ["https://fixture.example/changed"]; }, "SEMANTIC_CITATION_MISMATCH");
    reject(raw => { raw.receipt.source_ids = []; }, "SEMANTIC_CITATION_MISMATCH");
    reject(raw => { raw.receipt.claim_ids = []; }, "SEMANTIC_CITATION_MISMATCH");
  });
  it("checks page metadata against the actual JSON-LD and receipt", () => {
    reject(raw => { raw.document.title = "Changed title"; }, "SEMANTIC_METADATA_MISMATCH");
    reject(raw => { raw.document.canonical_url = "https://fixture.example/problems/changed"; }, "SEMANTIC_METADATA_MISMATCH");
  });
  it("rejects rehashed JSON-LD FAQ answers and questions absent from visible FAQ content", () => {
    reject(raw => {
      const faq = graph(raw).find(row => row["@type"] === "FAQPage")!;
      const first = (faq.mainEntity as Record<string, unknown>[])[0];
      (first.acceptedAnswer as Record<string, unknown>).text = "PRIVATE_MARKER";
    }, "SEMANTIC_FAQ_MISMATCH");
    reject(raw => {
      const faq = graph(raw).find(row => row["@type"] === "FAQPage")!;
      (faq.mainEntity as Record<string, unknown>[])[0].name = "A changed question?";
    }, "SEMANTIC_FAQ_MISMATCH");
    reject(raw => {
      const question = all(section(raw, "FAQ")).find(node => node.tag === "h3")!;
      question.children = ["Changed visible question?"];
    }, "SEMANTIC_FAQ_MISMATCH");
  });
  it("requires visible date, metadata and structured date to agree", () => {
    reject(raw => { all(id(raw, "sources-and-review")).find(node => node.tag === "time")!.children = ["2020-01-01"]; }, "SEMANTIC_DATE_MISMATCH", dated);
    reject(raw => { graph(raw).find(row => row["@type"] === "WebPage")!.dateModified = "2020-01-01T00:00:00.000Z"; }, "SEMANTIC_DATE_MISMATCH", dated);
    reject(raw => { graph(raw).find(row => row["@type"] === "WebPage")!.dateModified = "2020-01-01T00:00:00.000Z"; }, "SEMANTIC_DATE_MISMATCH");
  });
  it("checks actual images, captions and metadata against assets and ImageObjects", () => {
    reject(raw => { nodes(raw).find(node => node.tag === "img")!.attrs!.width = "9"; }, "SEMANTIC_IMAGE_MISMATCH");
    reject(raw => { nodes(raw).find(node => node.tag === "img")!.attrs!.alt = "Changed alt"; }, "SEMANTIC_IMAGE_MISMATCH");
    reject(raw => { nodes(raw).find(node => node.tag === "figcaption")!.children = ["Changed caption"]; }, "SEMANTIC_IMAGE_MISMATCH");
    reject(raw => { graph(raw).find(row => row["@type"] === "ImageObject")!.contentUrl = "https://fixture.example/changed.png"; }, "SEMANTIC_IMAGE_MISMATCH");
    reject(raw => { raw.document.social_image!.alt = "Changed social alt"; }, "SEMANTIC_IMAGE_MISMATCH");
    reject(raw => { raw.assets[0].base64 = Buffer.from("Changed bytes").toString("base64"); }, "SEMANTIC_IMAGE_MISMATCH");
  });
  it("rejects malformed/accessor input without invoking getters or leaking values", () => {
    let calls = 0;
    const raw = structuredClone(f04);
    Object.defineProperty(raw.document, "body", { enumerable: true, get() { calls++; return []; } });
    expect(verifyDoorV44SemanticContract(raw)).toEqual({ ok: false, errors: [{ code: "SEMANTIC_INPUT_INVALID", pointer: "" }] });
    expect(calls).toBe(0);
    expect(verifyDoorV44SemanticContract(null).ok).toBe(false);
  });
  it("reaches asset integrity checks for raster fields above the generic one-megabyte JSON limit", () => {
    const raw = structuredClone(f04);
    raw.assets[0].base64 = Buffer.alloc(800000, 1).toString("base64");
    const result = verifyDoorV44SemanticContract(raw);
    expect(result.ok).toBe(false);
    expect(result.errors.some(error => error.code === "SEMANTIC_IMAGE_MISMATCH")).toBe(true);
    expect(result.errors.some(error => error.code === "SEMANTIC_INPUT_INVALID")).toBe(false);
  });
});
