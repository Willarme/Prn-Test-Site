import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { readDevDb } from "@/platform/stores/dev-db";

/**
 * End-to-end intake flow at the API contract level: door -> shared form ->
 * central intake -> consent ledger -> ProblemRecord -> JobPacket. The same
 * journey the browser takes, minus the DOM.
 */
let intakePost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-devdb-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

function intakeRequest(description: string, pageId: string | null = null, hash?: string) {
  return new Request("http://localhost/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      disclosure_content_hash: hash ?? ACTIVE_DISCLOSURE.content_hash,
      attribution: {
        page_id: pageId,
        intent_cluster_id: pageId ? "ic_hvac_no_power" : null,
        search_opportunity_id: null,
        problem_family_hint: pageId ? "hvac" : null,
        experiment_id: null,
        variant: null,
        referrer: null,
        landing_path: pageId ? "/problems/ac-not-turning-on" : "/start",
      },
    }),
  });
}

describe("central intake flow", () => {
  it("rejects descriptions that are too short, kindly", async () => {
    const res = await intakePost(intakeRequest("broke"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/a sentence is plenty/i);
  });

  it("door arrival: creates session, versioned consent, problem, and packet", async () => {
    const res = await intakePost(
      intakeRequest("The AC won't turn on since yesterday evening", "page_ac_not_turning_on")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toMatch(/^rq_/);

    const db = readDevDb();
    const session = db.intake_sessions.find((s) => s.request_id === body.request_id)!;
    expect(session.attribution.page_id).toBe("page_ac_not_turning_on");

    const consent = db.consent_events.find((c) => session.consent_event_ids.includes(c.consent_event_id))!;
    expect(consent.disclosure_version_id).toBe(ACTIVE_DISCLOSURE.disclosure_version_id);
    expect(consent.action).toBe("GRANT");
    expect(consent.surface).toBe("start_request_form");

    const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id)!;
    expect(problem.service_category).toBe("hvac");
    const packet = db.packets.find((k) => k.problem_id === problem.problem_id)!;
    expect(packet.engine).toBe("fixture");

    const eventNames = db.events.map((e) => e.event_name);
    for (const required of ["intake.started", "consent.granted", "problem.created", "packet.generated"]) {
      expect(eventNames).toContain(required);
    }
    // Attribution flows into events (page -> intake attribution, Wave 0 contract)
    const intakeEvent = db.events.find((e) => e.event_name === "intake.started")!;
    expect(intakeEvent.context.page_id).toBe("page_ac_not_turning_on");
  });

  it("rejects a consent-disclosure hash mismatch — recorded consent can never lie", async () => {
    const res = await intakePost(
      intakeRequest("water is dripping from the ceiling fan", null, "stale_hash_123")
    );
    expect(res.status).toBe(409);
  });

  it("gas smell HALTS server-side: no record, no packet, safety event only", async () => {
    const problemsBefore = readDevDb().problems.length;
    const res = await intakePost(intakeRequest("It smells like gas near the stove"));
    const body = await res.json();
    expect(body.request_id).toBeNull(); // nothing to redirect to
    expect(body.safety.state).toBe("urgent");
    expect(body.safety.intake_may_continue).toBe(false);
    expect(body.safety.message).toMatch(/leave the building/i);
    const db = readDevDb();
    expect(db.problems.length).toBe(problemsBefore); // NO analysis ran (#14A §14)
    expect(db.events.some((e) => e.event_name === "safety.triggered" && e.context.halted === "true")).toBe(true);
  });

  it("direct /start arrival works with no door attribution at all", async () => {
    const res = await intakePost(intakeRequest("water dripping through the kitchen ceiling when someone showers"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const db = readDevDb();
    const session = db.intake_sessions.find((s) => s.request_id === body.request_id)!;
    expect(session.attribution.page_id).toBeNull();
    const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id)!;
    expect(problem.service_category).toBe("plumbing");
  });
});
