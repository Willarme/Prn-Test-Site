import { createHash } from "node:crypto";
import type { DoorV44Diagnostic } from "./types";
import type { DoorV44Document, DoorV44Element, DoorV44RenderResult } from "./render-types";
import { isPlainDoorJson, stableDoorJson, sortDoorV44Diagnostics } from "./schema-engine";

const TAGS = new Set("main header footer nav section article aside div p span h1 h2 h3 h4 h5 h6 strong em b i small mark sup sub br hr ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td a form label input textarea button fieldset legend select option optgroup output details summary figure figcaption picture source img time abbr address blockquote cite code pre".split(" "));
const VOID = new Set(["br", "hr", "input", "img", "source", "col"]);
const PHRASING = new Set("span strong em b i small mark sup sub br a label input textarea button select output img time abbr cite code".split(" "));
const PHRASING_PARENTS = new Set("p span strong em b i small mark sup sub time abbr cite code pre h1 h2 h3 h4 h5 h6 button".split(" "));
const REQUIRED_PARENTS: Record<string, string[]> = {
  li: ["ul", "ol"], dt: ["dl"], dd: ["dl"], caption: ["table"], colgroup: ["table"], col: ["colgroup"],
  thead: ["table"], tbody: ["table"], tfoot: ["table"], tr: ["table", "thead", "tbody", "tfoot"],
  th: ["tr"], td: ["tr"], option: ["select", "optgroup"], optgroup: ["select"],
  source: ["picture"], summary: ["details"], figcaption: ["figure"],
};
const GLOBAL = new Set(["id", "class", "title", "lang", "dir", "role", "tabindex", "hidden"]);
const ARIA = new Set("aria-label aria-labelledby aria-describedby aria-controls aria-expanded aria-hidden aria-live aria-atomic aria-busy aria-current aria-disabled aria-required aria-invalid aria-pressed aria-selected aria-checked aria-haspopup aria-level aria-valuemin aria-valuemax aria-valuenow aria-valuetext aria-orientation aria-roledescription".split(" "));
const DATA = new Set("data-capability-id data-input-schema-version data-metric-slot data-page-id data-section data-claim-id data-theme data-constant-key data-count data-source-id data-visual-id data-receipt-id".split(" "));
const TAG_ATTRS: Record<string, string[]> = {
  a: ["href", "rel", "target"], form: ["action", "method", "enctype", "accept-charset"],
  label: ["for"], input: ["type", "name", "value", "required", "disabled", "checked", "multiple", "accept", "min", "max", "step", "minlength", "maxlength", "placeholder", "autocomplete", "inputmode"],
  textarea: ["name", "required", "disabled", "rows", "cols", "minlength", "maxlength", "placeholder", "autocomplete"],
  button: ["type", "name", "value", "disabled"], fieldset: ["disabled", "name"],
  select: ["name", "required", "disabled", "multiple", "size"], option: ["value", "label", "selected", "disabled"],
  optgroup: ["label", "disabled"], output: ["name", "for"],
  details: ["open"], img: ["src", "alt", "width", "height", "loading", "decoding"],
  source: ["srcset", "type", "media", "width", "height"], time: ["datetime"],
  ol: ["start", "reversed", "type"], li: ["value"], th: ["scope", "colspan", "rowspan", "headers"],
  td: ["colspan", "rowspan", "headers"], col: ["span"], colgroup: ["span"],
  blockquote: ["cite"],
};
const BOOLEAN = new Set("hidden required disabled checked multiple selected open reversed".split(" "));
const POSITIVE = new Set("width height rows cols size colspan rowspan span maxlength minlength".split(" "));
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const REF_LIST = /^(?:[A-Za-z][A-Za-z0-9_.:-]{0,127})(?: [A-Za-z][A-Za-z0-9_.:-]{0,127})*$/;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
type Row = Record<string, unknown>;
const own = (row: Row, key: string) => Object.prototype.hasOwnProperty.call(row, key);
function record(value: unknown): value is Row { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(row: Row, required: string[], optional: string[] = []): boolean {
  return required.every(key => own(row, key)) && Object.keys(row).every(key => required.includes(key) || optional.includes(key));
}
function hasControl(value: string, allowTextWhitespace: boolean): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 || code === 127) && !(allowTextWhitespace && [9, 10, 13].includes(code))) return true;
  }
  return false;
}
function text(value: unknown, max = 100000, empty = false): value is string {
  return typeof value === "string" && value.length <= max && (empty || value.length > 0)
    && !hasControl(value, true) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}
function safeUrl(value: string, kind: "href" | "src" | "action" | "absolute"): boolean {
  if (!value || value.length > 2048 || hasControl(value, false) || /[\s\\<>"']/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return false;
  if (kind === "href" && value.startsWith("#")) return ID.test(value.slice(1));
  if (kind !== "absolute" && /^\/(?!\/)/.test(value)) {
    try { return new URL(value, "https://serializer.invalid").origin === "https://serializer.invalid"; } catch { return false; }
  }
  if (kind === "action" || !value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
function attributeValue(tag: string, name: string, value: string): boolean {
  if (!text(value, 2048, true)) return false;
  if (BOOLEAN.has(name)) return value === "" || value === name;
  if (name === "href" || name === "src" || name === "action") return safeUrl(value, name);
  if (name === "cite") return safeUrl(value, "href");
  // A single governed picture candidate avoids parsing model-authored srcset lists.
  if (name === "srcset") return !value.includes(",") && safeUrl(value, "src");
  if (name === "id") return ID.test(value);
  if (name === "class") return /^[A-Za-z_][A-Za-z0-9_-]*(?: [A-Za-z_][A-Za-z0-9_-]*)*$/.test(value);
  if (["for", "headers", "aria-labelledby", "aria-describedby", "aria-controls"].includes(name)) return REF_LIST.test(value);
  if (name === "tabindex") return value === "0" || value === "-1";
  if (name === "lang") return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
  if (name === "dir") return ["ltr", "rtl", "auto"].includes(value);
  if (name === "role") return /^(?:main|navigation|region|article|complementary|contentinfo|banner|note|status|alert|group|presentation|none|img|list|listitem|table|row|cell|columnheader|rowheader)$/.test(value);
  if (POSITIVE.has(name)) return /^[1-9]\d{0,4}$/.test(value);
  if (name === "data-count") return /^(?:0|[1-9]\d{0,4})$/.test(value);
  if (name.startsWith("data-")) return /^[A-Za-z0-9][A-Za-z0-9_.:/@ -]{0,255}$/.test(value);
  if (name === "method") return ["get", "post"].includes(value);
  if (name === "enctype") return ["multipart/form-data", "application/x-www-form-urlencoded", "text/plain"].includes(value);
  if (name === "accept-charset") return value.toLowerCase() === "utf-8";
  if (name === "target") return ["_self", "_blank"].includes(value);
  if (name === "rel") return /^(?:nofollow|noopener|noreferrer|external)(?: (?:nofollow|noopener|noreferrer|external))*$/.test(value);
  if (name === "scope") return ["col", "row", "colgroup", "rowgroup"].includes(value);
  if (name === "loading") return ["lazy", "eager"].includes(value);
  if (name === "decoding") return ["async", "sync", "auto"].includes(value);
  if (name === "type" && tag === "input") return ["hidden", "text", "email", "tel", "number", "checkbox", "radio", "file"].includes(value);
  if (name === "type" && tag === "button") return ["button", "submit", "reset"].includes(value);
  if (name === "type" && tag === "source") return ["image/png", "image/webp", "image/jpeg", "image/avif"].includes(value);
  if (name === "type" && tag === "ol") return ["1", "a", "A", "i", "I"].includes(value);
  if (name === "name") return /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(value);
  if (name === "accept") return /^(?:image|audio|video)\/(?:\*|[a-z0-9.+-]+)(?:,(?:image|audio|video)\/(?:\*|[a-z0-9.+-]+))*$/.test(value);
  if (name === "autocomplete") return ["on", "off", "name", "email", "tel", "street-address", "postal-code"].includes(value);
  if (name === "inputmode") return ["none", "text", "tel", "url", "email", "numeric", "decimal", "search"].includes(value);
  if (name === "aria-live") return ["off", "polite", "assertive"].includes(value);
  if (["aria-hidden", "aria-expanded", "aria-atomic", "aria-busy", "aria-disabled", "aria-required", "aria-selected"].includes(name)) return ["true", "false"].includes(value);
  if (["aria-checked", "aria-pressed"].includes(name)) return ["true", "false", "mixed"].includes(value);
  if (name === "aria-current") return ["page", "step", "location", "date", "time", "true", "false"].includes(value);
  if (name === "aria-invalid") return ["true", "false", "grammar", "spelling"].includes(value);
  if (name === "aria-haspopup") return ["false", "true", "menu", "listbox", "tree", "grid", "dialog"].includes(value);
  if (name === "aria-orientation") return ["horizontal", "vertical"].includes(value);
  if (["aria-level", "aria-valuemin", "aria-valuemax", "aria-valuenow", "start", "min", "max", "step"].includes(name)) return /^-?\d+(?:\.\d+)?$/.test(value);
  if (name === "datetime") return text(value, 64) && Number.isFinite(Date.parse(value));
  // Label, placeholder, title, alt and ordinary form value strings are escaped,
  // not interpreted as HTML. Text containing angle brackets remains visible text.
  return true;
}
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");
}
function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
}
function attrs(value: Record<string, string> = {}): string {
  return Object.keys(value).sort().map(key => " " + key + '="' + escapeAttribute(value[key]) + '"').join("");
}
function element(value: DoorV44Element): string {
  const start = "<" + value.tag + attrs(value.attrs) + ">";
  const children = (value.children ?? []).map(child => typeof child === "string" ? escapeText(child) : element(child)).join("");
  // HTML parsing consumes one initial LF in these elements. Duplicate it so
  // the caller's first visible character survives the browser's parsing rule.
  const prefix = ["textarea", "pre"].includes(value.tag) && children.startsWith("\n") ? "\n" : "";
  return VOID.has(value.tag) ? start : start + prefix + children + "</" + value.tag + ">";
}
function meta(name: string, content: string, property = false): string {
  return "<meta" + attrs({ [property ? "property" : "name"]: name, content }) + ">";
}
function scriptJson(value: unknown): string {
  return stableDoorJson(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

/** Pure semantic serializer. No raw markup, theme code, filesystem, clock or I/O. */
export function renderDoorV44Document(input: unknown): DoorV44RenderResult {
  const errors: DoorV44Diagnostic[] = [];
  const fail = (code: string, pointer: string) => { errors.push({ code, pointer }); };
  try {
    // Check descriptors before reading any fields: getters and hostile prototypes
    // must never be invoked by the renderer or by a stringify operation.
    if (!isPlainDoorJson(input) || !record(input)) return { ok: false, errors: [{ code: "RENDER_INPUT_INVALID", pointer: "" }] };
    if (!keys(input, ["title", "description", "canonical_url", "robots", "site_name", "lang", "receipt_id", "date_modified", "structured_data", "body"], ["social_image"])) {
      fail("RENDER_DOCUMENT_INVALID", "");
    }
    for (const key of ["title", "description", "site_name", "receipt_id"] as const) if (!text(input[key], key === "receipt_id" ? 128 : 1000)) fail("RENDER_DOCUMENT_INVALID", "/" + key);
    if (typeof input.receipt_id === "string" && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.receipt_id)) fail("RENDER_DOCUMENT_INVALID", "/receipt_id");
    if (typeof input.canonical_url !== "string" || !safeUrl(input.canonical_url, "absolute")) fail("RENDER_URL_INVALID", "/canonical_url");
    else {
      const canonical = new URL(input.canonical_url);
      if (canonical.hash || canonical.search) fail("RENDER_URL_INVALID", "/canonical_url");
    }
    if (!["noindex,nofollow", "noindex,follow", "index,follow"].includes(String(input.robots)) || input.lang !== "en-US") fail("RENDER_DOCUMENT_INVALID", "");
    if (input.date_modified !== null && (typeof input.date_modified !== "string" || input.date_modified.length > 64 || !DATE.test(input.date_modified) || !Number.isFinite(Date.parse(input.date_modified)))) fail("RENDER_DOCUMENT_INVALID", "/date_modified");
    if (!Array.isArray(input.structured_data) || input.structured_data.length > 30 || !input.structured_data.every(record)) fail("RENDER_DOCUMENT_INVALID", "/structured_data");
    if (own(input, "social_image")) {
      const image = input.social_image;
      if (!record(image) || !keys(image, ["url", "alt", "width", "height", "mime"])) fail("RENDER_DOCUMENT_INVALID", "/social_image");
      else {
        if (typeof image.url !== "string" || !safeUrl(image.url, "absolute")) fail("RENDER_URL_INVALID", "/social_image/url");
        if (!text(image.alt, 1000)) fail("RENDER_DOCUMENT_INVALID", "/social_image/alt");
        for (const name of ["width", "height"] as const) if (!Number.isInteger(image[name]) || Number(image[name]) < 1 || Number(image[name]) > 8192) fail("RENDER_DOCUMENT_INVALID", "/social_image/" + name);
        if (!["image/png", "image/webp", "image/jpeg", "image/avif"].includes(String(image.mime))) fail("RENDER_DOCUMENT_INVALID", "/social_image/mime");
      }
    }
    const ids = new Set<string>();
    let count = 0;
    function checkElement(node: unknown, pointer: string, ancestors: string[] = []): void {
      if (++count > 15000 || ancestors.length > 32) { fail("RENDER_LIMIT_EXCEEDED", pointer); return; }
      if (!record(node) || !keys(node, ["tag"], ["attrs", "children"]) || typeof node.tag !== "string" || !TAGS.has(node.tag)) {
        fail("RENDER_ELEMENT_INVALID", pointer); return;
      }
      const tag = node.tag;
      if (REQUIRED_PARENTS[tag] && !REQUIRED_PARENTS[tag].includes(ancestors.at(-1) ?? "")) fail("RENDER_ELEMENT_INVALID", pointer);
      const attributes = node.attrs ?? {};
      if (!record(attributes) || (own(node, "attrs") && node.attrs === null)) { fail("RENDER_ATTRIBUTE_INVALID", pointer + "/attrs"); return; }
      for (const [name, value] of Object.entries(attributes)) {
        const known = GLOBAL.has(name) || ARIA.has(name) || DATA.has(name) || TAG_ATTRS[tag]?.includes(name);
        if (!known || typeof value !== "string" || !attributeValue(tag, name, value)) fail("RENDER_ATTRIBUTE_INVALID", pointer + "/attrs" + (known ? "/" + name : ""));
      }
      if (typeof attributes.id === "string") {
        if (ids.has(attributes.id)) fail("RENDER_ELEMENT_INVALID", pointer + "/attrs/id");
        ids.add(attributes.id);
      }
      if (tag === "img" && !["src", "alt", "width", "height"].every(key => own(attributes, key))) fail("RENDER_ELEMENT_INVALID", pointer + "/attrs");
      if (tag === "source" && !["srcset", "type"].every(key => own(attributes, key))) fail("RENDER_ELEMENT_INVALID", pointer + "/attrs");
      if (tag === "form" && (!["action", "method"].every(key => own(attributes, key)) || ancestors.includes("form"))) fail("RENDER_ELEMENT_INVALID", pointer + "/attrs");
      if (tag === "button" && !own(attributes, "type")) fail("RENDER_ELEMENT_INVALID", pointer + "/attrs/type");
      if (tag === "input" && !own(attributes, "type")) fail("RENDER_ELEMENT_INVALID", pointer + "/attrs/type");
      if (tag === "a" && attributes.target === "_blank" && !(typeof attributes.rel === "string" && attributes.rel.split(" ").includes("noopener"))) fail("RENDER_ATTRIBUTE_INVALID", pointer + "/attrs/rel");
      if ((tag === "a" && ancestors.includes("a")) || (["a", "button", "input", "textarea", "select", "details"].includes(tag) && ancestors.includes("button"))) fail("RENDER_ELEMENT_INVALID", pointer);
      const children = node.children ?? [];
      if (!Array.isArray(children) || (own(node, "children") && node.children === null)) { fail("RENDER_ELEMENT_INVALID", pointer + "/children"); return; }
      if (VOID.has(tag) && children.length) fail("RENDER_ELEMENT_INVALID", pointer + "/children");
      children.forEach((child, index) => {
        const childPointer = pointer + "/children/" + index;
        if (typeof child === "string") {
          if (!text(child, 100000, true)) fail("RENDER_TEXT_INVALID", childPointer);
          if (["ul", "ol", "table", "thead", "tbody", "tfoot", "tr", "colgroup", "select", "optgroup", "picture"].includes(tag) && child.trim()) fail("RENDER_ELEMENT_INVALID", childPointer);
          return;
        }
        if (["textarea", "option"].includes(tag)) fail("RENDER_ELEMENT_INVALID", childPointer);
        if (PHRASING_PARENTS.has(tag) && (!record(child) || !PHRASING.has(String(child.tag)))) fail("RENDER_ELEMENT_INVALID", childPointer);
        const allowedChildren: Record<string, string[]> = { ul: ["li"], ol: ["li"], table: ["caption", "colgroup", "thead", "tbody", "tfoot", "tr"], thead: ["tr"], tbody: ["tr"], tfoot: ["tr"], tr: ["th", "td"], colgroup: ["col"], select: ["option", "optgroup"], optgroup: ["option"], picture: ["source", "img"] };
        if (allowedChildren[tag] && (!record(child) || !allowedChildren[tag].includes(String(child.tag)))) fail("RENDER_ELEMENT_INVALID", childPointer);
        checkElement(child, childPointer, [...ancestors, tag]);
      });
    }
    if (!Array.isArray(input.body) || input.body.length === 0) fail("RENDER_DOCUMENT_INVALID", "/body");
    else input.body.forEach((node, index) => checkElement(node, "/body/" + index));
    if (errors.length) return { ok: false, errors: sortDoorV44Diagnostics(errors) };
    const document = input as unknown as DoorV44Document;
    const head = [
      '<meta charset="utf-8">',
      meta("viewport", "width=device-width, initial-scale=1"),
      "<title>" + escapeText(document.title) + "</title>",
      meta("description", document.description),
      '<link' + attrs({ rel: "canonical", href: document.canonical_url }) + ">",
      meta("robots", document.robots),
      meta("og:type", "article", true), meta("og:site_name", document.site_name, true),
      meta("og:title", document.title, true), meta("og:description", document.description, true),
      meta("og:url", document.canonical_url, true),
      meta("twitter:card", document.social_image ? "summary_large_image" : "summary"),
      meta("twitter:title", document.title), meta("twitter:description", document.description),
      meta("twitter:url", document.canonical_url),
      meta("door:receipt-id", document.receipt_id),
    ];
    if (document.date_modified) head.push(meta("article:modified_time", document.date_modified, true));
    if (document.social_image) {
      const image = document.social_image;
      head.push(meta("og:image", image.url, true), meta("og:image:alt", image.alt, true),
        meta("og:image:width", String(image.width), true), meta("og:image:height", String(image.height), true),
        meta("og:image:type", image.mime, true), meta("twitter:image", image.url), meta("twitter:image:alt", image.alt));
    }
    document.structured_data.forEach(row => head.push('<script type="application/ld+json">' + scriptJson(row) + "</script>"));
    const html = '<!doctype html>\n<html lang="' + document.lang + '">\n<head>\n' + head.join("\n") + "\n</head>\n<body>\n" + document.body.map(element).join("") + "\n</body>\n</html>\n";
    const { receipt_id: _receiptId, ...semantic } = document;
    return { ok: true, html, html_hash: hash(html), semantic_hash: hash(stableDoorJson(semantic)) };
  } catch {
    return { ok: false, errors: [{ code: "RENDER_INPUT_INVALID", pointer: "" }] };
  }
}
