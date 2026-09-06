import { FileRequestCallLedger, requestCallPolicy } from "../../src/platform/ai/request-calls";

const [root, requestId, tenantId, tries = "20"] = process.argv.slice(2);
process.send?.({ ready: true });
process.once("message", async () => {
  try {
    const ledger = new FileRequestCallLedger(root);
    let admitted = 0;
    for (let i = 0; i < Number(tries); i++) {
      if (await ledger.reserve({ request_id: requestId, tenant_id: tenantId }, requestCallPolicy(), "classify_home_problem")) admitted++;
    }
    process.send?.({ admitted });
  } catch { process.send?.({ error: "Request admission worker failed" }); process.exitCode = 1; }
  finally { process.disconnect?.(); }
});
