import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { DoorPageVersionError } from "../../src/domain/search/door-v44/page-version";
import { doorPageVersionStore } from "../../src/platform/search/door-page-version-store";
import { DoorPageArtifactError, readDoorPageVersionArtifact, registerDoorPageArtifact } from "../../src/platform/search/door-page-version-service";
import { DOOR_PAGE_INPUT_MAX_BYTES, DoorPageVersionInputError } from "../../src/domain/search/door-v44/page-version-input";
import { doorPageVersionInputStore } from "../../src/platform/search/door-page-version-input-store";
import { buildSavedDoorPageVersion, doorPageBuildSavedSchema, DoorPageSavedBuildError } from "../../src/platform/search/door-page-version-build-service";

const Identity = z.object({ tenant_id: z.string(), page_id: z.string() }).strict();
const Register = Identity.extend({ operation_id: z.string(), artifact_hash: z.string(), actor: z.string(), reason: z.string(), at: z.string() }).strict();
const Reserve = Identity.extend({ canonical_intent_id: z.string(), canonical_url: z.string(), operation_id: z.string(),
  expected_latest_version: z.number().int().min(0), actor: z.string(), reason: z.string(), at: z.string() }).strict();
const Verify = Identity.extend({ page_version: z.number().int().positive() }).strict();

async function readInput(path: string, limit = 65536): Promise<unknown> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("CATALOG_INPUT_INVALID");
    // Include one extra byte to detect a growing file without reading it all.
    const bytes = Buffer.alloc(limit + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await file.read(bytes, total, bytes.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > limit) throw new Error("CATALOG_INPUT_INVALID");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total)).replace(/^\uFEFF/, ""));
  } finally { await file.close(); }
}

/** Explicit local candidate tool. No configured Supabase client is constructed. */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!["reserve", "capture-input", "build-saved", "register", "list", "verify"].includes(command)) throw new Error("CATALOG_ARGUMENTS_INVALID");
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--db", "--root", "--input"].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error("CATALOG_ARGUMENTS_INVALID");
    options.set(args[i], args[i + 1]);
  }
  const database = options.get("--db"), inputPath = options.get("--input"), root = options.get("--root");
  if (!database || !isAbsolute(database) || !inputPath ||
      ((command === "register" || command === "verify" || command === "build-saved") ? !root || !isAbsolute(root) : root !== undefined)) {
    throw new Error("CATALOG_ARGUMENTS_INVALID");
  }
  if (resolve(database) === resolve(inputPath)) throw new Error("CATALOG_ARGUMENTS_INVALID");
  const input = await readInput(resolve(inputPath), command === "capture-input" ? DOOR_PAGE_INPUT_MAX_BYTES : 65536);
  process.env.PRN_DEV_DB_PATH = resolve(database);
  const store = doorPageVersionStore(() => null);
  let result: unknown;
  if (command === "reserve") result = await store.reserveVersion(Reserve.parse(input));
  else if (command === "capture-input") {
    // Validation belongs to the store; print identities/hashes, never complete context or raster bytes.
    const saved = await doorPageVersionInputStore(() => null).captureInput(input as Parameters<ReturnType<typeof doorPageVersionInputStore>["captureInput"]>[0]);
    result = { tenant_id: saved.tenant_id, page_id: saved.page_id, page_version: saved.page_version, reservation_id: saved.reservation_id,
      input_sha256: saved.input_sha256, spec_sha256: saved.spec_sha256, context_sha256: saved.context_sha256, assignments: saved.assignments,
      model_provenance_status: saved.model_provenance.status, captured_at: saved.captured_at };
  }
  else if (command === "build-saved") result = await buildSavedDoorPageVersion(store, doorPageVersionInputStore(() => null), resolve(root!), doorPageBuildSavedSchema.parse(input));
  else if (command === "register") result = await registerDoorPageArtifact(store, resolve(root!), Register.parse(input));
  else if (command === "verify") {
    const query = Verify.parse(input);
    const verified = await readDoorPageVersionArtifact(store, resolve(root!), query.tenant_id, query.page_id, query.page_version);
    result = { version: verified.version, artifact_read_verified: true };
  } else {
    const query = Identity.parse(input);
    result = await store.listVersions(query.tenant_id, query.page_id);
  }
  process.stdout.write(JSON.stringify({ ok: true, backend: "file", result, release_ready: false, publication: "NOT_ATTEMPTED" }, null, 2) + "\n");
}

main().catch(error => {
  const code = error instanceof DoorPageVersionError || error instanceof DoorPageArtifactError || error instanceof DoorPageVersionInputError || error instanceof DoorPageSavedBuildError ? error.code : "CATALOG_INPUT_OR_IO_INVALID";
  process.stdout.write(JSON.stringify({ ok: false, errors: [{ code }], publication: "NOT_ATTEMPTED" }) + "\n");
  process.exitCode = 1;
});
