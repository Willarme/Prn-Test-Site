import { z } from "zod";

export const FeatureFlag = z.object({
  flag_key: z.string().regex(/^[a-z_]+$/),
  enabled: z.boolean(),
  description: z.string().min(1),
  decision_ref: z.string().nullable(),
});
export type FeatureFlag = z.infer<typeof FeatureFlag>;

/**
 * Every surface ships behind a flag, and every route CONSULTS its flag
 * (verified by tests). A flag flips only at its wave gate: the three shell
 * flags flipped ON when Waves 5-7 shipped fixture-backed (D-20, under the
 * owner's standing approval); the risky flags stay OFF until their gates.
 */
export const DEFAULT_FLAGS: readonly FeatureFlag[] = [
  { flag_key: "seo_doors_enabled", enabled: false, description: "Serve published IntentPages publicly", decision_ref: null },
  { flag_key: "intake_shell_enabled", enabled: true, description: "Shared StartRequestForm + /start + intake API (fixture engine)", decision_ref: "D-20" },
  { flag_key: "results_shell_enabled", enabled: true, description: "Results page shell (fixture JobPacket)", decision_ref: "D-20" },
  { flag_key: "feature_lab_enabled", enabled: true, description: "Future Feature Lab concept pages + interest capture", decision_ref: "D-20" },
  { flag_key: "trust_enabled", enabled: false, description: "Trust Network V1 flows", decision_ref: null },
  { flag_key: "monetization_enabled", enabled: false, description: "Public-page ad/sponsor slots (#23 §5); never on private routes", decision_ref: null },
  { flag_key: "mcp_enabled", enabled: false, description: "Safe/internal MCP V1 (allowlisted test clients only)", decision_ref: null },
  { flag_key: "sms_enabled", enabled: false, description: "Telnyx SMS — stays OFF until 10DLC complete", decision_ref: null },
] as const;

export function flagEnabled(key: string): boolean {
  return DEFAULT_FLAGS.find((f) => f.flag_key === key)?.enabled ?? false;
}
