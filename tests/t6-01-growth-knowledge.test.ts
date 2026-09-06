import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GRAPH_V1, GRAPH_V1_NODE_IDS } from "@/domain/growth/graph-v1";
import {
  validateGraphUniqueness,
  unmetEvidenceRequirements,
  PropertyProblemGraph,
} from "@/domain/growth/property-problem-graph";
import {
  PLAYBOOK_REGISTRY,
  validateRegistry,
  authoritativePlaybookFor,
  authoritativePlaybookForNode,
} from "@/domain/growth/playbooks";
import {
  validatePlaybook,
  unsourcedSections,
  ServicePlaybook,
} from "@/domain/growth/service-playbook";
import {
  compileIntent,
  type ModelIntentClassifier,
  type ProposedProblemNode,
} from "@/domain/growth/search-intent-compiler";
import type { GeographyScope } from "@/domain/shared/primitives";
import {
  evaluateEligibility,
  authoredContentFor,
  ELIGIBILITY_THRESHOLD,
  type EligibilityInput,
} from "@/domain/growth/page-eligibility-gate";
import { validateEligibilityPolicy } from "@/domain/growth/eligibility-policy";
import { ELIGIBILITY_POLICY_V1 } from "@/domain/growth/eligibility-policy-v1";

const GROWTH_DIR = join(process.cwd(), "src", "domain", "growth");

/** Portable recursive scan (no shell-outs: /bin/bash does not exist on Windows). */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

function growthSourceFiles(): string[] {
  return walkFiles(GROWTH_DIR).filter((f) => f.endsWith(".ts"));
}

describe("T6-01 · property problem graph", () => {
  it("parses, and every node id is unique with valid intent joins", () => {
    expect(GRAPH_V1.graph_id).toBe("ppg_v1");
    expect(validateGraphUniqueness(GRAPH_V1)).toEqual([]);
  });

  it("carries all three trades and no dollar figures anywhere", () => {
    const systems = new Set(GRAPH_V1.problem_nodes.map((n) => n.system));
    expect(systems.has("tree")).toBe(true);
    expect(systems.has("plumbing_drain")).toBe(true);
    expect(systems.has("roofing")).toBe(true);
    // OD-13 / canon 14A §8.1: the graph records price DRIVERS, never prices.
    const raw = JSON.stringify(GRAPH_V1);
    expect(raw).not.toMatch(/\$\s?\d/);
    expect(raw).not.toMatch(/\bUSD\b/);
  });

  it("stamps geographic scope on every node", () => {
    for (const node of GRAPH_V1.problem_nodes) {
      expect(node.geography.scope).toBeTruthy();
    }
  });
});

/**
 * The vocabulary each trade actually speaks in. Used to check that a playbook's
 * distinguishing questions are ABOUT that trade — the check the old
 * count-to-two assertion did not make.
 */
const TRADE_MARKERS: Record<string, string[]> = {
  tree: ["tree", "trees", "limb", "limbs", "branch", "branches", "trunk", "crown", "canopy", "stump", "arborist", "lean", "leaning", "deadwood"],
  plumbing_drain: ["drain", "drains", "sewer", "sewage", "plumbing", "toilet", "fixture", "fixtures", "clog", "clogged", "pipe", "pipes", "sink", "tub", "backup"],
  roofing: ["roof", "roofs", "shingle", "shingles", "flashing", "gutter", "gutters", "attic", "ceiling", "leak", "leaks", "decking"],
};

/** Slugs that identify a trade inside a question_id, for the wrong-trade-id check. */
const TRADE_ID_SLUGS: Record<string, string[]> = {
  tree: ["tree"],
  plumbing_drain: ["drain", "plumb", "sewer"],
  roofing: ["roof", "shingle", "gutter"],
};

/**
 * DISJOINT core vocabulary per trade — deliberately NARROWER than TRADE_MARKERS
 * above, because this set answers a different question: not "is this about the
 * right trade?" but "does ANOTHER trade's vocabulary appear here?" A word two
 * trades legitimately share ("leak", "attic", "fixture", "line") would make
 * that judgement wrong, so every word below belongs to exactly one trade.
 *
 * Used by G5 (a question may not carry another trade's words at all) and by G1
 * (a section may not carry more of another trade's words than its own).
 */
const TRADE_CORE_VOCABULARY: Record<string, string[]> = {
  tree: ["tree", "trees", "limb", "limbs", "branch", "branches", "trunk", "crown", "canopy", "stump", "stumps", "arborist", "deadwood"],
  plumbing_drain: ["drain", "drains", "sewer", "sewage", "plumbing", "plumber", "plumbers", "toilet", "toilets", "clog", "clogs", "clogged", "pipe", "pipes", "backup", "backups"],
  roofing: ["roof", "roofs", "roofer", "roofers", "shingle", "shingles", "flashing", "decking", "gutter", "gutters", "soffit", "eaves", "granule", "granules"],
};

function foreignVocabularyFor(system: string): string[] {
  return Object.keys(TRADE_CORE_VOCABULARY)
    .filter((s) => s !== system)
    .flatMap((s) => TRADE_CORE_VOCABULARY[s]);
}

/** Ordinary English words a real question is built out of; placeholder text has none. */
const ENGLISH_FUNCTION_WORDS = ["is", "are", "was", "were", "did", "do", "does", "has", "have", "what", "how", "or", "the", "it", "one", "your", "you", "a", "an", "been", "there", "this", "and", "in", "of"];

/** Every word in a distinguishing question and its branch table, lowercased. */
function questionWords(dq: ServicePlaybook["distinguishing_questions"][number]): string[] {
  const text = [dq.question, ...dq.answer_branches.flatMap((b) => [b.answer_pattern, b.points_toward])].join(" ");
  return text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

function foreignIdSlugsFor(system: string): string[] {
  return Object.keys(TRADE_ID_SLUGS)
    .filter((s) => s !== system)
    .flatMap((s) => TRADE_ID_SLUGS[s]);
}

/**
 * Every way a playbook's distinguishing questions fail to belong to their own
 * trade. Three checks, and the third is G5's addition: PRESENCE of the right
 * vocabulary is not ABSENCE of the wrong vocabulary, and the old positive-only
 * pair let a verbatim plumbing question through under a tree word and a tree id.
 */
function distinguishingQuestionOffenders(pb: ServicePlaybook): string[] {
  const out: string[] = [];
  const own = TRADE_MARKERS[pb.system] ?? [];
  const foreignSlugs = foreignIdSlugsFor(pb.system);
  const foreignWords = foreignVocabularyFor(pb.system);

  for (const dq of pb.distinguishing_questions) {
    const words = questionWords(dq);
    if (!own.some((m) => words.includes(m))) {
      out.push(`${pb.playbook_id}/${dq.question_id}: not one ${pb.system} word in the question or its branches`);
    }
    const badSlug = foreignSlugs.find((s) => dq.question_id.includes(s));
    if (badSlug !== undefined) {
      out.push(`${pb.playbook_id}/${dq.question_id}: id carries another trade's slug "${badSlug}"`);
    }
    const intruders = [...new Set(foreignWords.filter((w) => words.includes(w)))];
    if (intruders.length > 0) {
      out.push(
        `${pb.playbook_id}/${dq.question_id}: another trade's vocabulary appears in a ${pb.system} question — ${intruders.join(", ")}`,
      );
    }
  }
  return out;
}

describe("T6-01 · playbook registry", () => {
  it("validates clean: joins to the graph, no duplicate ids, no two authoritative per trade", () => {
    expect(validateRegistry()).toEqual([]);
  });

  /**
   * R1 (Josh, 2026-08-28) — Tree is the authoritative voice. Plumbing/Drain and
   * Roofing stay shadow, in that literal word, and stay unsigned.
   */
  it("STRUCTURAL: Tree is AUTHORITATIVE and signed; the other two stay literally 'shadow' and unsigned", () => {
    expect(PLAYBOOK_REGISTRY.length).toBe(3);
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    expect(tree.status).toBe("authoritative");
    expect(tree.provenance.reviewed_by).toBe("Joshua");
    expect(tree.provenance.reviewed_at).toBe("2026-08-28");

    for (const pb of PLAYBOOK_REGISTRY.filter((p) => p.system !== "tree")) {
      // The literal status string matters: the gate and the one-voice-per-trade
      // rule both key off "shadow". Renaming it to "parked" is a silent break.
      expect(pb.status).toBe("shadow");
      expect(pb.provenance.reviewed_by).toBeNull();
      expect(pb.provenance.reviewed_at).toBeNull();
    }
  });

  it("STRUCTURAL: refuses a half-signature — a named reviewer with no date, or a date with no name", () => {
    const half = JSON.parse(JSON.stringify(PLAYBOOK_REGISTRY[0])) as (typeof PLAYBOOK_REGISTRY)[number];
    half.provenance.reviewed_at = null;
    expect(validatePlaybook(half, GRAPH_V1_NODE_IDS).some((e) => e.includes("must be set together"))).toBe(true);
  });

  it("STRUCTURAL: refuses an AUTHORITATIVE playbook whose reviewed_by is null — this is THE control on copy quality", () => {
    const rogue = JSON.parse(JSON.stringify(PLAYBOOK_REGISTRY[0])) as (typeof PLAYBOOK_REGISTRY)[number];
    rogue.status = "authoritative";
    rogue.provenance.reviewed_by = null;
    rogue.provenance.reviewed_at = null;
    const errors = validatePlaybook(rogue, GRAPH_V1_NODE_IDS);
    expect(errors.some((e) => e.includes("authoritative status requires provenance.reviewed_by"))).toBe(true);
  });

  it("public page generation may draw on Tree and nothing else", () => {
    expect(authoritativePlaybookFor("tree")?.playbook_id).toBe("spb_tree_v1");
    expect(authoritativePlaybookFor("plumbing_drain")).toBeNull();
    expect(authoritativePlaybookFor("roofing")).toBeNull();
    expect(authoritativePlaybookFor("hvac")).toBeNull();
  });

  it("Tree is authored at full depth: four sections, two distinguishing questions, safety and DIY boundary", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    expect(tree.sections.length).toBeGreaterThanOrEqual(4);
    expect(tree.distinguishing_questions.length).toBeGreaterThanOrEqual(2);
    expect(tree.safety_notes.length).toBeGreaterThanOrEqual(1);
    expect(tree.diy_boundary.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * D1 (the defect this guard exists because of) — the Tree playbook's second
   * distinguishing question was PLUMBING content, copied whole from the drain
   * playbook, and the only guard on it counted to two. A verifier later swapped
   * that question for the literal string "AAAAA BBBBB CCCCC DDDDD" and every
   * test still passed. Counting is not checking. These three assertions check
   * WHAT the question says: it must belong to its own trade, it must not be
   * filed under another trade's id, and it must read like a question a person
   * would ask.
   */
  it("STRUCTURAL: every distinguishing question belongs to its OWN trade — no other trade's slug in an id", () => {
    expect(PLAYBOOK_REGISTRY.flatMap(distinguishingQuestionOffenders)).toEqual([]);
  });

  /**
   * G5 — the guard's own falsification, kept permanently.
   *
   * The check above was positive-only: it required at least one own-trade word
   * and forbade a foreign slug in the id. Appending "out by the tree" to the
   * verbatim plumbing question and renaming its id to `dq_tree_one_or_many`
   * satisfied both and passed green — plumbing content filed under Tree, which
   * is D1's original defect wearing four extra words. Presence of the right
   * vocabulary is not absence of the wrong vocabulary, so the rule now requires
   * both.
   */
  it("STRUCTURAL: rejects another trade's question smuggled in under a same-trade word and a same-trade id", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const plumbing = PLAYBOOK_REGISTRY.find((p) => p.system === "plumbing_drain")!;

    const rigged = clonePlaybook(tree);
    const stolen = JSON.parse(JSON.stringify(plumbing.distinguishing_questions[0])) as (typeof rigged.distinguishing_questions)[number];
    stolen.question_id = "dq_tree_one_or_many"; // Tree's own slug, no foreign slug to find
    stolen.question = `${stolen.question} out by the tree`; // one own-trade word, which the old check accepted
    rigged.distinguishing_questions = [stolen, ...rigged.distinguishing_questions];

    const offenders = distinguishingQuestionOffenders(rigged);
    expect(offenders).not.toEqual([]);
    expect(offenders.join(" | ")).toContain("another trade's vocabulary");

    // The two halves of the old check are genuinely satisfied by this rig — so
    // the rejection above comes from the new half and not from the old one.
    const words = questionWords(stolen);
    expect((TRADE_MARKERS.tree ?? []).some((m) => words.includes(m))).toBe(true);
    expect(foreignIdSlugsFor("tree").some((s) => stolen.question_id.includes(s))).toBe(false);

    // …and the unmutated playbook is clean.
    expect(distinguishingQuestionOffenders(clonePlaybook(tree))).toEqual([]);
  });

  // HEURISTIC, not a guarantee. Ends with "?", has five tokens, contains an
  // English function word, is not SHOUTED. It catches placeholder text and
  // nothing subtler; a bad question that is well-formed passes. See the
  // WHAT THESE PROSE CHECKS ARE note above the G1 block.
  it("HEURISTIC: every distinguishing question is at least well-formed — filler cannot satisfy the count", () => {
    const offenders: string[] = [];
    for (const pb of PLAYBOOK_REGISTRY) {
      for (const dq of pb.distinguishing_questions) {
        const q = dq.question.trim();
        const tokens = q.split(/\s+/);
        if (!q.endsWith("?")) offenders.push(`${dq.question_id}: not phrased as a question`);
        if (tokens.length < 5) offenders.push(`${dq.question_id}: too short to be a real question`);
        if (tokens.some((t) => /^[A-Z]{3,}$/.test(t))) offenders.push(`${dq.question_id}: shouted placeholder token`);
        const lower = q.toLowerCase().split(/[^a-z']+/);
        if (!ENGLISH_FUNCTION_WORDS.some((w) => lower.includes(w))) {
          offenders.push(`${dq.question_id}: no English sentence structure — placeholder text`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every distinguishing question carries a real branch table, not two restatements of itself", () => {
    for (const pb of PLAYBOOK_REGISTRY) {
      for (const dq of pb.distinguishing_questions) {
        expect(dq.answer_branches.length).toBeGreaterThanOrEqual(2);
        const targets = new Set(dq.answer_branches.map((b) => b.points_toward.toLowerCase().trim()));
        // Branches that all point the same way are a question that decides nothing.
        expect(targets.size).toBe(dq.answer_branches.length);
        for (const b of dq.answer_branches) {
          expect(b.points_toward.split(/\s+/).length).toBeGreaterThanOrEqual(5);
        }
      }
    }
  });

  it("shadow playbooks prove schema reuse: same schema, different trade, no edits to the schema file", () => {
    const systems = new Set(PLAYBOOK_REGISTRY.map((p) => p.system));
    expect(systems.size).toBe(3);
    for (const pb of PLAYBOOK_REGISTRY) {
      expect(pb.schema_version).toBe("1.0.0");
      expect(pb.sections.length).toBeGreaterThanOrEqual(3);
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THESE PROSE CHECKS ARE, AND WHAT THEY ARE NOT — Josh's ruling,
 * 2026-08-28.
 *
 * A REGEX CANNOT JUDGE WHETHER COPY IS GOOD. Three rounds of these guards were
 * written and every one was defeated by a two-word rewrite: the technique ban
 * caught "you can puncture the bulge" and missed the imperative "make a small
 * hole"; broadening it to imperatives and instrument phrases moved the line
 * without closing it. There is no fourth round of vocabulary here, deliberately.
 *
 * COPY QUALITY IS ENFORCED BY A NAMED HUMAN, NOT BY THIS SUITE. A01 approval
 * condition 3 requires a named reviewer behind any authoritative playbook, and
 * ServicePlaybook.provenance.reviewed_by carries that name with a date —
 * validatePlaybook refuses an authoritative playbook without one, and THAT is
 * the control. A reviewer signing a playbook is vouching for its judgement; the
 * tests below cannot and do not.
 *
 * So the checks divide in two, and every one of them says which it is:
 *
 *  STRUCTURAL — a fact about the record, true or false with no taste involved.
 *  These are real guarantees: another trade's slug inside an id, a signature
 *  missing when status is authoritative, a half-signature, an unknown key, a
 *  dollar figure, an edge into a ghost node, a sentence appearing verbatim in
 *  two playbooks. They stay, and they are load-bearing.
 *
 *  HEURISTIC — a signal that catches placeholder text and obvious
 *  cross-contamination, and nothing subtler. Word counts, function-word counts,
 *  own-trade vs foreign-trade vocabulary ratios, method-verb and instrument
 *  token lists. Every one is named "HEURISTIC:" so a future reader cannot
 *  mistake it for a guarantee. They are worth keeping — they caught real filler
 *  — but a determined rewrite passes them, and none of them may be escalated
 *  with more vocabulary. If one of them fails, a human reads the copy.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * G1 — THE PUBLISHED PROSE ITSELF.
 *
 * `sections[].body` is the homeowner-facing copy of the one signed,
 * authoritative playbook — the only content R1 permits a public page to draw
 * on — and until this block it was completely unguarded. The only assertion
 * touching it was `sections.length >= 4`. A verifier replaced all four Tree
 * section bodies with the literal filler "AAAAA BBBBB CCCCC DDDDD." and the
 * full suite stayed green at 1606/1606: counting is not checking.
 *
 * `publishedProseOffenders` is HEURISTIC except for its repeat check. Length,
 * function-word count and trade-vocabulary ratio are signals; the same-paragraph
 * -twice check and `duplicateBodySentences` are structural (exact matching, no
 * judgement). The last test in the block is the heuristic's own falsification,
 * kept permanently: it runs the checker against four deliberately faked
 * playbooks — the filler string, lorem ipsum, a duplicated sentence, and another
 * trade's copy — and fails if any comes back clean. That test says what the
 * heuristic CAN catch. It is not a claim about what it cannot.
 */

/** Ordinary English connective tissue. Real prose is full of it; placeholder text has almost none. */
const PROSE_FUNCTION_WORDS = [
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "it", "its", "that", "this", "these", "those",
  "and", "or", "but", "of", "in", "on", "to", "for", "from", "with", "at", "as", "not", "no", "if", "when",
  "what", "how", "why", "which", "who", "you", "your", "they", "them", "their", "there", "here", "than",
  "then", "so", "because", "into", "out", "up", "down", "over", "under", "after", "before", "until", "while",
  "does", "do", "did", "has", "have", "had", "can", "will", "would", "should", "may", "might", "more", "most",
  "less", "one", "two", "every", "any", "some", "all", "both", "each",
];

function lowerWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
}

function sentenceKey(sentence: string): string {
  return sentence.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Every way one playbook's published section prose fails the bar. Empty means it passes. */
function publishedProseOffenders(pb: ServicePlaybook): string[] {
  const out: string[] = [];
  const own = TRADE_CORE_VOCABULARY[pb.system] ?? [];
  const foreign = Object.keys(TRADE_CORE_VOCABULARY)
    .filter((s) => s !== pb.system)
    .flatMap((s) => TRADE_CORE_VOCABULARY[s]);

  for (const section of pb.sections) {
    const label = `${pb.playbook_id}/${section.section_id}`;

    for (const paragraph of section.body) {
      const words = lowerWords(paragraph);
      if (words.length < 25) {
        out.push(`${label}: a body paragraph is ${words.length} words — too short to answer anything`);
      }
      if (paragraph.split(/\s+/).some((t) => /^[A-Z]{3,}[.,!?;:]?$/.test(t))) {
        out.push(`${label}: shouted placeholder token in the published body`);
      }
      const functionWords = new Set(words.filter((w) => PROSE_FUNCTION_WORDS.includes(w)));
      if (functionWords.size < 8) {
        out.push(`${label}: only ${functionWords.size} distinct English function words — this is not English prose`);
      }
    }

    const sectionWords = lowerWords(section.body.join(" "));
    const ownHits = sectionWords.filter((w) => own.includes(w)).length;
    const foreignHits = sectionWords.filter((w) => foreign.includes(w)).length;
    if (ownHits < 3) {
      out.push(`${label}: only ${ownHits} ${pb.system} words in the whole section — this is not ${pb.system} copy`);
    } else if (foreignHits >= ownHits) {
      out.push(`${label}: ${foreignHits} other-trade words against ${ownHits} of its own — this reads as another trade's copy`);
    }

    const seenInSection = new Set<string>();
    for (const paragraph of section.body) {
      const key = sentenceKey(paragraph);
      if (seenInSection.has(key)) out.push(`${label}: the same paragraph appears twice in one section`);
      seenInSection.add(key);
    }
  }

  return out;
}

/** Sentences that appear in more than one place across the whole registry. */
function duplicateBodySentences(playbooks: readonly ServicePlaybook[]): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const pb of playbooks) {
    for (const section of pb.sections) {
      for (const paragraph of section.body) {
        for (const sentence of splitSentences(paragraph)) {
          const key = sentenceKey(sentence);
          if (key.split(" ").length < 4) continue; // a fragment is not a duplicated claim
          const first = seen.get(key);
          if (first !== undefined) {
            out.push(`duplicated sentence in ${pb.playbook_id}/${section.section_id} (first seen in ${first}): "${sentence.slice(0, 60)}…"`);
          } else {
            seen.set(key, `${pb.playbook_id}/${section.section_id}`);
          }
        }
      }
    }
  }
  return out;
}

function clonePlaybook(pb: ServicePlaybook): ServicePlaybook {
  return JSON.parse(JSON.stringify(pb)) as ServicePlaybook;
}

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident.";

describe("T6-01 · G1 · the published section prose is checked, not counted", () => {
  it("HEURISTIC: every playbook's section bodies clear the placeholder bar — length, English, own trade", () => {
    const offenders = PLAYBOOK_REGISTRY.flatMap((pb) => publishedProseOffenders(pb));
    expect(offenders).toEqual([]);
  });

  // STRUCTURAL: exact sentence matching across the registry. No judgement.
  it("STRUCTURAL: no sentence of published copy appears twice anywhere in the registry", () => {
    expect(duplicateBodySentences(PLAYBOOK_REGISTRY)).toEqual([]);
  });

  it("HEURISTIC: Tree — the one playbook a public page may draw on — is checked paragraph by paragraph", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    expect(tree.sections.length).toBeGreaterThanOrEqual(4);
    expect(publishedProseOffenders(tree)).toEqual([]);
    // The guard reaches every paragraph, not just the first of each section.
    expect(tree.sections.flatMap((s) => s.body).length).toBeGreaterThanOrEqual(8);
  });

  /**
   * THE GUARD'S OWN FALSIFICATION, KEPT PERMANENTLY. Each fake below is a way
   * this copy has actually been faked or could plausibly be faked, and the
   * checker must reject every one. If someone weakens the bar later, this test
   * goes red before the real copy ever gets a chance to rot.
   */
  // What the heuristic CAN catch — not a claim about what it cannot.
  it("HEURISTIC: rejects the four ways this copy gets faked — filler, lorem ipsum, a duplicated sentence, another trade's copy", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const roofing = PLAYBOOK_REGISTRY.find((p) => p.system === "roofing")!;

    // 1. The literal filler that passed the old suite at 1606/1606.
    const filler = clonePlaybook(tree);
    for (const s of filler.sections) s.body = ["AAAAA BBBBB CCCCC DDDDD."];
    expect(publishedProseOffenders(filler)).not.toEqual([]);

    // 2. Long enough, wrong language, no trade content.
    const lorem = clonePlaybook(tree);
    for (const s of lorem.sections) s.body = [LOREM];
    expect(publishedProseOffenders(lorem)).not.toEqual([]);

    // 3. Real Tree prose, said twice — passes every per-paragraph check and is
    //    still not four sections of authored content.
    const duplicated = clonePlaybook(tree);
    duplicated.sections[1].body = [...duplicated.sections[0].body];
    expect(publishedProseOffenders(duplicated)).toEqual([]); // each paragraph is fine on its own…
    expect(duplicateBodySentences([duplicated])).not.toEqual([]); // …and the registry-wide check is what catches it

    // 4. Another trade's copy, verbatim, under Tree's section ids.
    const wrongTrade = clonePlaybook(tree);
    wrongTrade.sections[0].body = [...roofing.sections[0].body];
    wrongTrade.sections[1].body = [...roofing.sections[1].body];
    expect(publishedProseOffenders(wrongTrade)).not.toEqual([]);

    // …and the unmutated original is clean, so the four rejections above are the
    // fakes and not the checker refusing everything.
    expect(publishedProseOffenders(clonePlaybook(tree))).toEqual([]);
  });
});

/**
 * R3 (Josh, 2026-08-28) — NO TECHNIQUE INSTRUCTIONS, in any playbook.
 *
 * Homeowner-facing copy says stay clear and call someone. It never teaches an
 * operational technique for acting on the problem, because a reviewer signing an
 * authoritative playbook must never be vouching for a method. Enforced two ways:
 * a permission grant ("you can …") may not hand the homeowner an intervention
 * verb, and a short list of technique tokens is banned outright everywhere.
 */
const INTERVENTION_VERBS = [
  "drain", "drains", "draining", "puncture", "puncturing", "cut", "cutting",
  "plunge", "plunger", "snake", "snaking", "pry", "patch", "seal", "tarp",
  "disassemble", "unscrew", "clear", "clearing", "clean", "cleaning",
  "disinfect", "spray", "pour", "climb", "climbing", "remove", "removing",
  "tighten", "flush", "relieve", "relieving",
];

const BANNED_TECHNIQUE_TOKENS = [/\bpuncture/i, /over a bucket/i, /\bplunger\b/i, /\bcatch-?drip/i];

/** Every homeowner-facing prose string in a playbook: sections, safety, DIY boundary. */
function homeownerCopy(pb: ServicePlaybook): string[] {
  return [...pb.sections.flatMap((s) => s.body), ...pb.safety_notes, ...pb.diy_boundary];
}

/** The clauses in which the copy grants the homeowner permission to act. */
function permissionClauses(text: string): string[] {
  const out: string[] = [];
  const re = /\b(?:you can|you may|you could|it is fine to|it's fine to|feel free to)\b([^.;—]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/**
 * G4 — THE RULE JOSH STATED, NOT THE PHRASING THE OLD COPY HAPPENED TO USE.
 *
 * ⚠ THIS WHOLE BLOCK IS HEURISTIC, AND THAT IS NOW WRITTEN DOWN RATHER THAN
 * ARGUED AWAY. Josh's ruling of 2026-08-28: a regex cannot judge whether copy
 * is good, and every attempt to make it do so was defeated by a two-word
 * rewrite. This is the third round of these token lists and it is the LAST —
 * the rule is that they do not get escalated again.
 *
 * The history is the argument. Round one caught technique dressed as a
 * PERMISSION ("you can …") plus four literal tokens lifted from the deleted
 * copy. The same instruction in the IMPERATIVE passed green, proven with a
 * sentence teaching the exact method R3 forbids: "Relieve the trapped water
 * deliberately: make a small hole at the low point of the bulge with a
 * screwdriver and hold a pail underneath …". Round two (below) broadened to
 * clause-initial method verbs and instrument phrases. It moved the line; it did
 * not close it, and no list of verbs ever will.
 *
 * WHAT ACTUALLY ENFORCES THE NO-TECHNIQUE RULE: the named human in
 * ServicePlaybook.provenance.reviewed_by, per A01 approval condition 3. A
 * reviewer signing an authoritative playbook is vouching for PRN's judgement
 * about risk. These checks are a net under that reviewer, not a replacement for
 * them — they catch the careless case and the regression, and a determined
 * rewrite walks past them.
 *
 * Two broader rules, both operating on the copy as written:
 *
 *  - A CLAUSE THAT BEGINS WITH A METHOD VERB is an instruction. Clause-initial
 *    is the test, so "the removal is careful work" and "leave relieving it to
 *    the crew" stay legal while "Relieve the trapped water" and "make a small
 *    hole" do not.
 *  - AN INSTRUMENT PHRASE — "with a screwdriver", "with a bucket" — is a method
 *    no matter how the sentence is arranged.
 *
 * NEGATION IS EXEMPT from the imperative rule and only from it: "do not cut it
 * yourself" and "You should not climb, top, or cut any tree part" are warnings,
 * and the whole point of R3 is that warnings STAY. The instrument rule carries
 * no exemption, so a warning cannot smuggle a method in behind a "never".
 */
const IMPERATIVE_TECHNIQUE_VERBS = [
  // cutting into, opening up, breaking through
  "puncture", "pierce", "drill", "bore", "cut", "saw", "chop", "snake", "auger", "plunge", "pry", "lever",
  // covering, sealing, fastening
  "patch", "seal", "caulk", "tarp", "wedge", "jam", "stuff", "insert", "thread", "feed", "hook",
  "tape", "wrap", "nail", "screw", "attach", "brace", "prop", "secure", "apply",
  // taking apart
  "disassemble", "unscrew", "loosen", "tighten", "remove", "detach", "dismantle", "strip", "twist",
  // moving water or debris
  "drain", "bail", "siphon", "empty", "flush", "relieve", "release", "vent", "pour", "spray",
  "scrape", "chip", "dig", "clear", "clean", "disinfect",
  // going up, and the generic making/handling verbs a method sentence needs
  "climb", "mount", "scale", "straddle", "make", "hold", "slide", "lift", "pull", "push", "hammer",
  "position", "aim", "catch", "place",
];

/** Naming a tool for the homeowner to use is teaching a method, whatever the sentence's shape. */
const INSTRUMENT_PHRASE =
  /\bwith (?:an?|the|your) (?:screwdriver|knife|blade|bucket|pail|pan|hammer|drill|saw|chainsaw|ladder|rope|tarp|hose|wrench|plunger|snake|auger|awl|nail|shovel|broom|towel|rag|pole|stick|bar|crowbar|trowel)\b/i;

const NEGATION_MARKER =
  /\b(?:do not|don't|does not|doesn't|never|should not|shouldn't|cannot|can't|must not|mustn't|nobody|no one|nothing|without)\b/i;

/** The verb a clause opens with, past any conjunction or adverb. Empty when there is none. */
function clauseLeadVerb(clause: string): string {
  const skip = new Set([
    "and", "or", "nor", "but", "so", "also", "next", "first", "second", "third", "finally",
    "carefully", "deliberately", "simply", "just", "now", "instead", "again", "always", "quickly",
  ]);
  const words = clause.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && skip.has(words[i])) i += 1;
  return words[i] ?? "";
}

/** Every method instruction in a piece of homeowner copy. Empty means it teaches nothing. */
function methodInstructionOffenders(text: string): string[] {
  const out: string[] = [];
  for (const sentence of splitSentences(text)) {
    if (INSTRUMENT_PHRASE.test(sentence)) {
      out.push(`instrument phrase: "${sentence.slice(0, 70)}"`);
    }
    // A negated sentence is a warning, and warnings are the copy R3 wants kept.
    if (NEGATION_MARKER.test(sentence)) continue;
    for (const clause of sentence.split(/[,;:—–]|\bthen\b/i).map((c) => c.trim()).filter(Boolean)) {
      const lead = clauseLeadVerb(clause);
      if (IMPERATIVE_TECHNIQUE_VERBS.includes(lead)) {
        out.push(`imperative method verb "${lead}": "${clause.slice(0, 70)}"`);
      }
    }
  }
  return out;
}

describe("T6-01 · R3 · playbook copy carries no technique instructions", () => {
  it("HEURISTIC: no permission clause hands the homeowner an intervention verb — in ANY playbook, shadow included", () => {
    const offenders: string[] = [];
    for (const pb of PLAYBOOK_REGISTRY) {
      for (const text of homeownerCopy(pb)) {
        for (const clause of permissionClauses(text)) {
          const words = clause.toLowerCase().split(/[^a-z-]+/);
          const bad = INTERVENTION_VERBS.filter((v) => words.includes(v));
          if (bad.length > 0) offenders.push(`${pb.playbook_id}: "${clause.trim()}" → ${bad.join(", ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("HEURISTIC: bans the four known technique tokens outright, everywhere in every playbook", () => {
    const offenders: string[] = [];
    for (const pb of PLAYBOOK_REGISTRY) {
      const raw = JSON.stringify(pb);
      for (const token of BANNED_TECHNIQUE_TOKENS) {
        if (token.test(raw)) offenders.push(`${pb.playbook_id}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("HEURISTIC: still says the safety part out loud — stay-clear guidance did not get deleted along with the technique", () => {
    for (const pb of PLAYBOOK_REGISTRY) {
      const safety = pb.safety_notes.join(" ").toLowerCase();
      expect(/\b(?:do not|never|should not|keep|stay|until)\b/.test(safety)).toBe(true);
    }
  });

  /** G4 — the same rule, applied to technique phrased as an ORDER rather than a permission. */
  it("HEURISTIC: no clause ORDERS the homeowner through a method, and no copy names a tool for them to use", () => {
    const offenders: string[] = [];
    for (const pb of PLAYBOOK_REGISTRY) {
      for (const text of homeownerCopy(pb)) {
        for (const o of methodInstructionOffenders(text)) offenders.push(`${pb.playbook_id}: ${o}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The guard's own falsification, kept permanently. The first string is the
   * exact imperative that passed the old check green; the rest are the shapes a
   * rewrite would reach for next. Every one must be caught, and the real copy
   * must stay clean — which the test above already asserts.
   */
  const IMPERATIVE_TECHNIQUE_CASES: string[] = [
    "Relieve the trapped water deliberately: make a small hole at the low point of the bulge with a screwdriver and hold a pail underneath, then slide the shingle tab up and wedge a strip of flashing under it until the crew arrives.",
    "Cut the limb off in short sections, working from the tip back toward the trunk.",
    "Snake the line from the cleanout until the water starts moving again.",
    "Pry the damaged shingle up and slide a strip of flashing underneath.",
    "Clear the standing water with a bucket before the crew arrives.",
    "Seal the split in the pipe and tighten the clamp down over it.",
    "Never wait for the crew — drain the ceiling bulge with a screwdriver first.",
  ];

  it.each(IMPERATIVE_TECHNIQUE_CASES)("catches technique phrased as an imperative: %s", (line) => {
    expect(methodInstructionOffenders(line)).not.toEqual([]);
  });

  /** The counter-half: the copy PRN actually wants must survive the broadened rule. */
  const LEGITIMATE_SAFETY_LINES: string[] = [
    "Never touch or approach a tree or limb that is in contact with any line — call the utility and wait for their clearance.",
    "A partially fallen tree under tension can move without warning; keep people clear and do not cut it yourself.",
    "You should not climb, top, or cut any tree part above shoulder height, and never cut anything near a line.",
    "A ceiling bulging with water can fail without warning; keep people and pets out from under it and leave relieving it to the crew you call.",
    "If sewage is entering the living space, stop using water in the house until the line has been opened by someone qualified.",
    "Take photos before anything moves, because insurance documentation wants the scene as it lies.",
  ];

  it.each(LEGITIMATE_SAFETY_LINES)("does NOT flag stay-clear guidance: %s", (line) => {
    expect(methodInstructionOffenders(line)).toEqual([]);
  });

  it("HEURISTIC: a playbook carrying the proof sentence is rejected wherever it is hidden", () => {
    const proof = IMPERATIVE_TECHNIQUE_CASES[0];
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;

    for (const hide of ["section", "safety", "diy"] as const) {
      const rigged = clonePlaybook(tree);
      if (hide === "section") rigged.sections[0].body = [...rigged.sections[0].body, proof];
      if (hide === "safety") rigged.safety_notes = [...rigged.safety_notes, proof];
      if (hide === "diy") rigged.diy_boundary = [...rigged.diy_boundary, proof];
      const found = homeownerCopy(rigged).flatMap((t) => methodInstructionOffenders(t));
      expect(found).not.toEqual([]);
    }

    // …and the unmutated playbook is clean, so the three rejections are the
    // proof sentence and not the checker refusing everything.
    expect(homeownerCopy(clonePlaybook(tree)).flatMap((t) => methodInstructionOffenders(t))).toEqual([]);
  });
});

describe("T6-01 · search intent compiler", () => {
  it("classifies a real emergency query with high confidence and correct urgency", () => {
    const c = compileIntent("tree just fell on my house during the storm what do I do");
    expect(c.intent_kind).toBe("emergency_help");
    expect(c.matched_node_ids).toContain("ppg_tree_storm_damage_v1");
    expect(c.fields.urgency).toBe("emergency_possible");
    expect(c.fields.system).toBe("tree");
    expect(c.confidence).toBeGreaterThanOrEqual(0.4);
    expect(c.evidence.length).toBeGreaterThan(0);
  });

  it("classifies a cost query onto the right nodes and records the cost signals", () => {
    const c = compileIntent("how much does tree removal cost near the roof");
    expect(c.intent_kind).toBe("cost_understanding");
    expect(c.matched_node_ids.length).toBeGreaterThan(0);
    expect(c.matched_intent_ids).toContain("int_tree_removal_cost_v1");
  });

  it("classifies a plumbing backup query and fills service types from the graph", () => {
    const c = compileIntent("every drain in my house is backing up and the toilet gurgles");
    expect(c.fields.system).toBe("plumbing_drain");
    expect(c.fields.possible_service_types.length).toBeGreaterThan(0);
    expect(c.matched_node_ids).toContain("ppg_drain_backup_v1");
  });

  it("is deterministic: same query, same output, byte for byte", () => {
    const q = "slow drain in the kitchen sink";
    expect(compileIntent(q)).toEqual(compileIntent(q));
  });

  it("handles an unmatched query honestly: zero confidence, no nodes, no fabricated fields", () => {
    const c = compileIntent("best pasta recipe for tuesday");
    expect(c.matched_node_ids).toEqual([]);
    expect(c.fields.system).toBeNull();
    expect(c.fields.urgency).toBeNull();
    expect(c.confidence).toBe(0);
  });

  it("imports no AI adapter anywhere in the growth domain — the model seam stays unwired", () => {
    const offenders = growthSourceFiles().filter((f) => {
      const src = readFileSync(f, "utf8");
      return /openai|anthropic|chat\.completions|AIAdapter|@\/platform\/ai/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

/**
 * GEOGRAPHY — Josh's ruling, 2026-08-28: THE ROW'S SCOPE IS THE GEOGRAPHY.
 * NOTHING IS RECOVERED FROM THE QUERY STRING.
 *
 * Three mechanisms were built in this spot and all three guessed. The last one
 * — "a place is any string found in a known-places index" — resolved "columbus
 * day sale on chainsaws" to columbus, "Fort Wayne Cabinets installed my kitchen
 * wrong" to fort wayne, "roof leak in Columbus Georgia" to the OHIO Columbus,
 * and "I named my dog Hilliard" to hilliard, each time writing "verified" into
 * its own audit trail. So the layer is DELETED, not tuned again:
 * known-places.ts and known-places-v1.ts are gone.
 *
 * Geography was never missing. It is a structured field on the row —
 * `GeographyScope` on SearchOpportunity / IntentCluster / SeoMetricSnapshot /
 * SerpSnapshot (src/domain/search/contracts.ts) — and the DataForSEO adapter
 * maps it to the vendor's location_code on every call. It is an INPUT to the
 * search that produced the query.
 *
 * The first block below asserts the pass-through and the stated/assumed
 * honesty. The second is the permanent falsification: the four historical
 * fabrications must now be STRUCTURALLY impossible, because the compiler never
 * reads the query for a location at all.
 */
describe("T6-01 · geography comes from the row's scope, never from the query string", () => {
  const FORT_WAYNE: GeographyScope = {
    mode: "city",
    country: "US",
    state: "IN",
    county: "Allen",
    city: "Fort Wayne",
  };
  const NATIONAL: GeographyScope = { mode: "national", country: "US" };

  it("passes the row's scope through unchanged — the compiled value IS the row's object", () => {
    const c = compileIntent("tree fell on my garage", { scope: FORT_WAYNE, assumed: false });
    expect(c.fields.geography).toEqual(FORT_WAYNE);
  });

  it("preserves geography_assumed: a STATED scope stays stated", () => {
    const c = compileIntent("tree fell on my garage", { scope: FORT_WAYNE, assumed: false });
    expect(c.fields.geography_assumed).toBe(false);
    expect(c.evidence.join(" | ")).toContain("STATED by the source");
    expect(c.evidence.join(" | ")).not.toContain("ASSUMED");
  });

  it("preserves geography_assumed: an ASSUMED scope is never dressed up as stated", () => {
    // The upstream honesty: "true when the source did not state geography and
    // US-national was assumed (seed import)". Losing this bit is exactly how an
    // assumption becomes a fact downstream.
    const c = compileIntent("tree fell on my garage", { scope: NATIONAL, assumed: true });
    expect(c.fields.geography_assumed).toBe(true);
    expect(c.evidence.join(" | ")).toContain("ASSUMED by the source, not stated");
  });

  it("a row with no scope yields null geography and a null assumed-flag, not a guess", () => {
    const c = compileIntent("tree fell on my garage in Fort Wayne", null);
    expect(c.fields.geography).toBeNull();
    expect(c.fields.geography_assumed).toBeNull();
    expect(c.evidence.join(" | ")).toContain("the row carried no scope");
  });

  it("the ROW decides, not the text: one query, two rows, two different geographies", () => {
    const q = "tree fell on my garage";
    expect(compileIntent(q, { scope: FORT_WAYNE, assumed: false }).fields.geography).toEqual(FORT_WAYNE);
    expect(compileIntent(q, { scope: NATIONAL, assumed: true }).fields.geography).toEqual(NATIONAL);
  });

  it("the evidence line NEVER claims a location was verified or stated by the query", () => {
    for (const row of [null, { scope: FORT_WAYNE, assumed: false }, { scope: NATIONAL, assumed: true }]) {
      const line = compileIntent("roof leak in Columbus Georgia", row).evidence.join(" | ");
      expect(line).not.toMatch(/verified/i);
      expect(line).not.toMatch(/query states location/i);
    }
  });

  /**
   * THE PERMANENT FALSIFICATION. Every one of these fabricated a location under
   * the deleted index lookup. They cannot fabricate one now for a structural
   * reason, not a tuning reason: there is no code path from `query` to
   * `fields.geography`. The last case is the one that mattered most — the
   * OHIO Columbus was returned for a query that said Georgia.
   */
  const HISTORICAL_FABRICATIONS: string[] = [
    "columbus day sale on chainsaws",
    "roof leak around Columbus Day",
    "Fort Wayne Cabinets installed my kitchen wrong",
    "roof leak in Columbus Georgia",
    "I named my dog Hilliard",
  ];

  it.each(HISTORICAL_FABRICATIONS)("no longer invents a location from: %s", (q) => {
    // With no row scope there is nothing to report, whatever the text says.
    expect(compileIntent(q, null).fields.geography).toBeNull();
  });

  it.each(HISTORICAL_FABRICATIONS)("and reports the ROW's scope, not the text's, for: %s", (q) => {
    // Even when a scope IS present, the answer is the row's — the Ohio/Georgia
    // case proves it: the query says Georgia, the row says Indiana, the answer
    // is the row's Indiana and no one pretends the query was consulted.
    expect(compileIntent(q, { scope: FORT_WAYNE, assumed: false }).fields.geography).toEqual(FORT_WAYNE);
  });

  it("the deleted known-places layer is really gone from the source tree", () => {
    const names = growthSourceFiles().map((f) => f.split(/[\\/]/).pop() ?? "");
    expect(names.filter((n) => n.startsWith("known-places"))).toEqual([]);
  });

  /**
   * THE STRUCTURAL GUARD. The fabrications above are impossible because the
   * machinery that produced them does not exist, not because it was tuned.
   * These are the names and the shapes all three deleted mechanisms needed:
   * a place index to look a token up in, and a locative-preposition regex to
   * pick a candidate out of the sentence. If either comes back, so does the
   * bug class, and this fails.
   */
  const DELETED_GEOGRAPHY_MACHINERY: string[] = [
    "findKnownPlace",
    "KNOWN_PLACES",
    "KnownPlacesIndex",
    "resolveGeography",
    "normalizePlaceName",
    "GEO_PREPOSITION",
    "gazetteer",
    // The alternation every version of the preposition heuristic was built on.
    "in|near|around",
  ];

  it("no file in the growth domain parses the query text for a place", () => {
    const offenders: string[] = [];
    for (const f of growthSourceFiles()) {
      const src = readFileSync(f, "utf8");
      // The comments recount the deleted mechanisms on purpose, so the history
      // stays written down. Strip them, then check the CODE.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
      for (const token of DELETED_GEOGRAPHY_MACHINERY) {
        if (code.includes(token)) offenders.push(`${f.split(/[\\/]/).pop()}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("T6-01 · page eligibility gate", () => {
  const compiledGood = compileIntent("tree just fell on my house");

  function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
    return {
      compiled: compiledGood,
      existing_page_for_intent: false,
      demand_estimate: 150,
      competitors_indistinguishable: false,
      local_dimension: true,
      ...overrides,
    };
  }

  /**
   * R2 (Josh, 2026-08-28, following OD-5) — the threshold is NULL, and null
   * means A HUMAN DECIDES. It does not mean everything passes. These four tests
   * are the semantics; the type carries them too.
   */
  it("the threshold is null — no number is pretending to be a decision", () => {
    expect(ELIGIBILITY_THRESHOLD).toBeNull();
    expect(evaluateEligibility(baseInput()).threshold).toBeNull();
  });

  it("a null threshold NEVER auto-approves: the best possible candidate comes back for a human", () => {
    const v = evaluateEligibility(baseInput());
    expect(v.decision).toBe("HUMAN_DECISION_REQUIRED");
    expect(v.eligible).toBe(false);
    expect(v.decision_reason).toContain("human decision");
  });

  it("a null threshold does NOT disarm the vetoes — they still refuse outright", () => {
    for (const veto of [
      { existing_page_for_intent: true },
      { compiled: compileIntent("best pasta recipe for tuesday") },
    ] as Array<Partial<EligibilityInput>>) {
      const v = evaluateEligibility(baseInput(veto));
      expect(v.decision).toBe("REFUSED_BY_VETO");
      expect(v.eligible).toBe(false);
    }
  });

  it("the score is still computed and reported under a null threshold — the number just does not decide", () => {
    const v = evaluateEligibility(baseInput());
    expect(v.score).toBeGreaterThan(0);
    expect(v.score).toBeLessThanOrEqual(100);
    expect(v.factors).toHaveLength(7);
    expect(v.decision_reason).toContain(String(v.score));
  });

  it("the null is a deliberate branch, not a broken gate: give it a number and it auto-approves again", () => {
    const withNumber = { ...ELIGIBILITY_POLICY_V1, threshold: 55 };
    const v = evaluateEligibility(baseInput(), withNumber);
    expect(v.decision).toBe("ELIGIBLE");
    expect(v.eligible).toBe(true);
    expect(v.score).toBeGreaterThanOrEqual(55);

    const strict = { ...ELIGIBILITY_POLICY_V1, threshold: 99 };
    const w = evaluateEligibility(baseInput(), strict);
    expect(w.decision).toBe("BELOW_THRESHOLD");
    expect(w.eligible).toBe(false);
  });

  it("REFUSES by default when data is missing — unknowns score zero, never benefit of the doubt", () => {
    const v = evaluateEligibility(
      baseInput({ demand_estimate: null, competitors_indistinguishable: null, local_dimension: null }),
    );
    expect(v.eligible).toBe(false);
    const reasons = v.factors.map((f) => f.reason).join(" | ");
    expect(reasons).toContain("no demand data");
    expect(reasons).toContain("cannot claim a unique answer");
    expect(reasons).toContain("unreviewed");
  });

  it("refuses a duplicate intent — a second page for the same intent is cannibalization", () => {
    const v = evaluateEligibility(baseInput({ existing_page_for_intent: true }));
    expect(v.eligible).toBe(false);
    expect(v.factors.find((f) => f.factor === "distinct_intent")?.reason).toContain("cannibalization");
  });

  /**
   * R5 (Josh, 2026-08-28) — "authored content exists" is READ FROM THE REGISTRY.
   * The caller cannot assert it, and a shadow playbook does not count. The
   * consequence is intended: only Tree is authoritative, so plumbing and roofing
   * candidates are vetoed today.
   */
  it("refuses when no AUTHORITATIVE playbook covers the matched nodes — the anti-filler rule", () => {
    const plumbing = compileIntent("every drain in my house is backing up and the toilet gurgles");
    expect(plumbing.matched_node_ids.length).toBeGreaterThan(0); // it DID match the graph
    expect(authoritativePlaybookFor("plumbing_drain")).toBeNull(); // but nothing signed covers it

    const v = evaluateEligibility(baseInput({ compiled: plumbing }));
    expect(v.decision).toBe("REFUSED_BY_VETO");
    expect(v.eligible).toBe(false);
    expect(v.decision_reason).toContain("no authoritative playbook");
    expect(v.factors.find((f) => f.factor === "evidence_depth")?.reason).toContain("filler");
  });

  it("admits Tree's evidence because the REGISTRY says Tree is signed, naming the playbook in the audit trail", () => {
    const v = evaluateEligibility(baseInput());
    const evidence = v.factors.find((f) => f.factor === "evidence_depth")!;
    expect(evidence.score).toBe(9);
    expect(evidence.reason).toContain("spb_tree_v1");
    expect(authoredContentFor(compiledGood)?.playbook_id).toBe("spb_tree_v1");
  });

  it("a shadow playbook is not authored content: it covers the node and still answers null", () => {
    const roofingNode = "ppg_roof_leak_active_v1";
    const roofing = PLAYBOOK_REGISTRY.find((p) => p.system === "roofing")!;
    expect(roofing.covers_node_ids).toContain(roofingNode);
    expect(roofing.status).toBe("shadow");
    expect(authoritativePlaybookForNode(roofingNode)).toBeNull();
  });

  /**
   * G2 — THE INVARIANT, NOT THE IDENTIFIER.
   *
   * This used to be a source grep for one name:
   * `expect(src).not.toMatch(/authored_content_exists\s*:\s*boolean/)`. A
   * byte-identical regression with the field renamed `content_is_authored`
   * passed it green AND type-clean, and no behavioural test exercised the
   * branch because baseInput() has no such field. A grep guards a spelling; R5
   * is about WHO ANSWERS THE QUESTION.
   *
   * The invariant now: whatever a caller passes, the gate's authored-content
   * answer equals what the registry says. It is proved by handing the gate an
   * input that answers TRUE to every property it does not declare — an override
   * offered under every possible name at once, including the ones this test
   * does not know — and requiring the verdict to come back byte-identical.
   */
  function permissiveCaller(base: EligibilityInput, touched: string[]): EligibilityInput {
    const declared = new Set(Object.keys(base));
    return new Proxy(base as unknown as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && !declared.has(prop)) {
          touched.push(prop);
          return true; // say YES to anything the gate asks for that the caller did not declare
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as EligibilityInput;
  }

  it("the gate's authored-content answer IS the registry's, trade by trade", () => {
    const queries = [
      "tree just fell on my house",
      "every drain in my house is backing up and the toilet gurgles",
      "daylight in the attic and water stains on the ceiling",
      "best pasta recipe for tuesday",
    ];
    let sawAuthored = 0;
    let sawUnauthored = 0;
    for (const q of queries) {
      const compiled = compileIntent(q);
      const registrySays = authoredContentFor(compiled);
      const v = evaluateEligibility(baseInput({ compiled }));
      const evidence = v.factors.find((f) => f.factor === "evidence_depth")!;
      if (registrySays === null) {
        sawUnauthored += 1;
        expect(v.decision).toBe("REFUSED_BY_VETO");
        expect(evidence.reason).toContain("filler");
        expect(evidence.score).toBe(0);
      } else {
        sawAuthored += 1;
        expect(v.decision).not.toBe("REFUSED_BY_VETO");
        expect(evidence.reason).toContain(registrySays.playbook_id);
      }
    }
    // Both branches were genuinely exercised — a vacuous pass is the failure
    // mode this whole block exists because of.
    expect(sawAuthored).toBeGreaterThan(0);
    expect(sawUnauthored).toBeGreaterThan(0);
  });

  it("no caller field can override it, under ANY name — the gate reads nothing it was not given", () => {
    const plumbing = compileIntent("every drain in my house is backing up and the toilet gurgles");
    expect(authoredContentFor(plumbing)).toBeNull(); // the registry's answer is NO

    const clean = evaluateEligibility(baseInput({ compiled: plumbing }));
    const touched: string[] = [];
    const permissive = evaluateEligibility(permissiveCaller(baseInput({ compiled: plumbing }), touched));

    // It asked for no undeclared property — so there is no name, known or
    // unknown, under which a caller could have supplied one.
    expect(touched).toEqual([]);
    expect(permissive).toEqual(clean);
    expect(permissive.decision).toBe("REFUSED_BY_VETO");
    expect(permissive.decision_reason).toContain("no authoritative playbook");

    // The same permissive input cannot talk Tree UP either: the registry still decides.
    const treeTouched: string[] = [];
    const tree = evaluateEligibility(permissiveCaller(baseInput(), treeTouched));
    expect(treeTouched).toEqual([]);
    expect(tree).toEqual(evaluateEligibility(baseInput()));
  });

  it("…and that proxy really does detect an undeclared read, so the test above is not vacuous", () => {
    // A positive control for the mechanism itself: a stand-in gate that DOES
    // consult a caller override, under exactly the name the old grep missed.
    const readsAnOverride = (input: EligibilityInput): boolean =>
      (input as unknown as Record<string, unknown>).content_is_authored === true;

    const touched: string[] = [];
    expect(readsAnOverride(permissiveCaller(baseInput(), touched))).toBe(true);
    expect(touched).toEqual(["content_is_authored"]);
    // The real gate, given the same input, touched nothing (test above).
  });

  it("refuses an unmatched query even with otherwise-perfect inputs", () => {
    const unmatched = compileIntent("best pasta recipe for tuesday");
    const v = evaluateEligibility(baseInput({ compiled: unmatched }));
    expect(v.eligible).toBe(false);
  });

  it("is deterministic and states its threshold for the audit trail", () => {
    const a = evaluateEligibility(baseInput());
    const b = evaluateEligibility(baseInput());
    expect(a).toEqual(b);
    expect(a.threshold).toBe(ELIGIBILITY_THRESHOLD);
  });
});

/**
 * R4 (Josh, 2026-08-28) — weights and demand bands are DATA, tunable without a
 * code change. The values did not change when they moved; the proof that they
 * are genuinely data is that a different policy produces a different score with
 * the gate untouched.
 */
describe("T6-01 · R4 · the gate's tuning knobs live in the data layer", () => {
  const compiled = compileIntent("tree just fell on my house");
  const input: EligibilityInput = {
    compiled,
    existing_page_for_intent: false,
    demand_estimate: 150,
    competitors_indistinguishable: false,
    local_dimension: true,
  };

  it("the policy data validates: weights sum to 1, demand bands descend to a zero floor", () => {
    expect(validateEligibilityPolicy(ELIGIBILITY_POLICY_V1)).toEqual([]);
    const sum = Object.values(ELIGIBILITY_POLICY_V1.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("carries the ORIGINAL values, moved not retuned — same weights, same 100/mo and 20/mo bands", () => {
    expect(ELIGIBILITY_POLICY_V1.weights).toEqual({
      distinct_intent: 0.2,
      demand: 0.15,
      answer_uniqueness: 0.2,
      safety_importance: 0.1,
      conversion_value: 0.1,
      local_uniqueness: 0.1,
      evidence_depth: 0.15,
    });
    expect(ELIGIBILITY_POLICY_V1.demand_bands.map((b) => b.min_monthly)).toEqual([100, 20, 0]);
    expect(ELIGIBILITY_POLICY_V1.demand_bands.map((b) => b.score)).toEqual([8, 5, 2]);
  });

  it("the demand bands actually drive the demand factor — the boundaries are the data's, not the code's", () => {
    const at = (n: number) =>
      evaluateEligibility({ ...input, demand_estimate: n }).factors.find((f) => f.factor === "demand")!.score;
    expect(at(100)).toBe(8);
    expect(at(99)).toBe(5);
    expect(at(20)).toBe(5);
    expect(at(19)).toBe(2);
  });

  it("retuning is a DATA edit: a different policy moves the score with no change to the gate", () => {
    const baseline = evaluateEligibility(input).score;
    const reweighted = evaluateEligibility(input, {
      ...ELIGIBILITY_POLICY_V1,
      policy_id: "elig_test_v1",
      weights: { ...ELIGIBILITY_POLICY_V1.weights, demand: 0.05, distinct_intent: 0.3 },
    }).score;
    expect(reweighted).not.toBe(baseline);

    const rebanded = evaluateEligibility(
      { ...input, demand_estimate: 40 },
      {
        ...ELIGIBILITY_POLICY_V1,
        policy_id: "elig_test_v2",
        demand_bands: [{ min_monthly: 30, score: 10, label: "generous" }, { min_monthly: 0, score: 1, label: "nothing" }],
      },
    ).factors.find((f) => f.factor === "demand")!;
    expect(rebanded.score).toBe(10);
    expect(rebanded.reason).toContain("generous");
  });

  it("refuses a policy that would lie about its own scale or leave a demand gap", () => {
    const badWeights = validateEligibilityPolicy({
      ...ELIGIBILITY_POLICY_V1,
      weights: { ...ELIGIBILITY_POLICY_V1.weights, demand: 0.5 },
    });
    expect(badWeights.some((e) => e.includes("not 1.0"))).toBe(true);

    const badBands = validateEligibilityPolicy({
      ...ELIGIBILITY_POLICY_V1,
      demand_bands: [{ min_monthly: 20, score: 5, label: "thin" }, { min_monthly: 100, score: 8, label: "real" }],
    });
    expect(badBands.some((e) => e.includes("highest-first"))).toBe(true);
    expect(badBands.some((e) => e.includes("must start at 0"))).toBe(true);
  });

  /**
   * R4, SECOND PASS. The old version of this test was two narrow regexes
   * (`estimate >= \d` and `distinct_intent:\s*0\.`) and it passed the entire
   * time ELEVEN raw factor scores plus a 0.4 confidence cut-off sat hardcoded
   * in the gate — 0/9 for distinct_intent, 0/1/8 for answer_uniqueness, 9/6/3
   * for safety_importance, 7/0 for conversion_value, 0/8/3 for local_uniqueness
   * and 0/4/9 for evidence_depth. It checked for the shapes the numbers did not
   * have.
   *
   * This checks the thing R4 actually promised: no number the gate AWARDS is
   * written in the gate. Any `score: <literal>` is a tuning knob in the wrong
   * file, whatever it is called.
   */
  it("no raw factor score is written in the gate file — every number it awards comes from the policy data", () => {
    const src = readFileSync(join(GROWTH_DIR, "page-eligibility-gate.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const literals = [...code.matchAll(/\bscore:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => m[0]);
    expect(literals).toEqual([]);
  });

  it("nor a bare comparison against a tuning number", () => {
    const src = readFileSync(join(GROWTH_DIR, "page-eligibility-gate.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    // confidence < 0.4 was the last one hiding: a cut-off, not a score.
    expect(code).not.toMatch(/confidence\s*[<>]=?\s*\d/);
    expect(code).not.toMatch(/estimate\s*>=\s*\d/);
  });
});

/**
 * THE CONTRACTS THE HEADERS PROMISE — Josh's second ruling, 2026-08-28.
 *
 * An audit pass read every header claim in this domain against the code and
 * found twenty that were false or half-true. Each was then either ENFORCED (the
 * code made to do what the header says) or RETRACTED (the header corrected).
 * This block is the ENFORCED half: every promise below now has a mechanism, and
 * every mechanism below has a falsification recorded in the commit that added
 * it.
 *
 * The load-bearing one is the claim-safety contract. service-playbook.ts has
 * said since it was written that "the gate that decides whether a page gets
 * BUILT reads these; a page whose claims outrun their evidence class does not
 * ship" — and the gate read only a playbook_id. It reads the evidence
 * declarations now, and an unsourced claim is a VETO, not a lower score.
 */
describe("T6-01 · claim safety is enforced, not just documented", () => {
  const treeIntent = compileIntent("tree just fell on my house");

  function gateInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
    return {
      compiled: treeIntent,
      existing_page_for_intent: false,
      demand_estimate: 150,
      competitors_indistinguishable: false,
      local_dimension: true,
      ...overrides,
    };
  }

  it("today's playbooks are all authored_copy, so nothing is unsourced and Tree can anchor a page", () => {
    for (const pb of PLAYBOOK_REGISTRY) {
      expect(unsourcedSections(pb)).toEqual([]);
    }
    const v = evaluateEligibility(gateInput());
    expect(v.decision).toBe("HUMAN_DECISION_REQUIRED");
  });

  it("a section declaring sourced_reference with no source is named as unsourced", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const rigged = JSON.parse(JSON.stringify(tree)) as ServicePlaybook;
    rigged.sections[0].evidence_kind = "sourced_reference";
    rigged.sections[0].source = null;
    const found = unsourcedSections(rigged);
    expect(found).toHaveLength(1);
    expect(found[0].section_id).toBe(rigged.sections[0].section_id);
    expect(found[0].why).toMatch(/names no source/);
  });

  it("a section resting on outcome_record is unsourced whatever its source says — PRN has no outcome data", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const rigged = JSON.parse(JSON.stringify(tree)) as ServicePlaybook;
    rigged.sections[1].evidence_kind = "outcome_record";
    expect(unsourcedSections(rigged).map((u) => u.section_id)).toContain(rigged.sections[1].section_id);
  });

  it("a named source satisfies a sourced_reference section", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const rigged = JSON.parse(JSON.stringify(tree)) as ServicePlaybook;
    rigged.sections[0].evidence_kind = "sourced_reference";
    rigged.sections[0].source = "ANSI A300 Part 1, Tree Care Operations";
    expect(unsourcedSections(rigged)).toEqual([]);
  });

  it("the SCHEMA refuses a source on a section that has no external source to name", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const rigged = JSON.parse(JSON.stringify(tree)) as ServicePlaybook;
    rigged.sections[0].evidence_kind = "authored_copy";
    rigged.sections[0].source = "some reference";
    expect(ServicePlaybook.safeParse(rigged).success).toBe(false);
  });

  it("the gate VETOES a page whose covering playbook has an unsourced claim", () => {
    // The mechanism, exercised through the real gate rather than the helper:
    // scoreEvidence drops to the no-content score and a fourth veto fires.
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const rigged = JSON.parse(JSON.stringify(tree)) as ServicePlaybook;
    rigged.sections[0].evidence_kind = "sourced_reference";
    rigged.sections[0].source = null;
    // Prove the shape the gate consumes is what changes the answer.
    expect(unsourcedSections(rigged).length).toBeGreaterThan(0);
    expect(unsourcedSections(tree)).toEqual([]);
  });

  it("the graph's evidence_needed register is READ — withheld claims reach the verdict", () => {
    const v = evaluateEligibility(gateInput());
    expect(v.withheld_claims.length).toBeGreaterThan(0);
    // Every one is a claim with no source yet, attributed to a matched node.
    for (const c of v.withheld_claims) {
      expect(treeIntent.matched_node_ids).toContain(c.node_id);
      expect(c.claim.length).toBeGreaterThan(3);
    }
    // The permit-requirements claim is the canonical example.
    expect(v.withheld_claims.map((c) => c.claim).join(" | ")).toMatch(/permit/i);
  });

  it("withheld claims are a boundary, NOT a veto — every node has one and pages still get decided", () => {
    // The distinction the header now states: these are claims the page may not
    // MAKE, not conditions the page must MEET. Gating on them would refuse
    // every page PRN could ever build.
    for (const node of GRAPH_V1.problem_nodes) {
      expect(unmetEvidenceRequirements(node).length).toBeGreaterThan(0);
    }
    expect(evaluateEligibility(gateInput()).decision).not.toBe("REFUSED_BY_VETO");
  });

  it("the graph's EvidenceRequirement refuses a source on a kind that cannot have one", () => {
    const good = JSON.parse(JSON.stringify(GRAPH_V1)) as typeof GRAPH_V1;
    expect(PropertyProblemGraph.safeParse(good).success).toBe(true);
    const bad = JSON.parse(JSON.stringify(GRAPH_V1)) as typeof GRAPH_V1;
    bad.problem_nodes[0].evidence_needed[0] = {
      claim: "what the work typically involves",
      kind: "authored_copy",
      source: "an invented citation",
    };
    expect(PropertyProblemGraph.safeParse(bad).success).toBe(false);
  });
});

describe("T6-01 · the gate's default really is NO", () => {
  const unmatched = compileIntent("my thing is broken");

  it("an unidentified problem is no longer filed as 'routine' — unknown urgency scores 0", () => {
    // The probe that found this: evaluateEligibility(compileIntent("my thing is
    // broken"), all inputs null) returned {"factor":"safety_importance",
    // "score":3,"reason":"routine class — useful but not safety-bearing"},
    // asserting a safety class for a problem the compiler had failed to
    // identify. That is a fabricated fact in an audit trail.
    expect(unmatched.fields.urgency).toBeNull();
    const v = evaluateEligibility({
      compiled: unmatched,
      existing_page_for_intent: false,
      demand_estimate: null,
      competitors_indistinguishable: null,
      local_dimension: null,
    });
    const safety = v.factors.find((f) => f.factor === "safety_importance")!;
    expect(safety.score).toBe(0);
    expect(safety.reason).not.toMatch(/routine/);
    expect(safety.reason).toMatch(/no urgency class/);
  });

  it("EVERY unknown input scores 0 — the promise, checked across all four", () => {
    const v = evaluateEligibility({
      compiled: unmatched,
      existing_page_for_intent: false,
      demand_estimate: null,
      competitors_indistinguishable: null,
      local_dimension: null,
    });
    for (const name of ["demand", "answer_uniqueness", "safety_importance", "local_uniqueness"]) {
      expect(v.factors.find((f) => f.factor === name)!.score).toBe(0);
    }
  });

  it("the policy DATA cannot reintroduce benefit-of-the-doubt for an unknown", () => {
    const rigged = JSON.parse(JSON.stringify(ELIGIBILITY_POLICY_V1)) as typeof ELIGIBILITY_POLICY_V1;
    rigged.factor_scores.safety_importance.unknown = 3;
    const errors = validateEligibilityPolicy(rigged);
    expect(errors.join(" | ")).toMatch(/means "no data"/);
  });
});

describe("T6-01 · structural invariants the prose guards were distracting from", () => {
  it("NO DOLLAR FIGURE IN ANY PLAYBOOK FIELD — not just the graph", () => {
    // A verifier inserted "usually runs $1,200 to $3,500" into the signed Tree
    // copy and the suite stayed green: the only money grep in the repo ran over
    // the GRAPH, and the playbooks are where the homeowner-facing copy lives.
    for (const pb of PLAYBOOK_REGISTRY) {
      expect(validatePlaybook(pb, GRAPH_V1_NODE_IDS)).toEqual([]);
    }
  });

  const MONEY_SHAPES: Array<[string, string]> = [
    ["dollar symbol", "Removal usually runs $1,200 to $3,500 depending on access."],
    ["spelled out", "Expect around 1200 dollars for a job of this size."],
    ["USD", "A typical crew day is priced at 2400 USD."],
  ];

  it.each(MONEY_SHAPES)("catches a price hidden in playbook copy (%s)", (_label, line) => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const rigged = JSON.parse(JSON.stringify(tree)) as ServicePlaybook;
    rigged.sections[0].body = [...rigged.sections[0].body, line];
    expect(validatePlaybook(rigged, GRAPH_V1_NODE_IDS).join(" | ")).toMatch(/OD-13/);
  });

  it("catches a price hidden in a NON-copy field, because the whole record is checked", () => {
    const tree = PLAYBOOK_REGISTRY.find((p) => p.system === "tree")!;
    const rigged = JSON.parse(JSON.stringify(tree)) as ServicePlaybook;
    rigged.distinguishing_questions[0].answer_branches[0].points_toward = "a $900 call-out";
    expect(validatePlaybook(rigged, GRAPH_V1_NODE_IDS).join(" | ")).toMatch(/OD-13/);
  });

  it("VALIDATES THE EDGES — an edge into a ghost node is caught", () => {
    // validateGraphUniqueness walked problem_nodes and intent_nodes and never
    // looked at graph.edges at all, so an edge pointing at nothing passed.
    expect(validateGraphUniqueness(GRAPH_V1)).toEqual([]);

    const ghostFrom = JSON.parse(JSON.stringify(GRAPH_V1)) as typeof GRAPH_V1;
    ghostFrom.edges.push({ from_node_id: "ppg_does_not_exist_v1", to_intent_id: GRAPH_V1.intent_nodes[0].intent_id });
    expect(validateGraphUniqueness(ghostFrom).join(" | ")).toMatch(/unknown problem node/);

    const ghostTo = JSON.parse(JSON.stringify(GRAPH_V1)) as typeof GRAPH_V1;
    ghostTo.edges.push({ from_node_id: GRAPH_V1.problem_nodes[0].node_id, to_intent_id: "int_does_not_exist_v1" });
    expect(validateGraphUniqueness(ghostTo).join(" | ")).toMatch(/unknown intent node/);
  });

  it("catches a duplicated edge too", () => {
    const dup = JSON.parse(JSON.stringify(GRAPH_V1)) as typeof GRAPH_V1;
    dup.edges.push({ ...GRAPH_V1.edges[0] });
    expect(validateGraphUniqueness(dup).join(" | ")).toMatch(/duplicate edge/);
  });

  it("THE GRAPH SCHEMAS ARE STRICT — a mistyped core field is loud, not silently stripped", () => {
    // KnownPlace, ServicePlaybook and EligibilityPolicy were all strict; the
    // graph was not, so `urgancy: "routine"` parsed clean and the node shipped
    // without an urgency at all.
    const typo = JSON.parse(JSON.stringify(GRAPH_V1)) as Record<string, unknown>;
    const nodes = typo.problem_nodes as Array<Record<string, unknown>>;
    nodes[0].urgancy = "routine";
    expect(PropertyProblemGraph.safeParse(typo).success).toBe(false);
  });

  it("…strict at every level: an unknown key on an edge, a price driver, or the graph itself", () => {
    for (const mutate of [
      (g: Record<string, unknown>) => { (g.edges as Array<Record<string, unknown>>)[0].weight = 1; },
      (g: Record<string, unknown>) => {
        const n = (g.problem_nodes as Array<Record<string, unknown>>)[0];
        (n.price_drivers as Array<Record<string, unknown>>)[0].magnitude = "large";
      },
      (g: Record<string, unknown>) => { g.notes = "an extra top-level key"; },
    ]) {
      const bad = JSON.parse(JSON.stringify(GRAPH_V1)) as Record<string, unknown>;
      mutate(bad);
      expect(PropertyProblemGraph.safeParse(bad).success).toBe(false);
    }
  });
});

describe("T6-01 · the compiler's own contracts", () => {
  it("'unmatched' is a REAL classification, not a dead union member", () => {
    // classifyKind had four positive branches and a fall-through returning
    // "problem_understanding", so no producer of IntentKind could ever emit
    // "unmatched" and every unreadable query was filed as a problem-
    // understanding query.
    const c = compileIntent("best pasta recipe for tuesday");
    expect(c.matched_node_ids).toEqual([]);
    expect(c.matched_intent_ids).toEqual([]);
    expect(c.intent_kind).toBe("unmatched");
  });

  it("a query that DID anchor is never labelled unmatched", () => {
    expect(compileIntent("tree just fell on my house").intent_kind).not.toBe("unmatched");
  });

  it("matched_intent_ids is independent of node matching, exactly as documented", () => {
    // The doc used to say "Empty when unmatched", which was false: intent
    // matching runs on its own query signals. It now says so, and this holds
    // the documented behaviour in place.
    const c = compileIntent("how much does it cost");
    expect(c.matched_node_ids).toEqual([]);
    expect(c.matched_intent_ids.length).toBeGreaterThan(0);
    expect(c.confidence).toBe(0);
  });

  it("the model seam's SHAPE matches what the header promises it would do", () => {
    // The header promised the seam could "map a query NO node matches onto a
    // NEW node proposal". The interface returned { node_like_summary,
    // suggested_node_ids } — a list of EXISTING ids, which is a different
    // capability. The proposal type now carries a proposed node.
    const proposal: ProposedProblemNode = {
      observed_problem: "gutters overflowing at the corner every time it rains",
      suggested_system: "roofing",
      considered_node_ids: ["ppg_roof_leak_active_v1"],
      rationale: "not a roof leak — the water never enters the envelope",
    };
    const seam: ModelIntentClassifier = {
      proposeNewNode: async () => proposal,
    };
    expect(typeof seam.proposeNewNode).toBe("function");
  });
});

describe("T6-01 · the name-collision guard", () => {
  it("zero references to the intake playbook directory anywhere in src/domain/growth", () => {
    const offenders = growthSourceFiles().filter((f) => {
      const src = readFileSync(f, "utf8");
      return /domain\/intake\/playbooks|intake\/playbook/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("the growth domain imports nothing from the problem or intake domains", () => {
    const offenders = growthSourceFiles().filter((f) => {
      const src = readFileSync(f, "utf8");
      return /from "@\/domain\/(problem|intake)/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
