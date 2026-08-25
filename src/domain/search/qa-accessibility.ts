import type { QaFinding, QaSkippedCheck } from "@/domain/search/qa-types";

/**
 * ACCESSIBILITY AND PERFORMANCE — THE SCOPE DECISION, WRITTEN DOWN
 * (Loop Spec Audit condition C12).
 *
 * THE CONDITION, verbatim: "Flag accessibility/performance as a scope decision,
 * not a free add. §3 labels them `proposed`; §9 step 2 and §11 step 2 make them
 * mandatory ('Also implement'). This repo has vitest only — no headless browser,
 * no axe, nothing that can measure contrast or load time. Either move them to a
 * later wave or budget the harness explicitly; do not let a `proposed` line
 * become a silent scope commitment."
 *
 * THE DECISION TAKEN HERE, and the reasoning, so the next session does not have
 * to re-derive it:
 *
 *   IMPLEMENTED — everything that is a property of the PageSpec A06 was handed.
 *   An image with no alt text, a second `<h1>`, a heading level that jumps, an
 *   empty link label and a page-weight proxy are all decidable from the markup
 *   itself, with no browser, no network and no rendering. These are real checks
 *   with real failure modes, and they run on every page.
 *
 *   SKIPPED, AND SAID SO — everything that is a property of the RENDERED PAGE in
 *   a real browser. Colour contrast needs computed styles. Load time, LCP, CLS
 *   and transfer weight need a network and a layout engine. Focus order and
 *   screen-reader output need an accessibility tree. None of those exists in a
 *   vitest process, and A06 reports them `SKIPPED_NOT_MEASURABLE` with the
 *   reason and what it would take.
 *
 * A SKIPPED CHECK IS NOT A PASSING CHECK. That is the whole discipline: a page
 * whose contrast has never been measured must not carry a green accessibility
 * verdict, and A06 must not fabricate a number so its report looks complete. The
 * skipped list travels on every PageQAResult and renders on the owner's queue.
 *
 * NO PRN-DOMAIN IMPORTS — this file takes text and returns findings.
 */

/** The renderable surfaces of a page, in the order a reader meets them. */
export interface QaRenderSurface {
  /** Field name or block_id — the `where` on every finding. IDs only. */
  where: string;
  text: string;
  /** True for a content block's `body_md` (markdown is parsed); false for plain fields. */
  markdown: boolean;
  /** The heading level this surface renders at, when it renders one. */
  heading_level?: number;
}

/**
 * Markdown image with an EMPTY or whitespace-only alt: `![](src)`.
 * A decorative image is expressed with an explicit empty alt in HTML, but a
 * markdown body has no way to say "decorative", so an empty alt here is an
 * omission rather than a declaration.
 */
const IMAGE_WITH_ALT = /!\[([^\]]*)\]\(([^)]*)\)/g;
/** Markdown link with empty text: `[](/path)` — a link a screen reader cannot announce. */
const LINK_WITH_TEXT = /(?<!!)\[([^\]]*)\]\(([^)]*)\)/g;
/** ATX headings at line start. Setext headings are not produced by any writer here. */
const ATX_HEADING = /^(#{1,6})\s+(\S.*)$/gm;

export interface AccessibilityInput {
  surfaces: readonly QaRenderSurface[];
  /** The page's own H1 text. The page has exactly one, from the template. */
  h1: string;
  /** Link labels the page renders outside the markdown body. */
  link_labels: readonly { where: string; label: string }[];
  /** Total markup size proxy and its ceiling, both from policy. */
  markup_chars: number;
  max_markup_chars: number;
}

/**
 * The measurable half. Returns findings at the severities A06's policy assigns
 * (the caller re-severities from `blocker_checks`; the values here are the
 * defaults A06 proposes).
 */
export function runAccessibilityChecks(input: AccessibilityInput): QaFinding[] {
  const findings: QaFinding[] = [];

  for (const surface of input.surfaces) {
    if (!surface.markdown) continue;

    // --- images without alt text ---
    for (const match of surface.text.matchAll(IMAGE_WITH_ALT)) {
      const alt = (match[1] ?? "").trim();
      if (alt.length === 0) {
        findings.push({
          check: "a11y.image_alt_present",
          severity: "blocker",
          where: surface.where,
          message: "an image is embedded with no alt text — a screen reader announces nothing",
          repair_instructions:
            "Give the image descriptive alt text in the markdown: ![what the image shows](src). If it is genuinely decorative it does not belong in a content block.",
        });
      }
    }

    // --- link text ---
    for (const match of surface.text.matchAll(LINK_WITH_TEXT)) {
      const label = (match[1] ?? "").trim();
      if (label.length === 0) {
        findings.push({
          check: "a11y.link_text_non_empty",
          severity: "blocker",
          where: surface.where,
          message: "a link has no visible text — it cannot be read out or clicked reliably",
          repair_instructions: "Give the link text that describes its destination, not 'here' or 'click'.",
        });
      }
    }

    // --- heading structure inside a block body ---
    const level = surface.heading_level ?? 2;
    let previous = level;
    for (const match of surface.text.matchAll(ATX_HEADING)) {
      const depth = match[1].length;
      if (depth === 1) {
        findings.push({
          check: "a11y.no_second_h1",
          severity: "blocker",
          where: surface.where,
          message: "a second level-1 heading is inside the body — the page already has one H1",
          repair_instructions:
            "Demote it. Block bodies render below the block heading, so their own headings start at level 3.",
        });
        previous = depth;
        continue;
      }
      if (depth > previous + 1) {
        findings.push({
          check: "a11y.heading_order",
          severity: "major",
          where: surface.where,
          message: `heading level jumps from h${previous} to h${depth} — outline order is broken`,
          repair_instructions: `Use h${previous + 1} here, or add the intermediate heading the jump skipped.`,
        });
      }
      previous = depth;
    }
  }

  // --- link labels rendered outside markdown ---
  for (const link of input.link_labels) {
    if (link.label.trim().length === 0) {
      findings.push({
        check: "a11y.link_text_non_empty",
        severity: "blocker",
        where: link.where,
        message: "an internal link renders with an empty label",
        repair_instructions: "Give the link a label describing the page it points at.",
      });
    }
  }

  if (input.h1.trim().length === 0) {
    findings.push({
      check: "a11y.heading_order",
      severity: "blocker",
      where: "h1",
      message: "the page has no H1 — the document outline has no root",
      repair_instructions: "Set h1 to the question this page answers.",
    });
  }

  // --- page weight PROXY, honestly named ---
  if (input.markup_chars > input.max_markup_chars) {
    findings.push({
      check: "perf.page_weight_proxy",
      severity: "major",
      where: "content_blocks",
      message: `markup weight proxy ${input.markup_chars} chars exceeds the ${input.max_markup_chars} ceiling — this is a proxy for transfer weight, not a measurement of it`,
      repair_instructions:
        "Split or trim the page. A real transfer-weight measurement needs a browser harness this repo does not have.",
    });
  }

  return findings;
}

/**
 * THE HONEST GAP. Every check A06's spec names that a vitest process physically
 * cannot perform, each with what it would take to perform it. These travel on
 * every PageQAResult; none of them is ever counted as a pass.
 */
export const NOT_MEASURABLE_CHECKS: readonly QaSkippedCheck[] = [
  {
    check: "a11y.color_contrast",
    status: "SKIPPED_NOT_MEASURABLE",
    why: "contrast is a property of computed styles in a rendered document. Measuring it needs a headless browser running an accessibility auditor against a real DOM; this repo has vitest only. NOT measured, therefore NOT passed.",
  },
  {
    check: "a11y.focus_and_screen_reader",
    status: "SKIPPED_NOT_MEASURABLE",
    why: "focus order and screen-reader output are properties of the accessibility tree, which only exists in a browser. NOT measured, therefore NOT passed.",
  },
  {
    check: "perf.load_time",
    status: "SKIPPED_NOT_MEASURABLE",
    why: "load time, LCP, CLS and real transfer weight need a network and a layout engine. `perf.page_weight_proxy` measures the markup A06 was handed and is explicitly a proxy, not a substitute.",
  },
] as const;

/** The measurable check ids this module implements — for the checks_run list. */
export const ACCESSIBILITY_CHECK_IDS = [
  "a11y.image_alt_present",
  "a11y.heading_order",
  "a11y.no_second_h1",
  "a11y.link_text_non_empty",
  "perf.page_weight_proxy",
] as const;
