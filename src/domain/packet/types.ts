/**
 * THE DIRECTIONS' INPUT CONTRACT — the ten-key ProblemRecord JSON that
 * `PDF Job Packet Template Directions.md` §3 describes (campaign track P1,
 * 2026-09-05). Field names, enums and required-ness are the Directions' own;
 * nothing here is renamed to match the repo's older `JobPacket`, because the
 * Directions are the generation contract Melissa approved and the repo's
 * `ProblemRecord` in domain/problem/contracts.ts is a different object (the
 * intake record, not the packet input). `buildDirectionsInput` in
 * directions-input.ts is the one place the repo's journey is mapped onto this.
 *
 * Every varying value that reaches the page carries a provenance label from
 * the closed set of seven (Directions §5). There is no eighth.
 */

export type Provenance =
  | "reported"
  | "seen_in_photo_or_video"
  | "read_from_label"
  | "confirmed_by_homeowner"
  | "inference"
  | "unknown";

export type UrgencyLevel = "emergency" | "same_day" | "asap" | "soon" | "planned";
export type SafetyState = "hazard" | "possible_hazard" | "no_hazard_reported" | "safety_not_established";

/** Directions §9.1 — the hard-stop flags. */
export type HazardFlag =
  | "gas_smell"
  | "co_alarm"
  | "burning_or_smoke"
  | "electrical_water"
  | "active_flooding"
  | "sewage_indoors"
  | "structural"
  | "no_heat_freezing_vulnerable";

export type Trade =
  | "hvac"
  | "plumbing"
  | "roofing"
  | "electrical"
  | "water_heater"
  | "appliance"
  | "garage_door"
  | "generic";

export type OnsetCharacter = "gradual" | "sudden" | "intermittent";
export type Habitability = "lost" | "degraded" | "intact";

/** Directions §7.3 — the closed confidence vocabulary. */
export type ConfidenceWord = "Most consistent" | "Possible" | "Less likely";

/**
 * Directions §4.19 / §10.3 — the certainty a completed check licenses. The
 * first three are the demotions `counts.made_less_likely` is derived from;
 * `confirms` and `noted` demote nothing.
 */
export type CheckCertainty = "rules_out" | "unlikely" | "less_likely" | "confirms" | "noted";
export type CertaintyScope = "control_setting" | "power_level";

export interface Valued {
  value: string | null;
  provenance: Provenance;
  confirmed_by_homeowner?: boolean;
}

export interface DirectionsConfig {
  /** False for a packet-only share: never mint or print owner capabilities. */
  owner_actions?: boolean;
  /** Origin for both QR URLs. Required — the renderer halts without it. */
  link_base: string;
  keep_path?: string;
  ask_path?: string;
  locale?: string;
  date_style?: string;
  time_style?: string;
  /**
   * IANA zone used to display timestamps that carry no offset (the repo stores
   * UTC "Z" times). A timestamp with its own offset is displayed in that offset.
   * DEFAULT pending Melissa: the trial is Allen County, IN — America/New_York.
   */
  time_zone?: string;
  /**
   * SIGNED LINKS (deviation from Directions §3.4, documented here and in
   * directions-input.ts): the Directions build the two URLs as
   * `link_base + keep_path + packet.id`. In this repo a link is a signed,
   * revocable capability token (src/platform/links/tokens.ts; decisions 7 and
   * 8), so the caller supplies the finished URLs and the renderer uses them as
   * given. When absent, the Directions' plain form is used (the reference input).
   */
  home_memory_url?: string;
  trust_network_url?: string;
  /** Decision 7A: the provider media link, rendered as a chip on page 2. Null omits it. */
  media_link?: string | null;
}

export interface PacketMeta {
  id: string;
  version: string;
  generated_at: string;
  trade: Trade;
  playbook?: string;
}

export interface PropertyBlock {
  street: string;
  city_state_zip: string;
  type?: string | null;
  storeys?: string | null;
}

export interface ProblemBlock {
  title: string;
  homeowner_words: string;
  onset_date?: string | null;
  onset_weekday_spoken?: string | null;
  onset_character?: OnsetCharacter | null;
  onset_span_days?: number | null;
  urgency_level: UrgencyLevel;
  safety_state: SafetyState;
  hazard_flags: HazardFlag[];
  habitability?: Habitability;
  vulnerable_occupant?: boolean;
  damage_accruing?: boolean;
}

export interface EquipmentBlock {
  labels_set: string;
  type?: Valued | null;
  brand?: Valued | null;
  model?: Valued | null;
  serial?: Valued | null;
  age_years?: number | null;
  manufacture_year?: number | null;
  age_provenance?: Provenance;
  outdoor_unit_location?: Valued | null;
  air_handler_location?: Valued | null;
  thermostat?: Valued | null;
}

export interface MediaItem {
  id: string;
  /**
   * "voice_note" is an ADDITION to the Directions' photo|video (routine
   * decision 12: a voice note is stored and listed as evidence, never
   * transcribed). It counts as one item, like a video.
   */
  kind: "photo" | "video" | "voice_note";
  subject: string;
  location?: string | null;
  captured_at?: string | null;
  duration_seconds?: number | null;
  provenance: Provenance;
  /** A data: URI thumbnail, when the caller could read the stored bytes. */
  thumbnail_data_uri?: string | null;
}

export interface Reading {
  value: string | number;
  provenance: Provenance;
  source_media?: string | null;
  approximate?: boolean;
}

export interface EvidenceBlock {
  media: MediaItem[];
  readings?: Partial<
    Record<
      "thermostat_mode" | "thermostat_setpoint_f" | "room_temp_f" | "filter_age_weeks" | "filter_condition",
      Reading
    >
  >;
}

/** Directions §4.11 — the selection priority when more than seven candidates exist. */
export type FactKind =
  | "safety"
  | "reading"
  | "machine_state"
  | "check_result"
  | "maintenance"
  | "onset"
  | "other";

export interface Fact {
  text: string;
  provenance: Provenance;
  emphasis_word?: string | null;
  inline_tag?: string | null;
  kind?: FactKind;
}

export interface TimelineRow {
  label: string;
  text: string;
  provenance: Provenance;
  /** Sort key; the label is what prints. */
  at?: string | null;
}

export interface ScriptParts {
  problem_clause?: string | null;
  equipment_brand_type?: string | null;
  age_spoken?: string | null;
  model_number?: string | null;
  onset_clause?: string | null;
  thermostat_setpoint?: number | null;
  room_temp?: number | null;
  outdoor_state_clause?: string | null;
  filter_clause?: string | null;
  ice_clause?: string | null;
}

export interface NarrativeBlock {
  facts: Fact[];
  summary_observations: string[];
  timeline: TimelineRow[];
  script_parts: ScriptParts;
}

export interface Check {
  name: string;
  result: string;
  changed: string;
  result_provenance: Provenance;
  changed_provenance: Provenance;
  certainty: CheckCertainty;
  certainty_scope?: CertaintyScope | null;
}

export interface Unknown {
  item: string;
  reason: string;
}

export interface Branch {
  name: string;
  confidence: ConfidenceWord;
  for: string;
  against: string;
}

export interface ServiceHistoryAnswer {
  question_id: string;
  answer: string;
  provenance: Provenance;
}

export interface ProviderBlock {
  checks: Check[];
  unknowns: Unknown[];
  technician_only: string[];
  branches: Branch[];
  service_history: ServiceHistoryAnswer[];
  scope_factors: string[];
}

export type AccessKey =
  | "occupancy"
  | "owner_present_needed"
  | "parking"
  | "pets"
  | "equipment_route"
  | "preferred_window"
  | "gate_or_entry_code"
  | "contact_preference";

export type AccessBlock = Partial<Record<AccessKey, Valued | null>>;

export interface CountsBlock {
  facts_captured: number;
  made_less_likely?: number | null;
}

export interface DirectionsInput {
  config: DirectionsConfig;
  packet: PacketMeta;
  property: PropertyBlock;
  problem: ProblemBlock;
  equipment: EquipmentBlock;
  evidence: EvidenceBlock;
  narrative: NarrativeBlock;
  provider: ProviderBlock;
  access: AccessBlock;
  counts: CountsBlock;
}

export interface SelfCheck {
  ok: boolean;
  failures: string[];
  /** Things a human should know that are not failures (facts_shortfall, hazard_halt, omissions). */
  notes: string[];
}

export interface RenderResult {
  html: string;
  halted: boolean;
  self_check: SelfCheck;
}
