import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPrintedEvidence, normalizePrintedEvidence, PRINTED_READER_VERSION } from "@/domain/problem/printed-evidence";
import { printedAnswers } from "@/domain/intake/printed-readings";
import { readLabelReadings, reserveLabelAttempt, writeLabelConfidence, type LabelConfidenceRecord } from "@/platform/intake/label-completions";
import { resetServiceClient } from "@/platform/db/client";
import { resetRuntimeStore } from "@/platform/stores/runtime";

const execute = promisify(execFile);
const own = { request_id: "rq_reader_own", tenant_id: "prn", evidence_id: "ev_reader_own" };
const other = { request_id: "rq_reader_other", tenant_id: "other", evidence_id: "ev_reader_other" };
const noPhoto = { request_id: "rq_reader_no_photo", tenant_id: "prn", evidence_id: "ev_unused" };
const at = "2026-09-06T12:00:00.000Z";
function completion(identity = own): LabelConfidenceRecord {
  return { ...identity, read_at: at, run_id: null, confidence: {}, extraction_status: "unreadable", reason: "Synthetic unreadable fixture" };
}
function printed(): LabelConfidenceRecord {
  const read = normalizePrintedEvidence({ reader_version: PRINTED_READER_VERSION, width: 200, height: 100,
    lines: [{ text: "SETPOINT 24 C", confidence: 94, bbox: { x0: 1, y0: 1, x1: 190, y1: 90 } }] }, own.evidence_id, "a".repeat(64));
  const projected = printedAnswers("thermostat_photo", read);
  return { ...own, read_at: at, run_id: null, target: "thermostat_photo", printed_evidence: read,
    confidence: projected.confidence, extraction_status: projected.extraction_status };
}

describe("shared extraction completion SQL and actual Supabase HTTP client", () => {
  let db: PGlite; let server: Server; let origin: string; let dir: string;
  let unavailable = false;
  let corruptRead: "foreign" | "confidence" | "raw_transcript" | null = null;
  const requests: Array<{ method: string; table: string; role: string; request_id?: string }> = [];
  const tables = new Set(["intake_session", "problem_record", "evidence_object", "job_packet", "label_extraction_completion"]);
  const columns = new Set(["request_id", "tenant_id", "evidence_id", "intake_session_id", "problem_id", "record", "packet", "evidence_ids", "created_at", "packet_version", "read_at"]);
  async function sql<T>(statement: string, values: unknown[] = [], role = "service_role", requestId?: string) {
    return db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, request_id: requestId })]);
      return tx.query<T>(statement, values);
    });
  }
  async function reserve(identity = own, role = "service_role") {
    return (await sql<{ value: boolean }>("select public.reserve_label_extraction($1,$2,$3) as value", Object.values(identity), role)).rows[0].value;
  }
  async function save(record: unknown = completion(), identity = own, role = "service_role") {
    return (await sql<{ value: boolean }>("select public.complete_label_extraction($1,$2,$3,$4::jsonb) as value",
      [...Object.values(identity), JSON.stringify(record)], role)).rows[0].value;
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
    for (const name of ["00002_journey_runtime.sql", "00005_intake_details.sql", "00015_core_record_tenancy.sql", "00019_request_scoped_read_seam.sql", "00023_label_extraction_completion.sql"]) {
      await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8"));
    }
    await db.exec("grant select on public.intake_session,public.problem_record,public.evidence_object,public.job_packet to service_role");
    for (const identity of [own, other, noPhoto]) {
      await db.query(`insert into intake_session(intake_session_id,schema_version,request_id,attribution,entered_at)
        values($1,'1.0.0',$2,'{}',$3)`, [`is_${identity.request_id}`, identity.request_id, at]);
      await db.query(`insert into problem_record(problem_id,schema_version,status,source_channel,intake_session_id,safety_state,created_at,request_id,tenant_id,evidence_ids)
        values($1,'1.0.0','draft','web',$2,'normal',$3,$4,$5,$6)`, [`problem_${identity.request_id}`, `is_${identity.request_id}`, at, identity.request_id, identity.tenant_id, identity === noPhoto ? [] : [identity.evidence_id]]);
      if (identity !== noPhoto) await db.query(`insert into evidence_object(evidence_id,kind,content,privacy,captured_at,request_id,tenant_id)
        values($1,'photo','synthetic-private-photo','private',$2,$3,$4)`, [identity.evidence_id, at, identity.request_id, identity.tenant_id]);
      await db.query(`insert into job_packet(job_packet_id,packet_version,schema_version,problem_id,packet,generated_at,engine,request_id)
        values($1,1,'1.0.0',$2,'{}',$3,'fixture',$4)`, [`packet_${identity.request_id}`, `problem_${identity.request_id}`, at, identity.request_id]);
    }
    // A minimal loopback PostgREST transport executes real SQL with role/RLS.
    // It is not a claim that remote PostgREST or deployed auth was exercised.
    server = createServer((req, res) => { void (async () => {
      try {
        const url = new URL(req.url!, "http://localhost");
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        let role = "service_role"; let requestId: string | undefined;
        if (token !== "synthetic-service-key") {
          const [header, payload, signature] = token.split(".");
          if (signature !== createHmac("sha256", "synthetic-jwt-secret").update(`${header}.${payload}`).digest("base64url")) throw new Error("Invalid fixture JWT");
          const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
          if (claims.role !== "authenticated") throw new Error("Invalid fixture role");
          role = claims.role; requestId = claims.request_id;
        }
        const table = url.pathname.replace(/^\/rest\/v1\//, "");
        requests.push({ method: req.method!, table, role, request_id: requestId });
        if (unavailable && table.includes("label_extraction")) throw new Error("Synthetic shared store unavailable");
        let result: unknown;
        if (req.method === "POST") {
          let raw = ""; for await (const chunk of req) raw += String(chunk);
          const input = JSON.parse(raw);
          const id = { request_id: input.p_request_id, tenant_id: input.p_tenant_id, evidence_id: input.p_evidence_id };
          if (table === "rpc/reserve_label_extraction") result = await reserve(id, role);
          else if (table === "rpc/complete_label_extraction") result = await save(input.p_record, id, role);
          else throw new Error("Unexpected fixture mutation");
        } else {
          if (!tables.has(table)) throw new Error("Unexpected fixture table");
          const selected = url.searchParams.get("select") ?? "*";
          if (selected !== "*" && selected.split(",").some(column => !columns.has(column.trim()))) throw new Error("Unexpected fixture selection");
          const filters: string[] = []; const values: unknown[] = [];
          for (const [key, value] of url.searchParams) {
            if (["select", "order", "limit"].includes(key)) continue;
            if (!columns.has(key)) throw new Error("Unexpected fixture filter");
            if (value === "not.is.null") filters.push(`${key} is not null`);
            else if (value.startsWith("eq.")) { values.push(value.slice(3)); filters.push(`${key}=$${values.length}`); }
            else if (value.startsWith("in.(") && value.endsWith(")")) { values.push(value.slice(4,-1).split(",")); filters.push(`${key}=any($${values.length}::text[])`); }
            else throw new Error("Unexpected fixture operator");
          }
          let order = "";
          const ordered = url.searchParams.get("order");
          if (ordered) { const [key, direction] = ordered.split("."); if (!columns.has(key)) throw new Error("Unexpected fixture order"); order = ` order by ${key} ${direction === "desc" ? "desc" : "asc"}`; }
          const limit = url.searchParams.get("limit") === "1" ? " limit 1" : "";
          const rows = (await sql(`select ${selected} from public.${table}${filters.length ? ` where ${filters.join(" and ")}` : ""}${order}${limit}`, values, role, requestId)).rows;
          if (table === "label_extraction_completion" && corruptRead && rows.length) {
            const row = rows[0] as { record: Record<string, unknown> };
            if (corruptRead === "foreign") row.record.evidence_id = other.evidence_id;
            else if (corruptRead === "confidence") row.record.confidence = { thermostat_setpoint: "certain" };
            else row.record.raw_transcript = "Synthetic transcript that must never be accepted";
          }
          result = req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows;
        }
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(result));
      } catch (error) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ message: String(error), code: "SYNTHETIC" })); }
    })(); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 30_000);
  beforeEach(async () => {
    await db.exec("truncate public.label_extraction_completion"); unavailable = false; corruptRead = null; requests.length = 0;
    dir = mkdtempSync(join(tmpdir(), "prn-shared-reader-"));
    vi.stubEnv("SUPABASE_URL", origin); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
    vi.stubEnv("SUPABASE_ANON_KEY", "synthetic-anon-key"); vi.stubEnv("SUPABASE_JWT_SECRET", "synthetic-jwt-secret");
    vi.stubEnv("PRN_RUNTIME_STORE", "supabase"); vi.stubEnv("VERCEL", "1"); vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "db.json"));
    resetRuntimeStore(); resetServiceClient();
  });
  afterEach(() => { resetRuntimeStore(); resetServiceClient(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await db.close(); });

  it("admits exactly one competing attempt and keeps completed retries immutable", async () => {
    // PGlite uses one SQL connection: actual SQL locking/idempotence, not a
    // production multi-connection contention benchmark.
    expect((await Promise.all(Array.from({ length: 12 }, () => reserve()))).filter(Boolean)).toHaveLength(1);
    expect(await save()).toBe(true); expect(await save()).toBe(true);
    await expect(save({ ...completion(), reason: "Replacement" })).rejects.toThrow(/immutable/);
    expect(await reserve()).toBe(false);
  });
  it("only accepts a real photo on the same request, problem and tenant", async () => {
    for (const bad of [{ ...own, tenant_id: "other" }, { ...own, evidence_id: other.evidence_id }, { ...own, request_id: other.request_id }, { ...own, evidence_id: "missing" }]) {
      await expect(reserve(bad)).rejects.toThrow(/ownership/);
      await expect(save(completion(bad), bad)).rejects.toThrow(/ownership/);
    }
    expect((await sql("select * from label_extraction_completion")).rows).toHaveLength(0);
  });
  it("denies client writes, private validator calls, and foreign or anonymous reads", async () => {
    await save(); await save(completion(other), other);
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const mutation of ["update label_extraction_completion set record=record", "delete from label_extraction_completion", "truncate label_extraction_completion"]) {
        await expect(sql(mutation, [], role, own.request_id)).rejects.toThrow(/permission denied/);
      }
      await expect(sql("select label_extraction_valid_record('{}','a','b','c')", [], role)).rejects.toThrow(/permission denied/);
      if (role !== "service_role") {
        await expect(reserve(own, role)).rejects.toThrow(/permission denied/);
        await expect(save(completion(), own, role)).rejects.toThrow(/permission denied/);
      }
    }
    await expect(sql("select * from label_extraction_completion", [], "anon")).rejects.toThrow(/permission denied/);
    expect((await sql("select request_id from label_extraction_completion", [], "authenticated", own.request_id)).rows).toEqual([{ request_id: own.request_id }]);
    expect((await sql("select * from label_extraction_completion", [], "authenticated", "missing")).rows).toHaveLength(0);
  });
  it("rejects transcript additions, identity substitutions, malformed gaps and unbounded OCR metadata", async () => {
    const record = printed();
    const field = record.printed_evidence!.fields.setpoint!;
    const bad: unknown[] = [
      { ...record, raw_ocr: "entire private transcript" }, { ...record, tenant_id: "other" },
      { ...record, read_at: "2026-99-06T12:00:00Z" }, { ...record, confidence: { model: "certain" } },
      { ...record, printed_evidence: { ...record.printed_evidence, transcript: "entire raw text" } },
      { ...record, target: undefined },
      { ...record, extraction_status: "unreadable", confidence: {} },
      { ...record, confidence: { thermostat_setpoint: "high", thermostat_photo: "high" } },
      { ...record, printed_evidence: { ...record.printed_evidence, gaps: [] } },
      { ...record, printed_evidence: { ...record.printed_evidence, fields: { ...record.printed_evidence!.fields, setpoint: { ...field, source_media: [other.evidence_id] } } } },
      { ...record, printed_evidence: { ...record.printed_evidence, fields: { ...record.printed_evidence!.fields, setpoint: { ...field, prepared_image: { ...field.prepared_image, width: 1 } } } } },
    ];
    for (const input of bad) { await expect(save(input)).rejects.toThrow(/Invalid extraction/); expect(await writeLabelConfidence(input as LabelConfidenceRecord)).toBe(false); }
    expect((await sql("select * from label_extraction_completion")).rows).toHaveLength(0);
  });
  it("round trips the actual client and preserves typed Celsius/provenance/field gaps", async () => {
    expect(await reserveLabelAttempt(own.request_id, own.evidence_id)).toBe(true);
    expect(await writeLabelConfidence(printed())).toBe(true);
    expect(await readLabelReadings(own.request_id)).toEqual([printed()]);
    expect(requests.filter(req => req.method === "POST").every(req => req.role === "service_role")).toBe(true);
    expect(requests.find(req => req.table === "label_extraction_completion")).toMatchObject({ role: "authenticated", request_id: own.request_id });
    expect(existsSync(join(dir, "label-reads"))).toBe(false);
  });
  it("recovers an explicitly owned photo after a concurrent array overwrite but never accepts a foreign row", async () => {
    await db.query("update problem_record set evidence_ids='{}' where request_id=$1", [own.request_id]);
    try {
      expect(await reserveLabelAttempt(own.request_id, own.evidence_id)).toBe(true);
      expect(await writeLabelConfidence(printed())).toBe(true);
      expect(await readLabelReadings(own.request_id)).toEqual([printed()]);
      await db.query("update problem_record set evidence_ids=$1 where request_id=$2", [[other.evidence_id], own.request_id]);
      const foreign = { ...own, evidence_id: other.evidence_id };
      await expect(reserve(foreign)).rejects.toThrow(/ownership/);
      await expect(save(completion(foreign), foreign)).rejects.toThrow(/ownership/);
      expect(await writeLabelConfidence(completion(foreign))).toBe(false);
    } finally { await db.query("update problem_record set evidence_ids=$1 where request_id=$2", [[own.evidence_id], own.request_id]); }
  });
  it("fails closed during shared outages and forced file mode on hosted without writing local files", async () => {
    unavailable = true;
    expect(await reserveLabelAttempt(own.request_id, own.evidence_id)).toBe(false);
    expect(await writeLabelConfidence(completion())).toBe(false);
    await expect(readLabelReadings(own.request_id)).rejects.toThrow(/unavailable/);
    expect(existsSync(join(dir, "label-reads"))).toBe(false);
    vi.stubEnv("PRN_RUNTIME_STORE", "file"); resetRuntimeStore();
    expect(await writeLabelConfidence(completion())).toBe(false);
    expect(await reserveLabelAttempt(own.request_id, own.evidence_id)).toBe(false);
    await expect(readLabelReadings(own.request_id)).rejects.toThrow(/Shared extraction completion/);
    expect(existsSync(join(dir, "db.json"))).toBe(false); expect(existsSync(join(dir, "label-reads"))).toBe(false);
  }, 20_000);
  it("does not query optional extraction storage for a journey with no saved photos", async () => {
    unavailable = true;
    expect(await readLabelReadings(noPhoto.request_id)).toBeNull();
    expect(requests.some(request => request.table === "label_extraction_completion")).toBe(false);
  });
  it("rejects damaged or foreign shared results instead of accepting orphaned confidence", async () => {
    expect(await writeLabelConfidence(printed())).toBe(true);
    for (const mutation of ["foreign", "confidence", "raw_transcript"] as const) {
      corruptRead = mutation;
      await expect(readLabelReadings(own.request_id)).rejects.toThrow(/Invalid shared extraction completion/);
    }
    corruptRead = null;
    expect(await readLabelReadings(own.request_id)).toEqual([printed()]);
  });
  it("a separate Node process reads the immutable result written by an exited Node process", async () => {
    const script = join(dir, "shared-reader-worker.mts");
    writeFileSync(script, `import {readLabelReadings,writeLabelConfidence,reserveLabelAttempt} from ${JSON.stringify(pathToFileURL(join(process.cwd(), "src/platform/intake/label-completions.ts")).href)};
const nativeFetch=globalThis.fetch; globalThis.fetch=(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(!url.startsWith(process.env.SUPABASE_URL+'/'))throw new Error('External fixture traffic forbidden');return nativeFetch(input,init);};
const record=JSON.parse(process.argv[3]);const result=process.argv[2]==='write'?{reserved:await reserveLabelAttempt(record.request_id,record.evidence_id),saved:await writeLabelConfidence(record)}:await readLabelReadings(record.request_id);process.stdout.write(JSON.stringify(result));`);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      NODE_ENV: "test", VITEST: "1", PRN_AI_LIVE_TESTS: "0", PRN_RUNTIME_STORE: "supabase", VERCEL: "1", PRN_DEV_DB_PATH: join(dir, "child-db.json"),
      SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key", SUPABASE_ANON_KEY: "synthetic-anon-key", SUPABASE_JWT_SECRET: "synthetic-jwt-secret" };
    const first = await execute(process.execPath, ["--import", "tsx", script, "write", JSON.stringify(printed())], { cwd: process.cwd(), env, timeout: 20_000, windowsHide: true });
    expect(JSON.parse(first.stdout)).toEqual({ reserved: true, saved: true });
    const second = await execute(process.execPath, ["--import", "tsx", script, "read", JSON.stringify(printed())], { cwd: process.cwd(), env, timeout: 20_000, windowsHide: true });
    expect(JSON.parse(second.stdout)).toEqual([printed()]);
    expect(existsSync(join(dir, "child-db.json"))).toBe(false); expect(existsSync(join(dir, "label-reads"))).toBe(false);
  }, 45_000);
  it("retains an unavailable outcome as explicit gaps with no confidence or invented readings", async () => {
    const read = emptyPrintedEvidence(own.evidence_id, null, "unavailable");
    const record = { ...completion(), target: "thermostat_photo", printed_evidence: read, extraction_status: "failed" as const };
    expect(await writeLabelConfidence(record)).toBe(true);
    expect(await readLabelReadings(own.request_id)).toEqual([record]);
    expect(await reserveLabelAttempt(own.request_id, own.evidence_id)).toBe(false);
  });
});
