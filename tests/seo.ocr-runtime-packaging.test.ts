import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const moduleUrl = new URL('../tools/ocr-runtime-tracing.mjs', import.meta.url).href;
const checkerUrl = new URL('../tools/check-ocr-runtime-bundle.mjs', import.meta.url).href;
function run(source: string) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Packaging probe failed');
  return JSON.parse(result.stdout);
}
function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-packaging-fixture-'));
  const project = path.join(parent, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), '{}');
  const pkg = (name: string, dependencies = {}, base = project) => {
    const dir = path.join(base, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies }));
  };
  for (const name of ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng', 'sharp']) pkg(name);
  return { parent, project, pkg };
}

describe('OCR route runtime packaging', () => {
  it('covers both existing intake routes and every statically traced helper dependency', () => {
    const value = run(`import {ocrRuntimeTracePlan,OCR_RUNTIME_HELPERS} from ${JSON.stringify(moduleUrl)}; import {createRequire} from 'node:module'; const r=createRequire(import.meta.url);const plan=ocrRuntimeTracePlan();const glob=r('next/dist/compiled/glob');const files=new Set(plan.patterns.flatMap(p=>glob.sync(p,{cwd:process.cwd(),nodir:true,dot:true})).map(p=>p.replaceAll('\\\\','/').replace(/^\\.\\//,'')));const t=await r('next/dist/compiled/@vercel/nft').nodeFileTrace(OCR_RUNTIME_HELPERS,{base:process.cwd(),processCwd:process.cwd()});process.stdout.write(JSON.stringify({routes:plan.routes,missing:[...t.fileList].map(p=>p.replaceAll('\\\\','/')).filter(p=>!files.has(p)),weights:[...files].filter(p=>p.endsWith('eng.traineddata.gz')),wasm:[...files].filter(p=>p.endsWith('.wasm')),native:[...files].filter(p=>p.endsWith('.node')),patterns:plan.patterns}));`);
    expect(value.routes).toEqual(['/api/intake/media', '/api/intake/start']);
    expect(value.missing).toEqual([]);
    expect(value.weights).toEqual(['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz']);
    expect(value.wasm.length).toBeGreaterThanOrEqual(6);
    expect(value.native.some((name: string) => name.includes('sharp'))).toBe(true);
    expect(value.patterns.every((name: string) => name.startsWith('./node_modules/') || name.startsWith('./tools/ocr-'))).toBe(true);
  });
  it('fails when a declared transitive dependency is absent', () => {
    const { project, pkg } = fixture();
    pkg('tesseract.js', { 'synthetic-required-ocr-runtime': '1.0.0' });
    const result = run(`import {ocrRuntimeTracePlan} from ${JSON.stringify(moduleUrl)};try{ocrRuntimeTracePlan(${JSON.stringify(project)});process.stdout.write('null')}catch(e){process.stdout.write(JSON.stringify(e.message))}`);
    expect(result).toBe('OCR_MISSING_RUNTIME_PACKAGE:synthetic-required-ocr-runtime');
  });
  it('refuses an ancestor install that would hide an incomplete deployed bundle', () => {
    const { parent, project, pkg } = fixture();
    pkg('tesseract.js', { 'synthetic-required-ocr-runtime': '1.0.0' });
    pkg('synthetic-required-ocr-runtime', {}, parent);
    const result = run(`import {ocrRuntimeTracePlan} from ${JSON.stringify(moduleUrl)};try{ocrRuntimeTracePlan(${JSON.stringify(project)});process.stdout.write('null')}catch(e){process.stdout.write(JSON.stringify(e.message))}`);
    expect(result).toBe('OCR_ANCESTOR_DEPENDENCY:synthetic-required-ocr-runtime');
  });
  it('copies installed optional native dependencies without requiring foreign platforms', () => {
    const { project, pkg } = fixture();
    pkg('@img/sharp-synthetic');
    fs.writeFileSync(path.join(project, 'node_modules/sharp/package.json'), JSON.stringify({ name: 'sharp', version: '1.0.0', optionalDependencies: { '@img/sharp-synthetic': '1.0.0', '@img/sharp-not-installed': '1.0.0' } }));
    const result = run(`import {ocrRuntimeTracePlan} from ${JSON.stringify(moduleUrl)};process.stdout.write(JSON.stringify(ocrRuntimeTracePlan(${JSON.stringify(project)}).packages.map(p=>p.name)));`);
    expect(result).toContain('@img/sharp-synthetic');
    expect(result).not.toContain('@img/sharp-not-installed');
  });
  it('rejects private trace paths and traversal outside the bundle', () => {
    const result = run(`import {allowedRuntimeFile,within} from ${JSON.stringify(checkerUrl)};process.stdout.write(JSON.stringify({private:['.env','.env.production','x/.private/photo.png','data/runtime/record.json','data/ai-policy.json'].map(allowedRuntimeFile),public:allowedRuntimeFile('data/seo-factory-policy.json'),escape:within(process.cwd(),new URL('../',import.meta.url).pathname),same:within(process.cwd(),process.cwd())}));`);
    expect(result.private).toEqual([false, false, false, false, false]);
    expect(result.public).toBe(true);
    expect(result.escape).toBe(false);
    expect(result.same).toBe(false);
  });
  it('rejects a bundle under any ancestor node_modules directory', () => {
    const { parent, project } = fixture();
    fs.mkdirSync(path.join(parent, 'node_modules'), { recursive: true });
    const result = run(`import {assertNoAncestorModules} from ${JSON.stringify(checkerUrl)};try{assertNoAncestorModules(${JSON.stringify(project)});process.stdout.write('null')}catch(e){process.stdout.write(JSON.stringify(e.message))}`);
    expect(result).toBe('OCR_BUNDLE_HAS_ANCESTOR_NODE_MODULES');
  });
  it('does not accept webpack output from an unfinished Next build', () => {
    const { project } = fixture();
    const result = run(`import {collectRouteRuntimeFiles} from ${JSON.stringify(checkerUrl)};try{collectRouteRuntimeFiles(${JSON.stringify(project)},'.next-ocr-proof');process.stdout.write('null')}catch(e){process.stdout.write(JSON.stringify(e.message))}`);
    expect(result).toBe('OCR_NEXT_BUILD_NOT_COMPLETE');
  });
});
