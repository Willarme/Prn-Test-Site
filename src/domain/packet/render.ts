import { DEFAULT_TIME_ZONE, dateRange, dateShort, dateTime, wallClock, type WallClock } from "@/domain/packet/dates";
import { MOCKUP_CSS } from "@/domain/packet/mockup-css";
import { PACKET_SCREEN_CSS } from "@/domain/packet/screen-css";
import { qrSvg } from "@/domain/packet/qr";
import { assembleScript, escapeAttr, escapeHtml, spelled } from "@/domain/packet/script";
import { checkConsistency, guardCopy, textOf } from "@/domain/packet/self-check";
import type {
  AccessKey,
  Check,
  DirectionsInput,
  Fact,
  FactKind,
  HazardFlag,
  MediaItem,
  Provenance,
  RenderResult,
  Trade,
  Valued,
} from "@/domain/packet/types";
import { detectHazardFlags, safetyBodyFor, urgencyTag } from "@/domain/packet/urgency";

/**
 * THE JOB PACKET, RENDERED (campaign track P1, 2026-09-05).
 *
 * Three pages in one print-ready HTML document, from the Directions' input
 * (`PDF Job Packet Template Directions.md`) and the approved mockup
 * (`MOCKUP-1-job-packet-pdf.html`). Every string the Directions mark VERBATIM
 * is copied byte for byte from that file; every derived value follows a §3.4
 * recipe; every varying fact carries one of the seven labels (§5). Design is
 * the mockup's own CSS (mockup-css.ts) plus the print rules at the bottom of
 * this file.
 *
 * What this renderer will not do, by construction: invent a fact, state a
 * price, write a diagnosis, drop a block to look complete, print a contact
 * detail or a code, or pad a thin packet (§2, §8). The copy guard and the
 * eight consistency assertions run on every render (self-check.ts) and their
 * failures come back in `self_check`; a caller refuses to serve a failing
 * packet.
 *
 * HAZARD HALT (§9.2; decision 4, recommendation A): when a hard-stop flag is
 * set or found in the homeowner's own words, page 1 prints with the safety
 * block in place of the call script and pages 2 and 3 are not built at all.
 */
export class PacketHaltError extends Error {
  constructor(readonly reason: string) {
    super(`packet halted: ${reason}`);
  }
}

export interface RenderOptions {
  /** Screen-only chrome (Download PDF / Print) the route injects; never printed. */
  toolbar_html?: string;
  /** `?print=1`: open the print dialog on load. */
  print_on_load?: boolean;
}

// ---------------------------------------------------------------------------
// Labels (Directions §5.3, §12.3)
// ---------------------------------------------------------------------------

const TAG_CLASS: Record<Provenance, string> = {
  reported: "t-rep",
  seen_in_photo_or_video: "t-photo",
  read_from_label: "t-label",
  confirmed_by_homeowner: "t-conf",
  inference: "t-inf",
  unknown: "t-unk",
};

const INLINE_TAG: Record<Provenance, string> = {
  reported: "reported",
  seen_in_photo_or_video: "seen in photo",
  read_from_label: "read from label",
  confirmed_by_homeowner: "confirmed",
  inference: "inference",
  unknown: "unknown",
};

function tag(p: Provenance, opts: { text?: string; margin0?: boolean } = {}): string {
  const style = opts.margin0 ? ' style="margin:0"' : "";
  return `<span class="tag ${TAG_CLASS[p]}"${style}>${escapeHtml(opts.text ?? INLINE_TAG[p])}</span>`;
}

const UNKNOWN_TAG = '<span class="tag t-unk" style="margin:0">unknown</span>';

type EquipKey = "type" | "brand" | "model" | "serial" | "age" | "outdoor_unit_location" | "air_handler_location" | "thermostat";
interface LabelSet {
  equipment: { label: string; key: EquipKey | null }[];
  history: { id: string; question: string }[];
}

const RECENT_SERVICE = { id: "sh_recent_service", question: "Service in the last two years, and by whom?" };
const LABEL_SETS: Record<Trade, LabelSet> = {
  hvac: {
    equipment: [
      { label: "Type", key: "type" },
      { label: "Brand", key: "brand" },
      { label: "Model", key: "model" },
      { label: "Serial", key: "serial" },
      { label: "Age", key: "age" },
      { label: "Outdoor unit", key: "outdoor_unit_location" },
      { label: "Air handler", key: "air_handler_location" },
      { label: "Thermostat", key: "thermostat" },
    ],
    history: [
      { id: "sh_refrigerant", question: "Ever low on refrigerant or topped up?" },
      RECENT_SERVICE,
      { id: "sh_impact", question: "Outdoor unit ever hit, flooded, or worked near?" },
      { id: "sh_room_variance", question: "Same temperature difference in every room?" },
    ],
  },
  water_heater: {
    equipment: [
      { label: "Type", key: "type" }, { label: "Brand", key: "brand" }, { label: "Model", key: "model" }, { label: "Serial", key: "serial" },
      { label: "Age", key: "age" }, { label: "Fuel", key: null }, { label: "Capacity", key: null }, { label: "Location", key: null },
    ],
    history: [
      { id: "sh_flushed", question: "Ever flushed or drained, and when?" },
      { id: "sh_recent_service", question: "Service in the last two years, and by whom?" },
      { id: "sh_leak", question: "Any leak, drip or pooling before now?" },
      { id: "sh_runout", question: "Has the hot water run out faster over time?" },
    ],
  },
  plumbing: {
    equipment: [
      { label: "Fixture", key: "type" }, { label: "Brand", key: "brand" }, { label: "Model", key: "model" }, { label: "Age", key: "age" },
      { label: "Supply", key: null }, { label: "Shut-off location", key: null }, { label: "Material", key: null }, { label: "Location", key: null },
    ],
    history: [
      { id: "sh_worked_before", question: "Has this fixture been worked on before?" },
      { id: "sh_recent_service", question: "Service in the last two years, and by whom?" },
      { id: "sh_past_leak", question: "Any past leak in this room or below it?" },
      { id: "sh_other_fixtures", question: "Does it happen with other fixtures too?" },
    ],
  },
  electrical: {
    equipment: [
      { label: "Panel type", key: "type" }, { label: "Brand", key: "brand" }, { label: "Model", key: "model" }, { label: "Age", key: "age" },
      { label: "Service size", key: null }, { label: "Panel location", key: null }, { label: "Circuit affected", key: null }, { label: "Breaker type", key: null },
    ],
    history: [
      { id: "sh_panel_changed", question: "Has the panel been added to or replaced?" },
      { id: "sh_recent_service", question: "Service in the last two years, and by whom?" },
      { id: "sh_tripped_before", question: "Has this circuit tripped before?" },
      { id: "sh_other_circuits", question: "Do other circuits behave the same way?" },
    ],
  },
  roofing: {
    equipment: [
      { label: "Roof type", key: "type" }, { label: "Material", key: null }, { label: "Age", key: "age" }, { label: "Storeys", key: null },
      { label: "Pitch", key: null }, { label: "Layers", key: null }, { label: "Gutters", key: null }, { label: "Access", key: null },
    ],
    history: [
      { id: "sh_repaired_before", question: "Has the roof been repaired before, and where?" },
      { id: "sh_recent_work", question: "Work in the last two years, and by whom?" },
      { id: "sh_past_leak", question: "Any past leak in this room or below it?" },
      { id: "sh_storm", question: "Did it start after a specific storm?" },
    ],
  },
  appliance: {
    equipment: [
      { label: "Appliance", key: "type" }, { label: "Brand", key: "brand" }, { label: "Model", key: "model" }, { label: "Serial", key: "serial" },
      { label: "Age", key: "age" }, { label: "Fuel", key: null }, { label: "Location", key: null }, { label: "Install date", key: null },
    ],
    history: [
      { id: "sh_repaired_before", question: "Has this appliance been repaired before?" },
      { id: "sh_recent_service", question: "Service in the last two years, and by whom?" },
      { id: "sh_error_code", question: "Any error code shown?" },
      { id: "sh_gradual", question: "Did it change gradually or all at once?" },
    ],
  },
  garage_door: {
    equipment: [
      { label: "Door type", key: "type" }, { label: "Opener brand", key: "brand" }, { label: "Opener model", key: "model" }, { label: "Age", key: "age" },
      { label: "Springs", key: null }, { label: "Door material", key: null }, { label: "Track", key: null }, { label: "Remote type", key: null },
    ],
    history: [
      { id: "sh_springs", question: "Have the springs or cables been replaced?" },
      { id: "sh_recent_service", question: "Service in the last two years, and by whom?" },
      { id: "sh_off_track", question: "Has the door come off the track before?" },
      { id: "sh_wall_vs_remote", question: "Does it behave the same on the wall button and the remote?" },
    ],
  },
  generic: {
    equipment: [
      { label: "Type", key: "type" }, { label: "Brand", key: "brand" }, { label: "Model", key: "model" }, { label: "Serial", key: "serial" },
      { label: "Age", key: "age" }, { label: "Location", key: null }, { label: "Access", key: null }, { label: "Related equipment", key: null },
    ],
    history: [
      { id: "sh_repaired_before", question: "Has this been repaired before?" },
      { id: "sh_recent_service", question: "Service in the last two years, and by whom?" },
      { id: "sh_same_before", question: "Any past problem with the same thing?" },
      { id: "sh_gradual", question: "Did it change gradually or all at once?" },
    ],
  },
};

function labelSetFor(input: DirectionsInput): LabelSet {
  const set = input.equipment.labels_set;
  if (set && set in LABEL_SETS) return LABEL_SETS[set as Trade];
  if (set && set.startsWith("hvac")) return LABEL_SETS.hvac;
  return LABEL_SETS[input.packet.trade] ?? LABEL_SETS.generic;
}

const ACCESS_ROWS: { key: AccessKey; label: string }[] = [
  { key: "occupancy", label: "Occupancy" },
  { key: "owner_present_needed", label: "Owner present needed?" },
  { key: "parking", label: "Parking" },
  { key: "pets", label: "Pets" },
  { key: "equipment_route", label: "Equipment route" },
  { key: "preferred_window", label: "Preferred window" },
  { key: "gate_or_entry_code", label: "Gate or entry code" },
  { key: "contact_preference", label: "Contact" },
];

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

const FACT_PRIORITY: Record<FactKind, number> = {
  safety: 1, reading: 2, machine_state: 3, check_result: 4, maintenance: 5, onset: 6, other: 7,
};
const PROVENANCE_RANK: Record<Provenance, number> = {
  read_from_label: 0, seen_in_photo_or_video: 1, confirmed_by_homeowner: 2, reported: 3, inference: 4, unknown: 5,
};

export function selectFacts(candidates: Fact[]): { facts: Fact[]; shortfall: boolean } {
  const genuine = candidates.filter((f) => f.provenance !== "inference" && f.text.trim().length > 0);
  if (genuine.length <= 7) return { facts: genuine, shortfall: genuine.length < 7 };
  const scored = genuine.map((f, i) => ({ f, i, p: FACT_PRIORITY[f.kind ?? "other"], r: PROVENANCE_RANK[f.provenance] }));
  scored.sort((a, b) => a.p - b.p || a.r - b.r || a.i - b.i);
  const keep = new Set(scored.slice(0, 7).map((s) => s.i));
  return { facts: genuine.filter((_, i) => keep.has(i)), shortfall: false };
}

function factLine(f: Fact): string {
  let text = escapeHtml(f.text);
  if (f.emphasis_word) {
    const w = escapeHtml(f.emphasis_word);
    const re = new RegExp(`(^|\\s)(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=\\s|$|[,.])`);
    text = text.replace(re, `$1<b>$2</b>`);
  }
  const inline = f.inline_tag ?? INLINE_TAG[f.provenance];
  return `<li>${text} <span class="tag ${TAG_CLASS[f.provenance]}">${escapeHtml(inline)}</span></li>`;
}

function valueCell(v: Valued | null | undefined, absent: "Unknown" | "Not asked"): string {
  if (!v || !v.value) return `<span style="color:var(--ink3)">${absent} ${UNKNOWN_TAG}</span>`;
  return `<span>${escapeHtml(v.value)}</span>`;
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function mediaCaption(m: MediaItem): string {
  if (m.kind === "voice_note") return m.subject;
  if (m.kind === "video") {
    return m.duration_seconds != null ? `Video — ${m.duration_seconds}s, ${m.subject}` : `Video — ${m.subject}`;
  }
  if (!m.location) return m.subject;
  // The equipment label takes the em dash (the mockup's `Equipment label — outdoor`);
  // every other subject takes the comma (`Filter, in situ`, `Outdoor unit, wide`).
  return /equipment label/i.test(m.subject) ? `${m.subject} — ${m.location}` : `${m.subject}, ${m.location}`;
}

function orderMedia(media: MediaItem[]): MediaItem[] {
  // Supplied order (capture order when the builder made it), with the
  // equipment label first — the caption a provider looks for (§4.18).
  const label = media.filter((m) => /equipment label/i.test(m.subject));
  const rest = media.filter((m) => !/equipment label/i.test(m.subject));
  return [...label, ...rest];
}

export function renderPacketHtml(input: DirectionsInput, options: RenderOptions = {}): RenderResult {
  const notes: string[] = [];
  const failures: string[] = [];

  // --- §3.3 halts: a packet with no id, no link base, no address or no title cannot be built.
  if (!input.config?.link_base) throw new PacketHaltError("config.link_base is required (Directions §3.3)");
  if (!input.packet?.id) throw new PacketHaltError("packet.id is required (Directions §3.3)");
  const tz = input.config.time_zone ?? DEFAULT_TIME_ZONE;
  const generated = wallClock(input.packet.generated_at, tz);
  if (!generated) throw new PacketHaltError("packet.generated_at is required (Directions §3.3)");
  if ((!input.property?.street || !input.property?.city_state_zip) && !input.property?.unknown_reason?.trim()) {
    throw new PacketHaltError("property.street and property.city_state_zip are required (Directions §3.3)");
  }
  if (!input.problem?.title) throw new PacketHaltError("problem.title is required (Directions §3.3)");
  if (!input.problem?.homeowner_words) throw new PacketHaltError("problem.homeowner_words is required (Directions §3.3)");

  // --- §3.4 computed once.
  const version = input.packet.version || "v1";
  const packetRef = `PACKET #${input.packet.id} · ${version}`;
  const generatedAtDisplay = dateTime(generated);
  const generatedDateShort = dateShort(generated);
  const keepPath = input.config.keep_path ?? "/keep/";
  const askPath = input.config.ask_path ?? "/ask/";
  const homeMemoryUrl = input.config.home_memory_url ?? `${input.config.link_base}${keepPath}${input.packet.id}`;
  const trustNetworkUrl = input.config.trust_network_url ?? `${input.config.link_base}${askPath}${input.packet.id}`;
  const propertyLine =
    (input.property.street && input.property.city_state_zip ? `${input.property.street} · ${input.property.city_state_zip}` : `Job address still unknown. ${input.property.unknown_reason}`) +
    (input.property.type ? ` · ${input.property.type}${input.property.storeys ? `, ${input.property.storeys}` : ""}` : input.property.storeys ? ` · ${input.property.storeys}` : "");

  // --- §9: hard stop, from the flags or from the homeowner's own words.
  const flags: HazardFlag[] = detectHazardFlags(input.problem.homeowner_words, input.problem.hazard_flags ?? []);
  const halted = flags.length > 0;
  if (halted) notes.push(`hazard_halt: true (${flags.join(", ")})`);

  const media = orderMedia(input.evidence?.media ?? []);
  const hasPhotos = media.length > 0;
  const script = assembleScript(input.narrative.script_parts, { has_photos: hasPhotos });

  // --- Page 1 --------------------------------------------------------------------
  const page1 = renderPage1({
    ownerActions: input.config.owner_actions !== false,
    homeMemoryUrl,
    trustNetworkUrl,
    scriptHtml: script.html,
    halt: halted ? safetyBodyFor(flags) : null,
  });

  let page2 = "";
  let page3 = "";
  let computed = {
    count_photos: media.length,
    count_checks_done: input.provider?.checks?.length ?? 0,
    count_tech_only_left: input.provider?.technician_only?.length ?? 0,
    facts_text: [] as string[],
    summary_text: "",
  };

  if (!halted) {
    if (!input.narrative?.summary_observations?.length) {
      throw new PacketHaltError("narrative.summary_observations is required (Directions §3.3)");
    }
    const tagText = urgencyTag(input.problem.urgency_level ?? "asap", input.problem.safety_state ?? "safety_not_established");
    const { facts, shortfall } = selectFacts(input.narrative.facts ?? []);
    if (shortfall) notes.push(`facts_shortfall: true (${facts.length} genuine facts)`);
    const summary = input.narrative.summary_observations.slice(0, 7).join(" ");
    computed = { ...computed, facts_text: facts.map((f) => f.text), summary_text: summary };
    page2 = renderPage2({ input, tagText, packetRef, generatedAtDisplay, generatedDateShort, propertyLine, facts, shortfall, summary, version, media });
    const p3 = renderPage3({ input, generatedAtDisplay, generatedDateShort, version, media, tz });
    page3 = p3.html;
    notes.push(...p3.notes);
  }

  const printScript = options.print_on_load ? `<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)});</script>` : "";
  const html =
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">` +
    `<title>Job Packet ${escapeHtml(input.packet.id)}</title>` +
    `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">` +
    `<style>${MOCKUP_CSS}\n${PACKET_CSS}</style><style media="screen">${PACKET_SCREEN_CSS}</style>${printScript}</head><body>` +
    (options.toolbar_html ?? "") +
    `<div class="wrap">\n${page1}\n${page2}\n${page3}\n</div></body></html>`;

  // --- The self-check (§10.4): copy guard over the per-request strings, then the constraints.
  failures.push(...guardCopy(input, script.text));
  failures.push(
    ...checkConsistency(html, {
      packet_id: input.packet.id,
      version,
      generated_at_display: generatedAtDisplay,
      count_photos: computed.count_photos,
      count_checks_done: computed.count_checks_done,
      count_tech_only_left: computed.count_tech_only_left,
      model: input.equipment?.model?.value ?? null,
      home_memory_url: homeMemoryUrl,
      trust_network_url: trustNetworkUrl,
      script_text: script.text,
      facts_text: computed.facts_text,
      summary_text: computed.summary_text,
      halted,
      owner_actions: input.config.owner_actions !== false,
    })
  );

  return { html, halted, self_check: { ok: failures.length === 0, failures, notes } };
}

// ---------------------------------------------------------------------------
// Page 1 — the homeowner flyer (Directions §4.1–4.8). Template-constant apart
// from the two URLs, their QR codes and the call script.
// ---------------------------------------------------------------------------

const SAFETY_BODY = {
  gas_or_co: "Leave the building, then call your gas utility's emergency line or 911 from outside. Your packet is saved and it will still be here.",
  electrical_or_smoke: "Get clear of it and call 911, or your utility's emergency line, from a safe spot. Your packet is saved and it will still be here.",
  water_sewage_structural: "Call an emergency line for this trade now. Your packet is saved and it will still be here.",
} as const;

function qrBlock(url: string): string {
  let svg: string;
  try {
    svg = qrSvg(url, { ecl: "M", quiet: 0 });
  } catch {
    // §4.5 QR failure rule: the card still prints with the chip and the URL.
    svg = "";
  }
  return `<div class="x-qr" aria-hidden="true">${svg}</div>`;
}

function linkChip(url: string): string {
  return (
    `<a class="x-link" href="${escapeAttr(url)}">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10.6 5.2H5.2v13.6h13.6v-5.4"/><path d="M13.4 10.6 19.6 4.4"/><path d="M14.6 4.4h5v5"/></svg>` +
    `<span class="x-url">${escapeHtml(displayUrl(url))}</span></a>`
  );
}

function renderPage1(p: { homeMemoryUrl: string; trustNetworkUrl: string; scriptHtml: string; halt: keyof typeof SAFETY_BODY | null; ownerActions: boolean }): string {
  const scriptOrSafety = p.halt
    ? `<article class="x-script x-safety">
      <p class="x-eyebrow"><span class="x-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 9.5v4.5"/><path d="M12 16.8v.4"/></svg></span>Before anything else</p>
      <h3 class="x-sh">This one is not a wait-and-see.</h3>
      <blockquote class="x-quote"><p>${escapeHtml(SAFETY_BODY[p.halt])}</p></blockquote>
    </article>`
    : `<article class="x-script">
      <p class="x-eyebrow">
        <span class="x-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M4.6 6.2h14.8v10.3h-7.2l-4.5 3.4v-3.4H4.6z"/>
            <path d="M8.2 10h7.6"/>
            <path d="M8.2 13.1h4.7"/>
          </svg>
        </span>If you would rather call someone
      </p>
      <h3 class="x-sh">Read this out when they pick up.</h3>
      <blockquote class="x-quote">
        <p>${p.scriptHtml}</p>
      </blockquote>
    </article>`;

  return `<!-- ============ FLYER PAGE 1 ============ -->
<div class="page">
<div class="pglabel ho">Page 1 — for the homeowner</div>

  <div class="cover">
    <div class="brandrow">Go Live &nbsp;·&nbsp; Property Response Network</div>
    <div class="seal"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12.5l5.2 5.2L20 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <h1 class="fh1">Your Job Packet</h1>
  </div>

  <div class="parts">
    <h2>What is in here</h2>
    <div class="pgrid4">

      <div class="part pt-blue">
        <div class="ic ic-blue s72">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="4.5" width="14" height="17" rx="1.8" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><rect x="9" y="2.6" width="6" height="3.4" rx="1.2" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M8.5 11h7M8.5 14.5h5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>
        </div>
        <b>What you saw</b>
        <span>In your own words, kept exactly as you said it.</span>
      </div>

      <div class="part pt-amber">
        <div class="ic ic-amber s72">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 8.5a2 2 0 012-2h2.2l1.3-2.1h6.9l1.3 2.1H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="12" cy="12.8" r="3.5" stroke="currentColor" stroke-width="1.75"/></svg>
        </div>
        <b>Your photos</b>
        <span>Dated, labelled, pointed at the right part.</span>
      </div>

      <div class="part pt-green">
        <div class="ic ic-green s72">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 6.6l1.7 1.7 3-3.2M3.5 12.4l1.7 1.7 3-3.2M3.5 18.2l1.7 1.7 3-3.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 6.4h8M12.5 12.2h8M12.5 18h5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>
        </div>
        <b>The checks you did</b>
        <span>Each one with what it ruled out.</span>
      </div>

      <div class="part pt-pink">
        <div class="ic ic-pink s72">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="13.5" r="7.8" stroke="currentColor" stroke-width="1.75"/><path d="M12 9.6v4.2l2.7 1.6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.3 2.6h5.4M12 2.6v3.1" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>
        </div>
        <b>A head start on the clock</b>
        <span>Less time diagnosing can mean fewer hours on the bill.</span>
      </div>

    </div>
  </div>

  <section class="x-act">
    ${p.ownerActions ? `<div class="x-grid">

      <article class="x-card x-a">
        <div class="x-scan">
          ${qrBlock(p.homeMemoryUrl)}
        </div>
        <div class="x-meta">
          <p class="x-eyebrow">
            <span class="x-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <path d="M3.6 10.6 12 3.9l8.4 6.7"/>
                <path d="M5.7 9.1v10.9h12.6V9.1"/>
                <path d="M9.1 13.4h5.8"/>
                <path d="M9.1 16.5h3.5"/>
              </svg>
            </span>Home Memory
          </p>
          <p class="x-cap">Opens already filled in</p>
        </div>
        <h3 class="x-h">Your house is an asset with amnesia.</h3>
        <p class="x-p">Scan this and everything in this packet is already saved — the model number, the photos, what was wrong and what fixed it.</p>
        ${linkChip(p.homeMemoryUrl)}
      </article>

      <article class="x-card x-b">
        <div class="x-scan">
          ${qrBlock(p.trustNetworkUrl)}
        </div>
        <div class="x-meta">
          <p class="x-eyebrow">
            <span class="x-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <circle cx="12" cy="5.2" r="2.2"/>
                <circle cx="5.3" cy="17.6" r="2.2"/>
                <circle cx="18.7" cy="17.6" r="2.2"/>
                <path d="M10.4 6.9 6.9 15.6"/>
                <path d="M13.6 6.9l3.5 8.7"/>
                <path d="M7.5 17.6h9"/>
              </svg>
            </span>Trust Network
          </p>
          <p class="x-cap">They answer in a tap</p>
        </div>
        <h3 class="x-h">You already know someone who knows someone.</h3>
        <p class="x-p">Ask your own people who they would send to their sister's house, or send this packet straight to the guy you already trust.</p>
        ${linkChip(p.trustNetworkUrl)}
      </article>

    </div>` : `<p class="shared-note">Shared provider copy. Home Memory and referral actions are available from the homeowner's own link.</p>`}

    ${scriptOrSafety}
  </section>

  <div class="closer">
    <p class="tagline">You stop carrying your home in your head.<br><span class="tl-accent">You get your life back.</span></p>
    <div class="closer-rule"></div>
    <p class="closer-sub"><b>The rest of this packet</b> is written for whoever fixes it. Hand over the whole thing — you don't have to explain it again.</p>
  </div>

<div class="micro">A preparation record · the technician does their own testing on site · the price stays theirs to set</div>
</div>`;
}

// ---------------------------------------------------------------------------
// Page 2 — provider head start (Directions §4.9–4.16)
// ---------------------------------------------------------------------------

function ageCell(input: DirectionsInput): string {
  const age = input.equipment?.age_years;
  if (age == null) return `<span style="color:var(--ink3)">Unknown ${UNKNOWN_TAG}</span>`;
  const year = input.equipment.manufacture_year;
  return `<span>~${age} yrs${year != null ? ` (${year})` : ""}</span>`;
}

function equipmentNote(input: DirectionsInput): string {
  const model = input.equipment?.model;
  const serial = input.equipment?.serial;
  const fromLabel = (v: Valued | null | undefined) => Boolean(v?.value && v.provenance === "read_from_label");
  const m = fromLabel(model);
  const s = fromLabel(serial);
  if (!m && !s) return "";
  const what = m && s ? "Model and serial" : m ? "Model" : "Serial";
  const confirmed = (m ? model?.confirmed_by_homeowner : true) && (s ? serial?.confirmed_by_homeowner : true);
  const sentence = confirmed
    ? `${what} read from a label photograph and confirmed by the homeowner.`
    : `${what} read from a label photograph.`;
  return `<p style="font-size:.74rem;color:var(--ink3);margin:9px 0 0;line-height:1.5">${sentence} <span class="tag t-label" style="margin:0">read from label</span></p>`;
}

function renderPage2(p: {
  input: DirectionsInput;
  tagText: string;
  packetRef: string;
  generatedAtDisplay: string;
  generatedDateShort: string;
  propertyLine: string;
  facts: Fact[];
  shortfall: boolean;
  summary: string;
  version: string;
  media: MediaItem[];
}): string {
  const { input } = p;
  const set = labelSetFor(input);
  const eqRows = set.equipment
    .map(({ label, key }) => {
      let cell: string;
      if (key === null) cell = valueCell(null, "Not asked");
      else if (key === "age") cell = ageCell(input);
      else if (key === "outdoor_unit_location" || key === "air_handler_location" || key === "thermostat") cell = valueCell(input.equipment?.[key], "Not asked");
      else cell = valueCell(input.equipment?.[key], "Unknown");
      return `        <div class="eqrow"><span>${escapeHtml(label)}</span>${cell}</div>`;
    })
    .join("\n");

  const unknowns = (input.provider?.unknowns ?? []).filter((u) => u.reason && u.reason.trim().length > 0);
  const unknownRows =
    unknowns.length > 0
      ? unknowns.map((u) => `        <li>${escapeHtml(u.item)} — <em>${escapeHtml(u.reason)}</em></li>`).join("\n")
      : `        <li>Nothing outstanding was identified at intake. ${UNKNOWN_TAG}</li>`;
  const tech = input.provider?.technician_only ?? [];
  const techRows =
    tech.length > 0
      ? tech.map((t) => `        <li class="tech-item">${escapeHtml(t)}</li>`).join("\n")
      : `        <li>To be set on arrival.</li>`;

  const madeLessLikely =
    input.counts?.made_less_likely ??
    (input.provider?.checks ?? []).filter((c: Check) => c.certainty === "rules_out" || c.certainty === "unlikely" || c.certainty === "less_likely").length;
  const factsCaptured = input.counts?.facts_captured ?? (input.narrative?.facts?.length ?? 0);

  // Decision 7A: the provider media link, its own line under the header band
  // (a signed link is long; inside the badge it would squeeze the H1).
  const mediaLink = input.config.media_link
    ? `  <div class="provider-link"><span class="pl-label">Provider link</span> <a href="${escapeAttr(input.config.media_link)}">${escapeHtml(displayUrl(input.config.media_link))}</a></div>\n`
    : "";

  return `<!-- ============ PROVIDER PAGE 1 ============ -->
<div class="page">
<div class="pglabel">Page 2 — for the provider · head start · executive summary</div>
<div class="pad">

  <div class="band">
    <div>
      <h1 class="ttl">${escapeHtml(input.problem.title)}</h1>
      <p class="sub">${escapeHtml(p.propertyLine)}</p>
    </div>
    <div class="badge">
      <span class="urg">${escapeHtml(p.tagText)}</span>
      <div class="meta">${escapeHtml(p.packetRef)}<br>${escapeHtml(p.generatedAtDisplay)}</div>
    </div>
  </div>
${mediaLink}
  <div class="grid2">
    <div>
      <h3 class="sec">What the homeowner is dealing with</h3>
      <p class="summary">${escapeHtml(p.summary)}</p>

      <h3 class="sec">${p.shortfall ? "The facts worth reading first" : "The seven facts worth reading first"}</h3>
      <ul class="facts">
${p.facts.map((f) => `        ${factLine(f)}`).join("\n")}
      </ul>
    </div>

    <div>
      <h3 class="sec">Equipment</h3>
      <div class="eq">
${eqRows}
      </div>
      ${equipmentNote(input)}
    </div>
  </div>

  <div class="split">
    <div class="box unk">
      <h4>Still unknown — and why</h4>
      <ul>
${unknownRows}
      </ul>
    </div>
    <div class="box tech">
      <h4>Technician-only, on arrival</h4>
      <ul>
${techRows}
      </ul>
    </div>
  </div>

  <div class="strip">
    <div><div class="n">${factsCaptured}</div><div class="l">Facts captured</div></div>
    <div><div class="n">${p.media.length}</div><div class="l">Photos</div></div>
    <div><div class="n">${input.provider?.checks?.length ?? 0}</div><div class="l">Checks done</div></div>
    <div><div class="n">${madeLessLikely}</div><div class="l">Made less likely</div></div>
    <div><div class="n">${tech.length}</div><div class="l">Tech-only left</div></div>
  </div>

</div>
<div class="micro">Specific to this home and request · facts separated from inference · packet ${escapeHtml(p.version)} · ${escapeHtml(p.generatedDateShort)} · not a remote diagnosis</div>
</div>`;
}

// ---------------------------------------------------------------------------
// Page 3 — provider detail (Directions §4.17–4.25)
// ---------------------------------------------------------------------------

function renderPage3(p: {
  input: DirectionsInput;
  generatedAtDisplay: string;
  generatedDateShort: string;
  version: string;
  media: MediaItem[];
  tz: string;
}): { html: string; notes: string[] } {
  const { input } = p;
  const notes: string[] = [];
  const set = labelSetFor(input);

  // Timeline — chronological, then the generated row.
  const timeline = [...(input.narrative?.timeline ?? [])].sort((a, b) => {
    const ka = a.at ?? "";
    const kb = b.at ?? "";
    return ka.localeCompare(kb);
  });
  const tlRows = [
    ...timeline.map((r) => `    <li><b>${escapeHtml(r.label)}</b>${escapeHtml(r.text)}</li>`),
    `    <li><b>${escapeHtml(p.generatedAtDisplay)}</b>Packet generated.</li>`,
  ].join("\n");

  // Evidence.
  let evidence: string;
  if (p.media.length === 0) {
    evidence = `  <p style="font-size:.84rem;margin:0">No photos were captured at intake. ${UNKNOWN_TAG}</p>`;
  } else {
    const cells = p.media
      .map((m) => {
        const cap = escapeHtml(mediaCaption(m));
        if (m.thumbnail_data_uri) {
          return `    <div class="ph has-thumb" style="background-image:url(${m.thumbnail_data_uri})"><span class="cap">${cap}</span></div>`;
        }
        return `    <div class="ph">${cap}</div>`;
      })
      .join("\n");
    const clocks = p.media.map((m) => wallClock(m.captured_at ?? null, p.tz)).filter((w): w is WallClock => w !== null);
    let tail = "";
    if (clocks.length > 0) {
      const sorted = [...clocks].sort((a, b) => a.epoch_ms - b.epoch_ms);
      const range = dateRange(sorted[0], sorted[sorted.length - 1]);
      const phrase = `All ${spelled(p.media.length)} item${p.media.length === 1 ? "" : "s"}`;
      const link = input.config.media_link
        ? " Full-resolution originals available via the provider link on page 2."
        : "";
      if (!input.config.media_link) notes.push("provider media link absent: the page-3 sentence that references it is omitted (decision 7A)");
      tail = `  <p style="font-size:.76rem;color:var(--ink3);margin:9px 0 0">${phrase} captured by the homeowner between ${range}.${link}</p>`;
    } else {
      notes.push("no evidence item carries a capture date: the date-range phrase is dropped (§3.3)");
    }
    evidence = `  <div class="evid">\n${cells}\n  </div>\n${tail}`;
  }

  // Checks.
  const checks = input.provider?.checks ?? [];
  const checkRows =
    checks.length > 0
      ? checks
          .map((c) => `      <tr class="chk"><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.result)}</td><td>${escapeHtml(c.changed)}</td></tr>`)
          .join("\n")
      : `      <tr><td colspan="3">No checks were completed at intake. ${UNKNOWN_TAG}</td></tr>`;

  // Service history — all four questions, always.
  const answers = new Map((input.provider?.service_history ?? []).map((a) => [a.question_id, a]));
  const shRows = set.history
    .map(({ id, question }, i) => {
      const a = answers.get(id);
      const label = i === 0 ? `<td style="width:44%;color:var(--ink3)">` : `<td style="color:var(--ink3)">`;
      const cell = a
        ? `<td>${escapeHtml(a.answer)} ${tag(a.provenance, { margin0: true })}</td>`
        : `<td style="color:var(--ink3)">Not asked ${UNKNOWN_TAG}</td>`;
      return `      <tr class="sh">${label}${escapeHtml(question)}</td>${cell}</tr>`;
    })
    .join("\n");

  // Branches (§7).
  const branches = (input.provider?.branches ?? []).filter((b) => b.for?.trim() && b.against?.trim());
  const branchHtml =
    branches.length >= 2
      ? branches
          .map(
            (b) => `  <div class="branch">
    <div class="bh"><span class="bn">${escapeHtml(b.name)}</span><span class="conf">${escapeHtml(b.confidence)}</span></div>
    <p class="fa"><span class="for">For</span> — ${escapeHtml(b.for)}</p>
    <p class="fa"><span class="agn">Against</span> — ${escapeHtml(b.against)}</p>
  </div>`
          )
          .join("\n\n")
      : `  <p class="fa" style="margin:0 0 4px">The evidence recorded so far does not point one way. The technician's own tests decide.</p>`;
  if (branches.length < 2) notes.push(`branches: ${branches.length} usable, §7.5 line printed`);

  // Access — all eight rows, always; never a code, never a contact detail.
  const accRows = ACCESS_ROWS.map(({ key, label }, i) => {
    const v = input.access?.[key];
    const labelCell = i === 0 ? `<td style="width:34%;color:var(--ink3)">` : `<td style="color:var(--ink3)">`;
    let cell: string;
    if (key === "gate_or_entry_code") {
      cell = v?.value
        ? `<td style="color:var(--ink3)">Not printed here ${UNKNOWN_TAG}</td>`
        : `<td style="color:var(--ink3)">Not asked ${UNKNOWN_TAG}</td>`;
    } else if (v?.value) {
      cell = `<td>${escapeHtml(v.value)}</td>`;
    } else {
      cell = `<td style="color:var(--ink3)">Not asked ${UNKNOWN_TAG}</td>`;
    }
    return `      <tr class="acc">${labelCell}${escapeHtml(label)}</td>${cell}</tr>`;
  }).join("\n");

  // Scope factors.
  const scope = input.provider?.scope_factors ?? [];
  const scopeRows =
    scope.length > 0
      ? scope.map((s) => `    <li>${escapeHtml(s)}</li>`).join("\n")
      : `    <li>No scope factors were identified at intake. ${UNKNOWN_TAG}</li>`;

  const html = `<!-- ============ PROVIDER PAGE 2 ============ -->
<div class="page page-detail">
<div class="pglabel">Page 3 — for the provider · detail</div>
<div class="pad">

  <section class="detail-section">
  <div class="sechead">Timeline</div>
  <ul class="tl">
${tlRows}
  </ul>
  </section>

  <section class="detail-section">
  <div class="sechead">Evidence</div>
${evidence}
  </section>

  <section class="detail-section">
  <div class="sechead">Checks completed, and what each one changed</div>
  <table>
    <thead><tr><th style="width:34%">Check</th><th style="width:26%">Result</th><th>What it changed</th></tr></thead>
    <tbody>
${checkRows}
    </tbody>
  </table>
  </section>

  <section class="detail-section">
  <div class="sechead">Service history, as the homeowner knows it</div>
  <table>
    <tbody>
${shRows}
    </tbody>
  </table>
  <p style="font-size:.76rem;color:var(--ink3);margin:8px 0 0">Asked at intake so you don't have to. Anything the homeowner didn't know is shown as a recorded gap, never guessed.</p>
  </section>

  <section class="detail-section">
  <div class="sechead">Where the evidence points</div>

${branchHtml}

  <p style="font-size:.78rem;color:var(--ink3);margin:12px 0 0"><span class="tag t-inf" style="margin:0">inference</span> &nbsp;These are reasoning from the evidence above, offered to save discovery time. <b>They are not a diagnosis</b> and the technician's own tests decide.</p>
  </section>

  <section class="detail-section">
  <div class="sechead">Access and job readiness <span class="optnote">optional at intake · blanks are honest, not missing</span></div>
  <table>
    <tbody>
${accRows}
    </tbody>
  </table>
  </section>

  <section class="detail-section">
  <div class="sechead">Scope factors to evaluate</div>
  <ul class="facts">
${scopeRows}
  </ul>
  <p style="font-size:.76rem;color:var(--ink3);margin:8px 0 0">No prices are stated in this packet. These are factors for the provider to price.</p>
  </section>

  <section class="detail-section">
  <div class="sechead">How to read the labels in this packet</div>
  <div class="legend">
    <span class="tag t-rep">reported</span>
    <span class="tag t-photo">seen in photo / video</span>
    <span class="tag t-label">read from label</span>
    <span class="tag t-conf">confirmed by homeowner</span>
    <span class="tag t-inf">inference — verify</span>
    <span class="tag t-unk">unknown</span>
    <span class="tag t-tech">technician-only test</span>
  </div>
  </section>

</div>
<div class="micro">Packet ${escapeHtml(p.version)} · generated ${escapeHtml(p.generatedDateShort)} · prepared from the homeowner's own evidence · a preparation record, not an inspection or a guarantee</div>
</div>`;
  return { html, notes };
}

// ---------------------------------------------------------------------------
// Print rules and the small additions the packet makes to the mockup's CSS.
// ---------------------------------------------------------------------------

export const PACKET_CSS = `
/* ---- packet additions (design open; wording untouched) ---- */
.x-qr svg{display:block;width:100%;height:100%;color:var(--ink)}
.x-safety::before{background:var(--pinkd)}
.x-safety .x-quote::before{background:var(--pinkl)}
.ph.has-thumb{background-size:cover;background-position:center;position:relative;color:var(--white)}
.ph.has-thumb .cap{background:rgba(15,17,20,.72);border-radius:3px;padding:3px 5px;max-width:100%}
.provider-link{font:500 .69rem/1.5 var(--mono);color:var(--ink3);margin:-12px 0 18px;overflow-wrap:anywhere;word-break:break-all}
.provider-link .pl-label{margin-right:6px;letter-spacing:.06em;text-transform:uppercase}
.provider-link a{color:var(--blue);text-decoration:none}
.toolbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:center;padding:10px 16px;background:var(--ink);color:var(--on-ink);font:500 .8rem/1 var(--body)}
.toolbar a,.toolbar button{font:600 .8rem/1 var(--body);color:var(--ink);background:var(--white);border:1px solid var(--line-s);border-radius:var(--r);padding:9px 14px;text-decoration:none;cursor:pointer}
.toolbar a.primary{background:var(--green);color:var(--white);border-color:var(--green)}
@page{size:letter;margin:0.4in}
@media print{
  body{background:#fff;padding:0}
  .wrap{max-width:none}
  /* A Letter sheet is narrower than the screen breakpoints. Restore the
     approved columns explicitly so printing never uses the mobile stack. */
  .grid2,.split,.pgrid,.bar,.x-grid{grid-template-columns:1fr 1fr}
  .pgrid4{grid-template-columns:repeat(4,1fr)}
  .keyrow{grid-template-columns:repeat(4,1fr)}
  .evid{grid-template-columns:repeat(5,1fr)}
  .x-card{grid-template-columns:auto minmax(0,1fr);grid-template-areas:"scan meta" "head head" "body body" "link link"}
  .x-url{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .no-print,.toolbar{display:none!important}
  .page{border:0;box-shadow:none;border-radius:0;margin:0;break-after:page;page-break-after:always}
  .page:last-child{break-after:auto;page-break-after:auto}
  .page,.page *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .branch,.box,.strip,.eq,.evid,.x-card,.x-script,.closer,.part,.tl li,tr,.cover,.parts{break-inside:avoid;page-break-inside:avoid}
  .sechead,h3.sec{break-after:avoid;page-break-after:avoid}
  .pglabel{background:var(--paper2)}
  /* The mockup is an 880px screen layout, about twice a letter sheet tall.
     For paper the same design is set tighter: same order, same words, same
     colours, smaller paddings and type, so each logical page runs over the
     fewest sheets it can while staying readable. */
  .cover{padding:12px 30px 10px}.brandrow{margin-bottom:8px}.seal{width:38px;height:38px;margin-bottom:6px}.seal svg{width:22px;height:22px}.fh1{font-size:1.8rem;margin-bottom:0}
  .parts{padding:10px 30px}.parts h2{margin-bottom:8px;font-size:1rem}.pgrid4{gap:10px}.part{padding:9px 8px}.s72{width:32px;height:32px}.s72 svg{width:20px;height:20px}.part .ic{margin-bottom:6px}.part b{font-size:.76rem}.part span{font-size:10px;line-height:1.35}
  .x-act{padding:12px 30px 14px}.x-grid{gap:12px}.x-card{padding:12px 12px 10px;row-gap:8px;column-gap:12px}.x-qr{width:104px;height:104px;padding:6px}.x-meta{min-height:104px;gap:8px}.x-h{font-size:16px}.x-p{font-size:11.5px;line-height:1.45}.x-link{padding:7px 10px;font-size:11px}
  .x-script{margin-top:12px;padding:12px 16px 14px}.x-sh{font-size:19px;margin-top:6px}.x-quote{margin-top:10px;padding:12px 16px 14px}.x-quote::before{margin-bottom:10px}.x-quote p{font-size:13.5px;line-height:1.55}
  .closer{padding:12px 30px 10px}.tagline{font-size:1.15rem;line-height:1.2}.closer-rule{margin:8px auto 6px}.closer-sub{font-size:.72rem;line-height:1.35}
  .pad{padding:12px 18px}.band{margin-bottom:10px;padding-bottom:8px}.ttl{font-size:1.3rem}.grid2{gap:14px;margin-bottom:10px}.summary{font-size:.84rem;line-height:1.5;margin-bottom:8px}
  h3.sec{margin-bottom:6px}ul.facts li{padding:4px 0 4px 22px;font-size:.78rem}ul.facts li::before{top:10px}.eq{padding:10px 12px}.eqrow{font-size:.76rem;padding:3px 0}
  .split{gap:14px}.box{padding:10px 12px}.box h4{margin-bottom:6px;font-size:.76rem}.box ul{font-size:.76rem;line-height:1.5}.strip{margin-top:14px}.strip div{padding:8px 6px}.strip .n{font-size:1.1rem}
  .sechead{margin:14px 0 8px;font-size:.92rem}.tl li{padding-bottom:7px;font-size:.78rem}table{font-size:.76rem;margin-bottom:2px}td{padding:4px 6px 4px 0}th{padding-bottom:4px}
  .evid{gap:6px}.ph{font-size:.55rem}.branch{padding:8px 12px;margin-bottom:6px}.branch .bh{margin-bottom:4px}.branch .bn{font-size:.82rem}.fa{font-size:.74rem;line-height:1.5}
  /* The provider detail uses two reading columns on paper. Sections retain
     their source order and all evidence/check/access rows remain present. */
  .page-detail .pad{column-count:2;column-gap:18px;column-fill:balance;font-size:10.5px;line-height:1.35}
  .page-detail .detail-section{break-inside:avoid-column;margin-bottom:7px}
  .page-detail .sechead{font-size:11px;line-height:1.3;margin:0 0 5px;padding:0 0 4px}
  .page-detail .tl li,.page-detail table,.page-detail .fa,.page-detail ul.facts li{font-size:10.5px;line-height:1.35}
  .page-detail p{font-size:10.5px!important;line-height:1.35!important}
  .page-detail .tl li{padding-bottom:5px}
  .page-detail .tl b{font-size:8.7px;line-height:1.3}
  .page-detail td{padding:3px 5px 3px 0}
  .page-detail th{font-size:8px;line-height:1.25}
  .page-detail .branch{padding:6px 8px;margin-bottom:5px}
  .page-detail .branch .bh{display:block;margin-bottom:3px}
  .page-detail .branch .bn{font-size:10.5px}
  .page-detail .conf{display:block;font-size:8px;margin-top:3px}
  .page-detail .tag{font-size:7.5px;padding:2px 4px;margin-left:3px;white-space:normal}
  .page-detail .evid{grid-template-columns:repeat(4,1fr);gap:5px}
  .page-detail .ph{font-size:7px;padding:3px}
  .page-detail .optnote{display:block;float:none;font-size:8px;line-height:1.3;padding-top:3px}
  .page-detail .legend{gap:4px;margin-top:5px}
  .pglabel{padding:6px 22px}
  .micro{padding:4px 22px;font-size:.6rem}
}
`;

/** Visible text of a rendered packet — exported for tests. */
export { textOf };
