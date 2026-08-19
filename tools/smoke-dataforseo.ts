/**
 * Live smoke test for the DataForSEO adapter.
 *
 *   npm run smoke:seo
 *
 * Deliberately tiny: two keywords, one metrics call. It proves the credentials,
 * the endpoint shapes and the cost accounting are real before any autonomous
 * run is allowed to spend money. Reports per-capability availability so we know
 * exactly what this account tier can do.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { DataForSeoAdapter } from "../src/platform/adapters/dataforseo";
import type { GeographyScope } from "../src/domain/shared/primitives";

function loadEnv() {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* rely on real env */
  }
}

const GEO: GeographyScope = { mode: "national", country: "US" };
const KEYWORDS = ["ac not turning on", "water heater leaking"];

async function step(name: string, fn: () => Promise<string>) {
  process.stdout.write(`${name.padEnd(28)} `);
  try {
    console.log(await fn());
  } catch (err) {
    console.log(`UNAVAILABLE — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  loadEnv();
  const adapter = new DataForSeoAdapter();
  let spend = 0;

  await step("keyword metrics", async () => {
    const snaps = await adapter.getKeywordMetrics(KEYWORDS, GEO);
    spend += snaps.reduce((s, x) => s + (x.vendor_cost_usd ?? 0), 0);
    return snaps
      .map((s) => `${s.keyword}: vol=${s.volume_monthly ?? "?"} kd=${s.keyword_difficulty ?? "?"} cpc=${s.cpc_usd ?? "?"}`)
      .join(" | ");
  });

  console.log(`\nestimated spend this run: $${spend.toFixed(4)}`);
  console.log("(the autonomous agent stops at the monthly cap in your admin controls)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
