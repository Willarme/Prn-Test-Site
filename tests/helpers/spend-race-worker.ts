import { FileSpendLedger } from "../../src/platform/ai/spend";

process.once("message", async () => {
  try {
    const ledger = new FileSpendLedger(process.argv[2]);
    if (process.argv[3] === "reserve") {
      let admitted = 0;
      for (let i = 0; i < 20; i++) {
        if (await ledger.reserve({ day: "2026-09-05", capability: process.argv[4], usd: 0.01, global_cap_usd: 0.05, capability_cap_usd: 0.03 })) admitted += 1;
      }
      process.send?.({ done: true, admitted });
      process.disconnect();
      return;
    }
    for (let i = 0; i < 20; i++) await ledger.record("2026-09-05", "fixture.capability", 0.001);
    process.send?.({ done: true });
    process.disconnect();
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
});
process.send?.({ ready: true });
