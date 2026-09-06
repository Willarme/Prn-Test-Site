import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { signLink } from "@/platform/links/tokens";
import { readDevDb } from "@/platform/stores/dev-db";

/**
 * POST /api/results/email — "Email it to me instead" enqueues in preview mode
 * and never touches the network (campaign track P2; routine decision 8).
 */
let emailPost: (req: Request) => Promise<Response>;
let requestId: string;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-devdb-p2-email-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  delete process.env.EMAIL_MODE;
  const { POST: intakePost } = await import("@/app/api/intake/route");
  ({ POST: emailPost } = await import("@/app/api/results/email/route"));
  const res = await intakePost(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "The air is coming out but it isn't cold. Started yesterday afternoon.",
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
  requestId = ((await res.json()) as { request_id: string }).request_id;
  expect(requestId).toMatch(/^rq_/);
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  delete process.env.PRN_RUNTIME_STORE;
});

function form(fields: Record<string, string>): Request {
  const fd = new FormData();
  if (fields.request_id) fd.append("k", signLink({scope:"keep",request_id:fields.request_id}));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://localhost:3112/api/results/email", { method: "POST", body: fd });
}

describe("POST /api/results/email", () => {
  it("refuses an ownerless submission without enqueueing a message", async () => {
    const before = readDevDb().email_outbox.length;
    const res = await emailPost(form({ request_id: requestId, email: "test@example.com", k: "" }));
    expect(res.status).toBe(404);
    expect(readDevDb().email_outbox.length).toBe(before);
  });
  it("enqueues a preview message with the packet and PDF links, then 303s to /mail/<id>, with zero network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network call during a preview-mode email");
    });
    try {
      const res = await emailPost(
        form({ request_id: requestId, email: "  Homeowner@Example.com ", name: "Sam" })
      );
      expect(res.status).toBe(303);
      const location = res.headers.get("location")!;
      expect(location).toMatch(/^http:\/\/localhost:3112\/mail\/em_/);
      expect(fetchSpy).not.toHaveBeenCalled();

      const emailId = location.split("/mail/")[1]!.split("?")[0]!;
      const row = readDevDb().email_outbox.find((e) => e.email_id === emailId)!;
      expect(row).toBeTruthy();
      expect(row.request_id).toBe(requestId);
      expect(row.to).toBe("homeowner@example.com");
      expect(row.mode).toBe("preview");
      expect(row.sent_at).toBeNull();
      expect(row.provider_id).toBeNull();
      expect(row.subject).toBe("Your Job Packet");
      expect(row.text).toContain(`http://localhost:3112/packet/${requestId}`);
      expect(row.text).toContain(`http://localhost:3112/packet/${requestId}/pdf`);
      expect(row.html).toContain(`href="http://localhost:3112/packet/${requestId}/pdf?k=`);
      expect(row.text.startsWith("Hi Sam,")).toBe(true);
      // Nothing the homeowner typed rides in the redirect.
      expect(location).not.toContain("example.com");
      expect(location).not.toContain("Sam");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("\"Skip for now\" leaves the name out even when it was typed (§16.1)", async () => {
    const res = await emailPost(
      form({ request_id: requestId, email: "two@example.com", name: "Sam", skip: "1" })
    );
    expect(res.status).toBe(303);
    const emailId = res.headers.get("location")!.split("/mail/")[1]!.split("?")[0]!;
    const row = readDevDb().email_outbox.find((e) => e.email_id === emailId)!;
    expect(row.text.startsWith("Your Job Packet is ready.")).toBe(true);
    expect(row.text).not.toContain("Sam");
  });

  it("a bad address goes back to the form with ?error=email and enqueues nothing", async () => {
    const before = readDevDb().email_outbox.length;
    const res = await emailPost(form({ request_id: requestId, email: "not an address" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")?.split("&k=")[0]).toBe(
      `http://localhost:3112/results/${requestId}/email?error=email`
    );
    expect(readDevDb().email_outbox.length).toBe(before);
  });

  it("an unknown request goes back with ?error=unavailable and enqueues nothing", async () => {
    const before = readDevDb().email_outbox.length;
    const res = await emailPost(form({ request_id: "rq_nobody", email: "x@example.com" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")?.split("&k=")[0]).toBe(
      "http://localhost:3112/results/rq_nobody/email?error=unavailable"
    );
    expect(readDevDb().email_outbox.length).toBe(before);
  });

  it("a body with no request id is a 400, not a redirect to nowhere", async () => {
    expect((await emailPost(form({ email: "x@example.com" }))).status).toBe(400);
  });
});
