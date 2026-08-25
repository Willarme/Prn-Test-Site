import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * READING THE REPO AS EVIDENCE.
 *
 * Some expectations in the project record are STRUCTURAL — "a grep for
 * DataForSEO-specific identifiers outside the adapter file returns nothing",
 * "no module outside A06 writes qa.state to PASS", "no code path lets an
 * opportunity become a live page without both gates". Those are claims about
 * the shape of the codebase, and the only honest way to measure a claim about
 * shape is to read the shape.
 *
 * A behavioural test can prove a path behaves; only a scan can prove a SECOND
 * path does not exist. Both kinds appear in this harness, and each expectation
 * says which it used.
 */

const ROOT = process.cwd();

export interface SourceFile {
  /** Repo-relative, forward-slashed, so a finding reads the same on any OS. */
  path: string;
  text: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

let cache: SourceFile[] | null = null;

/** Every TypeScript file under src/, read once per process. */
export function sourceFiles(): readonly SourceFile[] {
  if (cache) return cache;
  const paths: string[] = [];
  walk(join(ROOT, "src"), paths);
  cache = paths.map((p) => ({
    path: relative(ROOT, p).split(sep).join("/"),
    text: readFileSync(p, "utf-8"),
  }));
  return cache;
}

export function readSource(repoRelative: string): string {
  return readFileSync(join(ROOT, ...repoRelative.split("/")), "utf-8");
}

/**
 * A file with its comments blanked out. Most "this must never appear" rules in
 * the record are about CODE, and this repo's comments quote the very strings the
 * rules ban — because they explain the rule. A scan that cannot tell a rule from
 * its own explanation reports the documentation as the violation.
 */
export function readCode(repoRelative: string): string {
  return stripComments(readSource(repoRelative));
}

const underCache = new Map<string, SourceFile[]>();

/** Every .ts/.tsx file under an arbitrary repo directory — tests/ lives outside src/. */
export function filesUnder(repoRelativeDir: string): readonly SourceFile[] {
  const hit = underCache.get(repoRelativeDir);
  if (hit) return hit;
  const paths: string[] = [];
  try {
    walk(join(ROOT, ...repoRelativeDir.split("/")), paths);
  } catch {
    /* a directory that does not exist contributes nothing, which is itself a finding */
  }
  const files = paths.map((p) => ({
    path: relative(ROOT, p).split(sep).join("/"),
    text: readFileSync(p, "utf-8"),
  }));
  underCache.set(repoRelativeDir, files);
  return files;
}

export interface Hit {
  path: string;
  line: number;
  text: string;
}

export interface ScanOptions {
  /** Only files whose path matches. */
  include?: RegExp;
  /** Files to exclude — typically the one place the pattern is allowed. */
  exclude?: RegExp;
  /**
   * Ignore matches inside comments. Most "this must not appear" rules in the
   * record are about CODE, and this repo's comments quote the very strings the
   * rules ban (they explain the rule). A scan that cannot tell a rule from its
   * own explanation reports the documentation as the violation.
   */
  codeOnly?: boolean;
}

/** Strip // and /* *\/ comments, preserving line count so line numbers hold. */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let inString: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      } else out += " ";
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        out += "  ";
        i += 2;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      out += "  ";
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function scan(pattern: RegExp, options: ScanOptions = {}): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles()) {
    if (options.include && !options.include.test(file.path)) continue;
    if (options.exclude && options.exclude.test(file.path)) continue;
    const text = options.codeOnly ? stripComments(file.text) : file.text;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const re = new RegExp(pattern.source, pattern.flags.replace("g", ""));
      if (re.test(lines[i])) {
        hits.push({ path: file.path, line: i + 1, text: lines[i].trim().slice(0, 160) });
      }
    }
  }
  return hits;
}

export function describeHits(hits: readonly Hit[], limit = 6): string[] {
  return hits.slice(0, limit).map((h) => `${h.path}:${h.line}  ${h.text}`);
}
