import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const sequenceGrants = `select c.relname, c.relacl::text as acl,
  has_sequence_privilege('authenticated',c.oid,'USAGE') as authenticated_usage,
  has_sequence_privilege('authenticated',c.oid,'SELECT') as authenticated_select
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='S' order by c.relname`;
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");

describe("loop migration sequence permission scope", () => {
  it("grants only its two new identity sequences while preserving every existing sequence ACL", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
        create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
        create table evidence_object(evidence_id text primary key, kind text not null,
          constraint evidence_object_kind_check check(kind in ('customer_text','photo','video','voice_transcript')));
        create sequence admin_audit_id_seq; create sequence diagnosis_answer_id_seq;
        create sequence intake_answer_id_seq; create sequence page_performance_daily_id_seq;
        grant all on all sequences in schema public to service_role;
        alter default privileges in schema public grant all on tables to service_role;
        alter default privileges in schema public grant all on sequences to service_role;`);
      const before = (await db.query(sequenceGrants)).rows;
      expect(before).toHaveLength(4);
      expect(before.every(row => row.authenticated_usage === false && row.authenticated_select === false)).toBe(true);
      await db.exec("begin");
      await db.exec(migration("00020_loop_surfaces.sql"));
      await db.exec(migration("00021_loop_grant_hardening.sql"));
      await db.exec("commit");
      const after = (await db.query(sequenceGrants)).rows;
      expect(after.filter(row => before.some(original => original.relname === row.relname))).toEqual(before);
      const created = after.filter(row => !before.some(original => original.relname === row.relname));
      expect(created.map(row => row.relname)).toEqual(["job_addresses_id_seq", "keep_claims_id_seq"]);
      expect(created.every(row => row.authenticated_usage === true && row.authenticated_select === true)).toBe(true);
      for (const name of ["job_addresses_id_seq", "keep_claims_id_seq"]) {
        const result = await db.query(`select has_sequence_privilege('anon',$1,'USAGE') as anon_usage,
          has_sequence_privilege('service_role',$1,'USAGE') as service_usage,
          has_sequence_privilege('service_role',$1,'SELECT') as service_select`, [name]);
        expect(result.rows[0]).toEqual({ anon_usage: false, service_usage: true, service_select: true });
      }
    } finally {
      await db.close();
    }
  });
});
