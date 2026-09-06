import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signRequestScopedToken } from "@/platform/db/client";

/**
 * T1-33 S3 — the falsification-grade isolation test.
 *
 * This runs the ACTUAL migration SQL (supabase/migrations/00002, 00005,
 * 00006 — the real DDL that ships, not a reimplementation) against a real
 * Postgres engine (@electric-sql/pglite: Postgres compiled to WASM, not a
 * JS reimplementation — RLS is enforced by the genuine Postgres planner).
 * There is no live Supabase project reachable from this machine/session, so
 * this is the closest real falsification the available infra allows — see
 * docs/security/SERVICE-KEY-AUDIT.md "What this does NOT prove" for exactly
 * what a real hosted Supabase project would additionally verify (PostgREST's
 * own JWT validation, the real `auth` schema, network-level access).
 *
 * `auth.jwt()` below is Supabase's own published helper
 * (https://supabase.com/docs/guides/database/postgres/row-level-security),
 * reproduced here only so the same policy SQL that ships to production has
 * something to call locally — production Supabase already has this function
 * built in.
 *
 * Two subjects, ALICE (request_id rq_alice_test) and BOB (request_id
 * rq_bob_test), each get a full journey (session, problem, packet, evidence,
 * intake answer, diagnosis answer, consent event). Every read query below is
 * issued with NO request_id filter in the SQL itself — isolation must come
 * entirely from RLS, not from a WHERE clause the test controls, or the test
 * would just be re-testing its own query instead of the database's
 * enforcement.
 *
 * Two halves: READ isolation (a request-scoped session sees only its own
 * rows) and WRITE isolation (a request-scoped session can only ever create
 * or update a row stamped with its OWN request_id — it cannot forge a row
 * under another subject's identity, even though nothing stops it from
 * TRYING to put a different request_id in the insert/update payload).
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
function migration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf-8");
}

/**
 * Migration 00020 (campaign track F2b, 2026-09-05) adds the loop surfaces —
 * the revocation ledger, the Home Memory claim, the magic link, the Trust
 * Network answer, the feedback row and the job address — with the SAME
 * request-scoped policy idiom. They join the isolation proof here so the
 * new tables are held to exactly the standard the journey tables are.
 */
const LOOP_SURFACE_TABLES = [
  "link_revocations",
  "keep_claims",
  "magic_links",
  "ask_answers",
  "feedback",
  "job_addresses",
] as const;

const TABLES_WITH_REQUEST_SCOPED_POLICY = [
  "intake_session",
  "problem_record",
  "job_packet",
  "evidence_object",
  "intake_answer",
  "diagnosis_answer",
  ...LOOP_SURFACE_TABLES,
] as const;

/** Every table with a request-scoped WRITE (INSERT WITH CHECK) policy — the read set plus consent_event. */
const WRITE_TABLES = [...TABLES_WITH_REQUEST_SCOPED_POLICY, "consent_event"] as const;

/** 00020's two tables that belong to no journey: deny-all to authenticated, service role only. */
const SERVICE_ONLY_LOOP_TABLES = ["email_outbox", "signups"] as const;
type WriteTable = (typeof WRITE_TABLES)[number];

let db: PGlite;

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

async function seedSubject(requestId: string, label: string): Promise<void> {
  const isid = `is_${label}`;
  const pid = `pr_${label}`;
  const jid = `jp_${label}`;
  const eid = `ev_${label}`;
  const now = "2026-08-28T00:00:00Z";
  await db.query(
    `insert into intake_session (intake_session_id, schema_version, guest_session_id, request_id, attribution, consent_event_ids, entered_at)
     values ($1, '1.0.0', $2, $3, '{}'::jsonb, '{}', $4)`,
    [isid, `gs_${label}`, requestId, now]
  );
  await db.query(
    `insert into problem_record (problem_id, schema_version, status, source_channel, intake_session_id, safety_state, created_at, request_id)
     values ($1, '1.0.0', 'packet_ready', 'web', $2, 'normal', $3, $4)`,
    [pid, isid, now, requestId]
  );
  await db.query(
    `insert into job_packet (job_packet_id, packet_version, schema_version, problem_id, packet, generated_at, engine, request_id)
     values ($1, 1, '1.0.0', $2, $3::jsonb, $4, 'fixture', $5)`,
    [jid, pid, JSON.stringify({ secret: `${label}-only packet contents` }), now, requestId]
  );
  await db.query(
    `insert into evidence_object (evidence_id, kind, content, privacy, captured_at, request_id)
     values ($1, 'customer_text', $2, 'private', $3, $4)`,
    [eid, `${label}'s private description`, now, requestId]
  );
  await db.query(
    `insert into intake_answer (request_id, field_key, value_text, source, answered_at)
     values ($1, 'unit_model', $2, 'typed', $3)`,
    [requestId, `${label}'s answer`, now]
  );
  await db.query(
    `insert into diagnosis_answer (request_id, step_id, answer, answered_at)
     values ($1, 'step_1', $2, $3)`,
    [requestId, `${label}'s diagnosis`, now]
  );
  await db.query(
    `insert into consent_event (consent_event_id, person_id, guest_session_id, problem_id, scope, action, disclosure_version_id, surface, occurred_at, request_id)
     values ($1, null, $2, $3, 'intake', 'GRANT', 'dv_test', 'start_request_form', $4, $5)`,
    [`ce_${label}`, `gs_${label}`, pid, now, requestId]
  );
  // 00020 loop surfaces — one row each, per subject.
  await db.query(
    `insert into link_revocations (link_id, request_id, revoked_at) values ($1, $2, $3)`,
    [`lk_${label}`, requestId, now]
  );
  await db.query(
    `insert into keep_claims (request_id, contact, contact_kind, claimed_at, magic_link_id)
     values ($1, $2, 'email', $3, $4)`,
    [requestId, `${label}@example.com`, now, `mg_${label}`]
  );
  await db.query(
    `insert into magic_links (magic_id, request_id, contact, created_at, consumed_at)
     values ($1, $2, $3, $4, null)`,
    [`mg_${label}`, requestId, `${label}@example.com`, now]
  );
  await db.query(
    `insert into ask_answers (ask_id, request_id, friend_name, friend_contact, provider_name, provider_contact, reason, created_at)
     values ($1, $2, $3, null, $4, null, null, $5)`,
    [`ask_${label}`, requestId, `${label}'s friend`, `${label}'s provider`, now]
  );
  await db.query(
    `insert into feedback (feedback_id, request_id, score, "right", slow, created_at)
     values ($1, $2, 'very', $3, null, $4)`,
    [`fb_${label}`, requestId, ["It didn't make me repeat myself"], now]
  );
  await db.query(
    `insert into job_addresses (request_id, street, city_state_zip, property_type, storeys, saved_at)
     values ($1, $2, 'Carmel, IN 46032', null, null, $3)`,
    [requestId, `${label}'s street`, now]
  );
}

/**
 * Attempts a minimal, otherwise-valid INSERT into `table`, stamping the row's
 * request_id column with `payloadRequestId` — which may deliberately differ
 * from the caller's own JWT claim, to test write forgery. `uid` disambiguates
 * primary keys from seedSubject's rows and between test cases.
 */
async function insertAttempt(table: WriteTable, payloadRequestId: string, uid: string): Promise<unknown> {
  const now = "2026-08-28T00:00:00Z";
  switch (table) {
    case "intake_session":
      return db.query(
        `insert into intake_session (intake_session_id, schema_version, guest_session_id, request_id, attribution, consent_event_ids, entered_at)
         values ($1, '1.0.0', $2, $3, '{}'::jsonb, '{}', $4)`,
        [`is_${uid}`, `gs_${uid}`, payloadRequestId, now]
      );
    case "problem_record":
      return db.query(
        `insert into problem_record (problem_id, schema_version, status, source_channel, intake_session_id, safety_state, created_at, request_id)
         values ($1, '1.0.0', 'packet_ready', 'web', $2, 'normal', $3, $4)`,
        [`pr_${uid}`, `is_${uid}`, now, payloadRequestId]
      );
    case "job_packet":
      return db.query(
        `insert into job_packet (job_packet_id, packet_version, schema_version, problem_id, packet, generated_at, engine, request_id)
         values ($1, 1, '1.0.0', $2, $3::jsonb, $4, 'fixture', $5)`,
        [`jp_${uid}`, `pr_${uid}`, JSON.stringify({ secret: `${uid}-contents` }), now, payloadRequestId]
      );
    case "evidence_object":
      return db.query(
        `insert into evidence_object (evidence_id, kind, content, privacy, captured_at, request_id)
         values ($1, 'customer_text', $2, 'private', $3, $4)`,
        [`ev_${uid}`, `${uid}'s description`, now, payloadRequestId]
      );
    case "intake_answer":
      return db.query(
        `insert into intake_answer (request_id, field_key, value_text, source, answered_at)
         values ($1, $2, $3, 'typed', $4)`,
        [payloadRequestId, `field_${uid}`, `${uid}'s answer`, now]
      );
    case "diagnosis_answer":
      return db.query(
        `insert into diagnosis_answer (request_id, step_id, answer, answered_at)
         values ($1, $2, $3, $4)`,
        [payloadRequestId, `step_${uid}`, `${uid}'s diagnosis`, now]
      );
    case "consent_event":
      return db.query(
        `insert into consent_event (consent_event_id, person_id, guest_session_id, problem_id, scope, action, disclosure_version_id, surface, occurred_at, request_id)
         values ($1, null, $2, $3, 'intake', 'GRANT', 'dv_test', 'start_request_form', $4, $5)`,
        [`ce_${uid}`, `gs_${uid}`, `pr_${uid}`, now, payloadRequestId]
      );
    case "link_revocations":
      return db.query(
        `insert into link_revocations (link_id, request_id, revoked_at) values ($1, $2, $3)`,
        [`lk_${uid}`, payloadRequestId, now]
      );
    case "keep_claims":
      return db.query(
        `insert into keep_claims (request_id, contact, contact_kind, claimed_at, magic_link_id)
         values ($1, $2, 'phone', $3, $4)`,
        [payloadRequestId, `${uid} contact`, now, `mg_${uid}`]
      );
    case "magic_links":
      return db.query(
        `insert into magic_links (magic_id, request_id, contact, created_at, consumed_at)
         values ($1, $2, $3, $4, null)`,
        [`mg_${uid}`, payloadRequestId, `${uid} contact`, now]
      );
    case "ask_answers":
      return db.query(
        `insert into ask_answers (ask_id, request_id, friend_name, friend_contact, provider_name, provider_contact, reason, created_at)
         values ($1, $2, $3, null, $4, null, null, $5)`,
        [`ask_${uid}`, payloadRequestId, `${uid} friend`, `${uid} provider`, now]
      );
    case "feedback":
      return db.query(
        `insert into feedback (feedback_id, request_id, score, "right", slow, created_at)
         values ($1, $2, 'somewhat', $3, null, $4)`,
        [`fb_${uid}`, payloadRequestId, [], now]
      );
    case "job_addresses":
      return db.query(
        `insert into job_addresses (request_id, street, city_state_zip, property_type, storeys, saved_at)
         values ($1, $2, 'Carmel, IN 46032', null, null, $3)`,
        [payloadRequestId, `${uid} street`, now]
      );
  }
}

/** Simulates the request-scoped client: SET ROLE + the exact JWT claims PostgREST would expose. */
async function asRequestScoped<T>(requestId: string, run: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    // Real shape a valid signed token decodes to — proves the token this repo
    // actually mints (signRequestScopedToken) carries the claim RLS reads.
    const token = signRequestScopedToken(requestId, "test-jwt-secret-not-real");
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8"));
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await run();
    await db.query("commit");
    return result;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

beforeAll(async () => {
  db = new PGlite();
  // Supabase provisions these three roles on every project by default; the
  // migrations (00005+) grant to them, so they must exist before we run any.
  await db.exec("create role anon");
  await db.exec("create role authenticated");
  await db.exec("create role service_role");
  await db.exec(AUTH_JWT_SHIM);
  await db.exec(migration("00002_journey_runtime.sql"));
  await db.exec(migration("00005_intake_details.sql"));
  await db.exec(migration("00019_request_scoped_read_seam.sql"));
  await db.exec(migration("00020_loop_surfaces.sql"));
  await seedSubject("rq_alice_test", "alice");
  await seedSubject("rq_bob_test", "bob");
});

describe("migration 00020 loop surfaces — what it changes besides the new tables", () => {
  it("evidence_object accepts the door's voice_note kind (F1, routine decision 12)", async () => {
    await expect(
      db.query(
        `insert into evidence_object (evidence_id, kind, content, privacy, captured_at, request_id)
         values ('ev_voice_test', 'voice_note', 'Voice note received, not transcribed', 'private', '2026-09-05T00:00:00Z', 'rq_alice_test')`
      )
    ).resolves.toBeTruthy();
    await expect(
      db.query(
        `insert into evidence_object (evidence_id, kind, content, privacy, captured_at, request_id)
         values ('ev_bad_kind', 'hologram', 'x', 'private', '2026-09-05T00:00:00Z', 'rq_alice_test')`
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it.each(SERVICE_ONLY_LOOP_TABLES)(
    "%s belongs to no journey: authenticated holds no privilege on it at all",
    async (table) => {
      await db.query("begin");
      try {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ request_id: "rq_alice_test" }),
        ]);
        await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/i);
      } finally {
        await db.query("rollback");
      }
    }
  );

  it("nobody can DELETE a loop-surface row, service role included (append-only ledgers)", async () => {
    await db.query("begin");
    try {
      await db.query("set local role service_role");
      await expect(db.query("delete from link_revocations where link_id = 'lk_alice'")).rejects.toThrow(
        /permission denied/i
      );
    } finally {
      await db.query("rollback");
    }
  });

  it("magic_links is single use at the database: the consume UPDATE matches a null consumed_at exactly once", async () => {
    const first = await db.query(
      "update magic_links set consumed_at = '2026-09-05T00:01:00Z' where magic_id = 'mg_alice' and consumed_at is null returning magic_id"
    );
    expect(first.rows.length).toBe(1);
    const second = await db.query(
      "update magic_links set consumed_at = '2026-09-05T00:02:00Z' where magic_id = 'mg_alice' and consumed_at is null returning magic_id"
    );
    expect(second.rows.length).toBe(0);
    const row = await db.query<{ consumed_at: string }>("select consumed_at from magic_links where magic_id = 'mg_alice'");
    expect(new Date(row.rows[0]!.consumed_at).toISOString()).toBe("2026-09-05T00:01:00.000Z");
  });
});

afterAll(async () => {
  await db.close();
});

describe("request-scoped read isolation (T1-33 S3)", () => {
  it.each(TABLES_WITH_REQUEST_SCOPED_POLICY)(
    "%s: a request-scoped session for one subject reads only that subject's rows",
    async (table) => {
      const aliceRows = await asRequestScoped("rq_alice_test", () => db.query(`select request_id from ${table}`));
      expect(aliceRows.rows.length).toBeGreaterThan(0);
      for (const row of aliceRows.rows as { request_id: string }[]) {
        expect(row.request_id).toBe("rq_alice_test");
      }

      const bobRows = await asRequestScoped("rq_bob_test", () => db.query(`select request_id from ${table}`));
      expect(bobRows.rows.length).toBeGreaterThan(0);
      for (const row of bobRows.rows as { request_id: string }[]) {
        expect(row.request_id).toBe("rq_bob_test");
      }
    }
  );

  it("alice's request-scoped session cannot see bob's job_packet contents, even unfiltered", async () => {
    const rows = await asRequestScoped("rq_alice_test", () => db.query<{ packet: { secret: string } }>(
      "select packet from job_packet"
    ));
    const secrets = rows.rows.map((r) => r.packet.secret);
    expect(secrets).toEqual(["alice-only packet contents"]);
    expect(secrets).not.toContain("bob-only packet contents");
  });

  it("no claim at all (malformed/missing token) sees zero rows, not everything", async () => {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      // No request.jwt.claims set for this transaction at all.
      const rows = await db.query("select request_id from problem_record");
      expect(rows.rows.length).toBe(0);
    } finally {
      await db.query("rollback");
    }
  });

  it("FALSIFICATION: the exact same isolation check leaks across subjects once RLS is disabled " +
    "(proves the passing checks above are a real guard, not a vacuous one)", async () => {
    for (const table of TABLES_WITH_REQUEST_SCOPED_POLICY) {
      await db.exec(`alter table ${table} disable row level security`);
    }
    try {
      const rows = await asRequestScoped("rq_alice_test", () => db.query("select request_id from problem_record"));
      const seen = new Set((rows.rows as { request_id: string }[]).map((r) => r.request_id));
      // With RLS off, alice's session now sees BOTH subjects — the leak the
      // policy exists to prevent. This is the opposite of the assertion in
      // the isolation test above; if that assertion had passed for the
      // wrong reason (e.g. a missing GRANT masking a missing POLICY), this
      // would also show only alice's row and the falsification would fail
      // to falsify anything — which is exactly the trap this test exists to
      // catch.
      expect(seen.has("rq_bob_test")).toBe(true);
      expect(seen.has("rq_alice_test")).toBe(true);
    } finally {
      for (const table of TABLES_WITH_REQUEST_SCOPED_POLICY) {
        await db.exec(`alter table ${table} enable row level security`);
      }
    }
  });

  it("restored: isolation holds again after RLS is re-enabled", async () => {
    const rows = await asRequestScoped("rq_alice_test", () => db.query("select request_id from problem_record"));
    const seen = new Set((rows.rows as { request_id: string }[]).map((r) => r.request_id));
    expect(seen.has("rq_bob_test")).toBe(false);
    expect(seen.has("rq_alice_test")).toBe(true);
  });

  it("anon (no grant at all) cannot query these tables regardless of RLS", async () => {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      await expect(db.query("select request_id from problem_record")).rejects.toThrow(/permission denied/i);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("request-scoped write isolation (T1-33 S3 write half)", () => {
  it.each(WRITE_TABLES)(
    "%s: a request-scoped session CAN insert a row stamped with its own request_id",
    async (table) => {
      // A fresh subject per table (not alice/bob) — intake_session.request_id
      // is UNIQUE, so this must not collide with seedSubject's existing rows.
      const freshRequestId = `rq_selfok_${table}`;
      await expect(
        asRequestScoped(freshRequestId, () => insertAttempt(table, freshRequestId, `selfok_${table}`))
      ).resolves.toBeTruthy();
    }
  );

  it.each(WRITE_TABLES)(
    "%s: a request-scoped session CANNOT insert a row claiming another subject's request_id (write forgery)",
    async (table) => {
      await expect(
        asRequestScoped("rq_alice_test", () => insertAttempt(table, "rq_bob_test", `forge_${table}`))
      ).rejects.toThrow(/row-level security policy/i);
    }
  );

  it("a request-scoped session CANNOT update another subject's problem_record row at all", async () => {
    const result = await asRequestScoped("rq_alice_test", () =>
      db.query("update problem_record set problem_summary = 'hacked by alice' where problem_id = 'pr_bob'")
    );
    // USING excludes bob's row from the update's candidate set entirely — 0
    // rows affected, not an error (the same shape a nonexistent id would
    // produce, which is the point: to alice's session, it doesn't exist).
    expect((result as { affectedRows?: number }).affectedRows ?? 0).toBe(0);
    const check = await db.query<{ problem_summary: string | null }>(
      "select problem_summary from problem_record where problem_id = 'pr_bob'"
    );
    expect(check.rows[0]?.problem_summary).not.toBe("hacked by alice");
  });

  it("a request-scoped session CANNOT reassign its own problem_record row to another subject's request_id", async () => {
    await expect(
      asRequestScoped("rq_alice_test", () =>
        db.query("update problem_record set request_id = 'rq_bob_test' where problem_id = 'pr_alice'")
      )
    ).rejects.toThrow(/row-level security policy/i);
  });

  it("a request-scoped session CAN update its own problem_record row", async () => {
    await asRequestScoped("rq_alice_test", () =>
      db.query("update problem_record set problem_summary = 'alice edited this herself' where problem_id = 'pr_alice'")
    );
    const check = await db.query<{ problem_summary: string | null }>(
      "select problem_summary from problem_record where problem_id = 'pr_alice'"
    );
    expect(check.rows[0]?.problem_summary).toBe("alice edited this herself");
  });

  it(
    "FALSIFICATION (write): with RLS disabled, the exact same forged insert succeeds " +
      "(proves the block above is a real guard, not a vacuous one)",
    async () => {
      for (const table of WRITE_TABLES) {
        await db.exec(`alter table ${table} disable row level security`);
      }
      try {
        // Same forged payload as the blocked test above — now unguarded.
        await expect(
          asRequestScoped("rq_alice_test", () => insertAttempt("consent_event", "rq_bob_test", "falsify_write"))
        ).resolves.toBeTruthy();
        const row = await db.query<{ request_id: string }>(
          "select request_id from consent_event where consent_event_id = 'ce_falsify_write'"
        );
        // The forged row really did land under bob's request_id, written by
        // a session authenticated as alice — the exact forgery the WITH
        // CHECK policy exists to prevent.
        expect(row.rows[0]?.request_id).toBe("rq_bob_test");
      } finally {
        for (const table of WRITE_TABLES) {
          await db.exec(`alter table ${table} enable row level security`);
        }
      }
    }
  );

  it("restored: the same forged insert is blocked again after RLS is re-enabled", async () => {
    await expect(
      asRequestScoped("rq_alice_test", () => insertAttempt("consent_event", "rq_bob_test", "restored_write"))
    ).rejects.toThrow(/row-level security policy/i);
  });
});
