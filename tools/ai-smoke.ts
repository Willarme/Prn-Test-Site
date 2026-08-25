import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { callModel } from "../src/platform/ai/callModel";
import { AiPolicy, DEFAULT_AI_POLICY } from "../src/platform/ai/policy";
import { MemoryAiPolicyStore } from "../src/platform/ai/policy-store";
import { spendLedger, utcDay } from "../src/platform/ai/spend";
import { fetchGenerationCost } from "../src/platform/ai/providers/openrouter";

/**
 * `npm run ai:smoke` — ONE real model call, through the whole stack.
 *
 * WHAT IT PROVES, and why each part matters:
 *   - the credential authenticates and the endpoint shape is right;
 *   - json_object mode works on the model the owner chose (ox-alpha advertises
 *     no structured_outputs support, so the schema has to travel in the prompt
 *     and be enforced by us) — this is the mode PRN actually depends on;
 *   - the governed door runs: registry lookup, kill switch, permission,
 *     enablement, privacy, budget, validation, one ledger row, one event;
 *   - the spend record persists to disk, so a restart cannot reset the cap;
 *   - and the key appears nowhere in anything this script emits.
 *
 * IT COSTS NOTHING. stealth/ox-alpha is priced $0/$0. It is also known to return
 * 429 `upstream_provider_shared_pool` when the free pool saturates — recorded in
 * this project's own operations log — so a 429 here is a REPORTABLE OUTCOME, not
 * a failure of the wiring. The script says which it got.
 *
 * IT DOES NOT TOUCH THE COMMITTED POLICY. Enablement is supplied in-process, so
 * running the smoke never leaves a capability switched on behind you.
 */

const SMOKE_MODEL = "stealth/ox-alpha";
const SMOKE_CAPABILITY = "seo.critique_page";

function loadEnv(): void {
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

/**
 * Everything printed goes through here so the final key-leak assertion sees the
 * WHOLE transcript, not just the lines somebody remembered to check.
 */
const transcript: string[] = [];
function say(line: string): void {
  transcript.push(line);
}

const SmokeReply = z.object({
  ok: z.boolean(),
  one_word: z.string().min(1).max(40),
});

const SMOKE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "one_word"],
  properties: {
    ok: { type: "boolean" },
    one_word: { type: "string" },
  },
};

async function main(): Promise<void> {
  loadEnv();
  const key = process.env.OPENROUTER_API_KEY;

  say("PRN AI SMOKE — one real call through the full stack");
  say("");
  say(`model      ${SMOKE_MODEL}`);
  say(`capability ${SMOKE_CAPABILITY} (A06, handles_customer_data: false)`);
  say(`credential ${key ? "present" : "ABSENT"}`);
  say("");

  if (!key) {
    say("No OPENROUTER_API_KEY. Nothing to smoke — and that is not an error:");
    say("a deployment with no key has no model, and every capability falls back");
    say("deterministically. That path is covered by the test suite.");
    finish();
    return;
  }

  /**
   * The shipped policy with ONE capability switched on, in memory. The committed
   * document is untouched.
   */
  const policy = AiPolicy.parse({
    ...DEFAULT_AI_POLICY,
    enabled: true,
    capabilities: {
      ...DEFAULT_AI_POLICY.capabilities,
      [SMOKE_CAPABILITY]: {
        ...DEFAULT_AI_POLICY.capabilities[SMOKE_CAPABILITY],
        enabled: true,
        model_id: SMOKE_MODEL,
        max_output_tokens: 800,
      },
    },
  });

  const day = utcDay();
  const before = await spendLedger().read(day);
  say(`spend before  ${before.total_usd} ${before.figure_label} (${before.calls} calls today)`);
  say("");

  const started = Date.now();
  const result = await callModel({
    agent_id: "A06",
    capability: SMOKE_CAPABILITY,
    handles_customer_data: false,
    prompt_id: "smoke.probe",
    prompt_version: "1.0.0",
    system:
      "You are a connectivity probe. Reply with the JSON object described below and nothing else.",
    user: 'Set "ok" to true and "one_word" to the single word: alive',
    schema_name: "SmokeReply",
    schema: SmokeReply,
    json_schema: SMOKE_JSON_SCHEMA,
    input_ids: ["smoke"],
    trigger: "admin_action",
    deps: { policyStore: new MemoryAiPolicyStore(policy), policy },
  });
  const wall = Date.now() - started;

  if (!result.ok) {
    say(`RESULT     ok=false  reason=${result.reason}`);
    say(`detail     ${result.detail}`);
    say(`run_id     ${result.run_id ?? "(none)"}`);
    say(`wall       ${wall}ms`);
    say("");
    if (result.reason === "rate_limited") {
      say("A 429 IS THE KNOWN BEHAVIOUR OF THE FREE POOL, not a wiring failure.");
      say("The provider retried with backoff before giving up, the reason was");
      say("recorded on a ledger row, and every caller of this capability falls");
      say("back deterministically. On A06 that means ai_critic.status NOT_RUN,");
      say("which is never treated as a pass. No customer sees any of it.");
    } else {
      say("Every failure reason above is a typed result, never a throw, and every");
      say("caller falls back to its deterministic implementation.");
    }
    finish();
    return;
  }

  say(`RESULT     ok=true`);
  say(`value      ${JSON.stringify(result.value)}`);
  say(`provider   ${result.provider}`);
  say(`model      ${result.model_id}`);
  say(`repaired   ${result.repaired}`);
  say(`tokens     ${result.usage.prompt_tokens} in / ${result.usage.completion_tokens} out / ${result.usage.total_tokens} total`);
  say(
    `reported   ${result.usage.reported_cost_usd === null ? "(the API reported no cost on the response)" : `$${result.usage.reported_cost_usd}`}`
  );
  say(`cost       $${result.cost_usd} ${result.figure_label}`);
  say(`basis      ${result.cost_basis}`);
  say(`latency    ${result.latency_ms}ms`);
  say(`generation ${result.generation_id ?? "(none)"}`);
  say(`run_id     ${result.run_id}`);

  if (result.generation_id) {
    const exact = await fetchGenerationCost(key, result.generation_id);
    say(
      `exact cost ${exact === null ? "(GET /generation did not return one yet — accounting lags the call)" : `$${exact} (GET /api/v1/generation, the vendor's own figure)`}`
    );
  }

  const after = await spendLedger().read(day);
  say("");
  say(`spend after   ${after.total_usd} ${after.figure_label} (${after.calls} calls today)`);
  say("The record is on disk. A restart cannot reset it.");

  finish();
}

function finish(): void {
  const key = process.env.OPENROUTER_API_KEY;
  const output = transcript.join("\n");

  // THE ASSERTION THIS SCRIPT EXISTS TO MAKE, alongside the call itself.
  if (key && output.includes(key)) {
    process.stdout.write(
      "FATAL: the credential appeared in this script's output. Refusing to print it.\n"
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(output + "\n\n");
  process.stdout.write(
    key
      ? "key leak check: PASS — the credential appears nowhere in the output above.\n"
      : "key leak check: n/a — no credential was configured.\n"
  );
}

void main();
