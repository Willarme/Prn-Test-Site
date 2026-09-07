import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slash = value => value.replaceAll('\\', '/');
export const PDF_RUNTIME_ROUTES = ['/packet/*/pdf'];
export const PDF_CHROMIUM_ASSETS = ['chromium.br', 'fonts.tar.br', 'swiftshader.tar.br', 'al2023.tar.br'];

/** Include the installed runtime closure, with no ancestor checkout dependency.
 * Chromium locates assets relative to its external package, so its complete bin
 * directory must accompany its JS even when building on Windows. */
export function pdfRuntimeTracePlan(projectRoot = HERE) {
  const root = fs.realpathSync(projectRoot);
  const packages = new Map();
  function visit(name, from, optional = false) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error('PDF_INVALID_PACKAGE_NAME');
    const resolver = createRequire(path.join(from, 'package.json'));
    const manifest = (resolver.resolve.paths(name) ?? []).map(dir => path.join(dir, name, 'package.json')).find(fs.existsSync);
    if (!manifest) { if (optional) return; throw new Error(`PDF_MISSING_RUNTIME_PACKAGE:${name}`); }
    const realManifest = fs.realpathSync(manifest);
    const relative = slash(path.relative(root, realManifest));
    if (!relative.startsWith('node_modules/') || relative.split('/').includes('..')) {
      if (optional) return;
      throw new Error(`PDF_ANCESTOR_DEPENDENCY:${name}`);
    }
    const dir = path.dirname(realManifest);
    if (packages.has(dir)) return;
    const metadata = JSON.parse(fs.readFileSync(realManifest, 'utf8'));
    if (metadata.name !== name) throw new Error(`PDF_PACKAGE_IDENTITY_MISMATCH:${name}`);
    packages.set(dir, { name, version: metadata.version, directory: slash(path.relative(root, dir)) });
    const optionalDeps = metadata.optionalDependencies ?? {};
    for (const dep of Object.keys(metadata.dependencies ?? {})) visit(dep, dir, dep in optionalDeps);
    for (const dep of Object.keys(optionalDeps)) visit(dep, dir, true);
  }
  for (const name of ['puppeteer-core', '@sparticuz/chromium']) visit(name, root);
  const rows = [...packages.values()].sort((a, b) => a.directory.localeCompare(b.directory));
  const chromium = rows.find(pkg => pkg.name === '@sparticuz/chromium');
  const required = rows.map(pkg => `${pkg.directory}/package.json`);
  const resolver = createRequire(path.join(root, 'package.json'));
  for (const name of ['puppeteer-core', '@sparticuz/chromium']) required.push(slash(path.relative(root, resolver.resolve(name))));
  for (const name of PDF_CHROMIUM_ASSETS) required.push(`${chromium.directory}/bin/${name}`);
  for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`PDF_MISSING_RUNTIME_FILE:${file}`);
  return { routes: [...PDF_RUNTIME_ROUTES], patterns: rows.map(pkg => `./${pkg.directory}/**/*`), packages: rows, required };
}

/** Validate actual Next output, not merely the config string. */
export function verifyPdfRuntimeTrace(projectRoot, tracePath) {
  const root = fs.realpathSync(projectRoot);
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  if (!Array.isArray(trace.files)) throw new Error('PDF_INVALID_NEXT_TRACE');
  const files = new Set(trace.files.map(file => path.resolve(path.dirname(tracePath), file)));
  const plan = pdfRuntimeTracePlan(root);
  const missing = plan.required.filter(file => !files.has(path.resolve(root, file)));
  if (missing.length) throw new Error(`PDF_INCOMPLETE_NEXT_TRACE:${missing.join(',')}`);
  return { trace: slash(path.relative(root, tracePath)), packages: plan.packages, required: plan.required,
    required_bytes: plan.required.reduce((bytes, file) => bytes + fs.statSync(path.join(root, file)).size, 0),
    trace_file_count: trace.files.length };
}
