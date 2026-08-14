/**
 * Owner policy CLI — change A04/A05/A06 behavior without a code deploy.
 *
 *   npm run policy                                  show active policy
 *   npm run policy -- set <field> <json-value>      change one field
 *
 * Examples:
 *   npm run policy -- set target_qualified_pages_per_period 30
 *   npm run policy -- set discovery_scan_cadence '"weekly"'
 *
 *   National + local mix (D-10): nationwide on with 20 pages/period, plus all
 *   cities of Allen County IN sharing a 10-page pool, plus statewide Ohio 5:
 *   npm run policy -- set geography_plan '{"national":{"enabled":true,"target_pages_per_period":20},"locals":[{"local_target_id":"lt_allen_in","state":"IN","county":"Allen","target_pages_per_period":10},{"local_target_id":"lt_ohio","state":"OH","county":null,"target_pages_per_period":5}]}'
 *
 * Every change re-validates the full policy (trial invariants like owner
 * publish approval cannot be turned off before T2 graduation), bumps the
 * version, and stamps effective_from.
 */
import path from "node:path";
import { FilePolicyStore } from "../src/platform/stores/policy-file";
import { SeoFactoryPolicy } from "../src/domain/search/policy";

const POLICY_PATH = path.join(process.cwd(), "data", "seo-factory-policy.json");

async function main() {
  const store = new FilePolicyStore(POLICY_PATH);
  const [command, field, ...valueParts] = process.argv.slice(2);

  const active = await store.getActive();

  if (!command || command === "show") {
    console.log(JSON.stringify(active, null, 2));
    return;
  }

  if (command === "set") {
    if (!field || valueParts.length === 0) {
      console.error('Usage: npm run policy -- set <field> <json-value>');
      process.exit(1);
    }
    if (!(field in active)) {
      console.error(`Unknown policy field "${field}". Valid fields:`);
      console.error(Object.keys(active).join(", "));
      process.exit(1);
    }
    let value: unknown;
    const rawValue = valueParts.join(" ");
    try {
      value = JSON.parse(rawValue);
    } catch {
      value = rawValue; // allow bare strings
    }
    const candidate = {
      ...active,
      [field]: value,
      version: active.version + 1,
      effective_from: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    };
    const result = SeoFactoryPolicy.safeParse(candidate);
    if (!result.success) {
      console.error("REJECTED — the change violates a trial invariant:");
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    await store.save(result.data);
    console.log(`Saved. ${field} updated; policy now version ${result.data.version}.`);
    console.log("The next scheduled A04 run picks this up automatically — no deploy needed.");
    return;
  }

  console.error(`Unknown command "${command}". Use: show | set`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
