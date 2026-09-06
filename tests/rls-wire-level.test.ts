import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * T1-33 — wire-level guard (adversarial-inspection finding #1, 2026-08-28).
 *
 * tests/rls-isolation.test.ts proves the RLS POLICY SQL is correct: it
 * drives pglite directly with hand-built SET ROLE / set_config calls. It
 * never calls src/platform/stores/runtime.ts's SupabaseRuntimeStore or its
 * scopedClient() dispatcher — so a regression IN THE APPLICATION CODE (e.g.
 * scopedClient() stops calling requestScopedClient() and always returns the
 * service client) is invisible to it. An adversarial inspector proved this:
 * mutating scopedClient() to `return this.db;` left the entire 230-test
 * gauntlet green.
 *
 * This file closes that gap. It mocks ONLY the seam module
 * (@/platform/db/client) — not the whole @supabase/supabase-js SDK, and NOT
 * runtime.ts itself — so SupabaseRuntimeStore's real, unmodified methods
 * (recordJourney, attachEvidence, listEvidence, getJourney, ...) run for
 * real, INCLUDING its own scopedClient() dispatch logic. The mocked seam
 * hands back a fake SupabaseClient whose .from(table) chain translates to
 * SQL run against a real Postgres engine (pglite) inside a transaction with
 * the role/claims the REAL requestScopedClient()/requireServiceClient()
 * would produce. If scopedClient() stops calling the request-scoped path,
 * every query silently runs as service_role (BYPASSRLS) instead — and a
 * cross-subject read/write that should be blocked succeeds. That is the
 * exact production failure this item exists to prevent, and it is exactly
 * what the tests below assert against.
 *
 * WHY listEvidence/attachEvidence, specifically: the vulnerability shape
 * that differs between "real scopedClient()" and "always this.db" needs a
 * caller that supplies the RIGHT request_id (so it authenticates as
 * itself) but the WRONG problem_id (an app bug, a stale reference, an IDOR
 * attempt). listEvidence(problemId, requestId) and
 * attachEvidence(problemId, requestId, evidence) are the only two store
 * methods whose signature can even produce that mismatch — every other
 * customer-facing method takes a single identifier and always
 * authenticates-as and queries-for the SAME subject, so calling it with
 * legitimate arguments can never expose this particular regression no
 * matter which client backs it.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
function migration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf-8");
}

/** Supabase's published auth.jwt() helper — reproduced for local RLS testing only. */
const AUTH_JWT_SHIM = `
  create schema if not exists auth;
  create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $$;
`;

// vi.mock's factory below is hoisted above every other statement in this
// file, so it cannot close over a `let db` declared normally — vi.hoisted
// gives the factory and beforeAll a shared mutable holder instead.
const harness = vi.hoisted(() => ({
  db: null as PGlite | null,
  queryTail: Promise.resolve(),
  afterEvidenceRead: null as (() => Promise<void>) | null,
  serviceFallback: false,
  failOwnedEvidenceRead: false,
}));

vi.mock("@/platform/db/client", () => {
  /** table.column pairs that are jsonb — everything else is a scalar or a Postgres array. */
  const JSONB_COLUMNS = new Set([
    "intake_session.attribution",
    "problem_record.clarifiers_asked",
    "job_packet.packet",
  ]);

  type FilterOp = { col: string; kind: "eq" | "in"; val: unknown };

  /**
   * Minimal fake SupabaseClient — implements only the .from(table) builder
   * chain shapes runtime.ts actually calls (select/insert/update/upsert,
   * eq/in/order/limit/maybeSingle, plus a thenable so bare `await
   * client.from(x).insert(y)` works exactly like the real SDK). Every query
   * runs against the shared pglite instance inside its OWN transaction,
   * with SET LOCAL ROLE (+ request.jwt.claims for "authenticated") applied
   * first — the same privilege boundary real Postgres/PostgREST enforces
   * for that role.
   */
  class FakeBuilder {
    private op: "select" | "insert" | "update" | "upsert" | "delete" | null = null;
    private payload: unknown = null;
    private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | null = null;
    private cols = "*";
    private countOpts: { count?: string; head?: boolean } | null = null;
    private filters: FilterOp[] = [];
    private orderBy: { col: string; ascending: boolean } | null = null;
    private limitN: number | null = null;
    private single = false;

    constructor(
      private readonly table: string,
      private readonly role: "service_role" | "authenticated",
      private readonly claims: Record<string, unknown> | null
    ) {}

    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      if (!this.op) this.op = "select";
      this.cols = cols ?? "*";
      this.countOpts = opts ?? null;
      return this;
    }
    insert(payload: unknown) {
      this.op = "insert";
      this.payload = payload;
      return this;
    }
    update(payload: unknown) {
      this.op = "update";
      this.payload = payload;
      return this;
    }
    upsert(payload: unknown, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      this.op = "upsert";
      this.payload = payload;
      this.upsertOpts = opts ?? null;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push({ col, kind: "eq", val });
      return this;
    }
    in(col: string, val: unknown[]) {
      this.filters.push({ col, kind: "in", val });
      return this;
    }
    order(col: string, opts?: { ascending?: boolean }) {
      this.orderBy = { col, ascending: opts?.ascending !== false };
      return this;
    }
    limit(n: number) {
      this.limitN = n;
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this.exec();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return this.exec().then(resolve, reject);
    }

    private toParam(col: string, v: unknown): unknown {
      if (v === undefined || v === null) return null;
      if (JSONB_COLUMNS.has(`${this.table}.${col}`)) return JSON.stringify(v);
      return v; // JS arrays pass through as Postgres arrays (text[] columns); scalars as-is
    }

    private whereClause(startIdx: number): { sql: string; params: unknown[] } {
      const parts: string[] = [];
      const params: unknown[] = [];
      let i = startIdx;
      for (const f of this.filters) {
        parts.push(f.kind === "in" ? `${f.col} = any($${i})` : `${f.col} = $${i}`);
        params.push(f.val);
        i++;
      }
      return { sql: parts.length ? `where ${parts.join(" and ")}` : "", params };
    }

    private async exec(): Promise<{ data: unknown; error: { message: string } | null; count?: number }> {
      // PGlite has one connection. Serialize each SQL transaction, then pause
      // only after its read commits to reproduce interleaved PostgREST calls.
      const previous = harness.queryTail;
      let release!: () => void;
      harness.queryTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      let result: { data: unknown; error: { message: string } | null; count?: number };
      try { result = await this.execTransaction(); }
      finally { release(); }
      if (this.op === "select" && this.table === "problem_record" && this.cols === "evidence_ids") {
        await harness.afterEvidenceRead?.();
      }
      return result;
    }

    private async execTransaction(): Promise<{ data: unknown; error: { message: string } | null; count?: number }> {
      if (harness.failOwnedEvidenceRead && this.op === "select" && this.table === "evidence_object" &&
          this.filters.some(f => f.col === "request_id")) return { data: null, error: { message: "owned evidence read failed" } };
      const db = harness.db!;
      await db.query("begin");
      try {
        await db.query(`set local role ${this.role}`);
        if (this.claims) {
          await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(this.claims)]);
        }
        const result = await this.run(db);
        await db.query("commit");
        // PostgREST crosses JSON: timestamps reach runtime.ts as ISO strings,
        // whereas PGlite returns Date objects before that transport boundary.
        return JSON.parse(JSON.stringify(result)) as typeof result;
      } catch (err) {
        await db.query("rollback");
        const message = err instanceof Error ? err.message : String(err);
        return { data: null, error: { message } };
      }
    }

    private async run(db: PGlite) {
      if (this.op === "select") {
        const { sql: where, params } = this.whereClause(1);
        if (this.countOpts?.head) {
          const res = await db.query<{ cnt: number }>(`select count(*)::int as cnt from ${this.table} ${where}`, params);
          return { data: null, error: null, count: res.rows[0]?.cnt ?? 0 };
        }
        let sql = `select ${this.cols} from ${this.table} ${where}`;
        if (this.orderBy) sql += ` order by ${this.orderBy.col} ${this.orderBy.ascending ? "asc" : "desc"}`;
        if (this.limitN != null) sql += ` limit ${this.limitN}`;
        const res = await db.query<Record<string, unknown>>(sql, params);
        return { data: this.single ? (res.rows[0] ?? null) : res.rows, error: null };
      }
      if (this.op === "insert") {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Record<string, unknown>[];
        if (rows.length === 0) return { data: [], error: null };
        const cols = Object.keys(rows[0]);
        const values: unknown[] = [];
        const placeholders = rows.map((row, ri) => {
          const ph = cols.map((c, ci) => {
            values.push(this.toParam(c, row[c]));
            return `$${ri * cols.length + ci + 1}`;
          });
          return `(${ph.join(",")})`;
        });
        await db.query(`insert into ${this.table} (${cols.join(",")}) values ${placeholders.join(",")}`, values);
        return { data: rows, error: null };
      }
      if (this.op === "update") {
        const payload = this.payload as Record<string, unknown>;
        const cols = Object.keys(payload);
        const setSql = cols.map((c, i) => `${c} = $${i + 1}`).join(",");
        const values = cols.map((c) => this.toParam(c, payload[c]));
        const { sql: where, params } = this.whereClause(cols.length + 1);
        await db.query(`update ${this.table} set ${setSql} ${where}`, [...values, ...params]);
        return { data: null, error: null };
      }
      if (this.op === "upsert") {
        const payload = this.payload as Record<string, unknown>;
        const cols = Object.keys(payload);
        const values = cols.map((c) => this.toParam(c, payload[c]));
        const placeholders = cols.map((_, i) => `$${i + 1}`);
        const conflictCol = this.upsertOpts?.onConflict ?? cols[0];
        const action = this.upsertOpts?.ignoreDuplicates
          ? "do nothing"
          : `do update set ${cols.map((c) => `${c}=excluded.${c}`).join(",")}`;
        await db.query(
          `insert into ${this.table} (${cols.join(",")}) values (${placeholders.join(",")}) on conflict (${conflictCol}) ${action}`,
          values
        );
        return { data: null, error: null };
      }
      if (this.op === "delete") {
        const { sql: where, params } = this.whereClause(1);
        await db.query(`delete from ${this.table} ${where}`, params);
        return { data: null, error: null };
      }
      throw new Error(`fake client: unsupported op ${this.op}`);
    }
  }

  function makeClient(role: "service_role" | "authenticated", claims: Record<string, unknown> | null) {
    return { from: (table: string) => new FakeBuilder(table, role, claims) };
  }

  return {
    requireServiceClient: () => makeClient("service_role", null),
    requestScopedClient: (requestId: string) => harness.serviceFallback ? null : makeClient("authenticated", { request_id: requestId }),
    serviceConfigured: () => true,
    // The merged db/client also carries the chain's provider-shaped exports
    // (A00 seam); the quality guard reads serviceClientProvider at module
    // scope, so the mock must supply them too. Same fakes, chain's names.
    serviceClientProvider: () => makeClient("service_role", null),
    platformDbConfigured: () => true,
  };
});

// vitest hoists vi.mock above regular imports regardless of source order,
// so this plain static import already gets the mocked "@/platform/db/client"
// wherever runtime.ts itself imports from it — this is the REAL,
// unmodified runtime.ts module and its REAL scopedClient() dispatch logic.
import { resetRuntimeStore, runtimeStore, type RecordJourneyInput } from "@/platform/stores/runtime";

function journeyInput(requestId: string, label: string): RecordJourneyInput {
  const now = "2026-08-28T00:00:00Z";
  return {
    session: {
      intake_session_id: `is_${label}`,
      schema_version: "1.0.0",
      guest_session_id: `gs_${label}`,
      request_id: requestId,
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
      consent_event_ids: [`ce_${label}`],
      playbook_id: null,
      entered_at: now,
      intake_started_at: now,
    },
    consent: {
      consent_event_id: `ce_${label}`,
      person_id: null,
      guest_session_id: `gs_${label}`,
      problem_id: `pr_${label}`,
      scope: "intake",
      action: "GRANT" as const,
      disclosure_version_id: "dv_test",
      surface: "start_request_form",
      trace_id: null,
      occurred_at: now,
    },
    problem: {
      problem_id: `pr_${label}`,
      schema_version: "1.0.0",
      status: "packet_ready" as const,
      source_channel: "web" as const,
      intake_session_id: `is_${label}`,
      problem_summary: `${label}'s problem`,
      service_category: null,
      service_category_confidence: null,
      safety_state: "normal" as const,
      safety_rule_id: null,
      // Matches real production wiring (fixture-engine.ts): the initial
      // customer_text evidence is linked to the problem at creation.
      evidence_ids: [`ev_${label}`],
      claim_ids: [] as string[],
      clarifiers_asked: [] as { question: string; answer: string | null }[],
      created_at: now,
      updated_at: now,
    },
    evidence: {
      evidence_id: `ev_${label}`,
      kind: "customer_text" as const,
      content: `${label}'s private description`,
      privacy: "private" as const,
      captured_at: now,
    },
    packet: {
      job_packet_id: `jp_${label}`,
      packet_version: 1,
      schema_version: "1.0.0",
      problem_id: `pr_${label}`,
      summary_plain: `${label}'s packet`,
      observed_statements: [] as string[],
      symptoms_and_timing: null,
      likely_service_category: {
        value: null,
        confidence: "low" as const,
        note: "This is an inference from the description, not a diagnosis." as const,
      },
      what_remains_unknown: [] as string[],
      safe_prep_notes: [] as string[],
      questions_for_provider: [] as string[],
      call_script: "call script",
      collected_details: [] as { label: string; value: string; source: string }[],
      media_count: 0,
      diagnosis: null,
      generated_at: now,
      engine: "fixture" as const,
    },
    events: [],
  };
}

beforeAll(async () => {
  harness.db = new PGlite();
  await harness.db.exec("create role anon");
  await harness.db.exec("create role authenticated");
  // BYPASSRLS matches real Supabase: service_role's whole point is that
  // RLS never applies to it, regardless of what policies exist.
  await harness.db.exec("create role service_role bypassrls");
  await harness.db.exec(AUTH_JWT_SHIM);
  await harness.db.exec(migration("00002_journey_runtime.sql"));
  // 00003 is what actually grants service_role its privileges in real
  // Supabase (its `alter default privileges` clauses cover tables created
  // by later migrations too) — needed so the FAKE client's service_role
  // path has real table grants, same as production, not just BYPASSRLS.
  await harness.db.exec(migration("00003_service_role_grants.sql"));
  await harness.db.exec(migration("00005_intake_details.sql"));
  await harness.db.exec(migration("00019_request_scoped_read_seam.sql"));
  // Track F2b's loop surfaces — same request-scoped idiom, proven through the
  // store's own methods below.
  await harness.db.exec(migration("00020_loop_surfaces.sql"));

  resetRuntimeStore();
  const store = runtimeStore();
  expect(store.kind).toBe("supabase"); // sanity: NOT the file fallback

  await store.recordJourney(journeyInput("rq_alice_wire", "alice"));
  await store.recordJourney(journeyInput("rq_bob_wire", "bob"));
});

afterAll(async () => {
  await harness.db?.close();
});

describe("wire-level guard: SupabaseRuntimeStore's own methods (T1-33, adversarial-inspection finding #1)", () => {
  it("sanity: getJourney returns the caller's own journey (the wire-up genuinely works end to end)", async () => {
    const store = runtimeStore();
    const journey = await store.getJourney("rq_alice_wire");
    expect(journey?.problem.problem_summary).toBe("alice's problem");
    expect(journey?.packet.summary_plain).toBe("alice's packet");
  });

  it("sanity: listEvidence returns the caller's own evidence for the caller's own problem_id", async () => {
    const store = runtimeStore();
    const own = await store.listEvidence("pr_alice", "rq_alice_wire");
    expect(own.map((e) => e.content)).toEqual(["alice's private description"]);
  });

  it(
    "READ FORGERY BLOCKED: listEvidence(bob's problem_id, alice's request_id) returns nothing — " +
      "RLS blocks the mismatched-identifier read even though the app code asked for it",
    async () => {
      const store = runtimeStore();
      const leaked = await store.listEvidence("pr_bob", "rq_alice_wire");
      expect(leaked).toEqual([]);
    }
  );

  it(
    "WRITE FORGERY BLOCKED: attachEvidence(bob's problem_id, alice's request_id, ...) " +
      "does not land in bob's problem_record.evidence_ids",
    async () => {
      const store = runtimeStore();
      await store.attachEvidence("pr_bob", "rq_alice_wire", {
        evidence_id: "ev_forged_by_alice",
        kind: "customer_text",
        content: "forged by alice",
        privacy: "private",
        captured_at: "2026-08-28T00:00:00Z",
      });
      // Ground truth, read directly (bypassing the fake client and any
      // store method entirely) as an unrestricted superuser query.
      const row = await harness.db!.query<{ evidence_ids: string[] }>(
        "select evidence_ids from problem_record where problem_id = 'pr_bob'"
      );
      expect(row.rows[0]?.evidence_ids ?? []).not.toContain("ev_forged_by_alice");
    }
  );
});

describe("wire-level: migration 00020 loop surfaces through SupabaseRuntimeStore's own methods (F2b)", () => {
  it("saveKeepClaim / getKeepClaim round-trip as the request-scoped role (grants, policies and the identity sequence all hold)", async () => {
    const store = runtimeStore();
    await store.saveKeepClaim({
      request_id: "rq_alice_wire",
      contact: "alice@example.com",
      contact_kind: "email",
      claimed_at: "2026-09-05T00:00:00Z",
      magic_link_id: "mg_alice_wire",
    });
    const mine = await store.getKeepClaim("rq_alice_wire");
    expect(mine?.contact).toBe("alice@example.com");
    expect(await store.getKeepClaim("rq_bob_wire")).toBeNull();
    // Ground truth, unrestricted: the row landed under alice's request_id.
    const row = await harness.db!.query<{ request_id: string }>(
      "select request_id from keep_claims where magic_link_id = 'mg_alice_wire'"
    );
    expect(row.rows[0]?.request_id).toBe("rq_alice_wire");
  });

  it("listAskAnswers for one subject never returns another subject's answers, even when the app asks unfiltered by mistake", async () => {
    const store = runtimeStore();
    // Bob's answer written directly as superuser (ground truth, not via the store).
    await harness.db!.query(
      `insert into ask_answers (ask_id, request_id, friend_name, friend_contact, provider_name, provider_contact, reason, created_at)
       values ('ask_bob_wire', 'rq_bob_wire', 'bob friend', null, 'bob provider', null, null, '2026-09-05T00:00:00Z')`
    );
    await store.saveAskAnswer({
      ask_id: "ask_alice_wire",
      request_id: "rq_alice_wire",
      friend_name: "alice friend",
      friend_contact: null,
      provider_name: "alice provider",
      provider_contact: null,
      reason: null,
      created_at: "2026-09-05T00:00:00Z",
    });
    const alice = await store.listAskAnswers("rq_alice_wire");
    expect(alice.map((a) => a.ask_id)).toEqual(["ask_alice_wire"]);
    // The RLS half: an unfiltered read as alice's scoped client sees only her row.
    const client = (await import("@/platform/db/client")).requestScopedClient("rq_alice_wire")!;
    const { data } = await client.from("ask_answers").select("ask_id");
    expect((data as { ask_id: string }[]).map((r) => r.ask_id)).toEqual(["ask_alice_wire"]);
  });

  it("revokeLink / isLinkRevoked: the ledger row lands and reads back (service-role read of a request-scoped write)", async () => {
    const store = runtimeStore();
    expect(await store.isLinkRevoked("lk_alice_wire")).toBe(false);
    await store.revokeLink("lk_alice_wire", "rq_alice_wire", "2026-09-05T00:00:00Z");
    expect(await store.isLinkRevoked("lk_alice_wire")).toBe(true);
  });
});

describe("later safety evidence through the real Supabase store", () => {
  it("retains a hazard after concurrent attachments overwrite its denormalized evidence id", async () => {
    const store = runtimeStore();
    await store.recordJourney(journeyInput("rq_race_wire", "race"));
    const waiting: Array<() => void> = [];
    harness.afterEvidenceRead = () => new Promise<void>(resolve => {
      waiting.push(resolve);
      if (waiting.length === 2) {
        harness.afterEvidenceRead = null;
        waiting.forEach(release => release());
      }
    });
    try {
      await Promise.all([
        store.attachEvidence("pr_race", "rq_race_wire", {
          evidence_id: "ev_race_gas", kind: "customer_text", content: "I smell gas near the unit",
          privacy: "private", captured_at: "2026-09-05T23:00:00Z",
        }),
        store.attachEvidence("pr_race", "rq_race_wire", {
          evidence_id: "ev_race_photo", kind: "photo", content: "private fixture photo",
          privacy: "private", captured_at: "2026-09-05T23:00:01Z",
        }),
      ]);
    } finally { harness.afterEvidenceRead = null; }
    const saved = await harness.db!.query<{ evidence_ids: string[] }>("select evidence_ids from problem_record where problem_id = 'pr_race'");
    expect(saved.rows[0].evidence_ids).toEqual(["ev_race", "ev_race_photo"]);
    const evidence = await store.listEvidence("pr_race", "rq_race_wire");
    expect(evidence.map(e => e.evidence_id)).toEqual(["ev_race", "ev_race_gas", "ev_race_photo"]);
    expect(evidence.every(e => e.privacy === "private")).toBe(true);
    const journey = await store.getJourney("rq_race_wire");
    expect(journey?.problem.safety_rule_id).toBe("safety_gas");
    expect(journey?.packet.summary_plain).not.toBe("race's packet");
    expect(journey?.packet.diagnosis).toBeNull();
    expect(await store.listEvidence("pr_race", "rq_bob_wire")).toEqual([]);
  });

  it("explicit owner checks protect request-owned evidence with the legacy service-client fallback too", async () => {
    harness.serviceFallback = true;
    try {
      const store = runtimeStore();
      expect(await store.listEvidence("pr_race", "rq_bob_wire")).toEqual([]);
      const own = await store.listEvidence("pr_race", "rq_race_wire");
      expect(own.some(e => e.evidence_id === "ev_race_gas")).toBe(true);
      expect(own.some(e => e.evidence_id === "ev_bob")).toBe(false);
    } finally { harness.serviceFallback = false; }
  });

  it("an unavailable owned-evidence read never reconstructs the stale safe packet", async () => {
    harness.failOwnedEvidenceRead = true;
    try { await expect(runtimeStore().getJourney("rq_race_wire")).rejects.toThrow("list owned evidence"); }
    finally { harness.failOwnedEvidenceRead = false; }
  });
});
