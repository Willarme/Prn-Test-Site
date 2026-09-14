import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { validateDoorV44Wording, verifyDoorV44WordingDerivative } from "../../src/domain/search/door-v44/wording";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--root" || !args[1])) throw new Error("arguments");
  const root = await realpath(path.resolve(args[1] ?? "."));
  async function read(relative: string) {
    const target = await realpath(path.join(root, relative));
    const resolved = path.relative(root, target);
    if (resolved.startsWith("..") || path.isAbsolute(resolved) || (await stat(target)).size > 1_000_000) throw new Error("input");
    return readFile(target);
  }
  const result = verifyDoorV44WordingDerivative({
    source: await read("content/door-template/v44/inputs/sources/vault-WORDING.md"),
    derivative: await read("content/door-template/v44/wording/sources/WORDING.mechanical.md"),
    manifest: await read("content/door-template/v44/wording/manifest.json"),
    rules: await read("content/door-template/v44/wording/rules.json"),
  });
  // This smoke proves a real check runs. It does not apply wording approval to a page.
  const negative = validateDoorV44Wording([{ role: "hero", text: "No account, no card." }], { surface: "door" });
  const positive = validateDoorV44Wording([{ role: "prose", text: "Your Job Packet is ready." }], { surface: "door" });
  const smoke = !negative.ok && positive.ok && !positive.review_required;
  process.stdout.write(JSON.stringify({ ...result, smoke_pass: smoke, semantic_approval: false }, null, 2) + "\n");
  process.exitCode = result.ok && smoke ? 0 : 1;
}
void main().catch(() => {
  process.stdout.write('{"ok":false,"findings":[{"code":"WORDING_CLI_INPUT","pointer":""}]}\n');
  process.exitCode = 2;
});
