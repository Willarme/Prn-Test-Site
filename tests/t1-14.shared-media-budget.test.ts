import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { videoDuration } from "@/platform/intake/video-duration";

it("reads real encoded video timing and refuses missing metadata", () => {
  expect(videoDuration(readFileSync("tests/fixtures/video/synthetic-2s.mp4"))).toBe(2);
  expect(videoDuration(readFileSync("tests/fixtures/video/synthetic-31s.mp4"))).toBe(31);
  expect(videoDuration(Buffer.from("not a video"))).toBeNull();
  const full = readFileSync("tests/fixtures/video/synthetic-2s.mp4");
  expect(videoDuration(full.subarray(0,full.length-200))).toBeNull();
});

it("shared RPC counts existing evidence, reserves under request lock, limits video, and preserves RLS and retry identity", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth,public to authenticated,service_role,anon;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb $$;
      create table intake_session(request_id text primary key,intake_session_id text unique);
      create table problem_record(problem_id text primary key,intake_session_id text,tenant_id text,evidence_ids text[] not null default '{}',updated_at timestamptz);
      create table evidence_object(evidence_id text primary key,request_id text,kind text,tenant_id text default 'prn',captured_at timestamptz default now());
      grant select on intake_session,problem_record to authenticated;
      insert into intake_session values ('rq_one','in_one'),('rq_two','in_two');
      insert into problem_record(problem_id,intake_session_id,tenant_id) values ('pr_one','in_one','prn'),('pr_two','in_two','foreign');
      insert into evidence_object(evidence_id,request_id,kind) values ('ev_old','rq_one','photo');`);
    await db.exec(readFileSync("supabase/migrations/00026_request_media_budget.sql","utf8"));
    await db.exec("insert into evidence_object(evidence_id,request_id,kind) values ('ev_text_a','rq_one','customer_text'),('ev_text_b','rq_one','customer_text')");
    expect((await db.query<{evidence_ids:string[]}>("select evidence_ids from problem_record where problem_id='pr_one'")).rows[0].evidence_ids).toEqual(['ev_text_a','ev_text_b']);
    const policy = { photos:4,videos:1,seconds:30,photo_version:3,video_version:1,seconds_version:1 };
    const call = async (operation_id:string,kind="photo",duration_seconds:number|null=null,tenant="prn") =>
      (await db.query<{result:{accepted:boolean;duplicate:boolean;used:number;max:number}}>(
        "select reserve_request_media('rq_one',$1,$2::jsonb,$3::jsonb) as result",[tenant,JSON.stringify({operation_id,kind,duration_seconds}),JSON.stringify(policy)])).rows[0].result;
    await db.exec("set role service_role");
    expect((await call('one')).accepted).toBe(true);
    expect((await call('two')).accepted).toBe(true);
    expect(await call('three')).toMatchObject({accepted:true,used:4,max:4});
    expect(await call('four')).toMatchObject({accepted:false,used:4,max:4});
    expect(await call('three')).toMatchObject({accepted:true,duplicate:true,used:4});
    await expect(call('three','video',2)).rejects.toThrow(/identity reused/);
    await expect(call('badvideo','video',31)).rejects.toThrow(/duration exceeds/);
    await expect(call('unknownvideo','video')).rejects.toThrow(/duration missing/);
    expect(await call('video','video',2)).toMatchObject({accepted:true,used:1,max:1});
    expect((await call('video2','video',2)).accepted).toBe(false);
    await expect(call('foreign','photo',null,'foreign')).rejects.toThrow(/ownership mismatch/);
    await expect(db.exec("update request_media_budget set reservations='[]'")).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set test.jwt='{\"request_id\":\"rq_one\"}'; set role authenticated");
    expect((await db.query("select * from request_media_budget")).rows).toHaveLength(1);
    await expect(call('unauthorized')).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set test.jwt='{\"request_id\":\"rq_two\"}'; set role authenticated");
    expect((await db.query("select * from request_media_budget")).rows).toHaveLength(0);
  } finally { await db.close(); }
});
