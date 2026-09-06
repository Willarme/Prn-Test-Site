#!/usr/bin/env node
/* global process */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Dedicated customer-like state; AI spend deliberately shares the existing
// atomic ledger and policy so a second server cannot create another allowance.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = join(root, "data/runtime/client-demo-v1");
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(root);
mkdirSync(runtime, { recursive: true });
const signingPath = join(runtime, "link-secret.txt");
let signingSecret;
try { signingSecret = readFileSync(signingPath, "utf8").trim(); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  signingSecret = randomBytes(32).toString("base64url");
  writeFileSync(signingPath, signingSecret + "\n", { flag: "wx", mode: 0o600 });
}
if (signingSecret.length < 32) throw new Error("Client demo signing state is invalid");
const mode = process.argv[2] || "start";
if (!["build", "start"].includes(mode)) throw new Error("Usage: node scripts/client-demo.mjs build|start");
const env = {
  ...process.env,
  NODE_ENV: "production",
  PRN_CLIENT_DEMO: "1",
  PRN_RUNTIME_STORE: "file",
  PRN_DEV_DB_PATH: join(runtime, "dev-db.json"),
  NEXT_DIST_DIR: ".next-client-demo",
  EMAIL_MODE: "preview",
  LINK_SIGNING_SECRET: signingSecret,
  // Empty values also prevent next/env from reintroducing these from .env.local.
  SUPABASE_URL: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_JWT_SECRET: "",
  RESEND_API_KEY: "", ADMIN_PASSWORD: "", ADMIN_SESSION_SECRET: "",
  DATAFORSEO_LOGIN: "", DATAFORSEO_PASSWORD: "", VERCEL: "",
};
const args = [join(root, "node_modules/next/dist/bin/next"), mode];
if (mode === "start") args.push("-H", "127.0.0.1", "-p", "3189");
const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
child.on("error", error => { process.stderr.write(`Client demo failed: ${error.message}\n`); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
