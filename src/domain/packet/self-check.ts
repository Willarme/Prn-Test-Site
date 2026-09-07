import type { DirectionsInput } from "@/domain/packet/types";
import { spelled } from "@/domain/packet/script";

/**
 * THE COPY GUARD (Directions §10) AND THE EIGHT CONSISTENCY CONSTRAINTS
 * (Directions §3.5 / §10.4) — run before a packet is emitted. A failure is a
 * build failure, not a warning: `renderPacketHtml` returns it in
 * `self_check.failures` and the route refuses to serve a packet that fails.
 *
 * The guard runs over the PER-REQUEST strings — everything in the Directions
 * input plus the assembled script — never over the template constants, which
 * are Melissa's approved words and are allowed to say "guarantee" in the
 * page-3 footer's own disclaimer. The repo's older packet guard
 * (domain/problem/packet-copy.ts FORBIDDEN_PACKET_COPY_PATTERNS) is folded in
 * so the two surfaces cannot disagree about a dollar sign.
 */

interface Rule {
  pattern: RegExp;
  why: string;
  /** Skip the homeowner's own words and clauses derived from them. */
  authored_only?: boolean;
}

export const PACKET_COPY_RULES: readonly Rule[] = [
  { pattern: /\$\s?\d/, why: "a dollar figure (Directions §2 rule 2, §10.1 #6)" },
  { pattern: /\b\d[\d,]*\s?(dollars|bucks|usd)\b/i, why: "a price (Directions §2 rule 2)" },
  { pattern: /\b(per hour|hourly rate|diagnostic fee|typically costs?|expect to pay|labou?r cost|parts cost)\b/i, why: "a price or rate (Directions §2 rule 2)" },
  { pattern: /\bsavings?\b|\bsave (you )?(money|time)\b/i, why: "a savings claim (WORDING 25; packet-copy.ts)" },
  { pattern: /\bguarantee(s|d|ing)?\b/i, why: "a guarantee (WORDING 25; packet-copy.ts)" },
  { pattern: /\b(will save|will reduce|ensures?|eliminates?)\b/i, why: "a promised result (WORDING 25)" },
  { pattern: /\blead(s|ed)?\b/i, why: 'the word "lead" (hard canon rule; packet-copy.ts)', authored_only: true },
  { pattern: /[\w.+-]+@[\w-]+(\.[\w-]+)+/, why: "an email address (Directions §2 rule 8)" },
  { pattern: /(?<![\w°/-])(\+?\d[\d\s().-]{7,}\d)(?![\w°/-])/, why: "a phone number (Directions §2 rule 8)" },
  { pattern: /\b(gate|entry|lockbox|lock box|alarm|door|garage|keypad) code\b[^.]{0,20}\d{3,}|\bcode\s*(is|:)\s*#?\s*\d{3,}\b|#\d{4,}\b/i, why: "a gate, lockbox or alarm code (Directions §2 rule 8)" },
  { pattern: /\b(the problem is|this is a failed|you need|will need|will fail|should be replaced|is caused by|the fix is|needs? (a new|replacing)|replacement is recommended)\b/i, why: "a diagnosis or repair recommendation (Directions §2 rule 3, §10.3)" },
  { pattern: /\b(definitely|certainly|obviously|clearly the|must be)\b/i, why: "a certainty verb off the ladder (Directions §10.3)" },
  { pattern: /\b(great job|nicely documented|you'?ve done the hard part|well done|good work)\b/i, why: "praise for effort our flow asked for (WORDING 50)" },
  { pattern: /\b(your|the) technician will\b/i, why: "saying what a provider does (WORDING 25)" },
  { pattern: /\b\d{1,3}\s?%/, why: "a percentage (Directions §7.3: words only)" },
];

const SKIP_KEYS = new Set(["captured_at", "generated_at", "onset_date", "at", "id", "link_base", "home_memory_url", "trust_network_url", "media_link", "thumbnail_data_uri", "evidence_id", "playbook", "time_zone", "locale"]);
const HOMEOWNER_KEYS = new Set(["homeowner_words", "problem_clause"]);

function walk(value: unknown, path: string, out: { path: string; text: string; homeowner: boolean }[]): void {
  if (typeof value === "string") {
    const key = path.split(".").pop() ?? "";
    if (SKIP_KEYS.has(key)) return;
    out.push({ path, text: value, homeowner: HOMEOWNER_KEYS.has(key) || path.includes("timeline") });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, out);
  }
}

/** Every per-request string that fails a rule, with where and why. */
export function guardCopy(input: DirectionsInput, scriptText: string): string[] {
  const strings: { path: string; text: string; homeowner: boolean }[] = [];
  walk({ ...input, config: undefined, packet: undefined }, "", strings);
  strings.push({ path: "script", text: scriptText, homeowner: true });
  const failures: string[] = [];
  for (const s of strings) {
    for (const rule of PACKET_COPY_RULES) {
      if (rule.authored_only && s.homeowner) continue;
      if (rule.pattern.test(s.text)) failures.push(`${s.path}: refused, ${rule.why} — "${s.text.slice(0, 80)}"`);
    }
  }
  // Branch confidence carries no number of any kind (§7.3).
  for (const [i, b] of input.provider.branches.entries()) {
    if (/\d/.test(b.confidence)) failures.push(`provider.branches[${i}].confidence: refused, a number in a confidence word`);
  }
  return failures;
}

/** Visible text of an HTML fragment, hrefs excluded, entities decoded. */
export function textOf(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function count(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j < 0) return n;
    n++;
    i = j + needle.length;
  }
}

export interface ComputedForCheck {
  owner_actions?: boolean;
  packet_id: string;
  version: string;
  generated_at_display: string;
  count_photos: number;
  count_checks_done: number;
  count_tech_only_left: number;
  model: string | null;
  home_memory_url: string;
  trust_network_url: string;
  script_text: string;
  facts_text: string[];
  summary_text: string;
  halted: boolean;
}

/** Directions §3.5 — the eight assertions, over the rendered document. */
export function checkConsistency(html: string, c: ComputedForCheck): string[] {
  const failures: string[] = [];
  const text = textOf(html);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

  // 1. packet.id in exactly three places: the meta block, the /keep/ URL, the
  //    /ask/ URL. With the Directions' plain-id links the two chips carry the
  //    id in their text; with the repo's signed links they do not, and the two
  //    URL renders are counted as the two hrefs instead (see directions-input.ts).
  const idInText = count(text, c.packet_id);
  const keepLinks = hrefs.filter((h) => h === c.home_memory_url).length;
  const askLinks = hrefs.filter((h) => h === c.trust_network_url).length;
  const chipsWithId = c.owner_actions === false ? 0 : [c.home_memory_url, c.trust_network_url].filter((u) => u.includes(c.packet_id)).length;
  const expectedInText = (c.halted ? 0 : 1) + chipsWithId;
  if (idInText !== expectedInText) {
    failures.push(`constraint 1: packet.id "${c.packet_id}" appears ${idInText} times in text, expected ${expectedInText}`);
  }
  const ownerLinks = c.owner_actions === false ? 0 : 1;
  if (keepLinks !== ownerLinks || askLinks !== ownerLinks) failures.push(`constraint 1: expected ${ownerLinks} Home Memory and Trust Network links, found ${keepLinks}/${askLinks}`);

  if (!c.halted) {
    // 2. version: meta block, page 2 footer, page 3 footer.
    const v = (text.match(new RegExp(`(?<![\\w.])${c.version}(?![\\w.])`, "g")) ?? []).length;
    if (v !== 3) failures.push(`constraint 2: packet.version "${c.version}" appears ${v} times, expected 3`);
    // 3. generated_at_display: meta block and the final timeline row.
    const g = count(text, c.generated_at_display);
    if (g !== 2) failures.push(`constraint 3: generated_at_display "${c.generated_at_display}" appears ${g} times, expected 2`);
    // 4. photos: thumbnails and the spelled count.
    const thumbs = (html.match(/class="ph(?:\s|")/g) ?? []).length;
    if (thumbs !== c.count_photos) failures.push(`constraint 4: ${thumbs} thumbnails, count_photos ${c.count_photos}`);
    if (c.count_photos > 0) {
      const phrase = c.count_photos === 1 ? "This item" : `All ${spelled(c.count_photos)} items`;
      if (!text.includes(phrase)) failures.push(`constraint 4: evidence_count_phrase "${phrase}" missing`);
    }
    // 5. checks rows.
    const rows = (html.match(/<tr class="chk">/g) ?? []).length;
    if (rows !== c.count_checks_done) failures.push(`constraint 5: ${rows} check rows, count_checks_done ${c.count_checks_done}`);
    // 6. tech-only list.
    const tech = (html.match(/<li class="tech-item">/g) ?? []).length;
    if (tech !== c.count_tech_only_left) failures.push(`constraint 6: ${tech} technician-only rows, count ${c.count_tech_only_left}`);
    // 7. shared numbers across the three registers.
    const readings = [...c.facts_text.join(" ").matchAll(/set (\d{2})°F, room (\d{2})°F/g)];
    for (const m of readings) {
      const [, sp, rt] = m;
      if (!c.summary_text.includes(`${sp}°F`) || !c.summary_text.includes(`${rt}°F`)) failures.push(`constraint 7: summary lacks ${sp}°F/${rt}°F`);
      if (!c.script_text.includes(`set to ${sp}`) || !c.script_text.includes(`at ${rt}`)) failures.push(`constraint 7: script lacks ${sp}/${rt}`);
    }
    // 8. equipment.model exactly twice: the table and the script.
    if (c.model) {
      const m = count(text, c.model);
      if (m !== 2) failures.push(`constraint 8: equipment.model "${c.model}" appears ${m} times, expected 2`);
    }
    // §10.4 #20 — every block prints.
    const eq = (html.match(/class="eqrow"/g) ?? []).length;
    if (eq !== 8) failures.push(`§10.4 #20: ${eq} equipment rows, expected 8`);
    const acc = (html.match(/<tr class="acc">/g) ?? []).length;
    if (acc !== 8) failures.push(`§10.4 #20: ${acc} access rows, expected 8`);
    const sh = (html.match(/<tr class="sh">/g) ?? []).length;
    if (sh !== 4) failures.push(`§10.4 #20: ${sh} service-history rows, expected 4`);
    const cells = (html.match(/class="l">/g) ?? []).length;
    if (cells !== 5) failures.push(`§10.4 #20: ${cells} counter cells, expected 5`);
    const legend = (html.match(/class="legend"/g) ?? []).length;
    if (legend !== 1) failures.push("§10.4 #12: legend missing");
  }
  return failures;
}
