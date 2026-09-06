"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { build } = require("../build.js");
const { compareV43 } = require("./fidelity-v43.js");
const kit = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(kit, "..", "AC Problem Page LIVE v43.html"), "utf8");
const result = build(path.join(kit, "spec/ac-blowing-warm-air"), path.join(kit, "TEMPLATE_SECTION_ORDER.json"));
assert.equal(compareV43(source, result.html, result.dateModified).pass, true);
assert.equal(compareV43(source.replace(/\r?\n/g, "\r\n"), result.html, result.dateModified).pass, true);
for (const [name, from, to] of [
  ["copy", "What is your AC doing right now?", "What is the problem?"],
  ["CSS", "letter-spacing:.07em!important", "letter-spacing:.08em!important"],
  ["section ID", 'id="related"', 'id="related-changed"'],
  ["date", '"dateModified": "' + result.dateModified + '"', '"dateModified": "2099-01-01"'],
]) {
  assert.ok(result.html.includes(from), name + " mutation must reach the artifact");
  assert.equal(compareV43(source, result.html.replace(from, to), result.dateModified).pass, false, name + " must fail");
}
assert.throws(() => compareV43(source.replace("<html", "<HTML"), result.html, result.dateModified), /reference changed/);
console.log("FIDELITY V43: 7 scenarios passed (real build, CRLF, copy, CSS, section, date, reference tamper)");
