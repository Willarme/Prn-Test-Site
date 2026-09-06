import registry from "../../../content/door-template/v43/spec/ac-blowing-warm-air/capability-registry.json";
import visible from "../../../content/door-template/v43/spec/ac-blowing-warm-air/capability.json";
import { getV43DoorBinding } from "@/domain/search/door-template";

/** Public projection of reviewed page claims. It grants no runtime or release permission. */
export function publicCapabilityManifest() {
  const binding = getV43DoorBinding();
  // This is the shared form contract, not a newly executable action schema.
  const expectedControls = [
    ["problem_description", "text", true, false], ["voice_note", "audio", false, false],
    ["photos", "image", false, true], ["video", "video", false, false],
  ];
  const controls = registry.tool.accepted_inputs.map((input) =>
    [input.field, input.type, input.required, "multiple" in input && input.multiple === true]);
  if (registry.tool.capability_id !== "home_problem_analyzer" || registry.tool.endpoint !== "/api/intake/start" ||
      registry.tool.method !== "POST" || registry.tool.enctype !== "multipart/form-data" ||
      registry.tool.input_schema_version !== "1" || JSON.stringify(controls) !== JSON.stringify(expectedControls)) {
    throw new Error("Capability manifest differs from the shared intake form contract.");
  }
  const capabilities = binding.capability_questions.map((claim, index) => {
    const source = registry.capabilities[index];
    const row = visible.rows[index];
    if (!source || !row || source.capability_id !== claim.capability_id ||
        source.visible_row_question !== claim.question || row.ask !== claim.question ||
        source.visible_row_answer !== claim.answer || row.tells !== claim.answer ||
        source.status !== claim.claimed_status || row.chip_label !== claim.claimed_status ||
        source.live_status !== claim.runtime_status) {
      throw new Error("Capability manifest differs from the reviewed visible table.");
    }
    return {
      capability_id: claim.capability_id,
      visible_row_question: claim.question,
      visible_row_answer: claim.answer,
      status: claim.claimed_status,
      required_inputs: claim.required_inputs,
      optional_inputs: claim.optional_inputs,
      possible_outputs: claim.possible_outputs,
      safety_class: claim.safety_class,
      live_status: claim.runtime_status,
    };
  });
  if (registry.capabilities.length !== capabilities.length || visible.rows.length !== capabilities.length) {
    throw new Error("Capability manifest row count differs from the reviewed visible table.");
  }
  return {
    schema_version: "1.0.0",
    template_version: binding.template_version,
    content_modified_at: binding.content_date,
    publication_state: "PREVIEW_NOINDEX",
    production_runtime_verified: false,
    disclaimer: "This manifest describes claims on the preview page. Production runtime verification is pending. It is not a ranking factor, release approval, or permission to invoke an action.",
    tool: {
      capability_id: registry.tool.capability_id,
      name: registry.tool.name,
      endpoint: registry.tool.endpoint,
      method: registry.tool.method,
      enctype: registry.tool.enctype,
      input_schema_version: registry.tool.input_schema_version,
      accepted_inputs_scope: "Visible homeowner controls only. This is not a complete standalone request schema; use the current rendered intake form.",
      required_form_context: [{
        field: "disclosure_content_hash",
        source: "Current rendered intake form after reviewing its disclosure.",
        requirement: "The server validates the current disclosure version. Do not invent a value or bypass the disclosure.",
      }],
      accepted_inputs: registry.tool.accepted_inputs.map((input) => ({
        field: input.field, type: input.type, required: input.required,
        ...("multiple" in input ? { multiple: input.multiple } : {}),
        page_words: input.page_words,
      })),
      outputs: registry.tool.outputs.map((output) => ({ id: output.id, page_words: output.page_words })),
      // These are page routes, not evidence that their claimed actions are live.
      public_routes: [...new Set([binding.canonical_path, ...binding.page_fields.internal_links.map((link) => link.path)])],
    },
    problem_family: {
      id: registry.problem_family.id, label: registry.problem_family.label,
      parent_id: registry.problem_family.parent_id, parent_label: registry.problem_family.parent_label,
    },
    safety_boundaries: {
      never: [...registry.safety_boundaries.never],
      stop_and_call_now: [...registry.safety_boundaries.stop_and_call_now],
    },
    limitations: [...registry.limitations],
    capabilities,
  };
}
