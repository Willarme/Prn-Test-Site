import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const OCR_RUNTIME_ROUTES = ['/api/intake/media', '/api/intake/start'];
export const OCR_RUNTIME_HELPERS = ['tools/ocr-printed-evidence.mjs', 'tools/ocr-worker.mjs', 'tools/ocr-offline-guard.mjs'];
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const slash = value => value.replaceAll('\\', '/');

/** Resolve runtime packages without executing their entrypoints. Includes are
 * evaluated on the build host, so Linux gets its installed Sharp/libvips files
 * rather than a hardcoded Windows binary. Missing required dependencies fail
 * the build; an ancestor node_modules must never conceal an incomplete install. */
export function ocrRuntimeTracePlan(projectRoot = HERE) {
  const root = fs.realpathSync(projectRoot);
  const packages = new Map();
  function visit(name, from, optional = false) {
    if (!packageName.test(name)) throw new Error('OCR_INVALID_PACKAGE_NAME');
    const resolver = createRequire(path.join(from, 'package.json'));
    const candidates = resolver.resolve.paths(name) ?? [];
    const manifest = candidates.map(dir => path.join(dir, name, 'package.json')).find(file => fs.existsSync(file));
    if (!manifest) { if (optional) return; throw new Error(`OCR_MISSING_RUNTIME_PACKAGE:${name}`); }
    const realManifest = fs.realpathSync(manifest);
    const relative = slash(path.relative(root, realManifest));
    if (!relative.startsWith('node_modules/') || relative.split('/').includes('..')) {
      if (optional) return;
      throw new Error(`OCR_ANCESTOR_DEPENDENCY:${name}`);
    }
    const dir = path.dirname(realManifest);
    if (packages.has(dir)) return;
    const metadata = JSON.parse(fs.readFileSync(realManifest, 'utf8'));
    if (metadata.name !== name) throw new Error(`OCR_PACKAGE_IDENTITY_MISMATCH:${name}`);
    packages.set(dir, { name, version: metadata.version, directory: slash(path.relative(root, dir)) });
    const optionalDeps = metadata.optionalDependencies ?? {};
    for (const dep of Object.keys(metadata.dependencies ?? {})) visit(dep, dir, dep in optionalDeps);
    for (const dep of Object.keys(optionalDeps)) visit(dep, dir, true);
  }
  for (const name of ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng', 'sharp']) visit(name, root);
  // Sharp also has a runtime WASM fallback that may be installed by a prior
  // compatible dependency. Include installed runtime @img packages and their
  // transitive dependencies, but never development SDK packages.
  const img = path.join(root, 'node_modules', '@img');
  if (fs.existsSync(img)) for (const entry of fs.readdirSync(img, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('sharp-') && !entry.name.includes('-dev')) visit(`@img/${entry.name}`, root, true);
  }
  const rows = [...packages.values()].sort((a, b) => a.directory.localeCompare(b.directory));
  const patterns = OCR_RUNTIME_HELPERS.map(file => `./${file}`);
  for (const pkg of rows) {
    if (pkg.name === '@tesseract.js-data/eng') {
      patterns.push(`./${pkg.directory}/package.json`, `./${pkg.directory}/4.0.0_best_int/eng.traineddata.gz`);
    } else patterns.push(`./${pkg.directory}/**/*`);
  }
  return { routes: [...OCR_RUNTIME_ROUTES], patterns, packages: rows };
}
