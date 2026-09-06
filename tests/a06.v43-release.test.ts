import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { getV43DoorBinding, v43SpecFields, V43_NOINDEX_REASON } from "@/domain/search/door-template";
import { DOOR_TEMPLATE_CHECK_IDS, runV43DoorChecks, V43_QA_PINS, V43_QA_AMENDMENT_PINS, type DoorTemplateEvidence } from "@/domain/search/door-template-qa";
import { PageSpec } from "@/domain/search/pages";
import { registryRowFor } from "@/domain/search/page-registry";
import { evaluateReleaseForPublish, runPageQaSync, withCriticStage, DEFAULT_PAGE_QA_POLICY } from "@/domain/search/qa";
import { collectDoorTemplateEvidence } from "@/platform/search/door-template-evidence";
import { publishGate, publishQueueSnapshot } from "@/platform/search/page-qa-gate";
import { pageRegistryStore } from "@/platform/search/page-registry-store";
import { POST as publish } from "@/app/api/admin/pages/publish/route";

vi.mock("@/platform/admin/auth", () => ({ isAdminUnlocked: async () => true }));
const ROOT = process.cwd();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fixture = () => PageSpec.parse({ ...SAMPLE_PAGE_SPEC, ...v43SpecFields(),
  page_spec_id: "ps_v43_release_fixture", page_id: "page_v43_release_fixture", primary_query: "ac blowing warm air",
  tenant_id: "prn", door_template: getV43DoorBinding(), indexed: false, noindex_reason: V43_NOINDEX_REASON,
  intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_v43_release_fixture" }, qa: { state: "PENDING", reasons: [] },
});
const evidenceFor = (spec: PageSpec) => collectDoorTemplateEvidence([spec])[spec.page_spec_id];
const checks = (spec: PageSpec, evidence?: DoorTemplateEvidence) => runV43DoorChecks(spec, evidence).map((finding) => finding.check);
const temporary: string[] = [];
const copyEvidenceFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "door-v43-file-mutation-")); temporary.push(dir);
  cpSync(join(ROOT, "content/door-template"), join(dir, "content/door-template"), { recursive: true });
  cpSync(join(ROOT, "content/source-evidence"), join(dir, "content/source-evidence"), { recursive: true });
  cpSync(join(ROOT, "public/images"), join(dir, "public/images"), { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  cpSync(join(ROOT, "config/ac-door-copy-amendment-assets.json"), join(dir, "config/ac-door-copy-amendment-assets.json"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  return dir;
};
const backend = process.env.PRN_RUNTIME_STORE;
const database = process.env.PRN_DEV_DB_PATH;
afterEach(() => {
  vi.restoreAllMocks();
  if (backend === undefined) delete process.env.PRN_RUNTIME_STORE; else process.env.PRN_RUNTIME_STORE = backend;
  if (database === undefined) delete process.env.PRN_DEV_DB_PATH; else process.env.PRN_DEV_DB_PATH = database;
  for (const dir of temporary.splice(0)) {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Fixture cleanup path outside temp root");
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("independent v43 release checks", () => {
  it("passes actual frozen file/render/asset fidelity while preserving current production blockers", () => {
    const spec = fixture();
    const evidence = evidenceFor(spec);
    expect(evidence.errors).toEqual([]);
    const findings = runV43DoorChecks(spec, evidence);
    expect(findings.filter((finding) => ["door_template.integrity", "door_template.asset_receipt"].includes(finding.check))).toEqual([]);
    expect(findings.some((finding) => finding.check === "door_template.claim_binding" && finding.where === "cause-2" && finding.message.includes("Check the price for your filter size and type."))).toBe(true);
    expect(findings.filter((finding) => finding.check === "door_template.capability_runtime")).toHaveLength(9);
    expect(findings.some((finding) => finding.check === "door_template.source_verification")).toBe(true);
    expect(findings.filter((finding) => finding.where.startsWith("review:"))).toHaveLength(0);
    expect(findings.some((finding) => finding.where === "stat-2:src-5")).toBe(false);
    expect(findings.some((finding) => finding.where === "stat-3:src-6")).toBe(false);
    expect(findings.some((finding) => finding.where === "stat-3:sup-trane-frozen-causes")).toBe(false);
    expect(findings.some((finding) => finding.where === "cause-5:src-8")).toBe(false);
    expect(findings.some((finding) => finding.check === "door_template.production_release")).toBe(true);
    expect(spec.door_template?.source_bindings.every((source) => source.verified_at === null && source.evidence_status === "INHERITED_UNVERIFIED")).toBe(true);
    expect(evidence.base_binding_sha256).toBe(V43_QA_PINS.binding);
    expect(evidence.base_rendered_sha256).toBe(V43_QA_PINS.rendered);
    expect(evidence.binding_sha256).toBe(V43_QA_AMENDMENT_PINS.binding);
    expect(evidence.rendered_sha256).toBe(V43_QA_AMENDMENT_PINS.rendered);
  });

  it.each(["binding_removed", "copy", "number", "source", "fingerprint", "asset", "live_label"])("fails closed on %s mutation without trusting schema validation", (mutation) => {
    const spec = fixture();
    const evidence = evidenceFor(spec);
    if (mutation === "binding_removed") delete spec.door_template;
    if (mutation === "copy") spec.content_blocks[0].body_md += " Changed approved words.";
    if (mutation === "number") spec.content_blocks[1].body_md += " Repairs cost $9999.";
    if (mutation === "source") spec.door_template!.claim_bindings[1].source_ids = ["src-1"];
    if (mutation === "fingerprint") spec.door_template!.reference_sha256 = "a".repeat(64);
    if (mutation === "asset") spec.door_template!.visual_assets[0].width = 100;
    if (mutation === "live_label") Object.assign(spec.door_template!.capability_questions[0], { runtime_status: "LIVE" });
    expect(checks(spec, evidence)).toContain("door_template.integrity");
    expect(evaluateReleaseForPublish({ ...spec, qa: { state: "PASS", reasons: [] } }).release_eligible).toBe(false);
  });

  it("keeps mandatory checks blocking when tenant policy removes every configurable check", () => {
    const spec = fixture();
    const result = runPageQaSync(spec, { policy: { ...DEFAULT_PAGE_QA_POLICY, required_checks: [], blocker_checks: [] },
      door_template_evidence: { [spec.page_spec_id]: evidenceFor(spec) } });
    expect(result.release_eligible).toBe(false);
    expect(result.deterministic.checks_run).toEqual(expect.arrayContaining([...DOOR_TEMPLATE_CHECK_IDS]));
    expect(result.blockers.some((finding) => finding.check === "door_template.source_verification")).toBe(true);
  });

  it.each(["page_id", "intent_cluster_id", "search_opportunity_id", "problem_family_hint"] as const)("rejects inconsistent intake %s even when schema parsing is bypassed", (field) => {
    const spec = fixture();
    const evidence = evidenceFor(spec);
    spec.intake_context[field] = "spoofed_attribution";
    expect(runV43DoorChecks(spec, evidence).some((finding) => finding.check === "door_template.integrity" && finding.where === "intake_context")).toBe(true);
  });

  it.each(["canonical", "og_url", "webpage_url", "date", "duplicate_canonical", "duplicate_webpage", "missing_html"])("independently rejects final %s metadata mutation despite unchanged collector hash claims", (mutation) => {
    const spec = fixture();
    const evidence = evidenceFor(spec);
    const current = "https://v43-preview.invalid" + spec.canonical_path;
    if (mutation === "canonical") evidence.final_rendered_html = evidence.final_rendered_html!.replace(
      '<link rel="canonical" href="' + current + '">', '<link rel="canonical" href="https://v43-preview.invalid/ac-blowing-warm-air">');
    if (mutation === "og_url") evidence.final_rendered_html = evidence.final_rendered_html!.replace(
      '<meta property="og:url" content="' + current + '">', '<meta property="og:url" content="https://v43-preview.invalid/ac-blowing-warm-air">');
    if (mutation === "webpage_url") evidence.final_rendered_html = evidence.final_rendered_html!.replace(
      '"url": "' + current + '"', '"url": "https://v43-preview.invalid/ac-blowing-warm-air"');
    if (mutation === "date") evidence.final_rendered_html = evidence.final_rendered_html!.replace('"dateModified": "2026-09-06"', '"dateModified": "2099-12-31"');
    if (mutation === "duplicate_canonical") evidence.final_rendered_html += '<link rel="canonical" href="' + current + '">';
    if (mutation === "duplicate_webpage") evidence.final_rendered_html += '<script type="application/ld+json">{"@type":"WebPage","dateModified":"2026-09-06"}</script>';
    if (mutation === "missing_html") evidence.final_rendered_html = null;
    Object.assign(evidence, { canonical: current, dateModified: "2026-09-06" });
    expect(runV43DoorChecks(spec, evidence).some((finding) => finding.check === "door_template.integrity" && finding.where.startsWith("rendered_"))).toBe(true);
  });

  it("hashes the raw source-date receipt instead of accepting fabricated freshness fields", () => {
    const spec = fixture();
    const evidence = evidenceFor(spec);
    evidence.source_date_evidence_text = evidence.source_date_evidence_text!.replace("2026-09-05T19:45:35Z", "2099-12-31T19:45:35Z");
    Object.assign(evidence, { source_modified_at: "2026-09-05T19:45:35Z", content_date_receipt_sha256: "93e5e1ff781d1a513afd383575b6b0d9bb975a2b049cf008e70a7fe73bc0b3e2" });
    expect(runV43DoorChecks(spec, evidence).some((finding) => finding.where === "content_date_receipt")).toBe(true);
  });

  it("a model PASS cannot erase independent blockers or promote concept capabilities", () => {
    const spec = fixture();
    const initial = runPageQaSync(spec, { door_template_evidence: { [spec.page_spec_id]: evidenceFor(spec) } });
    const result = withCriticStage(initial, { status: "PASS", reason: "Synthetic passing critic fixture", findings: [], provider: "fixture", cost_usd: 0, latency_ms: 0 });
    expect(result).toMatchObject({ state: "FAIL", overall: "FAIL", release_eligible: false });
    expect(result.blockers).toEqual(initial.blockers);
    expect(spec.door_template?.capability_questions.every((row) => row.runtime_status === "CLAIMED_ON_PAGE_PENDING_RUNTIME_VERIFICATION")).toBe(true);
  });

  it("requires current evidence for the exact claim and source, including price expiry", () => {
    const spec = fixture();
    const evidence = evidenceFor(spec);
    // This test synthesizes claim coverage only. Actual collected review gaps
    // remain independently blocking in the real-evidence tests.
    evidence.source_review_findings = [];
    const trane = evidence.sources.find(row => row.source_id === "sup-trane-frozen-causes")!;
    const now = Date.parse(evidence.collected_at);
    evidence.sources = spec.door_template!.source_bindings.map((source) => ({ source_id: source.source_id, url: source.url,
      content_sha256: "b".repeat(64), receipt_sha256: "c".repeat(64), verifier: "synthetic-unit-fixture",
      verified_at: new Date(now - 86400000).toISOString(), expires_at: new Date(now + 86400000).toISOString(),
      supported_claim_sha256: spec.door_template!.claim_bindings.filter((claim) => claim.source_ids.includes(source.source_id)).map((claim) => hash(claim.text)),
    }));
    evidence.sources.push(trane);
    expect(checks(spec, evidence)).not.toContain("door_template.source_verification");
    const carrier = evidence.sources.find((source) => source.source_id === "src-5")!;
    carrier.expires_at = new Date(now - 1).toISOString();
    expect(runV43DoorChecks(spec, evidence).some((finding) => finding.where === "stat-2:src-5")).toBe(true);
    carrier.expires_at = new Date(now + 86400000).toISOString();
    carrier.supported_claim_sha256 = [hash("An unrelated, supported price")];
    expect(runV43DoorChecks(spec, evidence).some((finding) => finding.where === "stat-2:src-5")).toBe(true);
    carrier.url = "https://example.test/borrowed-citation";
    expect(runV43DoorChecks(spec, evidence).some((finding) => finding.where === "src-5")).toBe(true);
  });

  it("refuses a locally tested capability even with a PASS receipt", () => {
    const spec = fixture();
    const evidence = evidenceFor(spec);
    const capability = spec.door_template!.capability_questions[0];
    evidence.capabilities = [{ capability_id: capability.capability_id, environment: "local", origin: "http://127.0.0.1:3188",
      deployment_id: "fixture", verified_at: evidence.collected_at, expires_at: new Date(Date.parse(evidence.collected_at) + 86400000).toISOString(),
      tested_claim_sha256: hash(spec.door_template!.claim_bindings.find((claim) => claim.claim_id === capability.capability_id)!.text),
      tested_inputs: [...capability.required_inputs, ...capability.optional_inputs], tested_outputs: capability.possible_outputs,
      result: "PASS", verified_by: "synthetic-fixture", receipt_sha256: "d".repeat(64) }];
    expect(runV43DoorChecks(spec, evidence).filter((finding) => finding.check === "door_template.capability_runtime")).toHaveLength(9);
  });

  it("reads actual bytes again and catches a PNG/header or source-design mutation", () => {
    const dir = copyEvidenceFixture();
    const spec = fixture();
    const first = evidenceFor(spec);
    expect(checks(spec, first)).not.toContain("door_template.asset_receipt");
    const path = join(dir, "public", spec.door_template!.visual_assets[0].raster_path);
    const png = readFileSync(path); png.writeUInt32BE(1199, 16); writeFileSync(path, png);
    expect(checks(spec, evidenceFor(spec))).toContain("door_template.asset_receipt");
    const style = join(dir, "content/door-template/v43/template/styles.css");
    writeFileSync(style, readFileSync(style, "utf8") + "\nbody { color: red; }\n");
    expect(checks(spec, evidenceFor(spec))).toContain("door_template.integrity");
  });

  it.each(["missing_amendment", "amendment_wording", "amendment_date", "rehashed_amendment", "base_binding", "base_render", "asset_receipt"])("rejects raw %s evidence even when collector scalar claims are left intact", mutation => {
    const spec = fixture();
    const evidence = evidenceFor(spec);
    if (mutation === "missing_amendment") evidence.amendment_evidence_text = null;
    if (["amendment_wording", "amendment_date", "rehashed_amendment"].includes(mutation)) {
      const value = JSON.parse(evidence.amendment_evidence_text!);
      if (mutation === "amendment_date") value.source_modified_at = "2099-01-01T00:00:00Z";
      else value.replacements[0].rendered.to += " Extra unreviewed text.";
      if (mutation === "rehashed_amendment") {
        const { amendment_sha256: _old, ...payload } = value;
        value.amendment_sha256 = hash(JSON.stringify(payload));
        evidence.amendment_sha256 = value.amendment_sha256;
      }
      evidence.amendment_evidence_text = JSON.stringify(value);
    }
    if (mutation === "base_binding") evidence.base_binding_sha256 = V43_QA_AMENDMENT_PINS.binding;
    if (mutation === "base_render") evidence.base_rendered_sha256 = V43_QA_AMENDMENT_PINS.rendered;
    if (mutation === "asset_receipt") {
      const value = JSON.parse(evidence.asset_amendment_evidence_text!);
      value.assets[0].raster_sha256 = "a".repeat(64);
      const { receipt_sha256: _old, ...payload } = value;
      value.receipt_sha256 = hash(JSON.stringify(payload));
      evidence.asset_amendment_evidence_text = JSON.stringify(value);
    }
    expect(checks(spec, evidence)).toContain("door_template.integrity");
  });

  it.each(["amendment", "base_binding", "base_reference", "public_svg", "asset_receipt"])("re-reads changed %s files instead of using cached approval", mutation => {
    const dir = copyEvidenceFixture();
    const spec = fixture();
    expect(evidenceFor(spec).errors).toEqual([]);
    const paths = { amendment: "content/door-template/amendments/v43-copy-2026-09-06-r1.json",
      base_binding: "content/door-template/v43/binding.json", base_reference: "content/door-template/v43/reference/approved-v43.html",
      public_svg: "public/images/ac-refrigerant-line-iced-vs-normal.svg", asset_receipt: "config/ac-door-copy-amendment-assets.json" };
    const path = join(dir, paths[mutation as keyof typeof paths]);
    if (mutation === "amendment" || mutation === "asset_receipt" || mutation === "base_binding") {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (mutation === "amendment") value.replacements[0].rendered.count++;
      if (mutation === "asset_receipt") value.assets[0].width = 1199;
      if (mutation === "base_binding") value.claim_bindings[0].text += " Unreviewed.";
      writeFileSync(path, JSON.stringify(value));
    } else writeFileSync(path, readFileSync(path, "utf8") + "\n<!-- changed -->\n");
    const result = checks(spec, evidenceFor(spec));
    expect(result).toContain(mutation === "public_svg" ? "door_template.asset_receipt" : "door_template.integrity");
  });

  it("requires the exact supplemental Trane receipt in addition to the original Carrier citation", () => {
    const spec = fixture(); const evidence = evidenceFor(spec);
    evidence.sources = evidence.sources.filter(row => row.source_id !== "sup-trane-frozen-causes");
    expect(runV43DoorChecks(spec, evidence).some(row => row.where === "stat-3:sup-trane-frozen-causes")).toBe(true);
  });

  it("keeps any still-open source review finding blocking", () => {
    const spec = fixture(); const evidence = evidenceFor(spec);
    evidence.source_review_findings = [{ id: "remaining-source-review", reason: "Actual unresolved source evidence remains." }];
    expect(runV43DoorChecks(spec, evidence).some(row => row.where === "review:remaining-source-review")).toBe(true);
  });

  it("rechecks source/runtime/activation evidence at the actual publish route and queue", async () => {
    const dir = mkdtempSync(join(tmpdir(), "door-v43-publish-")); temporary.push(dir);
    process.env.PRN_RUNTIME_STORE = "file"; process.env.PRN_DEV_DB_PATH = join(dir, "db.json");
    const spec = PageSpec.parse({ ...fixture(), qa: { state: "PASS", reasons: ["Synthetic historical PASS cannot waive current evidence"] } });
    const store = pageRegistryStore(() => null);
    await store.saveStagedPage(spec, { ...registryRowFor(spec, spec.created_at), lifecycle_status: "QA_PASS" });
    const gate = await publishGate({ page_spec_id: spec.page_spec_id, clientProvider: () => null });
    expect(gate?.decision.release_eligible).toBe(false);
    expect(gate?.decision.qa.blockers.some((finding) => finding.check === "door_template.source_verification")).toBe(true);
    const queue = (await publishQueueSnapshot(() => null)).find((row) => row.spec.page_spec_id === spec.page_spec_id);
    expect(queue?.decision.release_eligible).toBe(false);
    const response = await publish(new Request("http://localhost/api/admin/pages/publish", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_spec_id: spec.page_spec_id, action: "publish" }) }));
    expect(response.status).toBe(409);
    expect((await store.listPages()).find((page) => page.page_id === spec.page_id)?.published_at).toBeNull();
  });
});
