#!/usr/bin/env node
/* build.js — assembles ONE PRN door page from the template partials and ONE spec folder.

     node build.js spec/ac-blowing-warm-air                       # → out/ac-blowing-warm-air.html
     node build.js spec/ac-blowing-warm-air --order TEMPLATE_SECTION_ORDER.json --out "../AC Problem Page LIVE v42.html"

   Deterministic by construction: same inputs → same bytes. No model call, no network, no randomness.
   Every visible string is either TEMPLATE-CONSTANT (lives in template/) or PER-PAGE (lives in the
   spec folder). A slot with no value FAILS the build — nothing renders empty or invented.

   Slot syntax (chosen because "{%" appears nowhere in v41, and "{{site.name}}" must pass through untouched):
     {%page.title%}              a value from spec/<file>.json, namespaced by the file's stem
     {%each stats.cards%} … {%/each%}   repeat for every item; inside: {%.field%}  {%.%}  {%@i%} (1-based)  {%@n%} (count)  {%..field%} (parent item)
     {%if related.links%} … {%/if%}     render only when the value is truthy and not an empty array
     {%file visuals.plates.0.file%}     inline a file from the spec folder, verbatim (the SVG plates)
     {%extract visuals.plates.0.file title%}   the inner text of the first <title> in that file (the JSON-LD mirrors the drawing's own words)
     {%json accents.map%}               JSON.stringify of a value (the one runtime script that carries per-page data)

   Section order lives in TEMPLATE_SECTION_ORDER.json and NOWHERE else. build.js hardcodes no position.
   Structural facts it does enforce (see README §constraints): HERO is first and INTAKE is its child;
   RELATED (if present) sits directly before CLOSER because the two share one dark chapter; CLOSER is last. */
"use strict";
const fs = require("fs");
const path = require("path");

const KIT = __dirname;
const T = path.join(KIT, "template");

// ---------- section registry: key → partial file + the structural facts build.js needs ----------
const SECTIONS = {
  HERO: { file: "sections/hero.html", tint: "hero", required: true },
  INTAKE: { child_of: "HERO", required: true }, // rendered inside hero.html; listed so the ruling can name it
  STAT_CARDS: { file: "sections/stats.html", tint: "paper", required: true },
  THE_FLIP: { file: "sections/flip.html", tint: "paper", required: true },
  JOB_PACKET: { file: "sections/job-packet.html", tint: "warm", required: true },
  GENERAL_VS_YOURS: { file: "sections/general-vs-yours.html", tint: "paper", required: true },
  CAPABILITY_QUESTIONS: { file: "sections/capability-questions.html", tint: "dark", required: true },
  WHAT_CHANGES_THE_ANSWER: { file: "sections/observations.html", tint: "paper", required: true },
  VISUALS: { file: "sections/visuals.html", tint: "dark", required: true },
  COMMON_POSSIBILITIES: { file: "sections/common-causes.html", tint: "dark", required: true },
  SAFE_OBSERVATIONS: { file: "sections/what-to-check.html", tint: "paper", required: true },
  REPAIR_RECORD: { file: "sections/repair-record.html", tint: "warm", required: true },
  FAQ: { file: "sections/faq.html", tint: "paper", required: true },
  RELATED: { file: "sections/related.html", tint: "dark", required: false }, // CONDITIONAL: omit when no sibling door exists
  CLOSER: { file: "sections/closer.html", tint: "dark", required: true },
};

// ---------- the tiny deterministic template engine ----------
function readUtf8(p) { return fs.readFileSync(p, "utf8"); }

/* Sidecars: .json files that live in the spec folder but are NOT page data. They are machine records
   kept beside the page (tools/build-capability-manifest.js reads the capability registry), so
   loadSpec skips them entirely - no namespace, no slots, and verify.js's "every spec leaf reaches
   the page" check never sees them. Nothing here renders. */
const SPEC_SIDECARS = new Set(["capability-registry.json"]);

function loadSpec(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("spec folder not found: " + dir);
  const spec = { $dir: dir };
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json") || SPEC_SIDECARS.has(f)) continue;
    const key = f.replace(/\.json$/, "");
    try { spec[key] = JSON.parse(readUtf8(path.join(dir, f))); }
    catch (e) { throw new Error("spec file " + f + " is not valid JSON: " + e.message); }
    // keys starting with "_" are documentation for the next author (e.g. _what) and are never rendered — skip them
    (function walk(o, at) { for (const [k, v] of Object.entries(o)) { if (String(k).startsWith("_")) continue; const q = at + "." + k; if (v && typeof v === "object") walk(v, q); else if (typeof v === "string" && v.includes("{%")) throw new Error("spec " + f + " carries a slot marker inside a value at " + q + " — spec values are literal text, never templates"); } })(spec[key], key);
  }
  return spec;
}

function lookup(ref, ctx, spec) {
  if (ref === "@i") return ctx.i;
  if (ref === "@n") return ctx.n;
  if (ref === ".") return ctx.item;
  // {%ref|default%} — a default used ONLY when the key is absent. Reserved for layout/whitespace
  // fields that keep a rebuilt v41 byte-identical (e.g. the sources list's indentation); never for copy.
  const bar = ref.indexOf("|");
  if (bar > -1) {
    const dflt = ref.slice(bar + 1).replace(/\\n/g, "\n");
    try { return lookup(ref.slice(0, bar), ctx, spec); } catch (e) { if (/^missing slot value/.test(e.message)) return dflt; throw e; }
  }
  let base, p;
  if (ref.startsWith("..")) { base = ctx.parent && ctx.parent.item; p = ref.slice(2); }
  else if (ref.startsWith(".")) { base = ctx.item; p = ref.slice(1); }
  else { base = spec; p = ref; }
  if (p === "") return base;
  const v = p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), base);
  if (v === undefined) throw new Error("missing slot value: {%" + ref + "%} — add it to the spec; nothing renders empty");
  return v;
}
function asString(ref, v) {
  if (typeof v === "string") { if (v === "" && ref.indexOf("|") === -1) throw new Error("slot {%" + ref + "%} is an EMPTY string — fill it, or remove the element; only layout fields may default to empty via |"); return v; }
  if (typeof v === "number") return String(v);
  throw new Error("slot {%" + ref + "%} is not a string (got " + (Array.isArray(v) ? "array" : typeof v) + ")");
}
function findBlockEnd(tpl, from, kind) {
  const open = new RegExp("\\{%\\s*" + kind + "\\s", "g");
  const close = new RegExp("\\{%\\s*/" + kind + "\\s*%\\}", "g");
  let depth = 1, pos = from;
  for (;;) {
    open.lastIndex = pos; close.lastIndex = pos;
    const o = open.exec(tpl), c = close.exec(tpl);
    if (!c) throw new Error("unclosed {%" + kind + "%} block");
    if (o && o.index < c.index) { depth++; pos = o.index + o[0].length; }
    else { depth--; if (depth === 0) return [tpl.slice(from, c.index), c.index + c[0].length]; pos = c.index + c[0].length; }
  }
}
function render(tpl, ctx, spec) {
  const TOK = /\{%(.*?)%\}/g;
  let out = "", i = 0, m;
  while ((m = TOK.exec(tpl))) {
    out += tpl.slice(i, m.index);
    i = TOK.lastIndex;
    // the expression is trimmed; a |default keeps its whitespace verbatim (it may BE whitespace)
    const raw = m[1], bar = raw.indexOf("|");
    const expr = bar > -1 ? raw.slice(0, bar).trim() + "|" + raw.slice(bar + 1) : raw.trim();
    if (expr.startsWith("each ")) {
      const [body, end] = findBlockEnd(tpl, i, "each"); i = end; TOK.lastIndex = i;
      const ref = expr.slice(5).trim();
      const arr = lookup(ref, ctx, spec);
      if (!Array.isArray(arr)) throw new Error("{%each " + ref + "%} is not an array");
      arr.forEach((item, k) => { out += render(body, { item, i: k + 1, n: arr.length, parent: ctx }, spec); });
    } else if (expr.startsWith("if ")) {
      const [body, end] = findBlockEnd(tpl, i, "if"); i = end; TOK.lastIndex = i;
      // an ABSENT value is simply false here — {%if%} is how a spec opts out of an optional block
      let v; try { v = lookup(expr.slice(3).trim(), ctx, spec); } catch (e) { if (/^missing slot value/.test(e.message)) v = false; else throw e; }
      const truthy = Array.isArray(v) ? v.length > 0 : !!v;
      if (truthy) out += render(body, ctx, spec);
    } else if (expr.startsWith("file ")) {
      const p = asString(expr, lookup(expr.slice(5).trim(), ctx, spec));
      const fp = path.join(spec.$dir, p);
      if (!fs.existsSync(fp)) throw new Error("{%" + expr + "%} → " + p + " does not exist in the spec folder (" + spec.$dir + ")");
      out += readUtf8(fp);
    } else if (expr.startsWith("extract ")) {
      const [, ref, tag] = expr.split(/\s+/);
      const p = asString(ref, lookup(ref, ctx, spec));
      const fp = path.join(spec.$dir, p);
      if (!fs.existsSync(fp)) throw new Error("{%" + expr + "%} → " + p + " does not exist in the spec folder (" + spec.$dir + ")");
      const s = readUtf8(fp);
      const mm = s.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">"));
      if (!mm) throw new Error("{%extract%}: no <" + tag + "> in " + p);
      out += mm[1];
    } else if (expr.startsWith("json ")) {
      out += JSON.stringify(lookup(expr.slice(5).trim(), ctx, spec));
    } else if (expr.startsWith("pluck ")) {
      // {%pluck list field flag%} → JSON array of item[field] for the items whose item[flag] is truthy
      const [, ref, field, flag] = expr.split(/\s+/);
      const arr = lookup(ref, ctx, spec);
      if (!Array.isArray(arr)) throw new Error("{%pluck " + ref + "%} is not an array");
      out += JSON.stringify(arr.filter((x) => !flag || x[flag]).map((x) => { if (x[field] === undefined) throw new Error("{%pluck%}: item lacks " + field); return x[field]; }));
    } else if (expr.startsWith("@sep ")) {
      // {%@sep ,%} — emits the text between repeated items (nothing after the last one)
      if (ctx.i !== undefined && ctx.i < ctx.n) out += expr.slice(5);
    } else {
      out += asString(expr, lookup(expr, ctx, spec));
    }
  }
  return out + tpl.slice(i);
}

/* ---------- dateModified: derived from a real signal, never hand-typed ----------
   Completion-plan item 4 (P0). v41 hard-codes "2026-09-01" in the JSON-LD while the approved build is
   2026-09-05 - exactly the failure the plan names: the rendered page changed and the date did not.
   So the date is no longer a spec value at all. build.js derives it from the newest modification time
   across the inputs that actually produce this page: the spec folder, the template folder, and the
   order file. Nothing else can move it, and nothing can hand-type it (page.json carrying the key is a
   build FAILURE - see build() below).

     - Deterministic. The same files, untouched, always yield the same date. This is NOT "now" at
       render time: rebuilding a week from now without editing anything still says 2026-09-05.
     - Honest. It cannot claim a freshness the content does not have, and it cannot go stale either.
     - Local calendar date, because that is the day the owner edited the page. Deliberately not UTC:
       an evening edit must not publish as tomorrow.

   KNOWN LIMIT, for A06 and for whoever wires the release pipeline: mtimes do not survive a git clone.
   On a clean checkout every file carries the checkout time, so a CI build would stamp the checkout
   date, not the content date. Release from the working tree, or have the pipeline pass the approved
   content version's real timestamp in as opts.dateModified. Do not "fix" this by typing a date. */
function derivedDateModified() {
  const roots = Array.prototype.slice.call(arguments);
  let newestMs = 0, newestFrom = null;
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
    if (st.mtimeMs > newestMs) { newestMs = st.mtimeMs; newestFrom = p; }
  };
  for (const r of roots) if (r && fs.existsSync(r)) walk(r);
  if (!newestMs) throw new Error("dateModified: none of the page's input paths exist - cannot date the page from a real signal, and a date is never invented");
  const d = new Date(newestMs);
  const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  return { date: iso, from: newestFrom, ms: newestMs };
}

// ---------- order ----------
function loadOrder(file) {
  const j = JSON.parse(readUtf8(file));
  const order = Array.isArray(j) ? j : j.order;
  if (!Array.isArray(order) || !order.length) throw new Error("order file must carry an \"order\" array");
  return { order, meta: Array.isArray(j) ? {} : j };
}
function validateOrder(order, spec) {
  const keys = Object.keys(SECTIONS);
  const seen = new Set();
  for (const k of order) {
    if (!SECTIONS[k]) throw new Error("unknown section key in order: " + k + " (known: " + keys.join(", ") + ")");
    if (seen.has(k)) throw new Error("section listed twice in order: " + k);
    seen.add(k);
  }
  for (const k of keys) {
    if (!seen.has(k) && SECTIONS[k].required) throw new Error("required section missing from order: " + k);
  }
  if (order[0] !== "HERO") throw new Error("HERO must be first: it holds the H1 and the intake console (a build change, not a reorder)");
  if (order[1] !== "INTAKE") throw new Error("INTAKE must be second: it is a child of HERO's grid in the template (moving it is a build change, not a reorder)");
  if (order[order.length - 1] !== "CLOSER") throw new Error("CLOSER must be last: it is the return to the intake; anything after it competes with the CTA");
  const ri = order.indexOf("RELATED");
  if (ri > -1 && order[ri + 1] !== "CLOSER") throw new Error("RELATED must sit directly before CLOSER: the two share one dark chapter (#related-closer); separating them is a build change");
  if (ri === -1 && spec.related && Array.isArray(spec.related.links) && spec.related.links.length) {
    console.warn("warning: RELATED is omitted from the order but the spec carries " + spec.related.links.length + " related link(s)");
  }
  // tint adjacency (README §constraints): report, never fail — v41 itself ships VISUALS next to COMMON_POSSIBILITIES.
  const warn = [];
  for (let i = 2; i < order.length - 1; i++) {
    const a = SECTIONS[order[i]], b = SECTIONS[order[i + 1]];
    if (a && b && a.tint && a.tint === b.tint && a.tint !== "paper") warn.push(order[i] + " → " + order[i + 1] + " (" + a.tint + ")");
  }
  return warn;
}

// ---------- assembly ----------
function build(specDir, orderFile, opts) {
  const spec = loadSpec(specDir);
  const { order } = loadOrder(orderFile);
  const warnings = validateOrder(order, spec);

  // dateModified is derived, not authored. A spec that carries it is a mistake, and a silent override
  // would be worse than the stale date it replaces - so say so and stop.
  if (spec.page && spec.page.date_modified !== undefined) {
    throw new Error('spec page.json carries a hand-typed "date_modified" - build.js derives dateModified from the newest mtime across the spec, the template and the order file (completion-plan item 4). Delete the key; the _date_modified note in page.json explains why.');
  }
  // opts.dateModified: pin the derived date. ONLY for a test harness comparing two builds like for
  // like (verify.js's slot-mutation check), or for a release pipeline handing in the approved content
  // version's real timestamp. Never a way to type a date that is not true.
  const stamp = (opts && opts.dateModified)
    ? { date: opts.dateModified, from: "(pinned by caller)", ms: null }
    : derivedDateModified(specDir, T, orderFile);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp.date)) throw new Error("dateModified is not an ISO calendar date: " + stamp.date);
  spec.page.date_modified = stamp.date;
  const tpl = (f) => readUtf8(path.join(T, f));
  const R = (f) => render(tpl(f), {}, spec);
  let html = "";
  html += R("head-open.html");
  html += R("tokens.css");
  html += tpl("styles.css");            // template-constant, verbatim, never rendered
  html += tpl("head-close.html");
  html += R("chrome-top.html");
  const dropped = [];
  html += R(SECTIONS.HERO.file);         // INTAKE renders inside it
  order.slice(2).forEach((k, idx) => {
    if (k === "RELATED" || (k === "CLOSER" && !order.includes("RELATED"))) html += '<div class="chapter dark" id="related-closer">\n';
    let sec = R(SECTIONS[k].file);
    if (!sec.startsWith("<!-- ================= ")) throw new Error("section partial must open with its marker comment: " + SECTIONS[k].file);
    // TINT RULE (design doc 3.2): two adjacent light-tinted sections never share a tint; the second drops it.
    const prevKey = idx === 0 ? null : order.slice(2)[idx - 1];
    const prev = prevKey && SECTIONS[prevKey], cur = SECTIONS[k];
    if (prev && cur.tint === prev.tint && (cur.tint === "warm" || cur.tint === "cool")) {
      const before = sec;
      sec = sec.replace(/<section class="sec tint tint-(warm|cool) chapter"/, '<section class="sec chapter"');
      if (sec === before) throw new Error("tint rule: could not find the tint class on " + k);
      dropped.push(k + " (was " + cur.tint + ", after " + prevKey + ")");
    }
    if (idx === 0) {
      // The .manual wrapper opens right after the marker comment of whichever section comes third
      // (in v41 that is STAT CARDS: marker on line 2474, <div class="manual"> on 2475). Whatever the
      // ruled order, the wrapper follows the third section's marker, so v41 rebuilds byte for byte
      // and any reorder keeps the same structure.
      const nl = sec.indexOf("\n") + 1;
      sec = sec.slice(0, nl) + '<div class="manual">\n' + sec.slice(nl);
    }
    html += sec;
  });
  html += R("colophon.html");
  html += "</div>\n</div>\n\n";         // closes #related-closer, closes .manual, the blank line before the JSON-LD
  html += R("jsonld.html");
  html += R("scripts.html");
  html += tpl("tail.html");
  // Line endings: v41 is 100% CRLF (3910 CRLF, 0 bare LF). Three literals in the assembly above
  // (the .manual wrapper, the #related-closer opener and the closing </div>s) emit a bare LF,
  // which is 15 characters and was the ONLY reason the BYTES check failed. Text, gates and slots
  // were already identical. Normalise the document to CRLF so the kit meets its own contract.
  // LF is the canonical form (what git stores); verify.js compares modulo line endings and says which
  // convention it saw, so the kit passes on a machine whose git checks files out as CRLF and on one that does not.
  html = html.replace(/\r\n/g, "\n");
  if (!/\{\{site\.name\}\}/.test(html)) throw new Error("the {{site.name}} brand token must survive the build (it is substituted at site render time)");
  if (/\{%/.test(html)) throw new Error("an unrendered slot marker survived the build: " + html.match(/\{%[^%]*%\}/)[0]);
  return { html, warnings, spec, order, dropped, dateModified: stamp.date, dateModifiedFrom: stamp.from };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const specDir = args.find((a) => !a.startsWith("--"));
  if (!specDir) { console.error("usage: node build.js <spec-dir> [--order file] [--out file]"); process.exit(2); }
  const opt = (name, dflt) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : dflt; };
  // an EXPLICIT --order/--out resolves against the caller's cwd (like the spec dir); only the defaults resolve against the kit
  const resolveArg = (name, dflt) => (args.includes(name) ? path.resolve(process.cwd(), opt(name)) : path.resolve(KIT, dflt));
  const orderFile = resolveArg("--order", "TEMPLATE_SECTION_ORDER.json");
  const outFile = resolveArg("--out", path.join("out", path.basename(specDir) + ".html"));
  try {
    const { html, warnings, order, dropped, dateModified, dateModifiedFrom } = build(path.resolve(process.cwd(), specDir), orderFile);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, html, "utf8");
    for (const w of warnings) console.warn("  tint  adjacent same-tint sections: " + w);
    for (const d of (dropped || [])) console.warn("  tint  dropped by the tint rule: " + d);
    console.log("  built " + outFile + " (" + html.length + " chars) · order: " + order.join(" → "));
    console.log("  dateModified " + dateModified + "  (derived from the newest input mtime: " + path.relative(KIT, dateModifiedFrom) + ")");
  } catch (e) { console.error("  BUILD FAILED: " + e.message); process.exit(1); }
}
module.exports = { build, render, loadSpec, SECTIONS };
