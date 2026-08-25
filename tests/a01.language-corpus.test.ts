import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSENT_SCOPE_LANGUAGE_REUSE,
  buildLanguageCorpus,
  corpusPassingGate,
  type CorpusRecordInput,
} from "@/domain/problem/language-corpus";
import {
  DEFAULT_LANGUAGE_MINING_POLICY,
  LanguageMiningPolicy,
  MINING_COHORT_FLOOR,
  miningGate,
} from "@/domain/search/language-mining";
import { CONSENT_SCOPE_INTAKE } from "@/domain/privacy/disclosures";

/**
 * A01 STEP 10 — THE MINING CORPUS CONTRACT (HO-2).
 *
 * The seam the loop's whole SEO argument rests on, and it existed nowhere: A04
 * shipped the gate and the rule, A01's spec described the value in prose, and
 * no object connected them. What is proven here is that the producer matches the
 * gate's declared shape exactly, that the three protections apply in order
 * (consent, aggregation, floor), and that A01 does not decide whether mining
 * happens.
 */
const CONSENTED = [CONSENT_SCOPE_LANGUAGE_REUSE, CONSENT_SCOPE_INTAKE];

function records(texts: string[], scopes: readonly string[] = CONSENTED): CorpusRecordInput[] {
  return texts.map((text, i) => ({
    problem_id: `pr_${i}`,
    text,
    consent_scopes: scopes,
  }));
}

/** Six households describing the same fault in their own words. */
const COHORT = [
  "the ac is not cooling the house at all",
  "my ac is not cooling and it runs constantly",
  "ac is not cooling, thermostat says 78",
  "the ac is not cooling upstairs",
  "ac is not cooling since Tuesday at 425 Elm Street",
  "the ac is not cooling and the fan is loud",
];

describe("A01 — the corpus matches the gate's declared shape", () => {
  it("produces exactly { phrase, distinctRecordCount } and nothing else", () => {
    const corpus = buildLanguageCorpus(records(COHORT));
    expect(corpus.phrases.length).toBeGreaterThan(0);
    for (const p of corpus.phrases) {
      expect(Object.keys(p).sort()).toEqual(["distinctRecordCount", "phrase"]);
      expect(typeof p.phrase).toBe("string");
      expect(Number.isInteger(p.distinctRecordCount)).toBe(true);
    }
    // And the gate accepts them without adaptation — that is the contract.
    const on = LanguageMiningPolicy.parse({
      ...DEFAULT_LANGUAGE_MINING_POLICY,
      enabled: true,
    });
    for (const p of corpus.phrases) {
      expect(miningGate(on, p).allowed, p.phrase).toBe(true);
    }
  });
});

describe("A01 — consent applies FIRST, before any text is read", () => {
  it("a record with no reuse scope contributes nothing", () => {
    const corpus = buildLanguageCorpus(records(COHORT, [CONSENT_SCOPE_INTAKE]));
    expect(corpus.eligible_records).toBe(0);
    expect(corpus.excluded.no_consent).toBe(6);
    expect(corpus.phrases).toEqual([]);
  });

  it("intake.data_processing is NOT read as covering language reuse", () => {
    // The active disclosure mentions trends, but the scope the intake route
    // records is a different one, and inferring coverage would be a build
    // session deciding a consent question.
    expect(CONSENT_SCOPE_LANGUAGE_REUSE).not.toBe(CONSENT_SCOPE_INTAKE);
    const mixed = [
      ...records(COHORT.slice(0, 3), CONSENTED),
      ...records(COHORT.slice(3), [CONSENT_SCOPE_INTAKE]).map((r) => ({
        ...r,
        problem_id: `${r.problem_id}_x`,
      })),
    ];
    const corpus = buildLanguageCorpus(mixed);
    expect(corpus.eligible_records).toBe(3);
    expect(corpus.excluded.no_consent).toBe(3);
    // Three consented records cannot clear a floor of five.
    expect(corpus.phrases).toEqual([]);
  });

  it("no surface grants the reuse scope today, so production yields nothing", () => {
    for (const file of [
      "src/app/api/intake/route.ts",
      "src/app/api/intake/answer/route.ts",
      "src/app/api/intake/media/route.ts",
      "src/domain/privacy/disclosures.ts",
    ]) {
      const content = readFileSync(join(process.cwd(), file), "utf-8");
      expect(content, file).not.toContain("intake.language_reuse");
    }
  });
});

describe("A01 — aggregation counts RECORDS, not repetitions", () => {
  it("one talkative homeowner counts once", () => {
    const shouty = [
      {
        problem_id: "pr_loud",
        text: "the ac is not cooling. the ac is not cooling. the ac is not cooling.",
        consent_scopes: CONSENTED,
      },
    ];
    const corpus = buildLanguageCorpus(shouty, { min_distinct_records: MINING_COHORT_FLOOR });
    // Said three times, counted once, and one is below the floor: nothing out.
    expect(corpus.phrases).toEqual([]);
    expect(corpus.eligible_records).toBe(1);
  });

  it("the same record supplied twice is still one record", () => {
    const dup = [...records(COHORT), ...records(COHORT)];
    const corpus = buildLanguageCorpus(dup);
    expect(corpus.eligible_records).toBe(6);
    const notCooling = corpus.phrases.find((p) => p.phrase === "not cooling");
    expect(notCooling?.distinctRecordCount).toBe(6);
  });

  it("is deterministic and sorted, so a diff means the data moved", () => {
    const a = buildLanguageCorpus(records(COHORT));
    const b = buildLanguageCorpus(records([...COHORT].reverse()));
    expect(a.phrases.map((p) => p.phrase)).toEqual(b.phrases.map((p) => p.phrase));
    for (let i = 1; i < a.phrases.length; i += 1) {
      expect(a.phrases[i - 1].distinctRecordCount).toBeGreaterThanOrEqual(
        a.phrases[i].distinctRecordCount
      );
    }
  });
});

describe("A01 — the floor is the privacy mechanism, and it is not negotiable", () => {
  it("a phrase below the floor is not emitted at all", () => {
    const corpus = buildLanguageCorpus(records(COHORT));
    for (const p of corpus.phrases) {
      expect(p.distinctRecordCount).toBeGreaterThanOrEqual(MINING_COHORT_FLOOR);
    }
    expect(corpus.suppressed_below_floor).toBeGreaterThan(0);
  });

  it("a caller cannot ask for a cohort smaller than the structural floor", () => {
    const corpus = buildLanguageCorpus(records(COHORT), { min_distinct_records: 1 });
    expect(corpus.cohort_floor).toBe(MINING_COHORT_FLOOR);
    for (const p of corpus.phrases) {
      expect(p.distinctRecordCount).toBeGreaterThanOrEqual(MINING_COHORT_FLOOR);
    }
  });

  it("identifying strings do not survive — the address in one description is gone", () => {
    const corpus = buildLanguageCorpus(records(COHORT));
    const all = corpus.phrases.map((p) => p.phrase).join(" | ");
    expect(all).not.toContain("elm");
    expect(all).not.toContain("425");
    // Nothing numeric of any kind is countable.
    expect(all).not.toMatch(/\d/);
  });

  it("no record's text is copied into the output", () => {
    const corpus = buildLanguageCorpus(records(COHORT));
    const serialised = JSON.stringify(corpus);
    for (const text of COHORT) {
      expect(serialised).not.toContain(text);
    }
  });
});

describe("A01 — does NOT decide whether mining happens", () => {
  it("the shipped policy is still OFF, and the gate still refuses everything", () => {
    expect(DEFAULT_LANGUAGE_MINING_POLICY.enabled).toBe(false);
    const corpus = buildLanguageCorpus(records(COHORT));
    expect(corpus.phrases.length).toBeGreaterThan(0);
    // A real corpus, and nothing passes, because the flag is not A01's to flip.
    expect(corpusPassingGate(DEFAULT_LANGUAGE_MINING_POLICY, corpus)).toEqual([]);
  });

  it("A01's producer never constructs an enabled policy", () => {
    const source = readFileSync(
      join(process.cwd(), "src/domain/problem/language-corpus.ts"),
      "utf-8"
    );
    expect(source).not.toMatch(/enabled:\s*true/);
    expect(source).toMatch(/TODO-ASK-OWNER \(Melissa\)/);
  });

  it("lives OUTSIDE domain/search, so A04's structural guard stays intact", () => {
    for (const dir of ["src/domain/search", "src/platform/search"]) {
      const full = join(process.cwd(), dir);
      const walk = (d: string): string[] => {
        const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
        return readdirSync(d).flatMap((name) => {
          const p = join(d, name);
          return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
        });
      };
      for (const file of walk(full)) {
        const content = readFileSync(file, "utf-8");
        expect(content, file).not.toMatch(/language-corpus/);
        expect(content, file).not.toMatch(/from "@\/domain\/problem/);
      }
    }
  });
});
