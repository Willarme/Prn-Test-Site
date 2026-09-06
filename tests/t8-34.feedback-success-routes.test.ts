import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ load: vi.fn(), access: vi.fn(), render: vi.fn(), eligible: vi.fn(), email: vi.fn() }));
vi.mock("@/platform/packet/load", () => ({ loadPacket: seams.load, resolvePacketAccess: seams.access }));
vi.mock("@/domain/packet/render", () => ({ PacketHaltError: class extends Error {}, renderPacketHtml: seams.render }));
vi.mock("@/platform/feedback/eligible", () => ({ feedbackEligible: seams.eligible }));
vi.mock("@/platform/events/customer", () => ({ recordCustomerEvent: async () => {} }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => ({ getEmail: seams.email }) }));
vi.mock("@/platform/links/owner", () => ({ ownerAllowed: async () => true }));
vi.mock("@/platform/links/ledger", () => ({ readLinkLedger: () => ({ links: [] }) }));

import { GET as packetGet } from "@/app/packet/[request_id]/route";
import MailPage from "@/app/mail/[email_id]/page";
import { FeedbackSuccess } from "@/components/results/FeedbackSuccess";

const loaded = () => ({ input: {}, journey: { session: { guest_session_id: "guest_synthetic" }, problem: { problem_id: "problem_synthetic" }, packet: { job_packet_id: "packet_synthetic", packet_version: 1 } } });
beforeEach(() => {
  vi.clearAllMocks();
  seams.load.mockResolvedValue(loaded());
  seams.access.mockResolvedValue({ ok: true, owner: true, via: "owner" });
  seams.render.mockReturnValue({ html: "<html><body>Packet</body></html>", self_check: { ok: true }, halted: false });
  seams.eligible.mockResolvedValue(true);
});
const get = () => packetGet(new Request("http://localhost/packet/rq_synthetic"), { params: Promise.resolve({ request_id: "rq_synthetic" }) });

describe("T8-34 packet value confirmation", () => {
  it("includes a load-only signal after successful owner render/self-check", async () => {
    const html = await (await get()).text();
    expect(html).toContain("data-feedback-value");
    expect(html).toContain('addEventListener("load"');
    expect(html).toContain("prn_feedback_value_v2:rq_synthetic");
  });

  it.each(["missing", "address", "held", "halted", "thin", "share"])("does not signal %s responses", async (kind) => {
    if (kind === "missing") seams.load.mockResolvedValue(null);
    if (kind === "address") seams.load.mockResolvedValue({ ...loaded(), input: null });
    if (kind === "held") seams.render.mockReturnValue({ html: "<body>Private</body>", self_check: { ok: false }, halted: false });
    if (kind === "halted") seams.render.mockReturnValue({ html: "<body>Held</body>", self_check: { ok: true }, halted: true });
    if (kind === "thin") seams.eligible.mockResolvedValue(false);
    if (kind === "share") seams.access.mockResolvedValue({ ok: true, owner: false, via: "share_link" });
    expect(await (await get()).text()).not.toContain("data-feedback-value");
  });
});

type Node = { type?: unknown; props?: { children?: unknown } };
function containsSignal(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(containsSignal);
  if (!node || typeof node !== "object") return false;
  const element = node as Node;
  return element.type === FeedbackSuccess || containsSignal(element.props?.children);
}

describe("T8-34 sent-value receipt", () => {
  it.each([
    ["live", "Your Job Packet", "2026-09-06T00:00:00Z", true],
    ["preview", "Your Job Packet", null, false],
    ["live", "Your Job Packet", null, false],
    ["live", "Confirm your save", "2026-09-06T00:00:00Z", false],
  ])("accepts only live packet sends with a durable sent record (%s / %s / %s)", async (mode, subject, sent_at, expected) => {
    seams.email.mockResolvedValue({ email_id: "em_synthetic", request_id: "rq_synthetic", to: "synthetic@example.invalid", text: "Synthetic packet pointer", mode, subject, sent_at });
    const page = await MailPage({ params: Promise.resolve({ email_id: "em_synthetic" }), searchParams: Promise.resolve({}) });
    expect(containsSignal(page)).toBe(expected);
  });
});
