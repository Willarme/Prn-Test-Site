import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { DoorV44Spec, DoorV44ValidationContext } from "@/domain/search/door-v44/types";
import type { DoorV44CompilerContext } from "@/domain/search/door-v44/compiler-types";
import { doorV44IntentReviewHash } from "@/domain/search/door-v44/compiler";

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
function schemas(directory: string): unknown[] {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? schemas(path) : entry.name.endsWith(".json") ? [json(path)] : [];
  });
}
export const bytesHash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function compilerFixture(name = "f04"): Promise<{ spec: DoorV44Spec; context: DoorV44CompilerContext }> {
  const directory = join(process.cwd(), "tests/fixtures/door-v44/contracts");
  // The original loader-only fixtures have numbered placeholder labels and no actual image bytes.
  // This named synthetic derivative supplies real raster bytes and explicit fixture-only provenance.
  const prepare = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(/ ([1-9])$/g, (_, digit: string) => " " + "ABCDEFGHI"[Number(digit) - 1]);
    if (Array.isArray(value)) return value.map(prepare);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, prepare(item)]));
    return value;
  };
  const spec = prepare(json(join(directory, name + ".json"))) as DoorV44Spec;
  spec.sections.hero.answer = [{ type: "paragraph", children: [{ type: "text", value: "This synthetic page tests a structured account of the observation, its timing, the available context, and the boundary of what remains unknown. Its contents are compiler test data. The useful next question depends on evidence already present and grounded in the observed condition. A qualified assessment uses measurement to distinguish competing explanations whenever the visible evidence leaves the cause uncertain. See the controlled source fixture for provenance." },
    { type: "source_ref", source_id: spec.sources[0].source_id, label: "Synthetic source" }] }];
  const validation = json(join(directory, "context.json")) as DoorV44ValidationContext;
  validation.schema_bundle = schemas(join(process.cwd(), "content/door-template/v44/schemas"));
  const previousCapability = spec.capabilities[0].capability_id;
  spec.capabilities[0].capability_id = "home_problem_analyzer";
  spec.sections.capability.rows[0].capability_id = "home_problem_analyzer";
  validation.capabilities.find(row => row.capability_id === previousCapability)!.capability_id = "home_problem_analyzer";
  spec.sections.stats.cards.forEach(row => { row.value = [{ type: "fact_ref", claim_id: row.claim_id, label: "1" }]; });
  const pixels = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00a885" } }).png().toBuffer();
  const inline = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#00a885"/></svg>';
  for (const visual of spec.visuals) {
    visual.width = 8; visual.height = 8; visual.inline_hash = bytesHash(inline); visual.raster_hash = bytesHash(pixels);
    const index = validation.visual_assets.findIndex(row => row.asset_id === visual.asset_id);
    validation.visual_assets[index] = { ...structuredClone(visual), tenant_id: spec.identity.tenant_id };
  }
  const disclosure = "Synthetic disclosure for nonpublic compiler verification.";
  const context: DoorV44CompilerContext = {
    validation, site: { name: "PRN synthetic fixture", current_year: 2026 },
    disclosure_text: disclosure, disclosure_text_sha256: bytesHash(disclosure),
    source_records: spec.sources.map(row => ({ source_id: row.source_id, content_hash: validation.sources.find(source => source.source_id === row.source_id)!.content_hash,
      title: "Synthetic manual", publisher: "Synthetic fixture publisher", url: "https://fixture.example/manual", canonical_url: "https://fixture.example/manual",
      http_status: 200, redirect_to: null, checked_at: "2026-09-12T12:00:00.000Z", expires_at: "2027-01-01T00:00:00.000Z" })),
    fact_records: spec.claims.map(row => ({ claim_id: row.claim_id, content_hash: row.content_hash, permitted_labels: ["1"],
      publisher: "Synthetic fixture publisher", geography: "Synthetic national fixture", window: "Synthetic test window",
      denominator: "Synthetic unit", sample_size: "Synthetic test only", observed_at: "2026-09-12T12:00:00.000Z", methodology_id: "fixture.methodology" })),
    asset_records: spec.visuals.map(row => ({ asset_id: row.asset_id, inline_source: inline, raster_base64: pixels.toString("base64"),
      license_receipt: "fixture_generated_test_asset", renderer_identity: "sharp_0.35.4_fixture" })),
    visible_approvals: [], intent_review: { receipt_id: "fixture_intent_review", content_hash: doorV44IntentReviewHash(spec) },
  };
  return { spec, context };
}
