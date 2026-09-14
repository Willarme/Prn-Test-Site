import { unguardedRuntimeStore } from "../../src/platform/stores/runtime";

// Invoked only by features.process-storage.test.ts with an isolated temporary DB.
async function main() {
  const store = unguardedRuntimeStore();
  const action = process.argv[2];
  try {
    const input = JSON.parse(process.argv[3] ?? "{}");
    const result = action === "set" ? await store.setFeatureStates(input)
      : action === "interest" ? await store.recordFeatureInterest(input)
      : await store.listFeatureStates("trial");
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: (error as { code?: string }).code,
      message: (error as Error).message }));
  }
}
void main();
