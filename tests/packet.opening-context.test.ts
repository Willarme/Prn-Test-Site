import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { printablePacketText } from "@/domain/packet/directions-input";
import { renderPacketHtml } from "@/domain/packet/render";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { signLink } from "@/platform/links/tokens";
import { loadPacket } from "@/platform/packet/load";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as finishPost } from "@/app/api/intake/finish/route";

let dir: string;
const network = vi.fn(() => { throw new Error("No network in opening-context tests"); });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "packet-opening-context-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "dev-db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubGlobal("fetch", network);
  resetRuntimeStore(); setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); resetRuntimeStore(); setAiPolicyStoreForTests(null); setSpendLedgerForTests(null);
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true });
});
async function accepted(response: Response) {
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body;
}
function request(path: string, body: object) {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function createPacket(description: string) {
  const started = await accepted(await startPost(request("/api/intake", { description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
    attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
      intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } })));
  const id = started.request_id as string;
  await accepted(await finishPost(request("/api/intake/finish", { request_id: id, k: signLink({ scope: "keep", request_id: id }) })));
  const journey = (await runtimeStore().getJourney(id))!;
  const loaded = await loadPacket(id, { owner: true, link_base: "https://example.test", now: journey.packet.generated_at });
  expect(loaded?.input).not.toBeNull();
  return { journey, input: loaded!.input!, rendered: renderPacketHtml(loaded!.input!) };
}

describe("the provider packet preserves supplied opening context", () => {
  it("keeps unparsed clauses from the accepted multi-sentence opening without claiming structured readings", async () => {
    const description = "SYNTHETIC QUALITY AUDIT: My central AC stopped cooling yesterday afternoon. Air is coming from the vents but feels warm. The thermostat is set to cool at 72 degrees and reads 79. The filter was changed two months ago.";
    const { journey, input, rendered } = await createPacket(description);
    expect(journey.packet.intake_snapshot!.handoff.user_language).toBe(description);
    expect(input.narrative.summary_observations[0]).toContain(description);
    expect(rendered.html).toContain("Air is coming from the vents but feels warm.");
    expect(rendered.html).toContain("The filter was changed two months ago.");
    expect(input.narrative.script_parts.problem_clause).not.toContain("two months ago");
    expect(input.evidence.readings?.filter_age_weeks).toBeUndefined();
    expect(rendered.self_check.ok).toBe(true);
  });

  it("retains supplied text in storage while applying the existing shared-text privacy and amount firewall", async () => {
    const description = "My AC is not cooling. The filter was changed two months ago. Contact audit@example.test, 555-010-1234. Gate code is 4321. The previous invoice was $250.";
    const { journey, input, rendered } = await createPacket(description);
    expect(journey.packet.intake_snapshot!.handoff.user_language).toBe(description);
    expect(input.narrative.summary_observations[0]).toContain(printablePacketText(description));
    expect(rendered.html).toContain("The filter was changed two months ago.");
    for (const privateText of ["audit@example.test", "555-010-1234", "4321", "$250"]) {
      expect(rendered.html).not.toContain(privateText);
    }
    expect(rendered.self_check.ok).toBe(true);
  });
});
