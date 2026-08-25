import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";

/**
 * The runtime-editable home of AiPolicy — the same shape as
 * platform/stores/policy-file.ts, deliberately.
 *
 * That file is the repo's proven pattern for "configuration over code": a JSON
 * document read at run time, validated on save so an invalid policy can never be
 * persisted no matter who edits it, with a /tmp override on Vercel because the
 * repo file is read-only there. Model enablement and spend caps need exactly
 * those properties, so they get the same mechanism rather than a new one.
 *
 * VALIDATION ON SAVE IS THE POINT. `AiPolicy` refuses a document whose per-call
 * cap exceeds its daily cap, whose daily cap exceeds the global budget, or whose
 * dollar figures have lost their TEST label. An owner cannot accidentally write
 * a policy that fails open.
 *
 * A MISSING FILE IS THE DEFAULT POLICY, and the default is everything OFF. So a
 * fresh checkout, a fresh deployment and a deleted file all land in the same
 * safe state.
 */
export interface AiPolicyStore {
  getActive(): Promise<AiPolicy>;
  save(policy: AiPolicy): Promise<void>;
}

export const AI_POLICY_PATH = join(process.cwd(), "data", "ai-policy.json");

export class FileAiPolicyStore implements AiPolicyStore {
  constructor(private readonly filePath: string = AI_POLICY_PATH) {}

  /** On Vercel the repo file is read-only; runtime edits live in /tmp (ephemeral). */
  private overridePath(): string | null {
    return process.env.VERCEL ? "/tmp/prn-runtime/ai-policy.json" : null;
  }

  async getActive(): Promise<AiPolicy> {
    const candidates = [this.overridePath(), this.filePath].filter(
      (p): p is string => p !== null
    );
    for (const path of candidates) {
      try {
        const raw = await readFile(path, "utf-8");
        return AiPolicy.parse(JSON.parse(raw));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        // A CORRUPT policy document must not fail OPEN. Falling back to the
        // shipped defaults means "everything off", which is the only safe
        // reading of "we cannot tell what the owner wanted".
        console.warn(
          `[ai-policy] could not read ${path} (${err instanceof Error ? err.message : String(err)}) — falling back to the shipped defaults, which have every capability DISABLED.`
        );
        return DEFAULT_AI_POLICY;
      }
    }
    return DEFAULT_AI_POLICY;
  }

  async save(policy: AiPolicy): Promise<void> {
    const valid = AiPolicy.parse(policy);
    const target = this.overridePath() ?? this.filePath;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(valid, null, 2) + "\n", "utf-8");
  }
}

/** In-memory store for tests and for callers that supply a policy directly. */
export class MemoryAiPolicyStore implements AiPolicyStore {
  constructor(private policy: AiPolicy = DEFAULT_AI_POLICY) {}
  async getActive(): Promise<AiPolicy> {
    return this.policy;
  }
  async save(policy: AiPolicy): Promise<void> {
    this.policy = AiPolicy.parse(policy);
  }
}

let active: AiPolicyStore | null = null;

export function aiPolicyStore(): AiPolicyStore {
  if (!active) active = new FileAiPolicyStore();
  return active;
}

/** Test seam. */
export function setAiPolicyStoreForTests(store: AiPolicyStore | null): void {
  active = store;
}
