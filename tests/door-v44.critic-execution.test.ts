import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDoorV44CriticInput, validateDoorV44CriticReply, DoorCriticReply, DOOR_CRITIC_REPLY_SCHEMA } from "@/domain/search/door-v44/critic-input";
import { deriveDoorWriterIdentity } from "@/domain/search/door-v44/writer-identity";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { readDoorV44EvidenceJson, writeDoorV44EvidenceJson } from "@/domain/search/door-v44/artifact-store";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { doorPageVersionInputStore } from "@/platform/search/door-page-version-input-store";
import { doorPageEvidenceStore } from "@/platform/search/door-page-evidence-store";
import { buildSavedDoorPageVersion } from "@/platform/search/door-page-version-build-service";
import { readDoorPageVersionArtifact } from "@/platform/search/door-page-version-service";
import { runDoorPageCritic, recordDoorPageCritic, doorCriticDecimal, DOOR_CRITIC_PROMPT_SHA256, type DoorCriticCommand, type DoorCriticDependencies, type DoorEvidenceExecutionAuthority } from "@/platform/search/door-page-critic";
import { recordDoorPageArtifactIntegrity } from "@/platform/search/door-page-artifact-evidence";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { MODEL_CATALOGUE } from "@/platform/ai/models";
import type { ModelCallInput, ModelProvider } from "@/platform/ai/provider";
import { MemorySpendLedger } from "@/platform/ai/spend";
import { resetKillSwitchForTests, engageKillSwitch } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { readDevDb } from "@/platform/stores/dev-db";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

let root: string, command: DoorCriticCommand, deps: DoorCriticDependencies, projection: ReturnType<typeof createDoorV44CriticInput>;
const clock = () => new Date("2026-09-14T02:00:00.000Z");
const assignment = { capability: "generate_page_copy", provider: "openrouter", model_id: "test/writer", catalogue_policy_version: "synthetic-policy-1", run_id: "synthetic-writer-run", record_sha256: "a".repeat(64) };
function syntheticAuthority(): DoorEvidenceExecutionAuthority { return { producer:{id:"synthetic-critic",version:"1.0.0",implementation_sha256:"b".repeat(64),run_id:"replaced-by-observed-run",actor_id:"system:synthetic-test",actor_kind:"system",trust_scope:"synthetic_test"},
  environment:{id:"synthetic-env",manifest_sha256:"c".repeat(64),commit:"d".repeat(40),origin:"https://fixture.example"},dependencies:[],expires_at:"2026-09-15T02:00:00.000Z" }; }
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "door-critic-proof-")); vi.stubEnv("PRN_DEV_DB_PATH", join(root, "records.json"));
  const versions = doorPageVersionStore(() => null), inputs = doorPageVersionInputStore(() => null), evidence = doorPageEvidenceStore(() => null);
  const { spec, context } = await compilerFixture();
  const audit = { actor: "system:synthetic-test", reason: "Synthetic critic mechanism proof", at: "2026-09-13T20:00:00.000Z" };
  const reservation = await versions.reserveVersion({ tenant_id: spec.identity.tenant_id, page_id: spec.identity.page_id, canonical_intent_id: spec.identity.canonical_intent_id,
    canonical_url: new URL(spec.identity.canonical_path, context.validation.origin).href, operation_id: "synthetic-critic", expected_latest_version: 0, ...audit });
  const saved = await inputs.captureInput({ tenant_id: reservation.tenant_id, page_id: reservation.page_id, reservation_id: reservation.reservation_id,
    spec, context, model_provenance: { status: "recorded", assignments: [assignment] }, ...audit });
  deps = { versions, inputs, evidence, artifactRoot: join(root, "artifacts") };
  await buildSavedDoorPageVersion(versions, inputs, deps.artifactRoot, { tenant_id: saved.tenant_id, page_id: saved.page_id, operation_id: "synthetic-critic", expected_input_sha256: saved.input_sha256, ...audit });
  command = { tenant_id: saved.tenant_id, page_id: saved.page_id, page_version: 1, expected_input_sha256: saved.input_sha256, prior_attempt_sha256: null };
  const page = await readDoorPageVersionArtifact(versions, deps.artifactRoot, saved.tenant_id, saved.page_id, 1);
  projection = createDoorV44CriticInput(page.compiled, saved, page.version);
});
beforeEach(() => { resetKillSwitchForTests(); resetAgentRunLedgerForTests(); });
afterAll(() => { vi.unstubAllEnvs(); const checked = resolve(root); if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-critic-proof-")) throw new Error("unsafe fixture cleanup"); rmSync(checked, {recursive:true,force:true}); });
function enabled(): AiPolicy { return AiPolicy.parse({ ...DEFAULT_AI_POLICY, tenant_id: command.tenant_id, enabled:true,
  capabilities: { ...DEFAULT_AI_POLICY.capabilities, "seo.critique_page": { ...DEFAULT_AI_POLICY.capabilities["seo.critique_page"], model_id:"test/critic", enabled:true } } }); }
function harness(patch: Record<string, unknown> = {}, repair = false) {
  const calls: ModelCallInput[] = [];
  const provider: ModelProvider = { id:"openrouter", async complete(input) {
    calls.push(input); const value = { artifact_hash:projection.data.subject.artifact_hash, input_projection_sha256:projection.input_projection_sha256, verdict:"PASS", reason:"Synthetic reply", findings:[], ...patch };
    return { ok:true, raw:repair && calls.length === 1 ? "{}" : JSON.stringify(value), usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30,reported_cost_usd:0.0000001}, generationId:"synthetic-generation", provider:"openrouter", attempts:1 };
  } };
  return { calls, gateway: { policy:enabled(), catalogue:[{...MODEL_CATALOGUE[0], id:"test/critic", price_in_per_mtok:0,price_out_per_mtok:0}], provider:()=>provider, spend:new MemorySpendLedger(), now:clock } };
}
describe("immutable v44 critic execution", () => {
  it("projects complete governed content without raster buffers or audit actors", () => {
    expect(projection.data.spec.sections).toHaveProperty("hero"); expect(projection.data.document).toBeTruthy();
    expect(projection.data.source_records.length).toBeGreaterThan(0); expect(projection.data.fact_records.length).toBeGreaterThan(0);
    expect(projection.serialized).not.toContain("raster_base64"); expect(projection.serialized).not.toContain("system:synthetic-test");
    expect(projection.input_projection_sha256).toBe(doorV44Hash(projection.data));
    expect(Object.keys(DoorCriticReply.shape).sort()).toEqual([...DOOR_CRITIC_REPLY_SCHEMA.required].sort());
  });
  it("retains actual gateway run, generation, policy and complete input identities", async () => {
    const h = harness(); const result = await runDoorPageCritic(command,{...deps,gateway:h.gateway});
    expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.reason);
    expect(result.execution).toMatchObject({ run_id:expect.stringMatching(/^ar_/), output:{provider:"openrouter", model_id:"test/critic", generation_id:"synthetic-generation", cost_usd:"0.0000001", prompt_sha256:DOOR_CRITIC_PROMPT_SHA256, projection_sha256:projection.input_projection_sha256, repair_iteration:0, schema_repaired:false} });
    expect(h.calls).toHaveLength(1); expect(h.calls[0].system).toContain("CONTENT UNDER REVIEW"); expect(h.calls[0].user).toContain(projection.input_projection_sha256);
    const receipt = await recordDoorPageCritic(result.execution, syntheticAuthority(),deps.evidence,deps.artifactRoot);
    expect(await deps.evidence.getReceipt(command.tenant_id,command.page_id,receipt.receipt_sha256)).toEqual(receipt);
    expect(await readDoorV44EvidenceJson(deps.artifactRoot,receipt.attachments[0].sha256)).toEqual(result.execution.reply);
    expect(readDevDb().published_page_ids).toEqual([]); expect(receipt.producer.trust_scope).toBe("synthetic_test");
  });
  it("keeps schema repair separate from content-version repair", async () => {
    const h=harness({},true); const result=await runDoorPageCritic(command,{...deps,gateway:h.gateway});
    expect(result).toMatchObject({ok:true,execution:{output:{schema_repaired:true,repair_iteration:0,prior_attempt_sha256:null}}}); expect(h.calls).toHaveLength(2);
  });
  it("records the real artifact read as only its three narrow integrity claims",async()=>{
    const c={tenant_id:command.tenant_id,page_id:command.page_id,page_version:1,expected_input_sha256:command.expected_input_sha256};
    const receipt=await recordDoorPageArtifactIntegrity(c,syntheticAuthority(),{...deps,now:clock});
    expect(receipt).toMatchObject({kind:"artifact_integrity",subject:projection.data.subject,output:{artifact_read_verified:true,semantic_verified:true,input_verified:true}});
    expect(Object.keys(receipt.output)).toHaveLength(3);expect(receipt.producer.run_id).toMatch(/^artifact_/);
    await expect(recordDoorPageArtifactIntegrity({...c,expected_input_sha256:"0".repeat(64)},syntheticAuthority(),{...deps,now:clock})).rejects.toThrow("DOOR_ARTIFACT_EVIDENCE_BINDING_INVALID");
    const injected={...syntheticAuthority(),subject:{...projection.data.subject,page_id:"another-page"},kind:"content_approval"};
    await expect(recordDoorPageArtifactIntegrity(c,injected,{...deps,now:clock})).rejects.toThrow("DOOR_ARTIFACT_EVIDENCE_INVALID");
  });
  it("persists private evidence bytes immutably and detects corruption on replay",async()=>{
    const value={synthetic:true,small:1e-7}; const written=await writeDoorV44EvidenceJson(deps.artifactRoot,value);
    expect(await writeDoorV44EvidenceJson(deps.artifactRoot,value)).toEqual(written);expect(await readDoorV44EvidenceJson(deps.artifactRoot,written.sha256)).toEqual(value);
    const path=join(deps.artifactRoot,"evidence",written.sha256+".json"), bytes=readFileSync(path);
    try{writeFileSync(path,"{}");await expect(readDoorV44EvidenceJson(deps.artifactRoot,written.sha256)).rejects.toThrow();await expect(writeDoorV44EvidenceJson(deps.artifactRoot,value)).rejects.toThrow();}
    finally{writeFileSync(path,bytes);}
    let reads=0;const unsafe=Object.defineProperty({},"value",{enumerable:true,get(){reads++;return 1;}});
    await expect(writeDoorV44EvidenceJson(deps.artifactRoot,unsafe)).rejects.toThrow();expect(reads).toBe(0);
    await expect(readDoorV44EvidenceJson(deps.artifactRoot,"../outside")).rejects.toThrow();
  });
  it("converges concurrent evidence writers on complete immutable bytes",async()=>{
    const value={synthetic:"concurrent-proof",body:"x".repeat(128*1024)};
    const written=await Promise.all(Array.from({length:8},()=>writeDoorV44EvidenceJson(deps.artifactRoot,value)));
    expect(new Set(written.map(row=>row.sha256)).size).toBe(1);expect(await readDoorV44EvidenceJson(deps.artifactRoot,written[0].sha256)).toEqual(value);
  });
  it("leaves disabled policies off and never calls the provider", async () => {
    const h=harness(); const result=await runDoorPageCritic(command,{...deps,gateway:{...h.gateway,policy:{...DEFAULT_AI_POLICY,tenant_id:command.tenant_id}}});
    expect(result).toMatchObject({ok:false,reason:"disabled"}); expect(h.calls).toHaveLength(0); expect(DEFAULT_AI_POLICY.enabled).toBe(false);
  });
  it.each([true,false])("handles a valid sparse policy with enabled=%s through the gateway refusal",async enabled=>{
    const h=harness();const policy=AiPolicy.parse({...h.gateway.policy,enabled,capabilities:{}});
    expect(await runDoorPageCritic(command,{...deps,gateway:{...h.gateway,policy}})).toMatchObject({ok:false,reason:"disabled"});expect(h.calls).toHaveLength(0);
  });
  it("preserves provider-native model suffixes in execution and stored evidence",async()=>{
    const h=harness();h.gateway.catalogue[0].id="test/critic:free";h.gateway.policy.capabilities["seo.critique_page"].model_id="test/critic:free";
    const result=await runDoorPageCritic(command,{...deps,gateway:h.gateway});if(!result.ok)throw new Error(result.reason);
    expect(await recordDoorPageCritic(result.execution,syntheticAuthority(),deps.evidence,deps.artifactRoot)).toMatchObject({output:{model_id:"test/critic:free"}});
  });
  it("honors the existing kill switch before any provider request", async () => {
    await engageKillSwitch({scope:"AGENT",scope_ref:"A06",by:"synthetic-test",reason:"Synthetic critic stop"},()=>null); const h=harness(); const result=await runDoorPageCritic(command,{...deps,gateway:h.gateway});
    expect(result).toMatchObject({ok:false,reason:"kill_switch"}); expect(h.calls).toHaveLength(0);
  });
  it("refuses the captured writer even if current generation policy has changed", async () => {
    const h=harness(); h.gateway.policy.capabilities["seo.critique_page"].model_id="test/writer"; h.gateway.catalogue[0].id="test/writer";
    expect(await runDoorPageCritic(command,{...deps,gateway:h.gateway})).toMatchObject({ok:false,reason:"critic_not_independent"}); expect(h.calls).toHaveLength(0);
  });
  it("refuses unknown writers and mismatched saved input hashes before spend", async () => {
    const h=harness(); expect(await runDoorPageCritic({...command,expected_input_sha256:"0".repeat(64)},{...deps,gateway:h.gateway})).toMatchObject({ok:false,reason:"input_changed"});
    const saved=await deps.inputs.getVersionInput(command.tenant_id,command.page_id,1);
    expect(await runDoorPageCritic(command,{...deps,gateway:h.gateway,inputs:{...deps.inputs,getVersionInput:async()=>({...saved!,model_provenance:{status:"not_recorded"}})}})).toMatchObject({ok:false,reason:"writer_unknown"}); expect(h.calls).toHaveLength(0);
  });
  it.each([{artifact_hash:"0".repeat(64)},{input_projection_sha256:"1".repeat(64)},{findings:[{check:"claim_grounding",severity:"minor",pointer:"/spec/missing",message:"x",repair_instructions:null}]}])("refuses a reply about different or nonexistent content: %j",async patch=>{
    const h=harness(patch); expect(await runDoorPageCritic(command,{...deps,gateway:h.gateway})).toMatchObject({ok:false,reason:"reply_binding_invalid",run_id:expect.stringMatching(/^ar_/)});
  });
  it.each(["major","blocker"] as const)("downgrades contradictory PASS with a %s finding",async severity=>{
    const h=harness({findings:[{check:"claim_grounding",severity,pointer:"/spec/sections/hero",message:"Synthetic defect",repair_instructions:null}]});
    expect(await runDoorPageCritic(command,{...deps,gateway:h.gateway})).toMatchObject({ok:true,execution:{reply:{verdict:"FAIL"}}});
  });
  it("retains duplicate-location explanations while indexing their strongest severity",async()=>{
    const h=harness({findings:["minor","major"].map(severity=>({check:"claim_grounding",severity,pointer:"/spec/sections/hero",message:severity+" synthetic explanation",repair_instructions:null}))});
    const result=await runDoorPageCritic(command,{...deps,gateway:h.gateway});if(!result.ok)throw new Error(result.reason);
    const receipt=await recordDoorPageCritic(result.execution,syntheticAuthority(),deps.evidence,deps.artifactRoot);
    expect(receipt.findings).toEqual([{code:"claim_grounding",pointer:"/spec/sections/hero",severity:"blocker"}]);expect(receipt.verdict).toBe("FAIL");
    expect(await readDoorV44EvidenceJson(deps.artifactRoot,receipt.attachments[0].sha256)).toMatchObject({findings:expect.arrayContaining([{check:"claim_grounding",severity:"minor",pointer:"/spec/sections/hero",message:"minor synthetic explanation",repair_instructions:null}])});
  });
  it("requires a real earlier-version receipt for content repair",async()=>{
    const h=harness(); expect(await runDoorPageCritic({...command,prior_attempt_sha256:"9".repeat(64)},{...deps,gateway:h.gateway})).toMatchObject({ok:false,reason:"repair_chain_invalid"});expect(h.calls).toHaveLength(0);
  });
  it("does not invoke getters on incoming commands or replies",async()=>{
    let calls=0; const unsafe=Object.defineProperty({},"tenant_id",{enumerable:true,get(){calls++;return command.tenant_id;}});
    expect(await runDoorPageCritic(unsafe as DoorCriticCommand,deps)).toMatchObject({ok:false,reason:"input_unavailable"});
    expect(()=>validateDoorV44CriticReply(unsafe,projection)).toThrow(); expect(calls).toBe(0);
  });
  it("refuses changed artifact bytes without spending or rebuilding",async()=>{
    const path=join(deps.artifactRoot,"bundles",projection.data.subject.artifact_hash,"index.html"), prior=readFileSync(path); const h=harness();
    try {writeFileSync(path,Buffer.concat([prior,Buffer.from("<!-- tampered -->")]));expect(await runDoorPageCritic(command,{...deps,gateway:h.gateway})).toMatchObject({ok:false,reason:"input_unavailable"});expect(h.calls).toHaveLength(0);} finally{writeFileSync(path,prior);}
  });
});
describe("captured writer identity and decimal evidence",()=>{
  it("binds run identity while normalizing assignment order",()=>{
    const other={...assignment,run_id:"synthetic-second",model_id:"test/other"};
    expect(deriveDoorWriterIdentity({status:"recorded",assignments:[assignment,other]})).toEqual(deriveDoorWriterIdentity({status:"recorded",assignments:[other,assignment]}));
    expect(deriveDoorWriterIdentity({status:"recorded",assignments:[assignment]})?.assignments_sha256).not.toBe(deriveDoorWriterIdentity({status:"recorded",assignments:[{...assignment,run_id:"changed"}]})?.assignments_sha256);
    expect(deriveDoorWriterIdentity({status:"fixture_no_model_calls",fixture_id:"F04"})).toBeNull();
    expect(deriveDoorWriterIdentity({status:"recorded",assignments:[{...assignment,capability:"seo.critique_page"}]})).toBeNull();
  });
  it.each([0,0.0000001,1.234567890123e-7,1e21,Number.MIN_VALUE,Number.MAX_VALUE])( "roundtrips observed cost %s without exponent",value=>{const text=doorCriticDecimal(value);expect(text).toMatch(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);expect(Number(text)).toBe(value);});
  it.each([-1,NaN,Infinity])("refuses invalid cost %s",value=>expect(()=>doorCriticDecimal(value)).toThrow());
});
