import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { readDevDb } from "@/platform/stores/dev-db";
import { runtimeStore } from "@/platform/stores/runtime";
import { appendIntakeEffort, readIntakeEffort } from "@/platform/intake/effort";
import { filesUnder } from "../evals/source";

/**
 * `tenant_id` IS WRITTEN, NOT MERELY RESERVED.
 *
 * A00's approval condition 1 reserves an optional tenant on every core record,
 * default "prn", with no tenant logic anywhere. `ProblemRecord` and
 * `EvidenceObject` carried the field and NOTHING POPULATED IT — every stored
 * homeowner record had it absent. A field that is never written is not
 * reserved, it is decorative, and the expensive version of this fix is adding a
 * NOT NULL tenant column to populated homeowner rows later.
 *
 * These cases read the records back OUT OF THE STORE after a real journey,
 * because that is the only place the question can be answered: the contract
 * says optional either way.
 */
let intakePost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-tenant-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

function intakeRequest(description: string) {
  return new Request("http://localhost/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
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
  });
}

describe("the reserved tenant is populated on the real write path", () => {
  it("a driven journey persists tenant_id on the ProblemRecord and the EvidenceObject", async () => {
    const res = await intakePost(intakeRequest("The AC won't turn on since yesterday evening"));
    expect(res.status).toBe(200);
    const body = await res.json();

    const db = readDevDb();
    const session = db.intake_sessions.find((s) => s.request_id === body.request_id)!;
    const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id)!;
    const evidence = db.evidence.filter((e) => problem.evidence_ids.includes(e.evidence_id));

    expect(problem.tenant_id).toBe("prn");
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) expect(e.tenant_id).toBe("prn");

    // The packet already carried it; the claims and the derivation do too, so
    // every durable object this journey produced names the same tenant.
    const packet = db.packets.find((k) => k.problem_id === problem.problem_id)!;
    expect(packet.tenant_id).toBe("prn");
    const store = runtimeStore();
    for (const claim of await store.listClaims(problem.problem_id)) {
      expect(claim.tenant_id).toBe("prn");
    }
    for (const d of await store.listDerivations(problem.problem_id)) {
      expect(d.tenant_id).toBe("prn");
    }
  });

  it("evidence attached later — the second write path — is stamped too", async () => {
    /**
     * The media route's own write goes through `attachEvidence`, so that is
     * what is exercised here: a photo uploaded an hour after intake must not
     * land untenanted just because it arrived on a different path.
     */
    const res = await intakePost(intakeRequest("Water is dripping through the kitchen ceiling"));
    const body = await res.json();
    const db = readDevDb();
    const session = db.intake_sessions.find((s) => s.request_id === body.request_id)!;
    const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id)!;

    const store = runtimeStore();
    await store.attachEvidence(problem.problem_id, body.request_id, {
      evidence_id: "ev_attached_later",
      kind: "photo",
      content: "private://media/ev_attached_later.jpg",
      privacy: "private",
      captured_at: "2026-08-25T12:00:00Z",
      mime: "image/jpeg",
      bytes: 1024,
      field_key: "problem_photo",
    });
    const attached = (await store.listEvidence(problem.problem_id)).find(
      (e) => e.evidence_id === "ev_attached_later"
    )!;
    expect(attached.tenant_id).toBe("prn");
  });

  it("a record that already names a tenant keeps it — the default fills a blank, it never overwrites", async () => {
    const store = runtimeStore();
    await store.attachEvidence("pr_nonexistent_for_this_check", "req_nonexistent_for_this_check", {
      evidence_id: "ev_other_tenant",
      tenant_id: "other_client",
      kind: "customer_text",
      content: "some words",
      privacy: "private",
      captured_at: "2026-08-25T12:00:00Z",
    });
    const stored = readDevDb().evidence.find((e) => e.evidence_id === "ev_other_tenant")!;
    expect(stored.tenant_id).toBe("other_client");
  });

  it("rejects foreign-tenant effort reads and writes without changing the owner's ledger", async () => {
    const response = await intakePost(intakeRequest("The AC runs but blows warm air"));
    expect(response.status).toBe(200);
    const { request_id } = await response.json();
    const own = { request_id, tenant_id: "prn" };
    const before = await readIntakeEffort(own);
    expect(before.effort_spent).toBe(5);
    const foreign = { request_id, tenant_id: "foreign_client" };
    await expect(readIntakeEffort(foreign)).rejects.toThrow("Intake effort request ownership mismatch");
    await expect(appendIntakeEffort({ ...foreign, operation_id: "foreign_attempt", kind: "answer",
      question_id: "symptom_timing", question_type: "closed_choice" })).rejects.toThrow("Intake effort request ownership mismatch");
    expect(await readIntakeEffort(own)).toEqual(before);
  });

  it("runtime tenant product logic stays reserved with exact template and effort isolation seams", () => {
    /**
     * Runtime tenancy remains reserved. The reviewed PRN-only v43 template
     * has two narrowly allowed scope validations. T1-35 also requires the
     * durable effort ledger to validate and scope its exact request+tenant;
     * the foreign-read/write probe above protects that integrity boundary.
     * This does not introduce tenant product routing. The scan checks three
     * shapes that would mean exactly that: a comparison against a NAMED tenant,
     * a comparison of one record's tenant against another's, and a query
     * filtered by the column.
     *
     * A PRESENCE CHECK IS NOT TENANT LOGIC and is deliberately not caught:
     * `input.tenant_id === undefined` in the event steward is schema validation
     * — "this optional field, if present, is non-empty" — and treating it as
     * routing would forbid validating a field the condition itself requires to
     * exist.
     */
    const offenders: string[] = [];
    for (const file of filesUnder("src")) {
      if (file.path === "src/platform/stores/runtime.ts") continue; // withTenant lives here
      for (const [i, line] of file.text.split(/\r?\n/).entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // a comment explaining the rule is not the rule
        const namedTenant = /tenant_id\s*(===|!==|==|!=)\s*["'`]/.test(line);
        const crossRecord = /tenant_id\s*(===|!==|==|!=)\s*[\w.]*\btenant_id\b/.test(line);
        const filtered = /\.eq\(\s*["']tenant_id["']/.test(line) || /where.*\btenant_id\b\s*=/.test(line);
        const reviewedScope = file.path === "src/domain/search/door-template.ts" && [
          '&& (opportunity.tenant_id === undefined || opportunity.tenant_id === "prn")',
          'if (spec.tenant_id !== undefined && spec.tenant_id !== "prn") issues.push("tenant_id");',
        ].includes(line.trim());
        const reviewedEffort = file.path === "src/platform/intake/effort.ts" && [
          'if (ledger.request_id !== identity.request_id || ledger.tenant_id !== identity.tenant_id || ledger.problem_id !== problemId ||',
          '.eq("request_id", identity.request_id).eq("tenant_id", identity.tenant_id).maybeSingle();',
        ].includes(line.trim());
        if (((namedTenant && !reviewedScope) || crossRecord || filtered) && !reviewedEffort) {
          offenders.push(`${file.path}:${i + 1}  ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
