import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DoorV44CompilerContext } from "../../src/domain/search/door-v44/compiler-types";
import { writeDoorV44Artifact, readDoorV44Artifact } from "../../src/domain/search/door-v44/artifact-store";
import { assertDoorV44BuildInvocation, collectDoorV44BuildProvenance, DoorV44ProvenanceError, injectDoorV44BuildProvenance, verifyDoorV44BuildProvenanceUnchanged } from "./provenance";

async function readJson(path: string): Promise<unknown> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(resolve(path)));
  return JSON.parse(text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
}

async function main(): Promise<void> {
  assertDoorV44BuildInvocation();
  if (resolve(process.argv[1]) !== resolve("tools/door-v44/build.ts")) throw new DoorV44ProvenanceError("BUILD_SOURCE_ROOT_MISMATCH");
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--spec", "--context", "--fixture", "--root"].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error("BUILD_ARGUMENTS_INVALID");
    options.set(args[i], args[i + 1]);
  }
  if (!options.has("--root")) throw new Error("BUILD_ROOT_REQUIRED");
  let spec: unknown;
  let context: DoorV44CompilerContext;
  if (options.has("--fixture")) {
    if (options.has("--spec") || options.has("--context") || !["f04", "f08"].includes(options.get("--fixture")!)) throw new Error("BUILD_FIXTURE_INVALID");
    // Explicit nonpublic test path only. This never supplies a live source/protocol/capability approval.
    const { compilerFixture } = await import("../../tests/fixtures/door-v44/compiler-fixture");
    ({ spec, context } = await compilerFixture(options.get("--fixture")));
  } else {
    if (!options.has("--spec") || !options.has("--context")) throw new Error("BUILD_INPUTS_REQUIRED");
    spec = await readJson(options.get("--spec")!);
    context = await readJson(options.get("--context")!) as DoorV44CompilerContext;
  }
  const input = { spec, context, input_mode: options.has("--fixture") ? "fixture_" + options.get("--fixture") as "fixture_f04" | "fixture_f08" : "explicit_json" as const };
  const provenance = await collectDoorV44BuildProvenance(process.cwd(), input);
  // The fixture helper can already have imported compiler modules. This is an observed-file
  // boundary, not a snapshot, module-loader trace, or trustworthy execution attestation.
  const { compileDoorV44Page } = await import("../../src/domain/search/door-v44/compiler");
  const compiled = await compileDoorV44Page(spec, injectDoorV44BuildProvenance(context, provenance));
  if (!compiled.ok) { process.stdout.write(JSON.stringify(compiled, null, 2) + "\n"); process.exitCode = 1; return; }
  await verifyDoorV44BuildProvenanceUnchanged(process.cwd(), input, provenance);
  const root = resolve(options.get("--root")!);
  const stored = await writeDoorV44Artifact(root, compiled, provenance);
  if (!stored.ok) { process.stdout.write(JSON.stringify(stored, null, 2) + "\n"); process.exitCode = 1; return; }
  const verified = await readDoorV44Artifact(root, compiled.receipt.artifact_hash);
  if (!verified.ok) { process.stdout.write(JSON.stringify(verified, null, 2) + "\n"); process.exitCode = 1; return; }
  process.stdout.write(JSON.stringify({ ok: true, mode: compiled.receipt.mode, artifact_hash: compiled.receipt.artifact_hash,
    directory: stored.directory, read_after_write: true, receipt: compiled.receipt, provenance_status: verified.provenance_status,
    execution_attestation: false, provenance_limitations: provenance.limitations,
    release_ready: false, publication: "NOT_ATTEMPTED" }, null, 2) + "\n");
}
main().catch(error => {
  process.stdout.write(JSON.stringify({ ok: false, errors: [{ code: error instanceof DoorV44ProvenanceError ? error.code : "BUILD_INPUT_OR_IO_INVALID", pointer: "" }], publication: "NOT_ATTEMPTED" }) + "\n");
  process.exitCode = 1;
});
