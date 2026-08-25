import { AiPolicy, AI_CAPABILITY_KEYS, DEFAULT_AI_POLICY } from "../src/platform/ai/policy";
import { AI_POLICY_PATH, FileAiPolicyStore } from "../src/platform/ai/policy-store";
import { MODEL_CATALOGUE, findModel } from "../src/platform/ai/models";
import { spendLedger, utcDay } from "../src/platform/ai/spend";

/**
 * Owner CLI for the AI policy — the thing that makes "changeable without a
 * deploy" true rather than a claim.
 *
 *   npm run ai:policy                          show the active policy and today's spend
 *   npm run ai:policy -- on                    global master switch ON
 *   npm run ai:policy -- off                   global master switch OFF (the shipped state)
 *   npm run ai:policy -- enable <capability>
 *   npm run ai:policy -- disable <capability>
 *   npm run ai:policy -- model <capability> <model_id>
 *   npm run ai:policy -- set <capability> <field> <number>
 *
 * EVERY WRITE IS VALIDATED. The store parses against `AiPolicy` on save, so a
 * per-call cap above a daily cap, a daily cap above the global budget, an
 * unknown model or a dropped TEST label is refused rather than persisted. It is
 * not possible to edit this policy into a state that fails open.
 *
 * THE FILE MAY NOT EXIST, and that is the safe state: a missing document reads as
 * the shipped defaults, which have every capability OFF. The first write creates
 * it.
 */

function usage(): void {
  process.stdout.write(
    [
      "npm run ai:policy                            show the active policy + today's spend",
      "npm run ai:policy -- on | off                the global master switch",
      "npm run ai:policy -- enable <capability>",
      "npm run ai:policy -- disable <capability>",
      "npm run ai:policy -- model <capability> <model_id>",
      "npm run ai:policy -- set <capability> <field> <number>",
      "",
      `capabilities: ${AI_CAPABILITY_KEYS.join(", ")}`,
      `models:       ${MODEL_CATALOGUE.map((m) => m.id).join(", ")}`,
      "fields:       max_cost_per_call_usd, daily_cap_usd, max_output_tokens",
      "",
    ].join("\n")
  );
}

function requireCapability(key: string | undefined): string {
  if (!key || !(AI_CAPABILITY_KEYS as readonly string[]).includes(key)) {
    throw new Error(`unknown capability "${key}" — one of: ${AI_CAPABILITY_KEYS.join(", ")}`);
  }
  return key;
}

async function show(policy: AiPolicy): Promise<void> {
  const day = utcDay();
  const spend = await spendLedger().read(day);
  const lines: string[] = [];
  lines.push(`AI POLICY  v${policy.version}  (${AI_POLICY_PATH})`);
  lines.push(`master switch      ${policy.enabled ? "ON" : "OFF"}`);
  lines.push(`request timeout    ${policy.request_timeout_ms}ms`);
  lines.push(`repair retries     ${policy.max_repair_retries}`);
  lines.push(`global daily cap   $${policy.global_daily_budget_usd} TEST`);
  lines.push("");
  lines.push(`SPEND TODAY (${day})  $${spend.total_usd} ${spend.figure_label} over ${spend.calls} calls`);
  lines.push("");
  for (const key of AI_CAPABILITY_KEYS) {
    const cap = policy.capabilities[key];
    if (!cap) continue;
    const model = findModel(cap.model_id);
    const spent = spend.by_capability[key] ?? 0;
    lines.push(`${cap.enabled ? "ON " : "off"}  ${key}`);
    lines.push(
      `      model ${cap.model_id}${model ? ` (${model.mode}, customer data ${model.allows_customer_data ? "ALLOWED" : "not cleared"})` : " — NOT IN CATALOGUE"}`
    );
    lines.push(
      `      caps  $${cap.max_cost_per_call_usd}/call, $${cap.daily_cap_usd}/day TEST · spent today $${spent} · max ${cap.max_output_tokens} output tokens`
    );
  }
  lines.push("");
  lines.push(
    "Nothing runs unless the master switch AND the capability are both ON. A capability that handles"
  );
  lines.push(
    "homeowner text also needs a model marked customer-data cleared, which is an owner decision and"
  );
  lines.push("which no seeded model carries today.");
  process.stdout.write(lines.join("\n") + "\n");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const store = new FileAiPolicyStore();
  const current = await store.getActive();

  if (!command) {
    await show(current);
    return;
  }

  const next: AiPolicy = { ...current, capabilities: { ...current.capabilities } };

  switch (command) {
    case "on":
    case "off": {
      next.enabled = command === "on";
      break;
    }
    case "enable":
    case "disable": {
      const key = requireCapability(rest[0]);
      next.capabilities[key] = { ...next.capabilities[key], enabled: command === "enable" };
      break;
    }
    case "model": {
      const key = requireCapability(rest[0]);
      const modelId = rest[1];
      if (!findModel(modelId)) {
        throw new Error(
          `"${modelId}" is not in MODEL_CATALOGUE. An unpriced model is refused at call time, never priced at zero — run \`npm run ai:models\` and add it deliberately.`
        );
      }
      next.capabilities[key] = { ...next.capabilities[key], model_id: modelId };
      break;
    }
    case "set": {
      const key = requireCapability(rest[0]);
      const field = rest[1];
      const value = Number(rest[2]);
      if (!["max_cost_per_call_usd", "daily_cap_usd", "max_output_tokens"].includes(field)) {
        throw new Error(`"${field}" is not a settable field`);
      }
      if (!Number.isFinite(value)) throw new Error(`"${rest[2]}" is not a number`);
      next.capabilities[key] = { ...next.capabilities[key], [field]: value };
      break;
    }
    default:
      usage();
      return;
  }

  next.version = current.version + 1;
  // Validated on save: an invalid policy is refused, whoever is editing.
  await store.save(AiPolicy.parse(next));
  process.stdout.write(`saved v${next.version}\n\n`);
  await show(await store.getActive());
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n`);
  usage();
  process.exitCode = 1;
});

// Referenced so the shipped defaults stay the documented fallback for a missing file.
void DEFAULT_AI_POLICY;
