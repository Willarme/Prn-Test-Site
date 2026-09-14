import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { compileDoorV44Schemas } from "../../src/domain/search/door-v44/schema-engine";

async function main() {
  const schemaRoot = path.resolve("content/door-template/v44/schemas");
  const inputs: unknown[] = [];
  async function readDirectory(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.isSymbolicLink()) throw new Error("symlink schema input");
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await readDirectory(filename);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const value = JSON.parse(await readFile(filename, "utf8"));
        // A coverage manifest is metadata, not another schema.
        if (value.$id) inputs.push(value);
      }
    }
  }
  await readDirectory(schemaRoot);
  const result = compileDoorV44Schemas(inputs);
  if (!result.ok) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(JSON.stringify({ ok: true, schema_hash: result.schema_hash, coverage: result.coverage,
    scope: "Schema compilation only; no compiler, rendering, release or H01-H18 completion claim." }, null, 2) + "\n");
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ ok: false, errors: [{ code: "SCHEMA_INPUT_UNREADABLE", pointer: "/schema_bundle" }] }) + "\n");
  process.exitCode = 1;
});
