import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { heldFieldConflicts } from "@/domain/intake/field-conflicts";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { runtimeStore } from "@/platform/stores/runtime";
import { loadJourneyContext } from "@/platform/intake/complete";
import { signLink } from "@/platform/links/tokens";
import { loadPacket } from "@/platform/packet/load";
import { renderPacketHtml } from "@/domain/packet/render";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import CompletePage from "@/app/complete/[request_id]/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: () => { throw new Error("NEXT_REDIRECT"); },
}));
const network = vi.fn(() => { throw new Error("No network in conflict tests"); });
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), "prn-field-conflict-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(directory, "dev-db.json"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubGlobal("fetch", network);
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function start() {
  const response = await startPost(new Request("http://localhost/api/intake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "My Carrier AC is 8 years old and blowing warm air since Tuesday.",
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
        intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } }),
  }));
  expect(response.status).toBe(200);
  return (await response.json()).request_id as string;
}
async function answer(request_id: string, field_key: string, value: string, confirmed = false) {
  const response = await answerPost(new Request("http://localhost/api/intake/answer", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ request_id, k: signLink({ scope: "keep", request_id }), fields: [{ field_key, value, confirmed }] }),
  }));
  expect(response.status).toBe(200);
}
async function completeHtml(request_id: string) {
  return renderToStaticMarkup(await CompletePage({ params: Promise.resolve({ request_id }),
    searchParams: Promise.resolve({ k: signLink({ scope: "keep", request_id }) }) }));
}

describe("later brand and age conflicts (F12)", () => {
  it("retains confirmed Carrier and age while showing the later Trane/age reports on reload and in the packet", async () => {
    const id = await start();
    await answer(id, "brand", "Carrier", true);
    const before = network.mock.calls.length;
    await answer(id, "symptom_timing", "My Trane AC is 9 years old.");
    const answers = await runtimeStore().listIntakeAnswers(id);
    expect(answers.filter(a => a.field_key === "brand").at(-1)).toMatchObject({ value_text: "Carrier", source: "confirmed" });
    expect(answers.filter(a => a.field_key === "system_age").at(-1)?.value_text).toBe("8 years");
    const ctx = (await loadJourneyContext(id))!;
    const conflicts = heldFieldConflicts(answers, ctx.allEvidence, ctx.playbook.required_fields);
    expect(conflicts.map(c => [c.field_key, c.held_value, c.reported_values])).toEqual([
      ["brand", "Carrier", ["Trane"]], ["system_age", "8 years", ["9 years"]],
    ]);
    expect(ctx.journey.packet.what_remains_unknown).toContain("Brand needs confirmation. Kept: Carrier. Later reported: Trane.");
    expect(ctx.journey.packet.collected_details.find(d => d.label === "Brand")?.value).toContain("Later reported: Trane");
    expect(ctx.journey.packet.collected_details.find(d => d.label === "Brand")?.source).toBe("customer_text");
    for (let reload = 0; reload < 2; reload++) {
      const html = await completeHtml(id);
      expect(html).toContain('data-field-conflict="brand"');
      expect(html).toContain('data-field-conflict="system_age"');
      expect(html).toContain("Use Carrier");
      expect(html).toContain("Use Trane");
      expect(html).toContain("Both reports stay in your packet until you choose.");
    }
    await runtimeStore().saveJobAddress(id, { street: "1 Test Lane", city_state_zip: "Fort Wayne, IN 46802", property_type: null, storeys: null });
    const packet = await loadPacket(id, { link_base: "http://localhost", owner: true });
    expect(packet?.input?.equipment.brand?.value).toBe("Carrier / Trane (needs confirmation)");
    expect(packet?.input?.equipment.age_years).toBeNull();
    expect(packet?.input?.provider.unknowns.some(u => u.reason.includes("Kept: 8 years. Later reported: 9 years."))).toBe(true);
    const printed = renderPacketHtml(packet!.input!);
    expect(printed.self_check.ok).toBe(true);
    expect(printed.html).toContain("Brand needs confirmation");
    expect(printed.html).toContain("Later reported: Trane");
    expect(network.mock.calls.length).toBe(before);
  });

  it.each(["Carrier", "Trane"])("an explicit field choice resolves the conflict to %s and preserves the original evidence", async choice => {
    const id = await start();
    await answer(id, "symptom_timing", "My Trane AC is blowing warm air.");
    expect(await completeHtml(id)).toContain('data-field-conflict="brand"');
    await answer(id, "brand", choice, true);
    const ctx = (await loadJourneyContext(id))!;
    expect(ctx.allEvidence.some(e => e.content.includes("My Trane AC is blowing warm air."))).toBe(true);
    expect(heldFieldConflicts(await runtimeStore().listIntakeAnswers(id), ctx.allEvidence, ctx.playbook.required_fields)).toEqual([]);
    expect(ctx.journey.packet.what_remains_unknown.some(u => u.includes("Brand needs confirmation"))).toBe(false);
    expect(ctx.journey.packet.collected_details.find(d => d.label === "Brand")?.value).toBe(choice);
    expect(await completeHtml(id)).not.toContain("data-field-conflict");
    await runtimeStore().saveJobAddress(id, { street: "1 Test Lane", city_state_zip: "Fort Wayne, IN 46802", property_type: null, storeys: null });
    expect((await loadPacket(id, { link_base: "http://localhost", owner: true }))?.input?.equipment.brand?.value).toBe(choice);
  });

  it("an explicit edit of the brand remains an intentional replacement", async () => {
    const id = await start();
    await answer(id, "brand", "Trane");
    const html = await completeHtml(id);
    expect(html).not.toContain("data-field-conflict");
    expect(html).not.toContain("Got it — Carrier");
    expect((await runtimeStore().getJourney(id))?.packet.collected_details.find(d => d.label === "Brand")?.value).toBe("Trane");
  });

  it("an explicit age choice resolves the age conflict in the reloaded packet", async () => {
    const id = await start();
    await answer(id, "symptom_timing", "My AC is 9 years old.");
    expect(await completeHtml(id)).toContain('data-field-conflict="system_age"');
    await answer(id, "system_age", "9 years", true);
    const ctx = (await loadJourneyContext(id))!;
    expect(heldFieldConflicts(await runtimeStore().listIntakeAnswers(id), ctx.allEvidence, ctx.playbook.required_fields)).toEqual([]);
    expect(ctx.journey.packet.what_remains_unknown.some(u => u.includes("Age needs confirmation"))).toBe(false);
    expect(ctx.journey.packet.collected_details.find(d => d.label === "Roughly how old is the system?")?.value).toBe("9 years");
    expect(await completeHtml(id)).not.toContain("data-field-conflict");
    await runtimeStore().saveJobAddress(id, { street: "1 Test Lane", city_state_zip: "Fort Wayne, IN 46802", property_type: null, storeys: null });
    expect((await loadPacket(id, { link_base: "http://localhost", owner: true }))?.input?.equipment.age_years).toBe(9);
  });

  it("the printable packet orders old second-precision and new millisecond answers chronologically", async () => {
    const id = await start();
    const second = Math.ceil(Date.now() / 1000) * 1000;
    await runtimeStore().saveIntakeAnswers([
      { request_id: id, field_key: "brand", value_text: "Carrier", source: "confirmed", evidence_id: null,
        answered_at: new Date(second).toISOString().replace(".000Z", "Z") },
      { request_id: id, field_key: "brand", value_text: "Trane", source: "confirmed", evidence_id: null,
        answered_at: new Date(second + 1).toISOString() },
    ]);
    await runtimeStore().saveJobAddress(id, { street: "1 Test Lane", city_state_zip: "Fort Wayne, IN 46802", property_type: null, storeys: null });
    expect((await loadPacket(id, { link_base: "http://localhost", owner: true }))?.input?.equipment.brand?.value).toBe("Trane");
  });
});

describe("conflict chronology does not depend on database row order", () => {
  const answerRow = { request_id: "rq_fixture", field_key: "brand", value_text: "Carrier", source: "confirmed" as const,
    evidence_id: "ev_confirm", answered_at: "2026-09-05T22:00:00Z" };
  const report = { evidence_id: "ev_report", kind: "customer_text" as const, privacy: "private" as const,
    content: "My Trane AC is blowing warm air.", captured_at: "2026-09-05T22:00:00Z", field_key: "intake_answer_text" };
  const confirmation = { ...report, evidence_id: "ev_confirm", content: "Carrier" };

  it.each([false, true])("retains an ambiguous historical tie regardless of evidence order (reversed: %s)", reverse => {
    const rows = reverse ? [confirmation, report] : [report, confirmation];
    expect(heldFieldConflicts([answerRow], rows, HVAC_COOLING_PLAYBOOK.required_fields)).toMatchObject([
      { field_key: "brand", held_value: "Carrier", reported_values: ["Trane"] },
    ]);
  });

  it("a later millisecond confirmation resolves the prior report independently of row order", () => {
    const later = { ...answerRow, answered_at: "2026-09-05T22:00:00.001Z" };
    expect(heldFieldConflicts([later], [confirmation, report], HVAC_COOLING_PLAYBOOK.required_fields)).toEqual([]);
  });
});

describe("only current literal cross-field reports create a conflict", () => {
  it.each([
    "Could my unit be a Trane that is 9 years old?", "I think my AC is a Trane, 9 years old.",
    "My previous unit was a Trane, 9 years old.", "It is not a Trane.",
    "The example says my Trane is 9 years old.", "If the Trane is 9 years old, should I replace it?",
    "I remember the Trane is 9 years old.", "My Carrier AC is 8 years old.",
  ])("does not contradict the held values for: %s", content => {
    const answers = [
      { request_id: "rq_fixture", field_key: "brand", value_text: "Carrier", source: "confirmed" as const, evidence_id: "ev_original", answered_at: "2026-09-05T22:00:00Z" },
      { request_id: "rq_fixture", field_key: "system_age", value_text: "8 years", source: "confirmed" as const, evidence_id: "ev_original", answered_at: "2026-09-05T22:00:00Z" },
    ];
    expect(heldFieldConflicts(answers, [{ evidence_id: "ev_later", kind: "customer_text", privacy: "private", content,
      captured_at: "2026-09-05T22:00:01Z", field_key: "intake_answer_text" }], HVAC_COOLING_PLAYBOOK.required_fields)).toEqual([]);
  });
});
