import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readReleaseManifests } from './check-release-traces.mjs';

function isLocalPrivatePath(relative) {
  // Remove only the project's own private paths. Vendor/content lookalikes
  // remain intact for the independent, broader refusal guard to inspect.
  const lower = relative.replaceAll('\\', '/').toLowerCase();
  return /^\.env(?:\.[^/]*)?(?:\/|$)/.test(lower) || /^\.private(?:\/|$)/.test(lower) ||
    /^data\/runtime(?:\/|$)/.test(lower) || /^data\/ai-policy\.json$/.test(lower);
}

// Next 15's late exclusion pass joins globs with Windows separators, which
// picomatch treats as escapes. Apply the same narrow private-path exclusions
// to completed manifests; the separate release guard must still pass afterward.
export function prepareReleaseTraces(projectRoot, buildDir = '.next') {
  // Parse and validate every manifest and path before any manifest is changed.
  const { manifests } = readReleaseManifests(projectRoot, buildDir);
  let removed = 0, changed = 0;
  const updates = [];
  for (const { file, content, entries } of manifests) {
    const files = entries.filter(entry => !isLocalPrivatePath(entry.relative)).map(entry => entry.value);
    const count = entries.length - files.length;
    if (count) { updates.push({ file, content: { ...content, files } }); removed += count; }
  }
  for (const update of updates) {
    fs.writeFileSync(update.file, JSON.stringify(update.content));
    changed++;
  }
  return { status: 'PREPARED', manifests_checked: manifests.length, manifests_changed: changed, private_path_references_removed: removed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(prepareReleaseTraces(process.cwd(), process.env.NEXT_DIST_DIR || '.next')) + '\n'); }
  catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
