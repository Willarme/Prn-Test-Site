import { describe, expect, it } from "vitest";
import { GET as doorRoute } from "@/app/problems/ac-blowing-warm-air/route";
import { GET as pagesGet } from "@/app/pages/[...path]/route";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { SAFETY_RULES } from "@/domain/problem/safety";
const doorGet = (request = new Request("http://localhost/problems/ac-blowing-warm-air")) => doorRoute(request);

/**
 * THE SERVED SURFACES: Melissa's door page and her six product previews.
 *
 * Both are approved, frozen documents. These cases pin the only two things the
 * server is allowed to change about them — the brand token on the door, and the
 * inter-page links on the previews — and pin that everything else survives.
 */

function pagesRequest(...path: string[]): [Request, { params: Promise<{ path: string[] }> }] {
  return [
    new Request(`http://localhost/pages/${path.join("/")}`),
    { params: Promise.resolve({ path }) },
  ];
}

describe("GET /problems/ac-blowing-warm-air — the kit-built door", () => {
  it("renders a bounded recovery message and keeps all fifteen sections", async () => {
    const html = await (await doorGet(new Request("http://localhost/problems/ac-blowing-warm-air?error=consent"))).text();
    expect(html).toContain('role="alert"');
    expect(html).toContain("Review the note below");
    expect(html).toContain('id="related"');
    expect(html).toContain('href="/no-hot-water"');
    expect(html).not.toContain("if(snapEnabled)");
    const unknown = await (await doorGet(new Request("http://localhost/problems/ac-blowing-warm-air?error=%3Cscript%3E"))).text();
    expect(unknown).not.toContain('role="alert"');
  });
  it("serves the door as HTML, with the brand substituted and no token left behind", async () => {
    const res = await doorGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).not.toContain("{{site.name}}");
    expect(html).toContain("Property Response Network");
    // Nothing else templated survived either — a stray {{ }} is a bug on a
    // page a stranger reads.
    expect(html).not.toMatch(/\{\{\s*[a-z_.]+\s*\}\}/i);
  });

  it("carries the consent block the intake API refuses without", async () => {
    const html = await (await doorGet()).text();
    expect(html).toContain(
      `<input type="hidden" name="disclosure_content_hash" value="${ACTIVE_DISCLOSURE.content_hash}">`
    );
    // The visible sentence whose hash that is — the two cannot drift, because
    // both come from ACTIVE_DISCLOSURE at request time.
    expect(html).toContain(ACTIVE_DISCLOSURE.content_text.slice(0, 60));
    // Injected INSIDE the form, or the browser sends neither.
    const formStart = html.indexOf('<form id="home-problem-intake"');
    const formEnd = html.indexOf("</form>", formStart);
    const hashAt = html.indexOf('name="disclosure_content_hash"');
    expect(formStart).toBeGreaterThan(-1);
    expect(hashAt).toBeGreaterThan(formStart);
    expect(hashAt).toBeLessThan(formEnd);
  });

  it("the frozen form and its fields are untouched", async () => {
    const html = await (await doorGet()).text();
    expect(html).toContain('action="/api/intake/start"');
    expect(html).toContain('method="post"');
    expect(html).toContain('enctype="multipart/form-data"');
    for (const field of [
      'name="problem_description"',
      'name="page_id"',
      'name="intent_cluster_id"',
      'name="search_opportunity_id"',
      'name="problem_family_hint"',
      'name="landing_path"',
      'name="voice_note"',
      'name="photos"',
      'name="video"',
    ]) {
      expect(html, field).toContain(field);
    }
  });
});

describe("GET /safety/[rule_id] — the hazard halt screen", () => {
  it("every halt-class rule has approved copy for this page to print", () => {
    const halting = SAFETY_RULES.filter((r) => !r.intake_may_continue);
    expect(halting.length).toBeGreaterThan(0);
    for (const rule of halting) {
      expect(rule.approved_response.length).toBeGreaterThan(40);
      expect(rule.label.length).toBeGreaterThan(0);
    }
  });

  it("the adapter's halt target is a rule this page can resolve", () => {
    expect(SAFETY_RULES.some((r) => r.safety_rule_id === "safety_gas")).toBe(true);
    expect(SAFETY_RULES.some((r) => r.safety_rule_id === "not_a_rule")).toBe(false);
  });
});

describe("GET /pages/* — Melissa's product previews", () => {
  /** Every reference has visible feedback controls; all six now persist before confirming. */
  const SLUGS = [
    { slug: "overview", vote: true },
    { slug: "dashboard", vote: true },
    { slug: "trust-network", vote: true },
    { slug: "smartquote", vote: true },
    { slug: "home-memory", vote: true },
    { slug: "provider-os", vote: true },
  ] as const;

  for (const { slug, vote } of SLUGS) {
    it(`serves /pages/${slug} as HTML with every inter-page link rewritten`, async () => {
      const res = await pagesGet(...pagesRequest(slug));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      const html = await res.text();
      expect(html.length).toBeGreaterThan(10_000);
      // No filename link survives anywhere on the page.
      expect(html).not.toContain(".dc.html");
      expect(html).not.toContain("property-response-v2 (2).html");
      // And the runtime it needs still resolves from this URL.
      expect(html).toContain('src="./support.js"');
      expect(html).toContain("./vendor/react.js");
      // The vote block still posts to the collector, where there is one.
      expect(html.includes("/api/signup")).toBe(vote);
    });
  }

  it("serves the shared support script and the vendored runtime", async () => {
    for (const path of [["support.js"], ["vendor", "react.js"], ["vendor", "react-dom.js"], ["vendor", "babel.js"]]) {
      const res = await pagesGet(...pagesRequest(...path));
      expect(res.status, path.join("/")).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect((await res.text()).length).toBeGreaterThan(1000);
    }
  });

  it("refuses anything that is not one of the approved pages", async () => {
    for (const path of [["nope"], ["vendor", "secrets.js"], ["vendor", "..", "..", "package.json"], []]) {
      const res = await pagesGet(...pagesRequest(...path));
      expect(res.status, path.join("/")).toBe(404);
    }
  });
});
