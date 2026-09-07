import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function isPrivateReleasePath(relative) {
  const lower = relative.replaceAll('\\', '/').toLowerCase();
  return /(?:^|\/)\.env(?:\.[^/]*)?(?:\/|$)/.test(lower) || /(?:^|\/)\.private(?:\/|$)/.test(lower) ||
    /(?:^|\/)data\/runtime(?:\/|$)/.test(lower) || /(?:^|\/)data\/ai-policy\.json$/.test(lower);
}

export function readReleaseManifests(projectRoot, buildDir = '.next') {
  const root = path.resolve(projectRoot), build = path.resolve(root, buildDir);
  const relativeBuild = path.relative(root, build);
  if (!relativeBuild || path.isAbsolute(relativeBuild) || relativeBuild === '..' || relativeBuild.startsWith('..' + path.sep)) throw new Error('Release build must be inside its project');
  const inspected = new Set();
  function assertSafe(file) {
    const relative = path.relative(root, file);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) throw new Error('Release trace path escapes its project');
    let current = root;
    for (const part of ['', ...relative.split(path.sep)]) {
      if (part) current = path.join(current, part);
      if (inspected.has(current)) continue;
      inspected.add(current);
      try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Release trace tree contains a symlink'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  assertSafe(build);
  const buildIdPath = path.join(build, 'BUILD_ID'); assertSafe(buildIdPath);
  const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
  if (!buildId) throw new Error('Release build is incomplete');
  const traces = [];
  function walk(directory, recursive) {
    assertSafe(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Release trace tree contains a symlink');
      if (entry.isDirectory() && recursive) walk(file, true);
      else if (entry.isFile() && entry.name.endsWith('.nft.json')) traces.push(file);
    }
  }
  // Next's shared server traces live at the build root, outside server/.
  walk(build, false);
  walk(path.join(build, 'server'), true);
  if (!traces.length) throw new Error('Release has no server traces');
  const manifests = [];
  function read(file, base, description) {
    assertSafe(file);
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!content || !Array.isArray(content.files) || content.files.some(value => typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value) || path.win32.isAbsolute(value))) throw new Error('Malformed ' + description);
    const entries = content.files.map(value => {
      const absolute = path.resolve(base, value.replaceAll('\\', '/'));
      assertSafe(absolute);
      return { value, relative: path.relative(root, absolute).replaceAll('\\', '/') };
    });
    manifests.push({ file, content, entries });
  }
  for (const trace of traces) read(trace, path.dirname(trace), 'release trace');
  read(path.join(build, 'required-server-files.json'), root, 'required-server-files manifest');
  return { buildId, traces, manifests };
}

export function checkReleaseTraces(projectRoot, buildDir = '.next') {
  const { buildId, traces, manifests } = readReleaseManifests(projectRoot, buildDir);
  const forbidden = new Set(), checked = new Set();
  for (const manifest of manifests) for (const { relative } of manifest.entries) {
    checked.add(relative);
    if (isPrivateReleasePath(relative)) forbidden.add(relative);
  }
  if (forbidden.size) throw new Error('Private runtime material in release traces: ' + [...forbidden].sort().join(', '));
  return { status: 'PASS', build_id: buildId, server_traces: traces.length, unique_files_checked: checked.size, private_runtime_files: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(checkReleaseTraces(process.cwd(), process.env.NEXT_DIST_DIR || '.next')) + '\n'); }
  catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
