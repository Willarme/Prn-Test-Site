import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { ResultsTemplate } from "@/components/results/ResultsTemplate";
import type { AskAnswer } from "@/platform/stores/interfaces";

/**
 * THE RESULTS PAGE IS MOCKUP-2, WORD FOR WORD (campaign track P2).
 *
 * The rendered template's visible text nodes must equal the approved
 * mockup's — minus the mockup's own review note and the "Feedback popup —
 * shown here for review only" label, which are notes to the reviewer and not
 * page copy. The extractor strips script/style/comments, decodes entities,
 * whitespace-normalises every node, and treats a `placeholder` attribute as a
 * visible string (the mockup shows the near-miss question's hint as a text
 * node; the page shows it as a textarea placeholder — same words, same eye).
 *
 * The approved mockup is committed as a portable fixture. Its independently
 * pinned source hash preserves the fidelity check without a private checkout.
 */
const FIXTURE = join(process.cwd(), "tests", "fixtures", "loop", "MOCKUP-2-results-page.html");
const FIXTURE_SHA256_LF = "c3c7697a8030bf474a617bd6dedca3f492884979fa76ff2721cb29a4bc2547bf";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  middot: "\u00b7",
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible strings, in document order: text nodes plus placeholder attributes. */
export function visibleStrings(html: string): string[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<title[\s\S]*?<\/title>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const out: string[] = [];
  for (const token of cleaned.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("<")) {
      const ph = token.match(/\splaceholder="([^"]*)"/);
      if (ph && ph[1].trim()) out.push(decode(ph[1]).replace(/\s+/g, " ").trim());
      continue;
    }
    const text = decode(token).replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

function mockupHtml(): string {
  return readFileSync(FIXTURE, "utf-8");
}

/** The mockup minus its reviewer-only blocks. */
function mockupPageOnly(html: string): string {
  const withoutNote = html.replace(/<div class="note">[\s\S]*?<\/div>/, "");
  const withoutLabel = withoutNote.replace(/<div class="fblabel">[\s\S]*?<\/div>/, "");
  expect(withoutNote).not.toBe(html);
  expect(withoutLabel).not.toBe(withoutNote);
  return withoutLabel;
}

const REQUEST_ID = "rq_p2_template_case";
const KEEP = "/keep/eyJ2IjoxfQ.keeptoken";
const ASK = "/ask/eyJ2IjoxfQ.asktoken";

function render(props: Partial<Parameters<typeof ResultsTemplate>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ResultsTemplate, {
      requestId: REQUEST_ID,
      keepHref: KEEP,
      askHref: ASK,
      ...props,
    })
  );
}

let mockup: string[];
let page: string;
let pageStrings: string[];

beforeAll(() => {
  mockup = visibleStrings(mockupPageOnly(mockupHtml()));
  page = render();
  pageStrings = visibleStrings(page);
});

describe("MOCKUP-2 fixture", () => {
  it("matches the approved source hash with portable line endings", () => {
    const source = readFileSync(FIXTURE, "utf-8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe(FIXTURE_SHA256_LF);
  });

  it("the extractor sees the page, the note and the popup label as the mockup wrote them", () => {
    const all = visibleStrings(mockupHtml());
    expect(all).toContain("Your Job Packet is ready");
    expect(all.some((s) => s.startsWith("MOCKUP 2 v6"))).toBe(true);
    expect(all.some((s) => s.includes("shown here for review only"))).toBe(true);
    expect(mockup.some((s) => s.startsWith("MOCKUP 2 v6"))).toBe(false);
    expect(mockup.some((s) => s.includes("shown here for review only"))).toBe(false);
    expect(mockup.length).toBeGreaterThan(80);
  });
});

describe("GET /results/[request_id] — the template", () => {
  it("renders exactly the mockup's visible strings, in the mockup's order", () => {
    expect(pageStrings).toEqual(mockup);
  });

  it("carries the frozen anchors the checklist names (D2, D5, D7, D8)", () => {
    for (const s of [
      "What you walk away with",
      "Your Job Packet is ready",
      "Open my Job Packet",
      "Email it to me instead",
      "Your house is an asset with amnesia.",
      "Save this to my home",
      "Not now",
      "You already know someone who knows someone.",
      "I already have someone",
      "Ask my people",
      "Find someone for me",
      "This is a preparation record. A qualified technician does their own testing on site, and the price stays theirs to set. What you entered stays with you until you choose to send it.",
      "Did that help narrow things down?",
    ]) {
      expect(pageStrings, s).toContain(s);
    }
    // D2: nothing congratulates the homeowner for finishing our flow.
    for (const banned of ["You did it", "You did the hard part", "Nicely done", "Great job"]) {
      expect(page).not.toContain(banned);
    }
  });

  it("is a template: no request id or per-request value in its text, identical across requests (D1)", () => {
    expect(pageStrings.join("\n")).not.toContain(REQUEST_ID);
    const other = visibleStrings(
      render({ requestId: "rq_p2_a_completely_different_one", keepHref: "/keep/x.y", askHref: "/ask/x.y" })
    );
    expect(other).toEqual(pageStrings);
  });

  it("every href resolves to a route in the campaign map", () => {
    const hrefs = Array.from(page.matchAll(/\shref="([^"]+)"/g)).map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(8);
    const allowed = [
      /^\/packet\/rq_[A-Za-z0-9_-]+$/,
      /^\/results\/rq_[A-Za-z0-9_-]+\/(email|send|find)$/,
      /^\/keep\/[A-Za-z0-9_.-]+$/,
      /^\/ask\/[A-Za-z0-9_.-]+$/,
      /^\/pages\/(dashboard|trust-network|smartquote|home-memory)$/,
      /^#trust$/,
    ];
    for (const h of hrefs) {
      expect(allowed.some((re) => re.test(h)), h).toBe(true);
    }
    expect(hrefs).toContain(`/packet/${REQUEST_ID}`);
    expect(hrefs).toContain(`/results/${REQUEST_ID}/email`);
    expect(hrefs).toContain(`/results/${REQUEST_ID}/send`);
    expect(hrefs).toContain(`/results/${REQUEST_ID}/find`);
    expect(hrefs).toContain(KEEP);
    expect(hrefs).toContain(ASK);
    for (const p of ["dashboard", "trust-network", "smartquote", "home-memory"]) {
      expect(hrefs).toContain(`/pages/${p}`);
    }
    // "Not now" scrolls to the Trust band, which exists.
    expect(page).toContain('id="trust"');
  });

  it("preserves the four action markers and keeps feedback hidden on arrival", () => {
    const triggers = Array.from(page.matchAll(/data-feedback-trigger="([^"]+)"/g)).map((m) => m[1]);
    expect(triggers.sort()).toEqual(["ask_people", "have_someone", "open_packet", "save_home"]);
    // The popup is in the HTML, hidden, never open on arrival.
    expect(page).toContain('data-testid="feedback-popup"');
    expect(page).toMatch(/class="fb-dock"[^>]*aria-hidden="true"/);
    expect(page).not.toContain('class="fb-dock open"');
  });

  it("the packet opens in its own tab with no gate (D4)", () => {
    const m = page.match(/<a class="cta-btn"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain(`href="/packet/${REQUEST_ID}"`);
    expect(m![0]).toContain('target="_blank"');
  });

  it("renders the friend's answers in the Trust band only when there are any", () => {
    const answers: AskAnswer[] = [
      {
        ask_id: "ask_1",
        request_id: REQUEST_ID,
        friend_name: "Dana",
        friend_contact: null,
        provider_name: "Northside Heating",
        provider_contact: null,
        reason: "They fixed ours in one visit.",
        created_at: "2026-09-05T12:00:00Z",
      },
      {
        ask_id: "ask_2",
        request_id: REQUEST_ID,
        friend_name: "Marcus",
        friend_contact: "m@example.com",
        provider_name: "Reyes Comfort",
        provider_contact: "555-0100",
        reason: null,
        created_at: "2026-09-05T12:05:00Z",
      },
    ];
    const withAnswers = visibleStrings(render({ askAnswers: answers }));
    const extra = withAnswers.filter((s) => !pageStrings.includes(s));
    expect(extra).toEqual([
      "Your people answered",
      "Northside Heating",
      "From Dana",
      "They fixed ours in one visit.",
      "Reyes Comfort",
      "From Marcus",
      "SEND THEM MY JOB PACKET →",
    ]);
    // Contact details never print on the homeowner's page.
    expect(withAnswers.join("\n")).not.toContain("m@example.com");
    expect(withAnswers.join("\n")).not.toContain("555-0100");
    // And the block sits inside the Trust band.
    const html = render({ askAnswers: answers });
    expect(html.indexOf('class="answers"')).toBeGreaterThan(html.indexOf('id="trust"'));
    expect(html.indexOf('class="answers"')).toBeLessThan(html.indexOf('class="paths"'));
  });
});
