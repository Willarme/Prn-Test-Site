import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

/** Runtime byte validation needs the original public source closure, even when
 * Next has also compiled these modules. Runtime records/artifacts are excluded. */
export function doorFixtureRuntimeTracePlan() {
  const manifest = JSON.parse(readFileSync(new URL('../content/door-v44-fixtures/v1/manifest.json', import.meta.url), 'utf8'));
  if (!Array.isArray(manifest.sources) || manifest.sources.length > 250 || !Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 11) throw new Error('Invalid door fixture trace manifest');
  const paths = manifest.sources.map(row => row.path);
  if (new Set(paths).size !== paths.length || paths.some(path => typeof path !== 'string' || path.includes('..') || !/^(?:(?:src|content)\/[A-Za-z0-9_./-]+|package(?:-lock)?\.json)$/.test(path))) throw new Error('Invalid door fixture source path');
  return { routes: ['/api/admin/page-runs', '/api/admin/page-runs/**', '/admin/page-creator/runs/**'],
    patterns: [...paths.map(path => './' + path), './content/door-v44-fixtures/v1/*.json'] };
}
