import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { readDevDb } from "@/platform/stores/dev-db";

/**
 * attachMedia — the shared evidence path, and the label read that rides on it.
 *
 * The rating-plate reader is another track's capability and may be absent, so
 * the cases here drive it through the injection seam rather than the module
 * graph: what is being pinned is what THIS file does with a read, not whether
 * the reader is installed.
 */
type MediaModule = typeof import("@/platform/intake/media");

let media: MediaModule;
let startPost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-devdb-f1m-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  media = await import("@/platform/intake/media");
  ({ POST: startPost } = await import("@/app/api/intake/start/route"));
});

afterEach(() => {
  media.__setLabelReaderForTests(undefined);
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

function png(name = "label.png"): File {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

async function newRequestId(description: string): Promise<string> {
  const form = new FormData();
  form.append("problem_description", description);
  form.append("problem_family_hint", "hvac-cooling");
  form.append("landing_path", "/problems/ac-blowing-warm-air");
  form.append("disclosure_content_hash", ACTIVE_DISCLOSURE.content_hash);
  const res = await startPost(
    new Request("http://localhost/api/intake/start", { method: "POST", body: form })
  );
  return res.headers.get("location")!.split("/complete/")[1]!;
}

function answersFor(requestId: string) {
  return readDevDb().intake_answers.filter((a) => a.request_id === requestId);
}

describe("attachMedia — what a photo is allowed to answer", () => {
  it("a readable rating plate fills the playbook's own field keys, in words", async () => {
    const requestId = await newRequestId(
      "The AC runs but the air is warm and it started yesterday afternoon"
    );
    media.__setLabelReaderForTests(async () => ({
      ok: true,
      readable: true,
      fields: {
        equipment_type: "air conditioner",
        brand: "Carrier",
        model: "24ABC636A003",
        serial: "1234E56789",
        manufacture_year: new Date().getUTCFullYear() - 8,
      },
      confidence: { brand: "high", model: "medium", serial: "low" },
      run_id: "ar_label_1",
    }));

    const result = await media.attachMedia({
      request_id: requestId,
      target: "door_photo",
      file: png(),
      source: "door_form",
    });
    expect(result.ok).toBe(true);

    const answers = answersFor(requestId);
    const brand = answers.find((a) => a.field_key === "brand")!;
    expect(brand.value_text).toBe("Carrier");
    expect(brand.source).toBe("photo");
    expect(answers.find((a) => a.field_key === "unit_model_serial")!.value_text).toBe(
      "Model 24ABC636A003, Serial 1234E56789"
    );
    // Age is stated the way the field asks for it, not as a raw year.
    expect(answers.find((a) => a.field_key === "system_age")!.value_text).toMatch(
      /^About 8 years old \(\d{4} on the label\)$/
    );

    // Confidence in WORDS, kept beside the data, out of the value the packet
    // prints. Nothing about a confidence level reaches homeowner-facing copy.
    const recorded = (await media.readLabelConfidence(requestId))!;
    expect(recorded.length).toBe(1);
    expect(recorded[0]!.confidence).toEqual({ brand: "high", model: "medium", serial: "low" });
    expect(recorded[0]!.run_id).toBe("ar_label_1");
    for (const a of answers) {
      expect(a.value_text ?? "").not.toMatch(/confidence|high|medium|low/i);
    }
  });

  it("never overwrites something the homeowner already told us", async () => {
    const requestId = await newRequestId(
      "The AC is blowing warm air and the unit outside is a Trane"
    );
    // The description already established the brand — that is an answer.
    const before = answersFor(requestId).find((a) => a.field_key === "brand");
    expect(before?.value_text).toMatch(/trane/i);

    media.__setLabelReaderForTests(async () => ({
      ok: true,
      readable: true,
      fields: { brand: "Goodman" },
      confidence: { brand: "low" },
      run_id: null,
    }));
    await media.attachMedia({
      request_id: requestId,
      target: "door_photo",
      file: png(),
      source: "door_form",
    });
    const brands = answersFor(requestId).filter((a) => a.field_key === "brand");
    expect(brands.length).toBe(1);
    expect(brands[0]!.value_text).toMatch(/trane/i);
  });

  it("an unreadable or failed read costs the homeowner nothing", async () => {
    const requestId = await newRequestId("The AC blows warm air every afternoon without fail");
    const before = answersFor(requestId).length;
    media.__setLabelReaderForTests(async () => ({ ok: false, reason: "timeout" }));
    const result = await media.attachMedia({
      request_id: requestId,
      target: "door_photo",
      file: png(),
      source: "door_form",
    });
    expect(result.ok).toBe(true);
    expect(answersFor(requestId).length).toBe(before);
    expect((await media.readLabelConfidence(requestId))).toBeNull();
  });

  it("a door photo answers no named field on its own", async () => {
    const requestId = await newRequestId("The AC blows warm air and I have no idea why at all");
    media.__setLabelReaderForTests(null);
    await media.attachMedia({
      request_id: requestId,
      target: "door_photo",
      file: png(),
      source: "door_form",
    });
    // A photo from the door is "here is my unit", before any question was
    // asked — it must not green-check a field nobody answered.
    expect(answersFor(requestId).some((a) => a.evidence_id !== null)).toBe(false);
  });

  it("refuses a file type it cannot store, before storing anything", async () => {
    const requestId = await newRequestId("The AC blows warm air and has done for two days now");
    const bad = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    const result = await media.attachMedia({
      request_id: requestId,
      target: "door_photo",
      file: bad,
      source: "door_form",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(415);
      expect(result.error).toMatch(/photo \(JPG, PNG, HEIC, WebP\)/);
    }
  });

  it("an audio file is a voice note, and only a voice note", async () => {
    const requestId = await newRequestId("The AC blows warm air, I recorded the sound it makes");
    const voice = new File([new Uint8Array(Buffer.from("audio"))], "note.m4a", {
      type: "audio/mp4",
    });
    const result = await media.attachMedia({
      request_id: requestId,
      target: "voice_note",
      file: voice,
      source: "door_form",
    });
    expect(result.ok).toBe(true);
    // A wrong-typed voice slot is refused with words about audio, not photos.
    const wrong = await media.attachMedia({
      request_id: requestId,
      target: "voice_note",
      file: png(),
      source: "door_form",
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/audio recording/);
  });

  it("an unknown request is a 404, not a crash", async () => {
    const result = await media.attachMedia({
      request_id: "rq_does_not_exist",
      target: "door_photo",
      file: png(),
      source: "door_form",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("the lazy label-reader loader", () => {
  /**
   * The loader resolves `@/platform/problem/<name>` through a TEMPLATE
   * specifier so a missing `ai-label.ts` is a caught rejection rather than a
   * build failure. That only helps if the same form still RESOLVES when the
   * module is there — this case proves the resolution mechanism against a
   * sibling module that already exists, so a silent "never loads anything"
   * cannot pass unnoticed.
   */
  it("resolves a real sibling module through the same specifier form", async () => {
    const name = "ai-classify";
    const mod = await import(/* @vite-ignore */ `@/platform/problem/${name}`);
    expect(typeof mod).toBe("object");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it("a missing module is a caught absence, not a throw", async () => {
    const name = "definitely-not-a-module-here";
    await expect(import(/* @vite-ignore */ `@/platform/problem/${name}`)).rejects.toBeTruthy();
    // And the path that uses it still succeeds with no reader at all.
    media.__setLabelReaderForTests(undefined);
    const requestId = await newRequestId("The AC blows warm air and the filter looks clean to me");
    const result = await media.attachMedia({
      request_id: requestId,
      target: "door_photo",
      file: png(),
      source: "door_form",
    });
    expect(result.ok).toBe(true);
  });
});
