import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DOOR_V44_WORDING_DERIVATIVE_SHA256, validateDoorV44Wording, verifyDoorV44WordingDerivative, type DoorV44WordingBlock } from "../src/domain/search/door-v44/wording";

const root = resolve(import.meta.dirname, "..");
const read = (name: string) => readFileSync(resolve(root, name));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const source = read("content/door-template/v44/inputs/sources/vault-WORDING.md");
const derivative = read("content/door-template/v44/wording/sources/WORDING.mechanical.md");
const manifest = read("content/door-template/v44/wording/manifest.json");
const rules = read("content/door-template/v44/wording/rules.json");
const validate = (text: string, role: DoorV44WordingBlock["role"] = "prose", money_evidence?: DoorV44WordingBlock["money_evidence"]) =>
  validateDoorV44Wording([{ text, role, ...(money_evidence ? { money_evidence } : {}) }], { surface: "door" });
const codes = (result: ReturnType<typeof validate>) => result.findings.map((finding) => finding.code);
let originals: Map<string, string>;
const protectedPaths = ["content/door-template/v44/inputs/manifest.json", ...JSON.parse(read("content/door-template/v44/inputs/manifest.json").toString()).files.map((file: { path: string }) => file.path)] as string[];
beforeAll(() => { originals = new Map(protectedPaths.map((name) => [name, hash(read(name))])); });
afterAll(() => { expect(new Map(protectedPaths.map((name) => [name, hash(read(name))]))).toEqual(originals); });

describe("mechanical WORDING derivative provenance", () => {
  it("changes exactly four known backspaces into literal regex word boundaries and leaves every other raw byte intact", () => {
    const offsets = [267675, 267839, 271662, 271702];
    expect([...source.entries()].filter(([, byte]) => byte === 8).map(([index]) => index)).toEqual(offsets);
    const chunks: Buffer[] = [];
    let start = 0;
    for (const offset of offsets) { chunks.push(source.subarray(start, offset), Buffer.from("\\b")); start = offset + 1; }
    chunks.push(source.subarray(start));
    expect(derivative).toEqual(Buffer.concat(chunks));
    expect(derivative.length).toBe(source.length + 4);
    expect(hash(source)).toBe("9ada20852ad5cc7756e96d2cef39d1164dfc9b51f54175141589e0f97ebe7491");
    expect(hash(derivative)).toBe("26715ab7b88496d97bf084a2400f222d468aa514f9ff6645493d8fbdd5a4305e");
    expect(verifyDoorV44WordingDerivative({ source, derivative, manifest, rules })).toMatchObject({ ok: true, semantic_approval: false, independent_twin: false });
  });
  it.each(["LF", "CRLF"])("verifies the exact admitted %s representation", (encoding) => {
    const encode = (bytes: Buffer) => { const lf = bytes.toString("utf8").replace(/\r\n/g, "\n"); return Buffer.from(encoding === "LF" ? lf : lf.replace(/\n/g, "\r\n")); };
    expect(verifyDoorV44WordingDerivative({ source: encode(source), derivative: encode(derivative), manifest: encode(manifest), rules: encode(rules) }).ok).toBe(true);
    expect(hash(Buffer.from(derivative.toString("utf8").replace(/\r\n/g, "\n")))).toBe(DOOR_V44_WORDING_DERIVATIVE_SHA256);
  });
  it.each(["source", "derivative", "manifest", "rules"] as const)("rejects %s tamper without altering the original", (key) => {
    const input = { source, derivative, manifest, rules };
    input[key] = Buffer.concat([input[key], Buffer.from("changed")]);
    expect(verifyDoorV44WordingDerivative(input).ok).toBe(false);
  });
  it.each(["manifest", "rules"] as const)("rejects unreviewed %s encodings and content while accepting both exact checkout forms", (key) => {
    const original = { source, derivative, manifest, rules };
    const lf = original[key].toString("utf8").replace(/\r\n/g, "\n");
    const crlf = lf.replace(/\n/g, "\r\n");
    for (const text of [lf, crlf]) {
      expect(verifyDoorV44WordingDerivative({ ...original, [key]: Buffer.from(text) }).ok).toBe(true);
    }
    const mutations = [
      Buffer.from(lf.replace("\n", "\r\n")),
      Buffer.from(crlf.replace("\r\n", "\n")),
      Buffer.from(lf.replace("\n", "\r")),
      Buffer.from(lf + "\n"),
      Buffer.from(lf.replace("{", "{ ")),
      Buffer.from("\ufeff" + lf),
      Buffer.concat([Buffer.from(lf), Buffer.from([0xff])]),
      Buffer.from(lf.replace(/"([^"]+)"/, '"tampered_$1"')),
    ];
    for (const bytes of mutations) {
      expect(bytes.equals(original[key])).toBe(false);
      const result = verifyDoorV44WordingDerivative({ ...original, [key]: bytes });
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual({ code: key === "manifest" ? "WORDING_MANIFEST_HASH" : "WORDING_RULES_HASH", pointer: "/" + key });
    }
  });
  it("does not accept partial newline conversion or deleting the original control bytes", () => {
    expect(verifyDoorV44WordingDerivative({ source, derivative: Buffer.from(derivative.toString("utf8").replace("\r\n", "\n")), manifest, rules }).ok).toBe(false);
    expect(verifyDoorV44WordingDerivative({ source, derivative: Buffer.from([...source].filter((byte) => byte !== 8)), manifest, rules }).ok).toBe(false);
  });
  it("CLI performs real positive/negative checks without starting a server", () => {
    const output = spawnSync(process.execPath, ["--import", "tsx", "tools/door-v44/wording.ts"], { cwd: root, encoding: "utf8", timeout: 20000 });
    expect(output.status, output.stderr).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({ ok: true, smoke_pass: true, semantic_approval: false, independent_twin: false });
    expect(output.stdout).not.toContain(root);
  });
});

describe("source-backed mechanical gates", () => {
  it.each([
    ["No account, no card.", "hero", "WORDING_R01_NEGATION"],
    ["A walkthrough, not a pitch.", "cta", "WORDING_R01_NEGATION"],
    ["Read the implementation guide.", "prose", "WORDING_R16_BACKSTAGE"],
    ["TODO: add the next section.", "prose", "WORDING_R16_BACKSTAGE"],
    ["three minutes", "time_claim", "WORDING_R36_NUMERIC_START"],
    ["Seven", "stat_value", "WORDING_R36_NUMERIC_START"],
    ["Your job packet is ready.", "prose", "WORDING_R39_NAME_CASE"],
    ["Powered by CHI", "prose", "WORDING_R39_TRADEMARK"],
    ["A repair costs $400.", "prose", "WORDING_R51_MONEY_EVIDENCE_REQUIRED"],
  ] as const)("rejects known violation %s", (text, role, code) => {
    const result = validate(text, role);
    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual({ code, pointer: "/blocks/0/text", severity: "blocker" });
  });
  it.each(["Your Job Packet is ready.", "Your AC is running and the air is warm.", "Powered by CHI\u2122", "Ask whether delivery includes leveling."])("accepts source-supported ordinary wording %s", (text) => {
    const result = validate(text);
    expect(result.ok).toBe(true);
    expect(result.semantic_approval).toBe(false);
  });
  it.each(["sourced", "illustrative"] as const)("allows door money with trusted %s annotation but never on a packet", (money_evidence) => {
    expect(validate("$200 to $1,500", "prose", money_evidence).ok).toBe(true);
    const packet = validateDoorV44Wording([{ text: "$200 to $1,500", role: "prose", money_evidence }], { surface: "job_packet" });
    expect(packet.ok).toBe(false);
    expect(codes(packet)).toContain("WORDING_R51_PACKET_MONEY");
  });
  it("finds numeric money words through the repaired word boundaries", () => {
    expect(codes(validate("Repair labor is 90 dollars."))).toContain("WORDING_R51_MONEY_EVIDENCE_REQUIRED");
    expect(codes(validate("Repair labor is 90 per hour."))).toContain("WORDING_R51_MONEY_EVIDENCE_REQUIRED");
  });
  it("keeps candidate-only judgments separate from mechanical failures", () => {
    for (const [text, code] of [
      ["You did the hard part.", "WORDING_R50_EFFORT_REVIEW"],
      ["An honest quote splits parts and labor.", "WORDING_R18_VIRTUE_REVIEW"],
      ["Delivery includes placement and leveling.", "WORDING_R25_OUTCOME_REVIEW"],
      ["The dealer can deliver the shed.", "WORDING_R25_THIRD_PARTY_REVIEW"],
      ["Three things to notice.", "WORDING_R17_META_REVIEW"],
      ["The machine is beside the driveway.", "WORDING_R16_VOCABULARY_REVIEW"],
    ]) {
      const result = validate(text);
      expect(result.ok).toBe(true);
      expect(result.review_required).toBe(true);
      expect(result.findings).toContainEqual({ code, pointer: "/blocks/0/text", severity: "review" });
    }
  });
  it("does not turn the effort candidate into a verdict about praise for the reader's own life", () => {
    const result = validate("You did the hard part. You bought the house.");
    expect(result.ok).toBe(true);
    expect(codes(result)).toContain("WORDING_R50_EFFORT_REVIEW");
  });
  it("honors explicit source exceptions and compiler-owned roles without relaxing controls", () => {
    expect(codes(validate("A second opinion", "prose"))).not.toContain("WORDING_R36_NUMBER_WORD_REVIEW");
    expect(validate("Your job packet", "accessible").ok).toBe(true);
    expect(validate("This is honest.", "quotation").findings).toEqual([]);
    expect(validate("You do not consent.", "legal").findings).toEqual([]);
    expect(validate("3 safe checks", "derived_count").findings).toEqual([]);
    expect(validate("TODO", "derived_count").ok).toBe(false);
    expect(validate("Text\u0008", "legal").ok).toBe(false);
  });
  it.each(["\u0000", "\u0008", "\u007f", "\ufeff"])("rejects control %s", (control) => {
    expect(codes(validate("Your packet" + control))).toContain("WORDING_CONTROL_CHARACTER");
  });
  it("is deterministic across LF/CRLF and does not mutate its caller", () => {
    const blocks = [{ text: "Your Job Packet is ready.\nRead the implementation guide.", role: "prose" as const }];
    const before = structuredClone(blocks);
    Object.freeze(blocks[0]); Object.freeze(blocks);
    const result = validateDoorV44Wording(blocks, { surface: "door" });
    expect(validateDoorV44Wording([{ ...blocks[0], text: blocks[0].text.replace(/\n/g, "\r\n") }], { surface: "door" })).toEqual(result);
    expect(blocks).toEqual(before);
  });
  it.each(["Dishwasher not draining: what changes the next step?", "Dishwasher not draining", "No airflow"])("preserves reviewed symptom phrase %s in a hero", (text) => {
    const term = text === "No airflow" ? "no airflow" : "dishwasher not draining";
    expect(validateDoorV44Wording([{ text, role: "hero", permitted_intent_terms: [term] }], { surface: "door" }).ok).toBe(true);
    expect(validate(text, "hero").ok).toBe(false);
  });
  it("does not let the reviewed symptom phrase exempt a separate marketing denial", () => {
    const result = validateDoorV44Wording([{ text: "Dishwasher not draining: not another pitch.", role: "hero", permitted_intent_terms: ["dishwasher not draining"] }], { surface: "door" });
    expect(codes(result)).toContain("WORDING_R01_NEGATION");
    expect(result.ok).toBe(false);
  });
  it("matches whole phrase tokens and applies other rules to the untouched original text", () => {
    const partial = validateDoorV44Wording([{ text: "Superdishwasher not draining: help", role: "hero", permitted_intent_terms: ["dishwasher not draining"] }], { surface: "door" });
    expect(codes(partial)).toContain("WORDING_R01_NEGATION");
    const backstage = validateDoorV44Wording([{ text: "Implementation guide not draining", role: "hero", permitted_intent_terms: ["implementation guide not draining"] }], { surface: "door" });
    expect(codes(backstage)).toContain("WORDING_R16_BACKSTAGE");
    const name = validateDoorV44Wording([{ text: "job packet not draining", role: "hero", permitted_intent_terms: ["job packet not draining"] }], { surface: "door" });
    expect(codes(name)).toContain("WORDING_R39_NAME_CASE");
  });
  it.each([["not"], [".* not draining"], ["dishwasher not draining\u0008"], ["<b>not draining</b>"], ["dishwasher  not draining"], ["dishwasher not draining", "DISHWASHER NOT DRAINING"]].map((terms) => ({ terms })))("rejects malformed symptom-span authority $terms", ({ terms }) => {
    const result = validateDoorV44Wording([{ text: "Dishwasher not draining", role: "hero", permitted_intent_terms: terms }], { surface: "door" });
    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual({ code: "WORDING_INPUT_INVALID", pointer: "/blocks/0/permitted_intent_terms", severity: "blocker" });
  });
  it("rejects malformed/poisoned blocks without getters, private text or unknown keys in diagnostics", () => {
    let called = false;
    const getter = { role: "prose", get text() { called = true; return "PRIVATE_PAYLOAD"; } };
    expect(validateDoorV44Wording([getter], { surface: "door" }).ok).toBe(false);
    expect(called).toBe(false);
    for (const input of [null, [], [{ role: "invented", text: "PRIVATE_PAYLOAD" }], [{ role: "prose", text: "PRIVATE_PAYLOAD", PRIVATE_KEY: 1 }]]) {
      const result = validateDoorV44Wording(input, { surface: "door" });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    }
  });
});
