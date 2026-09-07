import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { checkReleaseTraces } from '../tools/check-release-traces.mjs';
import { prepareReleaseTraces } from '../tools/prepare-release-traces.mjs';

const fixtures: string[] = [];
function fixture(target = 'node_modules/example/index.js', required = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-trace-check-')); fixtures.push(root);
  const directory = path.join(root, '.next/server/app/example'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(root, '.next/BUILD_ID'), 'synthetic-build');
  fs.writeFileSync(path.join(directory, 'route.js.nft.json'), JSON.stringify({ files: required ? [] : [path.relative(directory, path.join(root, target))] }));
  fs.writeFileSync(path.join(root, '.next/required-server-files.json'), JSON.stringify({ files: required ? [target] : [] }));
  return root;
}
afterEach(() => { for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('accepts an actual server trace containing source/dependency paths', () => {
  expect(checkReleaseTraces(fixture())).toMatchObject({ status: 'PASS', server_traces: 1, private_runtime_files: 0 });
});
it.each(['data/runtime/dev-db.json', 'data/runtime/link-secret.txt', 'data/ai-policy.json', '.env.local', '.private/config.json'])('refuses %s even if its inclusion came from automatic tracing', target => {
  expect(() => checkReleaseTraces(fixture(target))).toThrow(/Private runtime material/);
});
it('checks the required-server-files manifest as well as route traces', () => {
  expect(() => checkReleaseTraces(fixture('.env.production', true))).toThrow(/Private runtime material/);
});

it.each(['next-server.js.nft.json', 'next-minimal-server.js.nft.json'])('checks the root shared trace %s', name => {
  const root = fixture();
  fs.writeFileSync(path.join(root, '.next', name), JSON.stringify({ files: ['../data/runtime/.initialized'] }));
  expect(() => checkReleaseTraces(root)).toThrow(/Private runtime material/);
});

it('packages only private references, preserving entry order, metadata, dependencies and actual source files', () => {
  const root = fixture();
  const retained = ['node_modules/@sparticuz/chromium/bin/chromium.br', 'node_modules/tesseract.js/src/worker-script/node/index.js',
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'content/doors/ac.json',
    'data/seo-factory-policy.json', 'data/runtime-public/example.json', 'data/ai-policy.json.example', 'src/runtime/index.ts'];
  const excluded = ['data/runtime/dev-db.json', 'data/runtime/.initialized', 'data/runtime/links/.lock', '.env', '.env.production', '.private/token', 'data/ai-policy.json'];
  const files = [retained[0], ...excluded, ...retained.slice(1), retained[0]];
  for (const target of excluded) { fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true }); fs.writeFileSync(path.join(root, target), 'synthetic-private-fixture'); }
  const route = path.join(root, '.next/server/app/example/route.js.nft.json');
  const shared = path.join(root, '.next/next-server.js.nft.json');
  const required = path.join(root, '.next/required-server-files.json');
  for (const [manifest, base] of [[route, path.dirname(route)], [shared, path.dirname(shared)], [required, root]]) {
    fs.writeFileSync(manifest, JSON.stringify({ version: 1, metadata: { retain: true }, files: files.map(target => path.relative(base, path.join(root, target))) }));
  }
  expect(() => checkReleaseTraces(root)).toThrow(/Private runtime material/);
  expect(prepareReleaseTraces(root)).toMatchObject({ manifests_checked: 3, manifests_changed: 3, private_path_references_removed: 21 });
  for (const [manifest, base] of [[route, path.dirname(route)], [shared, path.dirname(shared)], [required, root]]) {
    expect(JSON.parse(fs.readFileSync(manifest, 'utf8'))).toEqual({ version: 1, metadata: { retain: true }, files: [...retained, retained[0]].map(target => path.relative(base, path.join(root, target))) });
  }
  for (const target of excluded) expect(fs.readFileSync(path.join(root, target), 'utf8')).toBe('synthetic-private-fixture');
  expect(checkReleaseTraces(root)).toMatchObject({ status: 'PASS', server_traces: 2 });
  expect(prepareReleaseTraces(root)).toMatchObject({ manifests_changed: 0, private_path_references_removed: 0 });
  fs.writeFileSync(shared, JSON.stringify({ files: ['../.env.local'] }));
  expect(() => checkReleaseTraces(root)).toThrow(/Private runtime material/);
});

it.each(['malformed', 'escape', 'absolute', 'symlink'])('validates every manifest before writes: %s', problem => {
  const root = fixture('data/runtime/dev-db.json');
  const route = path.join(root, '.next/server/app/example/route.js.nft.json');
  const before = fs.readFileSync(route, 'utf8');
  const required = path.join(root, '.next/required-server-files.json');
  if (problem === 'malformed') fs.writeFileSync(required, JSON.stringify({ files: [null] }));
  else if (problem === 'escape') fs.writeFileSync(required, JSON.stringify({ files: ['../outside.json'] }));
  else if (problem === 'absolute') fs.writeFileSync(required, JSON.stringify({ files: [path.join(root, '.env')] }));
  else {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'release-trace-link-target-')); fixtures.push(target);
    fs.symlinkSync(target, path.join(root, '.next/server/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  expect(() => prepareReleaseTraces(root)).toThrow();
  expect(fs.readFileSync(route, 'utf8')).toBe(before);
});

it.each(['node_modules/vendor/data/runtime/browser.wasm', 'node_modules/vendor/.env.example', 'content/example/.private/data.json'])('leaves nested lookalike %s untouched for the independent guard', target => {
  const root = fixture(target);
  const route = path.join(root, '.next/server/app/example/route.js.nft.json');
  const before = fs.readFileSync(route, 'utf8');
  expect(prepareReleaseTraces(root)).toMatchObject({ manifests_changed: 0, private_path_references_removed: 0 });
  expect(fs.readFileSync(route, 'utf8')).toBe(before);
  expect(() => checkReleaseTraces(root)).toThrow(/Private runtime material/);
});
