import { mkdtemp } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { readDevDb } from "@/platform/stores/dev-db";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * A02 STEP 7 — THE REMAINING INSTRUMENTS.
 *
 * This is the time-critical half of the build. Trial Spec Audit §4 counted the
 * producers of the customer-journey names outside the dictionary files and
 * found: `packet.viewed` 0, `packet.downloaded` 0, `packet.share_opened` 0.
 * Three names registered and seeded since #14A §18.2 that nothing has ever
 * emitted. Events are append-only history — a packet view during the trial that
 * nobody recorded is gone permanently — so these ship now, with A02, rather
 * than with the agent that will read them.
 */

let intakePost: (req: Request) => Promise<Response>;
let activityPost: (req: Request) => Promise<Response>;
let requestId = "";

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a02-instruments-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
  ({ POST: activityPost } = await import("@/app/api/packet-activity/route"));

  const res = await intakePost(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "The bathroom extractor fan rattles loudly and barely pulls any air",
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
  requestId = (await res.json()).request_id;
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

function activity(body: unknown) {
  return activityPost(
    new Request("http://localhost/api/packet-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("A02 — packet.downloaded and packet.share_opened now have a producer", () => {
  it("records a download, attributed to the customer and to the right packet", async () => {
    const res = await activity({ request_id: requestId, action: "downloaded", surface: "print_pdf" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: true });

    const event = readDevDb().events.filter((e) => e.event_name === "packet.downloaded").at(-1)!;
    expect(event).toBeDefined();
    expect(event.actor.actor_type).toBe("guest");
    expect(event.source.channel).toBe("web");
    expect(event.guest_session_id).toMatch(/^gs_/);
    expect(event.context.request_id).toBe(requestId);
    expect(event.context.job_packet_id).toMatch(/^jp_/);
    expect(event.context.surface).toBe("print_pdf");
  });

  it("records both share surfaces under the SHIPPED name, separable by surface", async () => {
    await activity({ request_id: requestId, action: "share_opened", surface: "copy_call_script" });
    await activity({ request_id: requestId, action: "share_opened", surface: "reveal_call_script" });
    const events = readDevDb().events.filter((e) => e.event_name === "packet.share_opened");
    expect(events.map((e) => e.context.surface)).toEqual([
      "copy_call_script",
      "reveal_call_script",
    ]);
    // The name that was NOT minted stays not-minted.
    expect(readDevDb().events.some((e) => (e.event_name as string) === "packet.shared")).toBe(
      false
    );
  });

  it("refuses to count activity for a request that does not exist", async () => {
    const res = await activity({
      request_id: "rq_invented_by_a_stranger",
      action: "downloaded",
      surface: "print_pdf",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: false });
  });

  it("takes no packet identity from the browser — the server looks it up", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/packet-activity/route.ts"), "utf-8");
    // The request body may name ONLY these three keys.
    const body = src.match(/const Body = z\.object\(\{[\s\S]*?\n\}\);/)![0];
    expect(body).not.toMatch(/job_packet_id|problem_id|guest_session_id/);
    expect(src).toMatch(/getJourney\(request_id\)/);
  });

  it("never returns packet or problem data to the browser", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/packet-activity/route.ts"), "utf-8");
    const returns = [...src.matchAll(/NextResponse\.json\((\{[^)]*\})/g)].map((m) => m[1]);
    expect(returns.length).toBeGreaterThan(0);
    for (const r of returns) {
      expect(r).not.toMatch(/journey|packet\.|problem\./);
    }
  });

  it("rejects a surface it does not recognise rather than storing free text", async () => {
    const res = await activity({
      request_id: requestId,
      action: "downloaded",
      surface: "<script>alert(1)</script>",
    });
    expect(res.status).toBe(400);
  });
});

describe("A02 — packet.viewed is emitted by the results page", () => {
  it("the page calls the customer emitter with ids only", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/results/[request_id]/page.tsx"),
      "utf-8"
    );
    expect(src).toMatch(/recordCustomerEvent\(\{[\s\S]*?event_name: "packet\.viewed"/);
    const block = src.match(/recordCustomerEvent\(\{[\s\S]*?\n {2}\}\);/)![0];
    expect(block).not.toMatch(/summary_plain|observed_statements|call_script|description/);
  });

  it("the emitter it uses attributes to a GUEST, not to an agent", () => {
    const src = readFileSync(join(process.cwd(), "src/platform/events/customer.ts"), "utf-8");
    expect(src).toMatch(/actor_type: "guest"/);
    expect(src).toMatch(/channel: "web"/);
  });

  it("the packet's own buttons post fire-and-forget, never blocking a click", () => {
    const src = readFileSync(join(process.cwd(), "src/components/results/PacketActions.tsx"), "utf-8");
    expect(src).toMatch(/void fetch\("\/api\/packet-activity"/);
    // No await before the customer's own action.
    expect(src).toMatch(/note\(requestId, "downloaded", "print_pdf"\);\s*\n\s*window\.print\(\);/);
    // …and the client still imports nothing from the event dictionary.
    expect(src).not.toMatch(/platform\/events/);
  });
});

describe("A02 — appendAudit carries a duration (A10's Owner Hours)", () => {
  it("accepts an entry WITHOUT one — every existing caller keeps working", async () => {
    await runtimeStore().appendAudit({
      at: "2026-08-25T12:00:00Z",
      action: "test.legacy_caller",
      target: "t1",
      detail: null,
    });
    const row = (await runtimeStore().listAudit()).find((e) => e.action === "test.legacy_caller")!;
    expect(row).toBeDefined();
    expect(row.duration_ms ?? null).toBeNull();
  });

  it("stores one when it is known", async () => {
    await runtimeStore().appendAudit({
      at: "2026-08-25T12:01:00Z",
      action: "test.timed_caller",
      target: "t2",
      detail: null,
      duration_ms: 42_000,
    });
    const row = (await runtimeStore().listAudit()).find((e) => e.action === "test.timed_caller")!;
    expect(row.duration_ms).toBe(42_000);
  });

  it("the one human gate actually measures it, and bounds the browser's number", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/pages/publish/route.ts"),
      "utf-8"
    );
    expect(route).toMatch(/owner_ms: z\.number\(\)\.int\(\)\.positive\(\)\.max\(/);
    expect(route).toMatch(/duration_ms: parsed\.data\.owner_ms \?\? null/);
    const button = readFileSync(
      join(process.cwd(), "src/components/admin/PublishButton.tsx"),
      "utf-8"
    );
    expect(button).toMatch(/owner_ms: Math\.max\(1, Date\.now\(\) - shownAt\.current\)/);
  });

  it("absent means NOT MEASURED — the schema never lets a 0 stand in for it", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/pages/publish/route.ts"),
      "utf-8"
    );
    // .positive() rejects 0, so an unmeasured action can only ever be null.
    expect(route).toMatch(/\.positive\(\)/);
  });

  it("ships the migration that gives the column a home", () => {
    const files = readdirSync(join(process.cwd(), "supabase/migrations"));
    const migration = files.find((f) => /admin_audit_duration/.test(f))!;
    expect(migration).toBeDefined();
    const sql = readFileSync(join(process.cwd(), "supabase/migrations", migration), "utf-8");
    expect(sql).toMatch(/add column if not exists duration_ms/);
  });

  it("the Supabase write survives the window before that migration is applied", () => {
    const src = readFileSync(join(process.cwd(), "src/platform/stores/runtime.ts"), "utf-8");
    // A telemetry column must never turn an owner's publish click into a 500.
    expect(src).toMatch(/missingColumn/);
    expect(src).toMatch(/00013_admin_audit_duration\.sql/);
  });
});
