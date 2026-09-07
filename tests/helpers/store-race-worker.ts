import { readFileSync } from "node:fs";
import { unguardedRuntimeStore } from "../../src/platform/stores/runtime";
import { updateDevDb } from "../../src/platform/stores/dev-db";
import { decodeLink, signLink } from "../../src/platform/links/tokens";
import { withFileLock } from "../../src/platform/stores/atomic-file";
import { issueLink } from "../../src/platform/links/ledger";

const mode = process.argv[2];
process.on("message", async () => {
  try {
    let result: unknown;
    if (mode === "consume") result = await unguardedRuntimeStore().consumeMagicLink("mg_race", new Date().toISOString(), "rq_race");
    else if (mode === "append") {
      for (let i = 0; i < 15; i++) updateDevDb(db => { db.signups.push({ signup_id: `su_${process.pid}_${i}`, page: "fixture", vote: "yes", created_at: new Date().toISOString() }); });
      result = true;
    } else if (mode === "issue") {
      for (let i = 0; i < 10; i++) (await issueLink({ scope: "ask", request_id: "rq_race" }));
      result = true;
    } else if (mode === "secret") result = signLink({ scope: "keep", request_id: "rq_race" });
    else if (mode === "verify") result = JSON.parse(readFileSync(process.argv[3], "utf8")).map((token: string) => decodeLink(token).ok);
    else if (mode === "die-locked") withFileLock(process.env.PRN_DEV_DB_PATH!, () => process.exit(23));
    else throw new Error("Unknown worker mode");
    process.send?.({ result: result ? (mode === "consume" ? true : result) : null });
    process.exit(0);
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
});
process.send?.({ ready: true });
