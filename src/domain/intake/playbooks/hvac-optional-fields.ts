import type { FieldRequirement } from "@/domain/intake/playbook";

/** Current Directions §3.3, §4.20–22 / Coverage §3.9–10.
 * Voluntary, blank by default, outside the automated clarifier budget.
 * Never add entry codes, account contacts or technician-only measurements.
 */
function field(
  field_key: string,
  label: string,
  optional_group: NonNullable<FieldRequirement["optional_group"]>,
  why_it_matters: string,
  how_to_find: string,
  choices?: FieldRequirement["choices"],
): FieldRequirement {
  return {
    field_key, label, optional_group, why_it_matters, how_to_find, choices,
    value_reason: ["urgency", "habitability", "vulnerable_occupant", "damage_accruing"].includes(field_key)
      ? "next_step" : field_key === "safety_signals" ? "safety" : "packet",
    photo_prompt: null, accepts: ["text"], priority: "helpful",
    harvest_to_property_memory: false, auto_detect_patterns: [],
  };
}
const choices = (...values: string[]) => values.map(value => ({ value, label: value }));
const yesNo = choices("Yes", "No", "Not sure");
const memory = "Your best memory is enough. Leave it blank if you would rather skip it.";
const access = "Only share practical visit details. Do not enter gate codes, door codes, phone numbers or email addresses.";

export const HVAC_OPTIONAL_FIELDS: FieldRequirement[] = [
  field("equipment_type", "What kind of cooling system is it?", "context", "Helps the technician prepare for this system.", "Use the label or what you already know; no need to open a panel."),
  field("outdoor_unit_location", "Where is the outdoor unit?", "context", "Helps the technician find the equipment.", "Describe its location from somewhere you can safely stand."),
  field("air_handler_location", "Where is the indoor unit or air handler?", "context", "Helps plan access to the indoor equipment.", "Only use what you already know. Do not climb or open equipment to find out."),
  field("thermostat_model", "Thermostat brand or model, if known", "context", "Helps identify the controls.", "Use the visible label or what you already know."),
  field("vent_airflow", "How does the airflow at the vents feel?", "context", "Separates weak airflow from a temperature problem.", "Only report what you can feel safely at a reachable vent.", choices("Normal", "Weak", "No airflow", "Not sure")),
  field("filter_age_weeks", "How many weeks since the filter was replaced?", "context", "Adds the maintenance timing behind the filter check.", "Enter a whole number of weeks if you know it, or leave blank."),
  field("urgency", "How soon do you need help?", "context", "Carries your own urgency into the packet.", "Choose how urgent this feels to you.", choices("Today", "As soon as possible", "Soon", "Planned work")),
  field("habitability", "How is this affecting use of the home?", "context", "Helps the packet reflect the impact on your home.", "Choose the closest description, or leave blank.", [
    { value: "lost", label: "I cannot use the home normally" },
    { value: "degraded", label: "I can use it, but with difficulty" },
    { value: "intact", label: "I can still use the home normally" },
  ]),
  field("vulnerable_occupant", "Is anyone at home especially affected by the loss of cooling?", "context", "Helps urgency reflect an occupant's needs.", "For example, an infant, older adult or someone with a medical need. Do not share names or medical details.", yesNo),
  field("damage_accruing", "Is the problem causing continuing damage?", "context", "Continuing damage can raise urgency.", "Answer only from what you have noticed, without investigating equipment.", yesNo),
  field("safety_signals", "Have you noticed breaker trips, a burning smell or water?", "context", "Keeps an unanswered safety check distinct from a negative answer.", "Only report what you have already noticed. Do not touch or inspect equipment to answer.", choices("None of these", "Breaker trips", "Burning smell", "Water", "Not sure")),
  field("sh_refrigerant", "Ever low on refrigerant or topped up?", "history", "Prior refrigerant work helps a technician interpret this visit.", memory, yesNo),
  field("sh_recent_service", "Service in the last two years, and by whom?", "history", "Prevents repeating work and preserves relevant service history.", `${memory} A company name is enough; do not include anyone's contact details.`),
  field("sh_impact", "Outdoor unit ever hit, flooded, or worked near?", "history", "Prior damage or nearby work may affect the technician's checks.", memory, yesNo),
  field("sh_room_variance", "Same temperature difference in every room?", "history", "Shows whether the symptom varies through the house.", memory, yesNo),
  field("access_occupancy", "Will anyone be home?", "access", "Helps plan the visit.", access),
  field("access_owner_present", "Does the owner need to be present?", "access", "Helps plan who needs to attend.", access, yesNo),
  field("access_parking", "Parking for the visit", "access", "Helps the technician arrive prepared.", access),
  field("access_pets", "Pets to plan around", "access", "Helps plan a safe arrival.", access),
  field("access_route", "Route to the equipment", "access", "Helps the technician find the equipment.", access),
  field("access_window", "Preferred visit window", "access", "Shares your preference without promising an appointment.", access),
  field("access_contact", "Contact preference", "access", "Shares how you prefer to be contacted.", "Choose a preference only; no phone number or email is needed.", choices("Text preferred", "Phone preferred", "Email preferred", "No preference")),
];
