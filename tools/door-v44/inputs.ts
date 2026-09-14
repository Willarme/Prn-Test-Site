import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { DOOR_V44_INPUT_MANIFEST_PATH, DOOR_V44_INPUT_MANIFEST_SHA256, verifyDoorV44Inputs } from "../../src/domain/search/door-v44/input-integrity";

async function main() {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--root", "--manifest", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i])) {
      process.stdout.write('{"ok":false,"diagnostics":[{"code":"INPUT_CLI_ARGUMENT","pointer":""}]}\n');
      process.exitCode = 2; return;
    }
    values.set(args[i], args[i + 1]);
  }
  const root = path.resolve(values.get("--root") ?? ".");
  const result = await verifyDoorV44Inputs({ root, manifestPath: values.get("--manifest") ?? DOOR_V44_INPUT_MANIFEST_PATH,
    expectedManifestSha256: DOOR_V44_INPUT_MANIFEST_SHA256, runtime: { node_version: process.version } });
  const output = JSON.stringify(result, null, 2) + "\n";
  if (values.has("--output")) {
    // Only create a new receipt in the dedicated existing directory. Never overwrite inputs or follow an output symlink.
    const name = values.get("--output")!;
    if (!/^artifacts\/door-v44\/input-contracts\/input-[a-z0-9-]+\.json$/.test(name)) {
      process.stdout.write('{"ok":false,"diagnostics":[{"code":"INPUT_CLI_OUTPUT_PATH","pointer":""}]}\n');
      process.exitCode = 2; return;
    }
    try {
      const actualRoot = await realpath(root);
      const directory = await realpath(path.resolve(root, "artifacts/door-v44/input-contracts"));
      const relative = path.relative(actualRoot, directory);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("outside root");
      await writeFile(path.join(directory, path.basename(name)), output, { flag: "wx" });
    } catch {
      process.stdout.write('{"ok":false,"diagnostics":[{"code":"INPUT_CLI_OUTPUT_UNAVAILABLE","pointer":""}]}\n');
      process.exitCode = 2; return;
    }
  }
  process.stdout.write(output);
  process.exitCode = result.ok ? 0 : 1;
}
void main().catch(() => {
  process.stdout.write('{"ok":false,"diagnostics":[{"code":"INPUT_CLI_FAILURE","pointer":""}]}\n');
  process.exitCode = 2;
});
