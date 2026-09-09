import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { ownerCookieName } from "@/platform/links/owner";
import { readDevDb } from "@/platform/stores/dev-db";

/**
 * THE DOOR ADAPTER, end to end at the contract level.
 *
 * Melissa's door page is a plain HTML form. Everything it can do to the system
 * happens through `POST /api/intake/start`, and every outcome it can produce is
 * a 303 to a page a browser can render. That is what this file pins: the four
 * outcomes, the cookie, the files, and the fact that a hazard sentence creates
 * nothing.
 */
let startPost: (req: Request) => Promise<Response>;
let jsonPost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-devdb-f1-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: startPost } = await import("@/app/api/intake/start/route"));
  ({ POST: jsonPost } = await import("@/app/api/intake/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

function doorForm(
  overrides: Record<string, string | null> = {},
  files: [string, File][] = []
): Request {
  const form = new FormData();
  const fields: Record<string, string | null> = {
    problem_description: "The air is coming out but it isn't cold. Started yesterday afternoon.",
    page_id: "page_ac_blowing_warm_air",
    intent_cluster_id: "ic_hvac_cooling_no_cold_air",
    search_opportunity_id: "so_ac_blowing_warm_air",
    problem_family_hint: "hvac-cooling",
    landing_path: "/problems/ac-blowing-warm-air",
    disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) form.append(key, value);
  }
  for (const [name, file] of files) form.append(name, file);
  return new Request("http://localhost/api/intake/start", {
    method: "POST",
    headers: { referer: "https://www.google.com/" },
    body: form,
  });
}

/** Everything attached to the ProblemRecord this request created. */
function evidenceFor(requestId: string) {
  const db = readDevDb();
  const session = db.intake_sessions.find((s) => s.request_id === requestId)!;
  const consent = db.consent_events.find((c) => c.guest_session_id === session.guest_session_id)!;
  const problem = db.problems.find((p) => p.problem_id === consent.problem_id)!;
  return db.evidence.filter((e) => problem.evidence_ids.includes(e.evidence_id));
}

/** A 1x1 PNG, small enough to be a real upload and cheap enough to be a test. */
function tinyPng(name = "unit.png"): File {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

describe("POST /api/intake/start — the door adapter", () => {
  it("a filled-in door form starts a request: 303 to the walkthrough, with the journey cookie", async () => {
    const res = await startPost(doorForm());
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location).toMatch(/^\/complete\/rq_/);
    // Next's internal request URL can say localhost while the browser uses
    // 127.0.0.1. A relative redirect keeps its newly issued owner cookie usable.
    expect(new URL(location, "http://127.0.0.1:3188").origin).toBe("http://127.0.0.1:3188");

    const requestId = location.split("/complete/")[1]!;
    const db = readDevDb();
    const session = db.intake_sessions.find((s) => s.request_id === requestId)!;
    expect(session).toBeTruthy();
    // The door's PRIOR CONTEXT travelled, and the Referer became the referrer.
    expect(session.attribution.page_id).toBe("page_ac_blowing_warm_air");
    expect(session.attribution.intent_cluster_id).toBe("ic_hvac_cooling_no_cold_air");
    expect(session.attribution.problem_family_hint).toBe("hvac-cooling");
    expect(session.attribution.landing_path).toBe("/problems/ac-blowing-warm-air");
    expect(session.attribution.referrer).toBe("https://www.google.com/");
    expect(session.attribution.experiment_id).toBeNull();

    // Consent was recorded against the exact disclosure the door rendered.
    const consent = db.consent_events.find((c) => c.guest_session_id === session.guest_session_id)!;
    expect(consent.disclosure_version_id).toBe(ACTIVE_DISCLOSURE.disclosure_version_id);
    expect(consent.surface).toBe("door_intake_form");

    // The same fallback cookie the JSON route sets, on the same path.
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ownerCookieName(requestId)}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/;");
  });

  it("no description: back to the door with a code, and nothing is created", async () => {
    const before = readDevDb().problems.length;
    const res = await startPost(doorForm({ problem_description: null }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "/problems/ac-blowing-warm-air?error=needs_description#intake"
    );
    expect(readDevDb().problems.length).toBe(before);
  });

  it("a stale consent hash is refused, and says which kind of refusal it was", async () => {
    const before = readDevDb().problems.length;
    const res = await startPost(doorForm({ disclosure_content_hash: "not-the-hash" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "/problems/ac-blowing-warm-air?error=consent#intake"
    );
    expect(readDevDb().problems.length).toBe(before);
  });

  it("a hazard sentence halts before any analysis: 303 to the safety screen, no record", async () => {
    const problemsBefore = readDevDb().problems.length;
    const packetsBefore = readDevDb().packets.length;
    const res = await startPost(
      doorForm({ problem_description: "I smell gas near the furnace and the AC is warm" })
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/safety/safety_gas");
    expect(readDevDb().problems.length).toBe(problemsBefore);
    expect(readDevDb().packets.length).toBe(packetsBefore);
    // The halt itself is on the record, which is the only thing that is.
    const halted = readDevDb().events.filter(
      (e) => e.event_name === "safety.triggered" && e.context.halted === "true"
    );
    expect(halted.length).toBeGreaterThan(0);
  });

  it("photos, a video and a voice note all land as evidence on the new request", async () => {
    const video = new File([new Uint8Array(readFileSync("tests/fixtures/video/synthetic-2s.mp4"))], "unit.mp4", {
      type: "video/mp4",
    });
    const voice = new File([new Uint8Array(Buffer.from("not really audio"))], "note.m4a", {
      type: "audio/mp4",
    });
    const res = await startPost(
      doorForm({}, [
        ["photos", tinyPng("a.png")],
        ["photos", tinyPng("b.png")],
        ["video", video],
        ["voice_note", voice],
      ])
    );
    expect(res.status).toBe(303);
    const requestId = res.headers.get("location")!.split("/complete/")[1]!;
    const evidence = evidenceFor(requestId);
    const kinds = evidence.map((e) => e.kind).sort();
    expect(kinds).toContain("customer_text");
    expect(evidence.filter((e) => e.kind === "photo").length).toBe(2);
    expect(evidence.filter((e) => e.kind === "video").length).toBe(1);
    const voiceRow = evidence.find((e) => e.kind === "voice_note")!;
    expect(voiceRow).toBeTruthy();
    // Nothing is claimed about what is in it, because nothing read it.
    expect(voiceRow.content).toBe("Voice note received, not transcribed");
  });

  it("an empty file input is not an upload", async () => {
    const empty = new File([], "", { type: "application/octet-stream" });
    const res = await startPost(doorForm({}, [["photos", empty], ["video", empty]]));
    expect(res.status).toBe(303);
    const requestId = res.headers.get("location")!.split("/complete/")[1]!;
    const media = evidenceFor(requestId).filter((e) => e.kind !== "customer_text");
    expect(media.length).toBe(0);
  });

  it("a refused attachment has a visible recovery flag and preserves accepted siblings", async () => {
    const refused = new File(["unsupported"], "unit.svg", { type: "image/svg+xml" });
    const res = await startPost(doorForm({}, [["photos", tinyPng()], ["photos", refused]]));
    const location = new URL(res.headers.get("location")!, "http://127.0.0.1:3188");
    expect(location.searchParams.get("uploads")).toBe("partial");
    const requestId = location.pathname.split("/complete/")[1]!;
    expect(evidenceFor(requestId).filter(e => e.kind === "photo")).toHaveLength(1);
  });

  it.each(["//evil.example.com/steal", "/\\evil.example.com/steal", "/%2f%2fevil.example.com", "/bad path"])("landing_path %s cannot leave this site", async (landing_path) => {
    const res = await startPost(
      doorForm({ problem_description: null, landing_path })
    );
    expect(res.headers.get("location")).toBe(
      "/problems/ac-blowing-warm-air?error=needs_description#intake"
    );
  });
});

describe("the JSON route's contract did not move when its body did", () => {
  function jsonRequest(description: string, hash?: string) {
    return new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        disclosure_content_hash: hash ?? ACTIVE_DISCLOSURE.content_hash,
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
    });
  }

  it("still answers 200 with request_id and next, and still sets the one cookie", async () => {
    const res = await jsonPost(jsonRequest("The upstairs bathroom tap drips all night"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toMatch(/^rq_/);
    expect(body.next).toBe(`/complete/${body.request_id}`);
    expect(res.headers.get("set-cookie") ?? "").toContain(`${ownerCookieName(body.request_id)}=`);
  });

  it("still 409s on a stale disclosure hash, with the same sentence", async () => {
    const res = await jsonPost(jsonRequest("The upstairs bathroom tap drips", "stale"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Consent disclosure version mismatch/);
  });

  it("still 400s on a description too short to work with", async () => {
    const res = await jsonPost(jsonRequest("hot"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/a sentence is plenty/);
  });

  it("still returns the halt shape rather than a redirect", async () => {
    const res = await jsonPost(jsonRequest("There is a gas smell in the basement"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toBeNull();
    expect(body.safety.intake_may_continue).toBe(false);
    expect(body.safety.message).toMatch(/leave the building now/);
  });
});
