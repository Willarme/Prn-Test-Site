import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosisAnswer, IntakePlaybook } from "@/domain/intake/playbook";
import { CANNOT_REACH_STEP_ANSWER } from "@/domain/intake/extract";

const seams = vi.hoisted(() => ({
  recordEvents: vi.fn(), saveFeedback: vi.fn(), getJourney: vi.fn(),
  listDiagnosisAnswers: vi.fn(), context: vi.fn(), owner: vi.fn(),
}));
vi.mock("@/platform/flags", () => ({ flagEnabled: () => true }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => ({ kind: "file", ...seams }) }));
vi.mock("@/platform/intake/complete", () => ({ loadJourneyContext: seams.context }));
vi.mock("@/platform/links/owner", () => ({ ownerAllowed: seams.owner }));

import { POST as interestPost } from "@/app/api/feature-interest/route";
import { POST as feedbackPost } from "@/app/api/feedback/route";
import { completedFeedbackWalkthrough } from "@/platform/feedback/eligible";
import { config, middleware } from "@/middleware";

beforeEach(() => {
  vi.clearAllMocks();
  seams.recordEvents.mockResolvedValue(undefined);
  seams.saveFeedback.mockResolvedValue(undefined);
  seams.getJourney.mockResolvedValue({});
  seams.owner.mockResolvedValue(true);
});

const post = (path: string, body: unknown) => new Request(`http://localhost${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("T8-34 persisted collector receipts", () => {
  it("feature interest rejects a failed store, then acknowledges an actual retry", async () => {
    const body = { concept: "smartquote", kind: "thumb", thumb: "up", landing_path: "/future/smartquote" };
    seams.recordEvents.mockRejectedValueOnce(new Error("synthetic storage failure"));
    const failed = await interestPost(post("/api/feature-interest", body));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false, recorded: false });
    const saved = await interestPost(post("/api/feature-interest", body));
    expect(await saved.json()).toEqual({ ok: true, recorded: true });
    expect(seams.recordEvents).toHaveBeenCalledTimes(2);
  });

  it("feedback write failure is retryable and success names the store receipt", async () => {
    const body = { request_id: "rq_synthetic", score: "very", right: ["ready_to_talk"] };
    seams.saveFeedback.mockRejectedValueOnce(new Error("synthetic storage failure"));
    const failed = await feedbackPost(post("/api/feedback", body));
    expect(failed.status).toBe(503);
    expect((await failed.json()).ok).toBe(false);
    const saved = await feedbackPost(post("/api/feedback", body));
    expect(await saved.json()).toEqual({ ok: true, recorded: "file" });
    expect(seams.saveFeedback).toHaveBeenCalledTimes(2);
  });
});

describe("T8-34 raw feature serving boundary", () => {
  it.each([
    "/feature/SmartQuote%20v3.dc.html", "/f%65ature/SmartQuote%20v3.dc.html",
    "/%66eature/SmartQuote%20v3.dc.html", "/feature%2FSmartQuote%20v3.dc.html",
  ])("matches and redirects encoded entry %s to the receipt adapter", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    const response = middleware(new NextRequest(`http://localhost${url}?review=1`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/pages/smartquote?review=1");
  });

  it.each(["/feature/unknown.html", "/feature", "/feature/vendor/unknown.js"])("refuses unknown raw path %s", (url) => {
    expect(middleware(new NextRequest(`http://localhost${url}`)).status).toBe(404);
  });

  it.each(["/admin", "/api/admin/seo-policy", "/problems/ac-blowing-warm-air", "/pages/smartquote"])("passes unrelated path %s unchanged", (url) => {
    const response = middleware(new NextRequest(`http://localhost${url}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("T8-34 conservative feedback sampling", () => {
  const playbook = {
    first_step_id: "observe",
    diagnostic_steps: [{ step_id: "observe", input: { kind: "text" }, branches: [{ when: "any", next_step_id: null, outcome_id: "outcome" }] }],
    outcomes: [{ outcome_id: "outcome" }],
  } as IntakePlaybook;
  const answer = (value: string | null, step_id = "observe") => [{ request_id: "rq_synthetic", step_id, answer: value, evidence_id: null, answered_at: "2026-09-06T00:00:00Z" }] satisfies DiagnosisAnswer[];

  it("requires a reached outcome and an actual observation, not skipped or absent evidence", () => {
    for (const value of [null, "", "skipped", "cannot-reach", CANNOT_REACH_STEP_ANSWER, "not sure"]) {
      expect(completedFeedbackWalkthrough(playbook, answer(value)), String(value)).toBe(false);
    }
    expect(completedFeedbackWalkthrough(playbook, [])).toBe(false);
    expect(completedFeedbackWalkthrough(playbook, answer("visible airflow", "unknown_step"))).toBe(false);
    expect(completedFeedbackWalkthrough(playbook, answer("visible airflow"))).toBe(true);
    expect(completedFeedbackWalkthrough({ ...playbook, outcomes: [] }, answer("visible airflow"))).toBe(false);
    expect(completedFeedbackWalkthrough({ ...playbook, first_step_id: null }, answer("visible airflow"))).toBe(false);
  });
});
