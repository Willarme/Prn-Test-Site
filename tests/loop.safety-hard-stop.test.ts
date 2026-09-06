import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { ACTIVE_SAFETY_PACKAGE } from "@/domain/problem/safety-package";

const classify = vi.hoisted(() => vi.fn(() => { throw new Error("classification must not run on a hard stop"); }));
vi.mock("@/domain/problem/capabilities", () => ({ classifyProblem: classify, selectClarifier: vi.fn() }));
let jsonPost: (request: Request) => Promise<Response>;
let doorPost: (request: Request) => Promise<Response>;
let db: typeof import("@/platform/stores/dev-db");
const saved = { path: process.env.PRN_DEV_DB_PATH, store: process.env.PRN_RUNTIME_STORE };

beforeAll(async () => {
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.PRN_DEV_DB_PATH = join(mkdtempSync(join(tmpdir(), "prn-f1-hard-stop-")), "db.json");
  db = await import("@/platform/stores/dev-db");
  db.updateDevDb(() => {});
  (await import("@/platform/stores/runtime")).resetRuntimeStore();
  ({ POST: jsonPost } = await import("@/app/api/intake/route"));
  ({ POST: doorPost } = await import("@/app/api/intake/start/route"));
});
afterAll(() => {
  if (saved.path === undefined) delete process.env.PRN_DEV_DB_PATH; else process.env.PRN_DEV_DB_PATH = saved.path;
  if (saved.store === undefined) delete process.env.PRN_RUNTIME_STORE; else process.env.PRN_RUNTIME_STORE = saved.store;
});

const cases = [
  ["I smell gas near the furnace.", "safety_gas"],
  ["I smell burning from the breaker box.", "safety_fire"],
  ["There's water standing around the outdoor unit and the panel.", "safety_flood_electric"],
] as const;
const attribution = { page_id: null, intent_cluster_id: null, search_opportunity_id: null, problem_family_hint: "hvac", experiment_id: null, variant: null, referrer: null, landing_path: "/start" };

describe("Melissa F1: both real intake transports stop all three hazard inputs", () => {
  for (const [description, ruleId] of cases) {
    it(ruleId, async () => {
      const before = db.readDevDb();
      const res = await jsonPost(new Request("http://localhost/api/intake", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, attribution, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash }),
      }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ request_id: null, safety: {
        state: "urgent", intake_may_continue: false,
        message: ACTIVE_SAFETY_PACKAGE.rules.find(r => r.safety_rule_id === ruleId)!.approved_response,
      } });
      const form = new FormData();
      form.set("problem_description", description);
      form.set("disclosure_content_hash", ACTIVE_DISCLOSURE.content_hash);
      form.set("landing_path", "/problems/ac-blowing-warm-air");
      const door = await doorPost(new Request("http://localhost/api/intake/start", { method: "POST", body: form }));
      expect(door.status).toBe(303);
      expect(door.headers.get("location")).toBe(`/safety/${ruleId}`);
      const after = db.readDevDb();
      expect(after.problems.length).toBe(before.problems.length);
      expect(after.packets.length).toBe(before.packets.length);
      expect(after.events.filter(e => e.event_name === "safety.triggered" && e.context.safety_rule_id === ruleId && e.context.halted === "true")).toHaveLength(2);
      expect(classify).not.toHaveBeenCalled();
    });
  }
});
