/* global process */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { allowedRuntimeFile, within } from './check-ocr-runtime-bundle.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Build inputs are a fixed local snapshot. Dependency files are hardlinked
 * individually, never a node_modules directory junction; generated build
 * outputs and Next's tsconfig edits cannot touch the source worktree. */
export function prepareOcrRuntimeProof(projectRoot = HERE) {
  const root = fs.realpathSync(projectRoot);
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'prn-ocr-next-build-'));
  const snapshot = path.join(proof, 'project');
  fs.mkdirSync(snapshot);
  const sources = [];
  let dependencyFiles = 0;
  function copy(relative, dependency = false) {
    if (!allowedRuntimeFile(relative)) throw new Error('OCR_UNSAFE_SNAPSHOT_SOURCE');
    const source = path.join(root, relative);
    const real = fs.realpathSync(source);
    if (!within(root, real)) throw new Error('OCR_SNAPSHOT_SYMLINK_ESCAPE');
    const destination = path.join(snapshot, relative);
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true });
      for (const name of fs.readdirSync(real)) copy(path.join(relative, name), dependency);
    } else if (stat.isFile()) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (dependency) {
        try { fs.linkSync(real, destination); }
        catch (error) { if (error.code !== 'EXDEV') throw error; fs.copyFileSync(real, destination); }
        dependencyFiles++;
      } else {
        const bytes = fs.readFileSync(real);
        fs.writeFileSync(destination, bytes);
        sources.push({ file: relative.replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    } else throw new Error('OCR_NON_FILE_SNAPSHOT_SOURCE');
  }
  // Tests are checked in the worktree separately. This snapshot compiles the
  // actual production source/routes, not concurrent test edits or private data.
  for (const relative of ['src', 'content', 'public', 'tools', 'scripts', 'config', 'evals',
    'package.json', 'package-lock.json', 'next.config.mjs', 'eslint.config.mjs', 'tsconfig.json', 'next-env.d.ts',
    'data/seo-factory-policy.json', 'data/factory/opportunities.json', 'data/factory/staged-specs.json', 'data/factory/qa-results.json']) {
    if (fs.existsSync(path.join(root, relative))) copy(relative);
  }
  copy('node_modules', true);
  const receipt = path.join(proof, 'source-snapshot.json');
  fs.writeFileSync(receipt, JSON.stringify({ captured_at: new Date().toISOString(), source_root: root, snapshot_root: snapshot, dependency_files: dependencyFiles, source_files: sources }, null, 2) + '\n');
  return { project_root: snapshot, build_dir: '.next-ocr-proof', receipt, source_files: sources.length, dependency_files: dependencyFiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(prepareOcrRuntimeProof(process.argv[2] ?? HERE), null, 2) + '\n'); }
  catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
