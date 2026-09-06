import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { analyzeProblemFixture } from "@/domain/problem/fixture-engine";
import { reclassifyOnNewEvidence, selectClarifier } from "@/domain/problem/capabilities";
import { findPlaybook } from "@/domain/intake/playbooks";
import { readDevDb } from "@/platform/stores/dev-db";
import { requirePolicyNumber } from "@/platform/policy/store";
import { ownerTokenFor, rememberOwner } from "./helpers/journey-auth";

/**
 * A01 STEP 9 — THE INSTRUMENTS, PROVEN THROUGH THE REAL SURFACES.
 *
 * Events are append-only history and cannot be backfilled, so the thing worth
 * proving is not that a function exists — it is that a homeowner answering a
 * question on the live route leaves a record. Every assertion below reads the
 * event log after driving the actual API handler.
 */
let intakePost: (req: Request) => Promise<Response>;
let answerPost: (req: Request) => Promise<Response>;
let mediaPost: (req: Request) => Promise<Response>;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-instruments-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
  ({ POST: answerPost } = await import("@/app/api/intake/answer/route"));
  ({ POST: mediaPost } = await import("@/app/api/intake/media/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

async function startJourney(): Promise<string> {
  const res = await intakePost(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "The ac stopped cooling and the outside unit is silent",
        disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
        attribution: {
          page_id: null,
          intent_cluster_id: null,
          search_opportunity_id: null,
          problem_family_hint: null,
          experiment_id: null,
          variant: null,
          referrer: null,
          landing_path: "/start",
        },
      }),
    })
  );
  const requestId = (await res.json()).request_id as string;
  // The answer and media routes are owner-gated (platform/links/owner.ts):
  // carry the signed owner proof the intake route just issued, as `k`, the
  // way a direct handler call without a Next cookie context has to.
  rememberOwner(requestId, res);
  return requestId;
}

function events(name: string) {
  return readDevDb().events.filter((e) => e.event_name === name);
}

describe("A01 — intake.clarifier_answered fires on the live answer route", () => {
  it("one event per accepted field, carrying the key and never the answer", async () => {
    const requestId = await startJourney();
    const before = events("intake.clarifier_answered").length;

    const res = await answerPost(
      new Request("http://localhost/api/intake/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          k: ownerTokenFor(requestId),
          fields: [
            { field_key: "system_age", value: "about 9 years old" },
            // Not a field this playbook asks for — must be ignored by both the
            // save and the instrument.
            { field_key: "not_a_real_field", value: "ignored" },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);

    const after = events("intake.clarifier_answered");
    expect(after.length).toBe(before + 1);
    const ev = after[after.length - 1];
    expect(ev.context.field_key).toBe("system_age");
    expect(ev.context.source).toBe("typed");
    expect(ev.context.request_id).toBe(requestId);
    expect(ev.privacy_class).toBe("internal");
    // THE ANSWER DOES NOT TRAVEL. Nothing in the envelope carries their words.
    expect(JSON.stringify(ev)).not.toContain("9 years old");
  });

  it("an uploaded photo for a registered required field records its answer instrument", async () => {
    const requestId = await startJourney();
    const before = events("intake.clarifier_answered").length;

    const form = new FormData();
    form.set("request_id", requestId);
    form.set("target", "unit_model_serial");
    form.set("k", ownerTokenFor(requestId));
    form.set("file", new File([new Uint8Array(PNG)], "plate.png", { type: "image/png" }));
    const res = await mediaPost(
      new Request("http://localhost/api/intake/media", { method: "POST", body: form })
    );
    expect(res.status).toBe(200);

    const after = events("intake.clarifier_answered");
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].context.source).toBe("photo");
    expect(after[after.length - 1].context.field_key).toBe("unit_model_serial");
  });
});

describe("A01 — intake.clarifier_asked fires when a question is selected", () => {
  const playbook = findPlaybook("pb_hvac_cooling_v1")!;
  const max = requirePolicyNumber("intake.max_clarifying_questions");

  it("emits on an ask, with the field key and the running count", async () => {
    const before = events("intake.clarifier_asked").length;
    const out = await selectClarifier(
      { playbook, answered_field_keys: [], asked_count: 2, max_questions: max },
      { allow_model: false, request_id: "rq_instrument" }
    );
    expect(out.ask).not.toBeNull();
    const after = events("intake.clarifier_asked");
    expect(after.length).toBe(before + 1);
    const ev = after[after.length - 1];
    expect(ev.context.field_key).toBe(out.ask?.field_key);
    expect(ev.context.asked_count).toBe("2");
    expect(ev.context.max_questions).toBe(String(max));
  });

  it("emits NOTHING at the cap — an unasked question is not an asked one", async () => {
    const before = events("intake.clarifier_asked").length;
    const out = await selectClarifier(
      { playbook, answered_field_keys: [], asked_count: max, max_questions: max },
      { allow_model: false }
    );
    expect(out.ask).toBeNull();
    expect(events("intake.clarifier_asked").length).toBe(before);
  });
});

describe("A01 — problem.updated fires on re-classification, and only then", () => {
  const NOW = "2026-08-25T00:00:00Z";

  it("says nothing when the classification stands", async () => {
    const problem = analyzeProblemFixture({
      description: "my roof is leaking after the storm",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    }).problem;
    const before = events("problem.updated").length;
    const outcome = await reclassifyOnNewEvidence({
      existing: problem,
      description: "my roof is leaking after the storm",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
      trigger: "evidence_added",
    });
    expect(outcome.changed).toBe(false);
    expect(events("problem.updated").length).toBe(before);
  });

  it("emits when it genuinely moved, naming what changed and never the text", async () => {
    const stale = analyzeProblemFixture({
      description: "water is coming through the ceiling",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
    }).problem;
    const before = events("problem.updated").length;
    const outcome = await reclassifyOnNewEvidence({
      existing: stale,
      description: "my roof is leaking after the storm and shingles came off",
      intake_session_id: null,
      problem_family_hint: null,
      now: NOW,
      trigger: "evidence_added",
    });
    expect(outcome.changed).toBe(true);
    const after = events("problem.updated");
    expect(after.length).toBe(before + 1);
    const ev = after[after.length - 1];
    expect(ev.context.change).toBe("reclassified");
    expect(ev.context.changed_fields).toContain("service_category");
    expect(ev.context.to).toBe("roofing");
    expect(JSON.stringify(ev)).not.toContain("shingles");
  });

  it("does NOT overwrite the stored record — it reports", () => {
    const capabilities = readFileSync(
      join(process.cwd(), "src/domain/problem/capabilities.ts"),
      "utf-8"
    );
    // No store write of any kind in the re-classification path.
    expect(capabilities).not.toMatch(/savePacket|recordJourney|saveProblem/);
  });
});

describe("A01 — the instruments mint nothing", () => {
  it("every name emitted from A01's paths was already registered", () => {
    const sources = [
      "src/domain/problem/capabilities.ts",
      "src/app/api/intake/answer/route.ts",
      "src/app/api/intake/media/route.ts",
    ].map((f) => readFileSync(join(process.cwd(), f), "utf-8"));
    const emitted = new Set<string>();
    for (const src of sources) {
      for (const m of src.matchAll(/event_name:\s*"([a-z_.]+)"/g)) emitted.add(m[1]);
    }
    const allowed = new Set([
      "intake.started",
      "intake.evidence_added",
      "intake.clarifier_asked",
      "intake.clarifier_answered",
      "safety.triggered",
      "problem.created",
      "problem.updated",
      "problem.fact_extracted",
      "consent.granted",
    ]);
    for (const name of emitted) {
      expect(allowed, `${name} is outside A01's permitted set`).toContain(name);
    }
    expect(emitted.has("intake.clarifier_answered")).toBe(true);
    expect(emitted.has("problem.updated")).toBe(true);
  });
});
