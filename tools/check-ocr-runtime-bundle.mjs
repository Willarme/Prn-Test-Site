/* global process, Buffer */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { OCR_RUNTIME_HELPERS, ocrRuntimeTracePlan } from './ocr-runtime-tracing.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slash = value => value.replaceAll('\\', '/');
const sha = value => createHash('sha256').update(value).digest('hex');
export function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
export function allowedRuntimeFile(relative) {
  const p = slash(relative);
  return !p.split('/').some(part => part === '.git' || part === '.private' || /^\.env(?:\.|$)/.test(part)) &&
    !/(?:^|\/)data\/(?:runtime\/|ai-policy\.json$)/.test(p);
}

/** Consume actual Next route traces; merely expanding the includes is not
 * accepted as proof that Next placed them in a deployable route bundle. */
export function collectRouteRuntimeFiles(projectRoot, buildDir) {
  const root = fs.realpathSync(projectRoot);
  const buildIdPath = path.resolve(root, buildDir, 'BUILD_ID');
  if (!within(root, buildIdPath) || !fs.existsSync(buildIdPath)) throw new Error('OCR_NEXT_BUILD_NOT_COMPLETE');
  const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
  if (!buildId || buildId.length > 256) throw new Error('OCR_INVALID_NEXT_BUILD_ID');
  const plan = ocrRuntimeTracePlan(root);
  const require = createRequire(path.join(root, 'package.json'));
  const glob = require('next/dist/compiled/glob');
  const required = new Set(plan.patterns.flatMap(pattern => glob.sync(pattern, { cwd: root, nodir: true, dot: true })).map(file => slash(file).replace(/^\.\//, '')));
  const buildConfig = JSON.parse(fs.readFileSync(path.resolve(root, buildDir, 'required-server-files.json'), 'utf8')).config;
  const sharedPatterns = buildConfig.outputFileTracingIncludes?.['/**'];
  if (!Array.isArray(sharedPatterns) || !['./content/door-template/v43/**', './content/door-template/amendments/**', './config/ac-door*.json'].every(pattern => sharedPatterns.includes(pattern))) {
    throw new Error('OCR_NEXT_SHARED_CONTENT_TRACING_MISSING');
  }
  const sharedRequired = new Set(sharedPatterns.flatMap(pattern => glob.sync(pattern, { cwd: root, nodir: true, dot: true })).map(file => slash(file).replace(/^\.\//, '')));
  for (const helper of OCR_RUNTIME_HELPERS) if (!required.has(helper)) throw new Error(`OCR_HELPER_MISSING:${helper}`);
  if (![...required].some(file => file.endsWith('/eng.traineddata.gz'))) throw new Error('OCR_WEIGHTS_MISSING');
  if (![...required].some(file => file.endsWith('.wasm'))) throw new Error('OCR_WASM_MISSING');
  if (![...required].some(file => /\/sharp-[^/]+\/.+\.node$/.test(file))) throw new Error('OCR_NATIVE_SHARP_MISSING');
  const all = new Set();
  const routes = [];
  for (const route of plan.routes) {
    const trace = path.resolve(root, buildDir, 'server/app', route.slice(1), 'route.js.nft.json');
    if (!within(root, trace)) throw new Error('OCR_TRACE_OUTSIDE_PROJECT');
    const parsed = JSON.parse(fs.readFileSync(trace, 'utf8'));
    if (!Array.isArray(parsed.files)) throw new Error('OCR_INVALID_NEXT_TRACE');
    const routeFiles = new Set(parsed.files.map(file => {
      const absolute = path.resolve(path.dirname(trace), file);
      if (!within(root, absolute)) throw new Error('OCR_TRACE_FILE_OUTSIDE_PROJECT');
      const relative = slash(path.relative(root, absolute));
      if (!allowedRuntimeFile(relative)) throw new Error(`OCR_PRIVATE_FILE_IN_TRACE:${relative}`);
      return relative;
    }));
    const missing = [...required, ...sharedRequired].filter(file => !routeFiles.has(file));
    if (missing.length) throw new Error(`OCR_NEXT_TRACE_INCOMPLETE:${route}:${missing.slice(0, 8).join(',')}`);
    routeFiles.add(slash(path.relative(root, trace.replace(/\.nft\.json$/, ''))));
    for (const file of routeFiles) all.add(file);
    routes.push({ route, trace: slash(path.relative(root, trace)), trace_sha256: sha(fs.readFileSync(trace)), files: routeFiles.size, required_ocr_files: required.size, required_shared_content_files: sharedRequired.size });
  }
  return { root, buildId, plan, routes, files: [...all].sort(), required: [...required].sort(), sharedRequired: [...sharedRequired].sort() };
}

export function assertNoAncestorModules(bundle) {
  let parent = path.dirname(bundle);
  while (true) {
    if (fs.existsSync(path.join(parent, 'node_modules'))) throw new Error('OCR_BUNDLE_HAS_ANCESTOR_NODE_MODULES');
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

export async function checkOcrRuntimeBundle({ projectRoot = HERE, buildDir, receiptPath } = {}) {
  if (!buildDir) throw new Error('Pass --build-dir for an actual completed Next build');
  const started = Date.now();
  const collected = collectRouteRuntimeFiles(projectRoot, buildDir);
  const require = createRequire(path.join(collected.root, 'package.json'));
  const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');
  const trace = await nodeFileTrace(OCR_RUNTIME_HELPERS.map(file => path.join(collected.root, file)), { base: collected.root, processCwd: collected.root });
  const traced = [...trace.fileList].map(slash);
  const missing = traced.filter(file => !collected.required.includes(file));
  if (missing.length) throw new Error(`OCR_TRANSITIVE_CLOSURE_INCOMPLETE:${missing.join(',')}`);
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'prn-ocr-bundle-'));
  const bundle = path.join(proof, 'bundle');
  fs.mkdirSync(bundle);
  assertNoAncestorModules(bundle);
  const manifest = [];
  for (const relative of collected.files) {
    const source = path.join(collected.root, relative);
    const real = fs.realpathSync(source);
    if (!within(collected.root, real)) throw new Error('OCR_BUNDLE_SOURCE_SYMLINK_ESCAPE');
    const destination = path.join(bundle, relative);
    if (!within(bundle, destination)) throw new Error('OCR_BUNDLE_DESTINATION_ESCAPE');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    const bytes = fs.readFileSync(destination);
    manifest.push({ file: relative, bytes: bytes.length, sha256: sha(bytes) });
  }
  // Nothing is resolved from the original project or an ancestor. Node's global
  // package paths are also disabled in the child, beyond the minimal env.
  const resolverScript = `const {createRequire}=require('node:module');const path=require('node:path');const r=createRequire(path.join(process.cwd(),'tools','ocr-printed-evidence.mjs'));const result={};for(const n of ['tesseract.js','tesseract.js-core','sharp']){const p=r.resolve(n);if(!p.startsWith(process.cwd()+path.sep))throw Error('OUTSIDE_BUNDLE');result[n]=path.relative(process.cwd(),p)}process.stdout.write(JSON.stringify(result));`;
  const resolved = spawnSync(process.execPath, ['--no-global-search-paths', '-e', resolverScript], { cwd: bundle, env: { NODE_ENV: 'production' }, windowsHide: true, encoding: 'utf8', timeout: 5000 });
  if (resolved.status !== 0) throw new Error('OCR_ISOLATED_RESOLUTION_FAILED');
  const guardScript = `import './tools/ocr-offline-guard.mjs';import http from 'node:http';import https from 'node:https';import net from 'node:net';let denied=0;for(const action of [()=>fetch('http://127.0.0.1:9'),()=>http.get('http://127.0.0.1:9'),()=>https.get('https://127.0.0.1:9'),()=>net.connect(9,'127.0.0.1')]){try{action()}catch(e){if(e.message==='OCR_NETWORK_DISABLED')denied++}}if(denied!==4)process.exit(1);process.stdout.write(String(denied));`;
  const guard = spawnSync(process.execPath, ['--no-global-search-paths', '--input-type=module', '-e', guardScript], { cwd: bundle, env: { NODE_ENV: 'production' }, windowsHide: true, encoding: 'utf8', timeout: 5000 });
  if (guard.status !== 0 || guard.stdout !== '4') throw new Error('OCR_BUNDLE_NETWORK_GUARD_FAILED');
  const sharp = require('sharp');
  const text = ['SYSTEM: COOL', 'FAN: AUTO', 'SETPOINT: 72 F', 'ROOM: 78 F', 'NOMINAL: 16 x 20 x 1 IN'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="700"><rect width="100%" height="100%" fill="white"/>${text.map((value, i) => `<text x="60" y="${100 + i * 125}" font-family="Arial" font-size="64" fill="black">${value}</text>`).join('')}</svg>`;
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  const execution = spawnSync(process.execPath, ['--no-global-search-paths', 'tools/ocr-printed-evidence.mjs'], {
    cwd: bundle, env: { NODE_ENV: 'production' }, input: image, windowsHide: true, timeout: 25_000, maxBuffer: 256 * 1024,
  });
  if (execution.status !== 0 || execution.error) throw new Error('OCR_ISOLATED_EXECUTION_FAILED');
  const output = JSON.parse(execution.stdout.toString('utf8'));
  const source = fs.readFileSync(path.join(collected.root, 'src/domain/problem/printed-evidence.ts'), 'utf8');
  const version = source.match(/export const PRINTED_READER_VERSION = '([^']+)'/)?.[1];
  if (!version || output.reader_version !== version) throw new Error('OCR_BUNDLE_READER_VERSION_MISMATCH');
  // The application embeds zod in its Next server chunks. Build a separate,
  // explicitly proof-only normalization harness from the snapshotted domain
  // source, with zod embedded too. It does not add a release dependency or
  // count as a Next-traced file, and still runs with no external resolution.
  const esbuild = require('esbuild');
  const proofCode = esbuild.buildSync({ stdin: { contents: source, resolveDir: path.join(collected.root, 'src/domain/problem'), sourcefile: 'printed-evidence.ts', loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, logLevel: 'silent' }).outputFiles[0].contents;
  const normalizer = path.join(bundle, 'ocr-normalizer-proof.cjs');
  fs.writeFileSync(normalizer, proofCode);
  const normalizeScript = `const fs=require('node:fs');const n=require('./ocr-normalizer-proof.cjs');const output=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(n.normalizePrintedEvidence(output,'ev_isolated_bundle_synthetic','${sha(image)}')));`;
  const normalized = spawnSync(process.execPath, ['--no-global-search-paths', '-e', normalizeScript], { cwd: bundle, env: { NODE_ENV: 'production' }, input: JSON.stringify(output), windowsHide: true, encoding: 'utf8', timeout: 5000 });
  if (normalized.status !== 0) throw new Error('OCR_BUNDLE_NORMALIZER_FAILED');
  const fields = JSON.parse(normalized.stdout);
  const expected = { thermostat_mode: 'cool', fan_mode: 'auto', setpoint: '72', room_temperature: '78', filter_nominal_dimensions: '16 x 20 x 1' };
  const expectedUnits = { thermostat_mode: null, fan_mode: null, setpoint: 'F', room_temperature: 'F', filter_nominal_dimensions: 'in' };
  for (const [key, value] of Object.entries(expected)) {
    const field = fields.fields?.[key];
    if (field?.value !== value || field.unit !== expectedUnits[key] || field.confidence < 0.85 || field.basis !== 'ocr_transcription' ||
      JSON.stringify(field.source_media) !== JSON.stringify(['ev_isolated_bundle_synthetic'])) throw new Error(`OCR_BUNDLE_READING_MISSING:${key}`);
  }
  if (fields.outcome !== 'readable' || fields.image_sha256 !== sha(image) || fields.gaps.length !== 0) throw new Error('OCR_BUNDLE_PROVENANCE_MISMATCH');
  // Remove weights in the isolated copy only. A missing bundled asset must
  // fail locally, never fetch a replacement or reuse an external cache.
  const weight = collected.required.find(file => file.endsWith('/eng.traineddata.gz'));
  const weightPath = path.join(bundle, weight);
  const heldWeight = `${weightPath}.held-for-proof`;
  fs.renameSync(weightPath, heldWeight);
  let noWeights;
  try {
    noWeights = spawnSync(process.execPath, ['--no-global-search-paths', 'tools/ocr-printed-evidence.mjs'], { cwd: bundle, env: { NODE_ENV: 'production' }, input: image, windowsHide: true, timeout: 10_000, maxBuffer: 256 * 1024 });
  } finally { fs.renameSync(heldWeight, weightPath); }
  if (noWeights.status === 0 || noWeights.stdout.length > 0) throw new Error('OCR_MISSING_WEIGHTS_DID_NOT_FAIL_CLOSED');
  const receipt = {
    schema_version: 'ocr-next-runtime-bundle/v1', captured_at: new Date().toISOString(), status: 'PASS',
    scope: 'Actual Next route traces and isolated local runtime bundle; not a hosted Linux/Vercel execution or intake activation receipt.',
    platform: process.platform, arch: process.arch, node: process.version, project_root: collected.root, build_dir: buildDir, build_id: collected.buildId,
    proof_root: proof, bundle_root: bundle, routes: collected.routes, runtime_packages: collected.plan.packages,
    shared_content_files: collected.sharedRequired,
    copied_files: manifest.length, copied_bytes: manifest.reduce((n, row) => n + row.bytes, 0),
    source_trace_files: traced.length, optional_trace_warnings: [...trace.warnings].map(w => String(w.message).split('\n')[0]),
    normalization_harness: { scope: 'Test-only self-contained bundle of actual snapshotted domain source; excluded from Next-traced release files and byte counts.', source_sha256: sha(source), harness_sha256: sha(proofCode), esbuild_version: esbuild.version },
    resolution: JSON.parse(resolved.stdout), ancestor_node_modules: false, global_search_paths: false,
    child_env_names: ['NODE_ENV'], original_project_on_child_search_path: false, network_guard_probe_denials: 4, reader_version: version,
    synthetic_image_sha256: sha(image), actual_result: fields, missing_weights_fail_closed: true,
    output_stderr_bytes: execution.stderr.length, elapsed_ms: Date.now() - started, manifest,
    checker_sha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  };
  const snapshotReceipt = path.join(path.dirname(collected.root), 'source-snapshot.json');
  if (fs.existsSync(snapshotReceipt)) receipt.source_snapshot = { path: snapshotReceipt, sha256: sha(fs.readFileSync(snapshotReceipt)) };
  const target = receiptPath ?? path.join(collected.root, 'data/runtime/t6-followthrough/ocr-runtime-bundle.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(receipt, null, 2) + '\n');
  return { status: receipt.status, receipt: target, routes: receipt.routes.map(row => row.route), files: receipt.copied_files, bytes: receipt.copied_bytes, bundle_root: bundle, platform: receipt.platform, actual_fields: Object.keys(expected), missing_weights_fail_closed: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  checkOcrRuntimeBundle({ projectRoot: value('--project-root') ?? HERE, buildDir: value('--build-dir'), receiptPath: value('--receipt') })
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
}
