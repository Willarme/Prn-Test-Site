import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { stripImageMetadata } from "@/platform/media/exif";
import { createOpenRouterProvider } from "@/platform/ai/providers/openrouter";
import { selectPlaybook } from "@/domain/intake/playbooks";
import { loadQuestionPlan, orderedDetailFields, saveQuestionPlan, validateQuestionPlan } from "@/platform/intake/question-plan";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function crc32(bytes: Buffer): number {
  let n = 0xffffffff;
  for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); }
  return (n ^ 0xffffffff) >>> 0;
}

describe("metadata on actual decodable images", () => {
  it("removes PNG location text and preserves decoded pixels", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
    const payload = Buffer.from("Location\0SYNTHETIC-PRIVATE-GPS"), chunk = Buffer.alloc(payload.length + 12);
    chunk.writeUInt32BE(payload.length); chunk.write("tEXt", 4); payload.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, chunk.length - 4)), chunk.length - 4);
    const input = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    const result = stripImageMetadata(input);
    expect(result.ok).toBe(true); if (!result.ok) throw Error(result.reason);
    expect(result.bytes.includes(Buffer.from("SYNTHETIC-PRIVATE-GPS"))).toBe(false);
    expect(await sharp(result.bytes).raw().toBuffer()).toEqual(await sharp(input).raw().toBuffer());
    const broken = Buffer.from(input); broken[40] ^= 1;
    expect(stripImageMetadata(broken).ok).toBe(false);
  });

  it("removes WebP XMP and preserves decoded pixels", async () => {
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).webp().toBuffer();
    const payload = Buffer.from("SYNTHETIC-PRIVATE-GPS"), chunk = Buffer.alloc(8 + payload.length + payload.length % 2);
    chunk.write("XMP "); chunk.writeUInt32LE(payload.length, 4); payload.copy(chunk, 8);
    const input = Buffer.concat([webp, chunk]); input.writeUInt32LE(input.length - 8, 4);
    const result = stripImageMetadata(input);
    expect(result.ok).toBe(true); if (!result.ok) throw Error(result.reason);
    expect(result.bytes.includes(payload)).toBe(false);
    expect(await sharp(result.bytes).raw().toBuffer()).toEqual(await sharp(webp).raw().toBuffer());
  });

  it("removes JPEG metadata after a scan and discards trailing private bytes", async () => {
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).jpeg({ progressive: true }).toBuffer();
    const payload = Buffer.from("Exif\0\0SYNTHETIC-PRIVATE-GPS"), chunk = Buffer.alloc(payload.length + 4);
    chunk[0] = 0xff; chunk[1] = 0xe1; chunk.writeUInt16BE(payload.length + 2, 2); payload.copy(chunk, 4);
    const input = Buffer.concat([jpg.subarray(0, -2), chunk, jpg.subarray(-2), payload]);
    const result = stripImageMetadata(input);
    expect(result.ok).toBe(true); if (!result.ok) throw Error(result.reason);
    expect(result.bytes.includes(payload)).toBe(false);
    expect(await sharp(result.bytes).raw().toBuffer()).toEqual(await sharp(jpg).raw().toBuffer());
  });
});

it("changing global fetch to a forwarding wrapper does not authorize a live test call", async () => {
  vi.stubEnv("VITEST", "true"); vi.stubEnv("PRN_AI_LIVE_TESTS", "");
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw Error("must never dispatch"); });
  const result = await createOpenRouterProvider("synthetic-key").complete({ modelId: "synthetic", system: "", user: "", schemaName: "T", jsonSchema: {}, mode: "json_object", maxTokens: 20, timeoutMs: 1000, dataCollection: "deny" });
  expect(result.ok).toBe(false); expect(transport).not.toHaveBeenCalled();
});

it("persists the selected question order, never turns selections into answers, and rejects unknown keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "prn-question-plan-test-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "db.json"));
  const playbook = selectPlaybook("AC is blowing warm air", "hvac");
  const keys = playbook.required_fields.slice(0, 3).map(f => f.field_key);
  const plan = { field_keys: [keys[2]!, keys[1]!], engine: "model" as const, run_id: "synthetic-run", max_questions: 2 };
  saveQuestionPlan("synthetic-request", playbook, plan);
  saveQuestionPlan("synthetic-request", playbook, { ...plan, field_keys: [keys[1]!] });
  const saved = loadQuestionPlan("synthetic-request", playbook);
  expect(saved).toEqual(plan);
  const answers = [{ field_key: keys[0]! }];
  expect(orderedDetailFields(playbook, answers, saved).map(f => f.field_key)).toEqual([keys[0], keys[2], keys[1]]);
  expect(answers).toEqual([{ field_key: keys[0] }]);
  expect(loadQuestionPlan("different-request", playbook)).toBe(null);
  expect(validateQuestionPlan({ ...plan, field_keys: ["invented"] }, playbook)).toBe(null);
});
