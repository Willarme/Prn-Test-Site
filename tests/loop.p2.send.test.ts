import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { readDevDb } from "@/platform/stores/dev-db";

/**
 * "I already have someone" — the share message (campaign track P2): one
 * signed packet link, the share text, the sms:/mailto: targets, and the
 * packet.share_opened envelope behind it.
 */
type Share = typeof import("@/platform/results/share");
type Tokens = typeof import("@/platform/links/tokens");

let share: Share;
let tokens: Tokens;
let requestId: string;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-devdb-p2-send-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.LINK_SIGNING_SECRET = "p2-send-test-secret-0123456789abcdef";
  tokens = await import("@/platform/links/tokens");
  tokens.__resetLinkSecretForTests();
  share = await import("@/platform/results/share");
  const { POST: intakePost } = await import("@/app/api/intake/route");
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
  delete process.env.LINK_SIGNING_SECRET;
  tokens.__resetLinkSecretForTests();
});

function shareEvents(): number {
  return readDevDb().events.filter(
    (e) =>
      e.event_name === "packet.share_opened" &&
      (e.context as Record<string, string>).surface === "own_provider_link"
  ).length;
}

describe("buildShareMessage", () => {
  it("mints a packet-scoped link for the request, wraps it in the share line, and records the share", async () => {
    const before = shareEvents();
    const msg = (await share.buildShareMessage({
      request_id: requestId,
      origin: "http://localhost:3112",
      contact: "(555) 010-0199",
    }))!;
    expect(msg).not.toBeNull();
    expect(msg.share_url).toMatch(/^http:\/\/localhost:3112\/p\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(msg.text).toBe(`Here is my Job Packet: ${msg.share_url}`);
    const { listIssuedLinks } = await import("@/platform/links/ledger");
    expect((await listIssuedLinks(requestId)).some(link => msg.share_url.endsWith(link.token))).toBe(true);

    const token = msg.share_url.split("/p/")[1]!;
    const decoded = tokens.decodeLink(token);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.scope).toBe("packet");
      expect(decoded.request_id).toBe(requestId);
      expect(decoded.exp).not.toBeNull();
    }
    // Narrow: the share link opens nothing but the packet.
    expect((await tokens.verifyLink(token, "keep")).ok).toBe(false);
    expect((await tokens.verifyLink(token, "packet")).ok).toBe(true);

    // The phone goes only into the sms: target, digits only.
    expect(msg.sms_href).toBe(`sms:5550100199?&body=${encodeURIComponent(msg.text)}`);
    expect(msg.mailto_href.startsWith("mailto:?subject=My%20Job%20Packet&body=")).toBe(true);

    expect(shareEvents()).toBe(before + 1);
    const ev = readDevDb().events.find(
      (e) =>
        e.event_name === "packet.share_opened" &&
        (e.context as Record<string, string>).request_id === requestId
    )!;
    expect(ev.actor.actor_type).toBe("guest");
    // Ids only in the envelope — never the person's number.
    expect(JSON.stringify(ev)).not.toContain("0199");
  });

  it("an email contact goes into the mailto: target, and no contact still yields both targets", async () => {
    const withEmail = (await share.buildShareMessage({
      request_id: requestId,
      origin: "http://localhost:3112",
      contact: "tech@example.com",
    }))!;
    expect(withEmail.mailto_href.startsWith("mailto:tech%40example.com?subject=")).toBe(true);
    expect(withEmail.sms_href.startsWith("sms:?&body=")).toBe(true);

    const bare = (await share.buildShareMessage({
      request_id: requestId,
      origin: "http://localhost:3112",
      contact: null,
    }))!;
    expect(bare.sms_href.startsWith("sms:?&body=")).toBe(true);
    expect(bare.mailto_href.startsWith("mailto:?subject=")).toBe(true);
    // Every call mints its own revocable link id.
    expect(bare.share_url).not.toBe(withEmail.share_url);
  });

  it("mints nothing for a request the store does not know", async () => {
    const before = shareEvents();
    expect(
      await share.buildShareMessage({ request_id: "rq_nobody", origin: "http://x", contact: null })
    ).toBeNull();
    expect(shareEvents()).toBe(before);
  });
});
