import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderPacketHtml, textOf, PacketHaltError } from "@/domain/packet/render";
import { assembleScript } from "@/domain/packet/script";
import { guardCopy } from "@/domain/packet/self-check";
import type { DirectionsInput } from "@/domain/packet/types";
import { referenceInput, thinInput } from "./loop.p1.fixtures";

/**
 * THE RENDERER AGAINST THE DIRECTIONS AND THE MOCKUP (track P1).
 *
 * The §3.2 reference input must render MOCKUP-1's frozen strings byte for
 * byte; the §3.5 constraints and the §10.4 self-check must pass on it; the
 * thin request (§8, §11.3) must shrink honestly; the hazard halt (§9.2) must
 * stop pages 2 and 3; the copy guard (§10.1) must refuse the things Melissa's
 * checklist F7/F8 type in.
 */
// Exact approved synthetic MOCKUP-1 reference, committed for portable fidelity checks.
const MOCKUP = join(process.cwd(), "tests", "fixtures", "loop", "MOCKUP-1-job-packet-pdf.html");
const MOCKUP_SCRIPT =
  `"Hi — my AC is running but blowing warm air. It's a Carrier split system, about eight years old, model <span class="x-mono">24ABC636A003</span>. Started gradually on Tuesday. The thermostat's set to 70 and the room's at 78, the outdoor unit is running and the fan's turning, the filter's clean and three weeks old, and there's no ice I can see. I've got photos and a Job Packet I can send you before you come out."`;

const VERBATIM = [
  "Page 1 — for the homeowner",
  "Go Live &nbsp;·&nbsp; Property Response Network",
  "Your Job Packet",
  "What is in here",
  "In your own words, kept exactly as you said it.",
  "Dated, labelled, pointed at the right part.",
  "Each one with what it ruled out.",
  "Less time diagnosing can mean fewer hours on the bill.",
  "Opens already filled in",
  "Your house is an asset with amnesia.",
  "Scan this and everything in this packet is already saved — the model number, the photos, what was wrong and what fixed it.",
  "They answer in a tap",
  "You already know someone who knows someone.",
  "Ask your own people who they would send to their sister's house, or send this packet straight to the guy you already trust.",
  "If you would rather call someone",
  "Read this out when they pick up.",
  "You stop carrying your home in your head.",
  "You get your life back.",
  "<b>The rest of this packet</b> is written for whoever fixes it. Hand over the whole thing — you don't have to explain it again.",
  "A preparation record · the technician does their own testing on site · the price stays theirs to set",
  "Page 2 — for the provider · head start · executive summary",
  "What the homeowner is dealing with",
  "The seven facts worth reading first",
  "Still unknown — and why",
  "Technician-only, on arrival",
  "Facts captured",
  "Made less likely",
  "Tech-only left",
  "Specific to this home and request · facts separated from inference · packet v3 · 3 Sep 2026 · not a remote diagnosis",
  "Page 3 — for the provider · detail",
  "Checks completed, and what each one changed",
  "Service history, as the homeowner knows it",
  "Asked at intake so you don't have to. Anything the homeowner didn't know is shown as a recorded gap, never guessed.",
  "Where the evidence points",
  "These are reasoning from the evidence above, offered to save discovery time. <b>They are not a diagnosis</b> and the technician's own tests decide.",
  "optional at intake · blanks are honest, not missing",
  "Scope factors to evaluate",
  "No prices are stated in this packet. These are factors for the provider to price.",
  "How to read the labels in this packet",
  "Packet v3 · generated 3 Sep 2026 · prepared from the homeowner's own evidence · a preparation record, not an inspection or a guarantee",
];

describe("P1 · the reference input renders the mockup", () => {
  const withLink = (): DirectionsInput => {
    const r = referenceInput();
    return { ...r, config: { ...r.config, media_link: "https://golive.com/media/x" } };
  };

  it("passes its own self-check, is not halted, and carries every VERBATIM string byte for byte", () => {
    const r = renderPacketHtml(withLink());
    expect(r.halted).toBe(false);
    expect(r.self_check).toEqual({ ok: true, failures: [], notes: [] });
    for (const s of VERBATIM) expect(r.html, s).toContain(s);
  });

  it("renders the urgency tag, the five counters 18·5·4·3·5, and the mockup's call script byte-identical", () => {
    const r = renderPacketHtml(withLink());
    expect(r.html).toContain('<span class="urg">As soon as possible · not a safety hazard</span>');
    const counters = [...r.html.matchAll(/<div class="n">(\d+)<\/div><div class="l">([^<]+)<\/div>/g)].map((m) => [m[2], m[1]]);
    expect(counters).toEqual([["Facts captured", "18"], ["Photos", "5"], ["Checks done", "4"], ["Made less likely", "3"], ["Tech-only left", "5"]]);
    expect(r.html).toContain(`<p>${MOCKUP_SCRIPT}</p>`);
  });

  it("the page-2 and page-3 text is the mockup's text, apart from the two documented deviations", () => {
    const mock = readFileSync(MOCKUP, "utf8").replace(/<div class="note">[\s\S]*?<\/div>/, "");
    const split = (s: string) => new Set(textOf(s).split(/(?<=[.?!])\s+|(?=Page \d)/).map((x) => x.trim()));
    const a = split(mock);
    const b = split(renderPacketHtml(withLink()).html);
    const onlyMock = [...a].filter((s) => !b.has(s));
    const onlyRender = [...b].filter((s) => !a.has(s));
    // 1: the mockup's own title; 2: the page-2 header gains the decision-7A provider link chip;
    // 3: the final timeline row carries generated_at_display (Directions §3.5 #3), not the mockup's weekday form.
    expect(onlyMock.length).toBe(3);
    expect(onlyMock).toContain("Job Packet PDF — Mockup v3");
    expect(onlyMock).toContain("Wed 3 Sep, 11:42 Packet generated.");
    expect(onlyRender.length).toBe(2);
    expect(onlyRender).toContain("3 Sep 2026, 11:42 Packet generated.");
    expect(onlyRender.some((s) => s.includes("Provider link golive.com/media/x"))).toBe(true);
  });

  it("§3.4 recipes: packet ref, property line, evidence phrase and date range, the provenance note, the age form", () => {
    const html = renderPacketHtml(withLink()).html;
    expect(html).toContain("PACKET #4821-A · v3<br>3 Sep 2026, 11:42");
    expect(html).toContain("1114 Oakhurst Dr · Fort Wayne, IN 46815 · single-family, 2 storey");
    expect(html).toContain("All five items captured by the homeowner between 2–3 Sep. Full-resolution originals available via the provider link on page 2.");
    expect(html).toContain("Model and serial read from a label photograph and confirmed by the homeowner.");
    expect(html).toContain("<span>~8 yrs (2018)</span>");
    expect(html).toContain('<div class="ph">Equipment label — outdoor</div>');
    expect(html).toContain('<div class="ph">Video — 12s, unit running</div>');
    expect(html).toContain('href="https://golive.com/keep/4821-A"');
    expect(html).toContain('href="https://golive.com/ask/4821-A"');
    expect(html).toContain("golive.com/keep/4821-A</span>");
    // The seven provenance labels, in the legend, in order.
    const legend = /<div class="legend">([\s\S]*?)<\/div>/.exec(html)![1];
    expect(textOf(legend)).toBe("reported seen in photo / video read from label confirmed by homeowner inference — verify unknown technician-only test");
    // The seven fact rows carry the mockup's tags.
    expect(html).toContain("<li>Outdoor fan <b>is</b> turning, unit is audibly running <span class=\"tag t-photo\">seen in video</span></li>");
    expect(html).toContain('<li>No breaker trips, no burning smell, no water <span class="tag t-conf">confirmed</span></li>');
  });

  it("is print-ready: letter @page, a page break between pages, exact colour printing", () => {
    const html = renderPacketHtml(withLink()).html;
    expect(html).toContain("@page{size:letter");
    expect(html).toContain("break-after:page");
    expect(html).toContain("print-color-adjust:exact");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Job Packet 4821-A</title>");
    // No app shell, no dark changelog note.
    expect(html).not.toContain('class="note"');
  });

  it("without the media link, the page-3 sentence that references it is omitted and noted (decision 7A)", () => {
    const r = renderPacketHtml(referenceInput());
    expect(r.html).toContain("All five items captured by the homeowner between 2–3 Sep.</p>");
    expect(r.html).not.toContain("provider link on page 2");
    expect(r.self_check.ok).toBe(true);
    expect(r.self_check.notes.some((n) => n.includes("provider media link absent"))).toBe(true);
  });

  it("selects seven of more than seven candidates by §4.11 priority and keeps the supplied order", () => {
    const r = referenceInput();
    // Nine candidates: the seven (kinded), a later "other" that loses the tie
    // on supplied order, and an inference that is never a candidate at all.
    r.narrative.facts = [
      ...r.narrative.facts.map((f, i) => ({ ...f, kind: (["machine_state", "reading", "other", "check_result", "maintenance", "onset", "safety"] as const)[i] })),
      { text: "Something else the homeowner mentioned", provenance: "reported", kind: "other" },
      { text: "A labelled inference that must never be promoted", provenance: "inference" },
    ];
    const html = renderPacketHtml(r).html;
    const rows = /<ul class="facts">([\s\S]*?)<\/ul>/.exec(html)![1].match(/<li>/g)!.length;
    expect(rows).toBe(7);
    expect(html).not.toContain("Something else the homeowner mentioned");
    expect(html).not.toContain("A labelled inference");
    expect(html).toContain("The seven facts worth reading first");
  });
});

describe("P1 · the thin request (§8, §11.3)", () => {
  it("shrinks honestly: small counters, Unknown equipment rows, unknowns with reasons, no padding", () => {
    const r = renderPacketHtml(thinInput());
    expect(r.halted).toBe(false);
    expect(r.self_check.ok, r.self_check.failures.join("\n")).toBe(true);
    const counters = [...r.html.matchAll(/<div class="n">(\d+)<\/div>/g)].map((m) => m[1]);
    expect(counters).toEqual(["1", "0", "0", "0", "5"]);
    expect(r.html).toContain("The facts worth reading first");
    expect(r.self_check.notes.some((n) => n.startsWith("facts_shortfall: true"))).toBe(true);
    expect((r.html.match(/Unknown <span class="tag t-unk"/g) ?? []).length).toBe(5);
    expect((r.html.match(/Not asked <span class="tag t-unk"/g) ?? []).length).toBe(3 + 4 + 8);
    expect(r.html).toContain("<li>Model and serial — <em>not photographed or typed at intake</em></li>");
    expect(r.html).toContain("No photos were captured at intake.");
    expect(r.html).toContain("No checks were completed at intake.");
    expect(r.html).toContain("The evidence recorded so far does not point one way. The technician's own tests decide.");
    expect(r.html).toContain("No scope factors were identified at intake.");
    expect(r.html).toContain("As soon as possible · safety not established");
    expect(r.html).not.toContain("captured by the homeowner between");
    // Slot 12 without photos drops "photos and ".
    expect(r.html).toContain(`<p>"Hi — my AC is running but blowing warm air. I've got a Job Packet I can send you before you come out."</p>`);
    // Page 1 constants unchanged.
    expect(r.html).toContain("Your house is an asset with amnesia.");
    // Every block still prints.
    expect((r.html.match(/class="eqrow"/g) ?? []).length).toBe(8);
    expect((r.html.match(/<tr class="acc">/g) ?? []).length).toBe(8);
    expect((r.html.match(/<tr class="sh">/g) ?? []).length).toBe(4);
  });
});

describe("P1 · the hazard halt (§9.2, decision 4A)", () => {
  it("page 1 prints with the safety block replacing the call script; pages 2 and 3 do not build", () => {
    const r = referenceInput();
    r.problem.homeowner_words = "I smell gas near the furnace and the AC is blowing warm.";
    const out = renderPacketHtml(r);
    expect(out.halted).toBe(true);
    expect(out.self_check.ok, out.self_check.failures.join("\n")).toBe(true);
    expect(out.self_check.notes).toContain("hazard_halt: true (gas_smell)");
    expect(out.html).toContain("Before anything else");
    expect(out.html).toContain("This one is not a wait-and-see.");
    expect(out.html).toContain("Leave the building, then call your gas utility's emergency line or 911 from outside. Your packet is saved and it will still be here.");
    expect(out.html).not.toContain("Read this out when they pick up.");
    expect(out.html).not.toContain("Page 2 —");
    expect(out.html).not.toContain("Page 3 —");
    expect(out.html).not.toContain("Where the evidence points");
    expect(out.html).toContain("Your house is an asset with amnesia.");
    expect(out.html).toContain("A preparation record · the technician does their own testing on site · the price stays theirs to set");
  });

  it("an explicit flag halts too, with the trade-appropriate body", () => {
    const r = referenceInput();
    r.problem.hazard_flags = ["active_flooding"];
    const out = renderPacketHtml(r);
    expect(out.halted).toBe(true);
    expect(out.html).toContain("Call an emergency line for this trade now. Your packet is saved and it will still be here.");
  });
});

describe("P1 · the copy guard (§10.1) and the §3.3 halts", () => {
  const refuse = (mutate: (r: DirectionsInput) => void, expected: RegExp) => {
    const r = referenceInput();
    mutate(r);
    const out = renderPacketHtml(r);
    expect(out.self_check.ok).toBe(false);
    expect(out.self_check.failures.join("\n")).toMatch(expected);
  };

  it("refuses a dollar figure", () => refuse((r) => r.provider.scope_factors.push("A capacitor is usually $1,200"), /dollar figure/));
  it("refuses a savings word", () => refuse((r) => r.provider.scope_factors.push("This will save you money"), /savings claim/));
  it("refuses a guarantee", () => refuse((r) => (r.narrative.summary_observations[0] = "We guarantee the fix."), /guarantee/));
  it("refuses a phone number", () => refuse((r) => (r.access.contact_preference = { value: "Call 260-555-0134 any time", provenance: "reported" }), /phone number/));
  it("refuses an email address", () => refuse((r) => (r.access.occupancy = { value: "email me at jane@example.com", provenance: "reported" }), /email address/));
  it("refuses a gate code", () => refuse((r) => (r.access.equipment_route = { value: "Side gate code is 4471", provenance: "reported" }), /code/));
  it("refuses a diagnosis", () => refuse((r) => (r.provider.checks[0].changed = "The problem is a bad capacitor"), /diagnosis/));
  it("refuses a percentage on a branch", () => refuse((r) => (r.provider.branches[0].for = "70% likely given the onset."), /percentage/));
  it("refuses praise for effort our flow asked for", () => refuse((r) => r.narrative.summary_observations.push("Great job documenting this."), /praise/));

  it("prints Not printed here when a gate code exists in the record, and never the code", () => {
    const r = referenceInput();
    r.access.gate_or_entry_code = { value: "__code_present__", provenance: "unknown" };
    const out = renderPacketHtml(r);
    expect(out.html).toContain("Not printed here");
    expect(out.html).not.toContain("__code_present__");
  });

  it("halts on the required-key absences the Directions name", () => {
    const missing = (mutate: (r: DirectionsInput) => void) => {
      const r = referenceInput();
      mutate(r);
      expect(() => renderPacketHtml(r)).toThrow(PacketHaltError);
    };
    missing((r) => (r.config.link_base = ""));
    missing((r) => (r.packet.id = ""));
    missing((r) => (r.property.street = ""));
    missing((r) => (r.problem.title = ""));
    missing((r) => (r.narrative.summary_observations = []));
  });

  it("guardCopy leaves the reference input alone", () => {
    expect(guardCopy(referenceInput(), "")).toEqual([]);
  });
});

describe("P1 · the call script assembler (§4.6)", () => {
  it("assembles all twelve slots into the mockup's sentence", () => {
    const s = assembleScript(referenceInput().narrative.script_parts, { has_photos: true });
    expect(s.html).toBe(MOCKUP_SCRIPT);
    expect(s.text).toBe(MOCKUP_SCRIPT.replace(/<[^>]+>/g, ""));
  });

  it("a script with only slots 1, 2 and 12 is a valid script", () => {
    expect(assembleScript({ problem_clause: "my AC is running but blowing warm air" }, { has_photos: true }).text).toBe(
      `"Hi — my AC is running but blowing warm air. I've got photos and a Job Packet I can send you before you come out."`
    );
  });

  it("the sentences close up around a gap, and the ice clause keeps its own and", () => {
    const s = assembleScript(
      { problem_clause: "my AC is running but blowing warm air", age_spoken: "about eight years old", ice_clause: "there's no ice I can see" },
      { has_photos: false }
    );
    expect(s.text).toBe(`"Hi — my AC is running but blowing warm air. It's about eight years old. There's no ice I can see. I've got a Job Packet I can send you before you come out."`);
    const t = assembleScript(
      { problem_clause: "my AC is running but blowing warm air", outdoor_state_clause: "the outdoor unit is running and the fan's turning", ice_clause: "there's no ice I can see" },
      { has_photos: true }
    );
    expect(t.text).toContain(". The outdoor unit is running and the fan's turning, and there's no ice I can see. I've got");
  });

  it("requires the problem clause", () => {
    expect(() => assembleScript({}, { has_photos: true })).toThrow(/problem_clause/);
  });
});
