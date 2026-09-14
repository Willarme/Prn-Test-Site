import { afterEach, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";

// Ported from private 8b2f678: escaping capability failures must retain the
// existing transport. Public hosted.intake-entry / links.production-signing
// retain the real signer, pre-persistence, safety and restart assertions.
const canary = "SYNTHETIC_PRIVATE_FAILURE_MUST_NOT_ESCAPE";
vi.mock("@/platform/intake/start", () => ({ startIntake: async () => { throw new Error("SYNTHETIC_PRIVATE_FAILURE_MUST_NOT_ESCAPE"); } }));
vi.mock("@/platform/intake/media", () => ({ attachMedia: vi.fn() }));
import { POST as jsonPost } from "@/app/api/intake/route";
import { POST as doorPost } from "@/app/api/intake/start/route";

afterEach(() => { vi.restoreAllMocks(); });
it("JSON escaping failure returns a nonempty generic JSON error without a cookie or private log detail", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await jsonPost(new Request("http://localhost/api/intake", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      description: "The upstairs bathroom tap drips all night",
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { page_id: null, intent_cluster_id: null, search_opportunity_id: null, problem_family_hint: null,
        experiment_id: null, variant: null, referrer: null, landing_path: "/start" },
    }),
  }));
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ error: "Something went wrong — your text is still here, try again." });
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(errors).toHaveBeenCalledExactlyOnceWith("[intake] unhandled failure");
  expect(JSON.stringify(errors.mock.calls)).not.toContain(canary);
});
it("multipart escaping failure preserves the safe relative 303 and never returns backend detail", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const body = new FormData();
  body.set("problem_description", "The upstairs bathroom tap drips all night");
  body.set("landing_path", "/problems/ac-blowing-warm-air");
  body.set("disclosure_content_hash", ACTIVE_DISCLOSURE.content_hash);
  const response = await doorPost(new Request("http://localhost/api/intake/start", { method: "POST", body }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/problems/ac-blowing-warm-air?error=try_again#intake");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(errors).toHaveBeenCalledExactlyOnceWith("[intake] unhandled failure");
  expect(JSON.stringify(errors.mock.calls)).not.toContain(canary);
});
