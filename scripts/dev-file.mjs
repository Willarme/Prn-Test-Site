#!/usr/bin/env node
/* global process */
/**
 * `npm run dev:file` — the dev server on the LOCAL FILE STORE, no matter what
 * .env.local says.
 *
 * Why this exists (campaign track F2b, 2026-09-05): .env.local on a developer
 * machine carries the trial project's Supabase service key, so a bare
 * `npm run dev` writes every demo journey, test photo and fixture vote into the
 * REAL trial database. Setting PRN_RUNTIME_STORE=file makes every backend
 * chooser (src/platform/db/client.ts serviceConfigured() and the media store)
 * pick the file backend under data/runtime/ instead. Any extra arguments are
 * passed straight through to `next dev`, e.g.
 *
 *   npm run dev:file -- -p 3102
 *
 * NEXT_DIST_DIR is respected if already set (per-track build directories,
 * next.config.mjs) and otherwise left alone.
 */
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const env = { ...process.env, PRN_RUNTIME_STORE: "file" };

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", ...args], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
