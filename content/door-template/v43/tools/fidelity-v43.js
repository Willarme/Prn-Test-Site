"use strict";
const crypto = require("crypto");

// Independently supplied, already approved source; never generated from the kit.
// LF normalization is the only normalization applied before checking this hash.
const SOURCE_SHA256 = "756fb95907fd3fb21f7bc9a86e854d0e90f8ef35455776b83a17b4935f8d8843";
const LF = (s) => s.replace(/\r\n/g, "\n");
const sha256 = (s) => crypto.createHash("sha256").update(LF(s)).digest("hex");
const OLD_ANCHOR = [
  "    if(snapEnabled){",
  "      animateScrollTo(t.getBoundingClientRect().top+(w.scrollY||0)-scrollPadTop());",
  "    } else {",
  "      t.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});",
  "    }",
].join("\n");
const FIXED_ANCHOR = "    t.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});";

function compareV43(reference, candidate, dateModified) {
  if (sha256(reference) !== SOURCE_SHA256) throw new Error("The independent v43 reference changed; do not rebaseline to a generated output.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateModified)) throw new Error("A real derived content date is required.");
  let expected = LF(reference);
  if (expected.split(OLD_ANCHOR).length !== 2) throw new Error("The approved anchor-repair source does not match exactly once.");
  if (expected.split('"dateModified": "2026-09-01"').length !== 2) throw new Error("The approved source date does not match exactly once.");
  // The complete allow-list: dated build metadata and the already-verified
  // undefined-variable repair. No CSS, visible words, markup or order is masked.
  expected = expected.replace(OLD_ANCHOR, FIXED_ANCHOR)
    .replace('"dateModified": "2026-09-01"', '"dateModified": "' + dateModified + '"');
  const actual = LF(candidate);
  let firstDiff = -1;
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    if (expected[i] !== actual[i]) { firstDiff = i; break; }
  }
  return { pass: firstDiff === -1, firstDiff, line: firstDiff < 0 ? null : expected.slice(0, firstDiff).split("\n").length,
    allowed: ["derived dateModified", "exact normal-flow anchor repair"], sourceSha256: SOURCE_SHA256 };
}
module.exports = { compareV43, SOURCE_SHA256, OLD_ANCHOR, FIXED_ANCHOR };
