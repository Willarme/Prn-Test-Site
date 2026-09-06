#!/usr/bin/env node
/* global process */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A repeatable private demo, isolated from the trial Supabase database.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", "3188"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PRN_RUNTIME_STORE: "file",
    PRN_DEV_DB_PATH: join(root, "data/runtime/missy-demo-20260905/dev-db.json"),
    NEXT_DIST_DIR: ".next-codex-demo",
    EMAIL_MODE: "preview",
  },
});
child.on("error", (error) => {
  process.stderr.write(`Could not start the demo: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
