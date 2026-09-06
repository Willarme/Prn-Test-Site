import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvidenceObject } from "@/domain/problem/contracts";
import {
  countPhotos,
  maxPhotosPerRequest,
  photoCapDecision,
  photoCapDecisionFor,
} from "@/domain/problem/evidence-caps";
import {
  capReached,
  selectNextClarifierDeterministic,
} from "@/domain/problem/clarifier";
import { findPlaybook } from "@/domain/intake/playbooks";
import { QUESTION_COSTS } from "@/domain/intake/readiness";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { MAX_INTAKE_EFFORT, readIntakeEffort } from "@/platform/intake/effort";
import { getPolicySetting, requirePolicyNumber } from "@/platform/policy/store";
import { runtimeStore } from "@/platform/stores/runtime";
import { rememberOwner, ownerTokenFor } from "./helpers/journey-auth";

/**
 * A01 STEP 5 — THE TWO CAPS.
 *
 * One of these did not exist at all (photos) and one existed as a mechanism the
 * eval harness could not see (clarifying questions). Both are proven the same
 * way: through the real surface, at the boundary, with the number read from
 * policy rather than written into the assertion.
 */
let intakePost: (req: Request) => Promise<Response>;
let mediaPost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-caps-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
  ({ POST: mediaPost } = await import("@/app/api/intake/media/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

/** A one-pixel PNG, so the upload path is exercised with a real allowed type. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

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
  const body = await res.json();
  rememberOwner(body.request_id, res);
  return body.request_id as string;
}

async function uploadPhoto(requestId: string, target: string, index: number): Promise<Response> {
  const form = new FormData();
  form.set("request_id", requestId);
  form.set("k", ownerTokenFor(requestId));
  form.set("target", target);
  form.set("file", new File([new Uint8Array(PNG)], `photo-${index}.png`, { type: "image/png" }));
  return mediaPost(
    new Request("http://localhost/api/intake/media", { method: "POST", body: form })
  );
}

describe("A01 — the photo cap", () => {
  it("reads its number from the policy store, and the number is the decided one", () => {
    const setting = getPolicySetting<number>("intake.max_photos_per_request");
    expect(setting).not.toBeNull();
    expect(setting?.level).toBe("COMPANY");
    // The stored photo policy is six, independently of the T1-35 combined
    // effort ceiling. Six admitted media actions plus opening would cost 23.
    expect(maxPhotosPerRequest()).toBe(6);
    expect(setting?.version).toBe(2);
    expect(maxPhotosPerRequest()).toBe(requirePolicyNumber("intake.max_photos_per_request"));
  });

  it("counts pictures, not evidence — text and video are not photos", () => {
    const evidence = [
      { kind: "customer_text" },
      { kind: "photo" },
      { kind: "video" },
      { kind: "photo" },
    ] as EvidenceObject[];
    expect(countPhotos(evidence)).toBe(2);
  });

  it("allows up to the cap and refuses at it, with copy that is not a scolding", () => {
    expect(photoCapDecision(5, 6).allowed).toBe(true);
    const refused = photoCapDecision(6, 6);
    expect(refused.allowed).toBe(false);
    // The closing number in the copy tracks the cap, so it can never contradict it.
    expect(refused.message).toMatch(/6 clear pictures/);
    expect(refused.message).toMatch(/most we ask for \(6\)/);
    expect(refused.max).toBe(6);
    // A record that somehow holds more than the cap still refuses.
    expect(photoCapDecision(9, 6).allowed).toBe(false);
  });

  it("refuses a photo at the stored six-photo cap without writing evidence", async () => {
    const requestId = await startJourney();
    const target = "door_photo";
    const max = maxPhotosPerRequest();
    const store = runtimeStore();
    const journey = (await store.getJourney(requestId))!;
    // Seed the independent storage boundary explicitly. A fresh accepted
    // journey reaches the effort ceiling before it can upload six photos.
    for (let i = 1; i <= max; i += 1) {
      await store.attachEvidence(journey.problem.problem_id, requestId, {
        evidence_id: `ev_${requestId}_cap_${i}`, kind: "photo", privacy: "private",
        content: `private://test-cap/photo-${i}.png`, captured_at: "2026-09-06T12:00:00Z",
        mime: "image/png", bytes: PNG.length, field_key: target,
      });
    }

    const over = await uploadPhoto(requestId, target, max + 1);
    expect(over.status).toBe(409);
    const body = await over.json();
    expect(body.error).toMatch(/most we ask for/i);
    expect(body.photos).toBe(max);
    expect(body.max_photos).toBe(max);
    // No evidence id came back, because nothing was created.
    expect(body.evidence_id).toBeUndefined();

    // …and the next is refused identically — the cap is a state, not a one-off.
    expect((await uploadPhoto(requestId, target, max + 2)).status).toBe(409);
    expect(countPhotos(await store.listEvidence(journey.problem.problem_id))).toBe(max);
    expect((await readIntakeEffort({ request_id: requestId, tenant_id: "prn" })).effort_spent).toBe(QUESTION_COSTS.free_text);
  });

  it("admits five photos after opening, then refuses more work at 20 effort without storing it", async () => {
    const requestId = await startJourney();
    const maxAdmitted = Math.floor((MAX_INTAKE_EFFORT - QUESTION_COSTS.free_text) / QUESTION_COSTS.media);
    expect(maxAdmitted).toBe(5);
    for (let i = 1; i <= maxAdmitted; i += 1) {
      expect((await uploadPhoto(requestId, "door_photo", i)).status, `photo ${i}`).toBe(200);
    }
    const store = runtimeStore();
    const journey = (await store.getJourney(requestId))!;
    const evidenceBefore = await store.listEvidence(journey.problem.problem_id);
    for (const i of [maxAdmitted + 1, maxAdmitted + 2]) {
      const refused = await uploadPhoto(requestId, "door_photo", i);
      expect(refused.status).toBe(409);
      const body = await refused.json();
      expect(body.error).toMatch(/intake limit/i);
      expect(body.evidence_id).toBeUndefined();
    }
    expect(await store.listEvidence(journey.problem.problem_id)).toEqual(evidenceBefore);
    const ledger = await readIntakeEffort({ request_id: requestId, tenant_id: "prn" });
    expect(ledger.effort_spent).toBe(20);
    expect(ledger.attempts.filter(a => a.accepted && a.operation.kind === "media")).toHaveLength(5);
    expect(ledger.attempts.filter(a => !a.accepted).every(a => a.charged_units === 0 && a.rejection_reason === "effort_limit")).toBe(true);
    expect(countPhotos(evidenceBefore)).toBe(maxAdmitted);
  });

  it("a first photo for an approved door target still works", async () => {
    const requestId = await startJourney();
    const res = await uploadPhoto(requestId, "door_photo", 1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.evidence_id).toMatch(/^ev_/);
  });

  it("is enforced server-side — the count comes off the record, not off the request", () => {
    // The decision function is reachable with only the stored evidence list; no
    // client-supplied count exists anywhere in its signature.
    const stored = [{ kind: "photo" }, { kind: "photo" }] as EvidenceObject[];
    expect(photoCapDecisionFor(stored, 4).current).toBe(2);
    expect(photoCapDecisionFor(stored, 2).allowed).toBe(false);
  });
});

describe("A01 — the clarifying-question ceiling", () => {
  const playbook = findPlaybook("pb_hvac_cooling_v1");

  it("reads its number from policy, and the mechanism is a running count", () => {
    expect(getPolicySetting("intake.max_clarifying_questions")).not.toBeNull();
    expect(capReached(4, 5)).toBe(false);
    expect(capReached(5, 5)).toBe(true);
    // Over the cap, however it got there, is still over the cap.
    expect(capReached(6, 5)).toBe(true);
  });

  it("AT THE CAP, NO FURTHER QUESTION IS SELECTED — `ask` is null and says why", () => {
    expect(playbook).not.toBeNull();
    const max = requirePolicyNumber("intake.max_clarifying_questions");
    const atCap = selectNextClarifierDeterministic({
      playbook: playbook!,
      answered_field_keys: [],
      asked_count: max,
      max_questions: max,
    });
    // The field is `ask`. (The eval harness previously asserted a field name
    // that has never existed on this type, which is why the cap read as broken.)
    expect(atCap.ask).toBeNull();
    expect(atCap.asked_count).toBe(max);
    expect(atCap.max_questions).toBe(max);
    expect(atCap.reason).toMatch(/ceiling is reached/);
    // There ARE unanswered fields — the refusal is the cap, not exhaustion.
    expect(playbook!.required_fields.length).toBeGreaterThan(0);
  });

  it("one under the cap still asks, so the ceiling is a ceiling and not a mute", () => {
    const max = requirePolicyNumber("intake.max_clarifying_questions");
    const under = selectNextClarifierDeterministic({
      playbook: playbook!,
      answered_field_keys: [],
      asked_count: max - 1,
      max_questions: max,
    });
    expect(under.ask).not.toBeNull();
    expect(under.ask?.priority).toBe("core");
  });

  it("a cap of zero asks nothing at all — the ceiling binds from the first question", () => {
    const none = selectNextClarifierDeterministic({
      playbook: playbook!,
      answered_field_keys: [],
      asked_count: 0,
      max_questions: 0,
    });
    expect(none.ask).toBeNull();
    expect(none.reason).toMatch(/ceiling is reached/);
  });
});
