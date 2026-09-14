import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderDoorV44Document } from "@/domain/search/door-v44/render";
import type { DoorV44Document, DoorV44Element } from "@/domain/search/door-v44/render-types";

function document(): DoorV44Document {
  return {
    title: "What changes the next step for your dishwasher?",
    description: "A synthetic account of observations, limits and a portable packet.",
    canonical_url: "https://fixture.example/problems/dishwasher-not-draining",
    robots: "noindex,nofollow",
    site_name: "Synthetic fixture",
    lang: "en-US",
    receipt_id: "fixture.receipt.v1",
    date_modified: null,
    social_image: { url: "https://fixture.example/assets/evidence.png", alt: "Synthetic evidence boundary", width: 1200, height: 800, mime: "image/png" },
    structured_data: [{ "@context": "https://schema.org", "@type": "WebPage", "@id": "https://fixture.example/problems/dishwasher-not-draining", name: "Synthetic fixture" }],
    body: [{ tag: "main", attrs: { id: "main" }, children: [
      { tag: "section", attrs: { "data-section": "HERO", id: "hero" }, children: [
        { tag: "h1", children: ["What changes the next step for your dishwasher?"] },
        { tag: "p", attrs: { id: "answer" }, children: ["A visible answer ", { tag: "strong", children: ["before any form"] }, "."] },
        { tag: "form", attrs: { id: "home-problem-intake", action: "/api/intake/start", method: "post", enctype: "multipart/form-data", "data-capability-id": "home_problem_analyzer", "data-input-schema-version": "1" }, children: [
          { tag: "input", attrs: { type: "hidden", name: "page_id", value: "fixture.f04" } },
          { tag: "label", attrs: { for: "problem-description" }, children: ["What did you notice?"] },
          { tag: "textarea", attrs: { id: "problem-description", name: "problem_description", required: "", rows: "4", maxlength: "4000", "aria-describedby": "help" }, children: [] },
          { tag: "p", attrs: { id: "help" }, children: ["Unknown details can remain unknown."] },
          { tag: "button", attrs: { id: "startBtn", type: "submit" }, children: ["Start with MY DISHWASHER"] },
        ] },
      ] },
      { tag: "section", attrs: { id: "safety" }, children: [{ tag: "h2", children: ["Safety boundaries"] }, { tag: "ul", children: [{ tag: "li", children: ["Synthetic fixture: no practical instructions."] }] }] },
      { tag: "section", attrs: { id: "sources" }, children: [{ tag: "h2", children: ["Sources and review notes"] }, { tag: "a", attrs: { href: "https://fixture.example/source", target: "_blank", rel: "nofollow noopener" }, children: ["Synthetic source"] }] },
    ] }],
  };
}
function rendered(raw: unknown = document()) {
  const result = renderDoorV44Document(raw);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("Positive document rejected");
  return result;
}
function rejected(raw: unknown, code?: string) {
  const result = renderDoorV44Document(raw);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Unsafe document accepted");
  expect(Object.keys(result).sort()).toEqual(["errors", "ok"]);
  expect(result.errors.length).toBeGreaterThan(0);
  for (const error of result.errors) {
    expect(Object.keys(error).sort()).toEqual(["code", "pointer"]);
    expect(error.pointer).toMatch(/^(?:\/|$)/);
  }
  if (code) expect(result.errors.some(error => error.code === code)).toBe(true);
  return result;
}
function setBody(node: DoorV44Element): DoorV44Document { return { ...document(), body: [node] }; }
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
}
describe("v44 safe semantic HTML serializer", () => {
  it("keeps the answer, safety, sources and a real native POST form readable without JavaScript", () => {
    const { html } = rendered();
    expect(html).toContain("<main id=\"main\">");
    expect(html).toContain('A visible answer <strong>before any form</strong>.');
    expect(html).toContain('<form action="/api/intake/start" data-capability-id="home_problem_analyzer" data-input-schema-version="1" enctype="multipart/form-data" id="home-problem-intake" method="post">');
    expect(html).toContain('<input name="page_id" type="hidden" value="fixture.f04">');
    expect(html).toContain('<label for="problem-description">What did you notice?</label>');
    expect(html).toContain('<textarea aria-describedby="help" id="problem-description" maxlength="4000" name="problem_description" required="" rows="4"></textarea>');
    expect(html).toContain('<button id="startBtn" type="submit">Start with MY DISHWASHER</button>');
    expect(html).toContain('<section id="safety">');
    expect(html).toContain('<section id="sources">');
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).not.toMatch(/<style\b|<script src=|\bonclick=|\bonsubmit=|javascript:/);
  });
  it("emits consistent canonical, OG and Twitter metadata plus the nonvisible receipt", () => {
    const { html } = rendered();
    const page = document();
    expect(html).toContain('<link href="' + page.canonical_url + '" rel="canonical">');
    for (const property of ["og:url", "twitter:url"]) expect(html).toContain('content="' + page.canonical_url + '" ' + (property.startsWith("og:") ? 'property="' : 'name="') + property + '"');
    for (const property of ["og:title", "twitter:title"]) expect(html).toContain('content="' + page.title + '" ' + (property.startsWith("og:") ? 'property="' : 'name="') + property + '"');
    expect(html).toContain('<meta content="1200" property="og:image:width">');
    expect(html).toContain('<meta content="800" property="og:image:height">');
    expect(html).toContain('<meta content="image/png" property="og:image:type">');
    expect(html).toContain('<meta content="fixture.receipt.v1" name="door:receipt-id">');
    expect(html.slice(html.indexOf("<body>"))).not.toContain("fixture.receipt.v1");
    expect(html).not.toContain("article:modified_time");
    page.date_modified = "2026-09-13T12:00:00.000Z";
    expect(rendered(page).html).toContain('<meta content="2026-09-13T12:00:00.000Z" property="article:modified_time">');
  });
  it("omits unavailable social metadata and uses a summary card", () => {
    const raw = document();
    delete raw.social_image;
    const { html } = rendered(raw);
    expect(html).toContain('<meta content="summary" name="twitter:card">');
    expect(html).not.toContain("og:image");
    expect(html).not.toContain('name="twitter:image"');
  });
  it("is byte deterministic across key ordering without modifying frozen input", () => {
    const raw = document();
    const before = JSON.stringify(raw);
    freeze(raw);
    const first = rendered(raw);
    expect(rendered(raw)).toEqual(first);
    expect(rendered(reverseKeys(raw))).toEqual(first);
    expect(JSON.stringify(raw)).toBe(before);
    expect(first.html_hash).toBe(createHash("sha256").update(first.html, "utf8").digest("hex"));
    expect(first.html).toMatch(/^<!doctype html>\n<html lang="en-US">\n/);
    expect(first.html.endsWith("</html>\n")).toBe(true);
    expect(first.html.endsWith("\n\n")).toBe(false);
    expect(first.html).not.toContain("\r");
    expect(first.html.charCodeAt(0)).not.toBe(0xfeff);
  });
  it("excludes only the receipt ID from semantic identity and preserves visible order", () => {
    const first = rendered();
    const raw = document();
    raw.receipt_id = "fixture.receipt.v2";
    const receipt = rendered(raw);
    expect(receipt.semantic_hash).toBe(first.semantic_hash);
    expect(receipt.html_hash).not.toBe(first.html_hash);
    raw.body[0].children!.reverse();
    const reordered = rendered(raw);
    expect(reordered.semantic_hash).not.toBe(receipt.semantic_hash);
    expect(reordered.html.indexOf('<section id="sources">')).toBeLessThan(reordered.html.indexOf('<section id="safety">'));
    raw.title = "Changed visible title";
    expect(rendered(raw).semantic_hash).not.toBe(reordered.semantic_hash);
  });
  it("escapes untrusted text and attribute values as text, including textarea terminators", () => {
    const raw = setBody({ tag: "div", attrs: { title: '" onmouseover="alert(1)' }, children: [
      '<script>alert("x")</script> & text',
      { tag: "textarea", attrs: { name: "notes" }, children: ['</textarea><img src=x onerror=alert(1)>'] },
      "\r\nEmoji stays visible: 🏠",
    ] });
    const { html } = rendered(raw);
    expect(html).toContain('title="&quot; onmouseover=&quot;alert(1)"');
    expect(html).toContain('&lt;script&gt;alert("x")&lt;/script&gt; &amp; text');
    expect(html).toContain('&lt;/textarea&gt;&lt;img src=x onerror=alert(1)&gt;</textarea>');
    expect(html).toContain("&#13;\nEmoji stays visible: 🏠");
    expect(html).not.toContain("\r");
    expect(html.match(/<img\b/g)).toBeNull();
    expect(html.match(/<script\b/g)).toHaveLength(1);
  });
  it("serializes JSON-LD without executable script terminators and round-trips its data", () => {
    const raw = document();
    const attack = '</script><script>alert("x")</script><!-- \u2028\u2029 & >';
    raw.structured_data = [{ "@context": "https://schema.org", "@type": "WebPage", description: attack }];
    const { html } = rendered(raw);
    const encoded = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    expect(encoded).not.toMatch(/<|>|&|\u2028|\u2029/);
    expect(JSON.parse(encoded)).toEqual(raw.structured_data[0]);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javaScript:alert(1)", "java\nscript:alert(1)", "data:text/html,bad", "vbscript:bad", "file:///private", "//evil.example/path", "/\\evil.example", "https://user:password@evil.example", "https://fixture.example/%0aevil", "&#106;avascript:bad"])("rejects unsafe href %s", href => {
    rejected(setBody({ tag: "a", attrs: { href }, children: ["Link"] }), "RENDER_ATTRIBUTE_INVALID");
  });
  it.each(["/safe-path", "#anchor", "https://fixture.example/source?a=1&b=2"])("allows governed href %s", href => {
    expect(rendered(setBody({ tag: "a", attrs: { href }, children: ["Link"] })).html).toContain("<a ");
  });
  it("rejects cross-origin form actions and active source protocols", () => {
    rejected(setBody({ tag: "form", attrs: { action: "https://evil.example/post", method: "post" }, children: [] }), "RENDER_ATTRIBUTE_INVALID");
    rejected(setBody({ tag: "img", attrs: { src: "data:image/svg+xml,bad", alt: "Rejected", width: "1", height: "1" } }), "RENDER_ATTRIBUTE_INVALID");
    rejected(setBody({ tag: "source", attrs: { srcset: "/safe.png, javascript:bad 2x", type: "image/png" } }), "RENDER_ATTRIBUTE_INVALID");
    rejected(setBody({ tag: "source", attrs: { srcset: "https://fixture.example/safe.png,javascript:bad", type: "image/png" } }), "RENDER_ATTRIBUTE_INVALID");
  });
  it.each(["script", "style", "svg", "iframe", "object", "embed", "link", "meta", "img onerror=bad"])("rejects unauthorized tag %s", tag => {
    rejected({ ...document(), body: [{ tag, children: ["unsafe"] }] }, "RENDER_ELEMENT_INVALID");
  });
  it.each(["onclick", "onerror", "style", "srcdoc", "formaction", "data-private-prompt", "ARIA-LABEL"])("rejects unauthorized attribute %s without leaking its name/value", name => {
    const result = rejected(setBody({ tag: "div", attrs: { [name]: "PRIVATE_fixture_value" }, children: [] }), "RENDER_ATTRIBUTE_INVALID");
    expect(JSON.stringify(result)).not.toContain(name);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_fixture_value");
  });
  it("rejects extra document/element fields and malformed native HTML structure", () => {
    rejected({ ...document(), internal_prompt: "PRIVATE_prompt" }, "RENDER_DOCUMENT_INVALID");
    rejected({ ...document(), body: [{ tag: "div", html: "<b>raw</b>" }] }, "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "img", attrs: { src: "/image.png" } }), "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "input", attrs: { type: "hidden" }, children: ["not void"] }), "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "button", children: ["No declared behavior"] }), "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "table", children: [{ tag: "p", children: ["Foster parenting forbidden"] }] }), "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "p", children: [{ tag: "div", children: ["Parser repair forbidden"] }] }), "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "tr", children: [{ tag: "td", children: ["Discarded table structure forbidden"] }] }), "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "ul", children: ["Invalid list text"] }), "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "textarea", children: [{ tag: "strong", children: ["Not text"] }] }), "RENDER_ELEMENT_INVALID");
    rejected(setBody({ tag: "form", attrs: { action: "/post", method: "post" }, children: [{ tag: "form", attrs: { action: "/post", method: "post" } }] }), "RENDER_ELEMENT_INVALID");
  });
  it("rejects object getters without invoking them, custom prototypes, sparse arrays and cycles", () => {
    let calls = 0;
    const raw = document();
    Object.defineProperty(raw, "title", { enumerable: true, get() { calls++; return "Getter should not run"; } });
    rejected(raw, "RENDER_INPUT_INVALID");
    expect(calls).toBe(0);
    const nested = document();
    Object.defineProperty(nested.body[0], "attrs", { enumerable: true, get() { calls++; return {}; } });
    rejected(nested, "RENDER_INPUT_INVALID");
    expect(calls).toBe(0);
    rejected(Object.assign(Object.create({ inherited: true }), document()), "RENDER_INPUT_INVALID");
    const cyclic = document();
    cyclic.body[0].children = [cyclic.body[0]];
    rejected(cyclic, "RENDER_INPUT_INVALID");
    const sparse = document();
    sparse.body = new Array(2);
    rejected(sparse, "RENDER_INPUT_INVALID");
    const poisoned = JSON.parse(JSON.stringify(document())) as Record<string, unknown>;
    Object.defineProperty(poisoned, "__proto__", { enumerable: true, value: {} });
    rejected(poisoned, "RENDER_INPUT_INVALID");
  });
  it("rejects malformed metadata and bounds recursive element depth", () => {
    rejected({ ...document(), canonical_url: "https://fixture.example/page?tracking=yes" }, "RENDER_URL_INVALID");
    rejected({ ...document(), robots: "all" }, "RENDER_DOCUMENT_INVALID");
    rejected({ ...document(), date_modified: "not a date" }, "RENDER_DOCUMENT_INVALID");
    rejected({ ...document(), receipt_id: "PRIVATE/path/file" }, "RENDER_DOCUMENT_INVALID");
    rejected({ ...document(), social_image: { ...document().social_image, width: 0 } }, "RENDER_DOCUMENT_INVALID");
    rejected({ ...document(), structured_data: [null] }, "RENDER_DOCUMENT_INVALID");
    rejected({ ...document(), structured_data: [{ number: NaN }] }, "RENDER_INPUT_INVALID");
    let deep: DoorV44Element = { tag: "span", children: ["Deep"] };
    for (let i = 0; i < 40; i++) deep = { tag: "div", children: [deep] };
    rejected(setBody(deep));
  });
  it("supports accessible native tables, pictures, details and conditional file controls", () => {
    const raw = setBody({ tag: "section", children: [
      { tag: "table", children: [{ tag: "caption", children: ["Evidence"] }, { tag: "thead", children: [{ tag: "tr", children: [{ tag: "th", attrs: { scope: "col" }, children: ["Observation"] }] }] }, { tag: "tbody", children: [{ tag: "tr", children: [{ tag: "td", children: ["Synthetic"] }] }] }] },
      { tag: "figure", attrs: { "data-visual-id": "fixture.visual" }, children: [{ tag: "picture", children: [{ tag: "source", attrs: { srcset: "/assets/diagram.webp", type: "image/webp" } }, { tag: "img", attrs: { src: "/assets/diagram.png", alt: "Evidence boundary", width: "1200", height: "800", loading: "lazy", decoding: "async" } }] }, { tag: "figcaption", children: ["Synthetic diagram."] }] },
      { tag: "details", children: [{ tag: "summary", children: ["Review notes"] }, { tag: "p", children: ["Readable without handlers."] }] },
      { tag: "input", attrs: { type: "file", name: "photos", accept: "image/*", multiple: "" } },
      { tag: "output", attrs: { role: "status", "aria-live": "polite" }, children: ["Ready"] },
    ] });
    const { html } = rendered(raw);
    expect(html).toContain('<th scope="col">Observation</th>');
    expect(html).toContain('<details><summary>Review notes</summary>');
    expect(html).toContain('<input accept="image/*" multiple="" name="photos" type="file">');
    expect(html).not.toContain("</img>");
    expect(html).not.toContain("</source>");
    expect(html).not.toContain("</input>");
  });
  it("preserves a leading text newline through the native textarea/pre parsing rule", () => {
    const { html } = rendered(setBody({ tag: "section", children: [
      { tag: "textarea", attrs: { name: "notes" }, children: ["\nFirst line"] },
      { tag: "pre", children: ["\nSecond line"] },
    ] }));
    expect(html).toContain('<textarea name="notes">\n\nFirst line</textarea>');
    expect(html).toContain("<pre>\n\nSecond line</pre>");
  });
});
