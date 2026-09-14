/** Offline synthetic contract corpus; intentionally fails full acceptance while F01 is blocked. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, join } from "node:path";
import { corpusDefinitions, corpusFixture, preflightCorpusFixture } from "../../tests/fixtures/door-v44/corpus/corpus-fixture";
import { convertF01 } from "../../tests/fixtures/door-v44/corpus/f01/convert";
import { analyzeDoorV44Batch } from "../../src/domain/search/door-v44/batch-analysis";
import type { DoorV44BatchInput } from "../../src/domain/search/door-v44/batch-analysis";
import { compileDoorV44Page } from "../../src/domain/search/door-v44/compiler";
import { writeDoorV44Artifact, readDoorV44Artifact } from "../../src/domain/search/door-v44/artifact-store";
import { doorV44Hash } from "../../src/domain/search/door-v44/schema-engine";
import { assertDoorV44BuildInvocation, collectDoorV44BuildProvenance, injectDoorV44BuildProvenance,
  verifyDoorV44BuildProvenanceUnchanged, DoorV44ProvenanceError } from "./provenance";

async function main() {
  assertDoorV44BuildInvocation();
  if (!process.argv[1] || resolve(process.argv[1]) !== resolve("tools/door-v44/corpus.ts")) throw new Error("CORPUS_INVOCATION_INVALID");
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--root") throw new Error("CORPUS_ARGUMENTS_INVALID");
  const root = resolve(args[1]);
  const relativeRoot = relative(resolve("artifacts/door-v44"), root);
  if (!relativeRoot || relativeRoot.startsWith("..") || isAbsolute(relativeRoot)) throw new Error("CORPUS_ROOT_INVALID");
  const f01 = convertF01();
  const rows: Array<Record<string, unknown>> = [{ fixture_id: "F01", status: f01.report.status,
    source_hash: f01.report.source_pin_hash, candidate_hash: f01.report.candidate_hash,
    exact_control_pass: false, compiler_pass: false, blockers: f01.report.blockers }];
  const batch: DoorV44BatchInput[] = [];
  for (const definition of corpusDefinitions) {
    const fixture = await corpusFixture(definition.id);
    const preflight = preflightCorpusFixture(fixture);
    if (!preflight.ok) { rows.push({ fixture_id: definition.id, status: "PREFLIGHT_FAILED", errors: preflight.errors }); continue; }
    const input = { spec: fixture.spec, context: fixture.context, input_mode: "fixture_corpus" as const };
    const provenance = await collectDoorV44BuildProvenance(process.cwd(), input);
    const compiled = await compileDoorV44Page(input.spec, injectDoorV44BuildProvenance(input.context, provenance));
    if (!compiled.ok) { rows.push({ fixture_id: definition.id, status: "COMPILE_FAILED", errors: compiled.errors }); continue; }
    await verifyDoorV44BuildProvenanceUnchanged(process.cwd(), input, provenance);
    const stored = await writeDoorV44Artifact(root, compiled, provenance);
    if (!stored.ok) { rows.push({ fixture_id: definition.id, status: "STORE_FAILED", errors: stored.errors }); continue; }
    const read = await readDoorV44Artifact(root, compiled.receipt.artifact_hash);
    if (!read.ok) { rows.push({ fixture_id: definition.id, status: "READ_FAILED", errors: read.errors }); continue; }
    rows.push({ fixture_id: definition.id, status: "SYNTHETIC_COMPILE_STORE_READ_PASS",
      artifact_hash: compiled.receipt.artifact_hash, semantic_hash: compiled.receipt.semantic_hash,
      counts: compiled.receipt.derived_counts, nameplate: definition.nameplate, media: definition.media,
      related: definition.related, provenance_status: read.provenance_status,
      execution_attestation: false, release_ready: false });
    batch.push({ spec: fixture.spec, context: fixture.context.validation });
  }
  const analysis = analyzeDoorV44Batch(batch);
  const report = { format: "door-v44-offline-corpus-report/1.0.0",
    corpus_version: "door-v44-synthetic-corpus/1.0.0", corpus_definition_hash: doorV44Hash(corpusDefinitions),
    fixture_count: rows.length, compiled_stored_read: rows.filter(row => row.status === "SYNTHETIC_COMPILE_STORE_READ_PASS").length,
    complete_corpus_pass: false, full_h01_h18_pass: false, release_ready: false,
    presentation: "Unstyled semantic compiler output with synthetic test rasters; no t01-t10 visual/theme acceptance",
    source_provenance: "Observed local source/input/runtime bytes; no execution snapshot or second-host attestation",
    fixtures: rows, batch_analysis: analysis, publication: "NOT_ATTEMPTED",
    remaining: ["F01 exact source-control conversion and scoped difference resolution", "Independent review of batch similarity findings",
      "Real t01 fidelity and full theme/visual/accessibility checks", "A05/A06 and production version/creator lifecycle", "Hosted route/image/intake/index acceptance"] };
  await mkdir(root, { recursive: true });
  const path = join(root, "corpus-report.json");
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({ report: path, fixture_count: rows.length, compiled_stored_read: report.compiled_stored_read,
    complete_corpus_pass: false, batch_disposition: analysis.ok ? analysis.disposition : "INVALID", publication: "NOT_ATTEMPTED" }, null, 2) + "\n");
  process.exitCode = 1; // F01 remains blocked. Measured partial progress is never a green full-corpus check.
}
main().catch(error => {
  process.stdout.write(JSON.stringify({ ok: false, errors: [{ code: error instanceof DoorV44ProvenanceError ? error.code : "CORPUS_INPUT_OR_IO_INVALID", pointer: "" }], publication: "NOT_ATTEMPTED" }) + "\n");
  process.exitCode = 1;
});
