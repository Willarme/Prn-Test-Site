import { z } from "zod";

export const FeatureFlag = z.object({
  flag_key: z.string().regex(/^[a-z_]+$/),
  enabled: z.boolean(),
  description: z.string().min(1),
  decision_ref: z.string().nullable(),
});
export type FeatureFlag = z.infer<typeof FeatureFlag>;

/**
 * Every incomplete surface ships behind a flag (kit master prompt). All OFF at
 * Wave 0; each flips only at its wave gate with owner approval.
 */
export const DEFAULT_FLAGS: readonly FeatureFlag[] = [
  { flag_key: "seo_doors_enabled", enabled: false, description: "Serve published IntentPages", decision_ref: null },
  { flag_key: "intake_shell_enabled", enabled: false, description: "Shared StartRequestForm + /start route", decision_ref: null },
  { flag_key: "results_shell_enabled", enabled: false, description: "Results page shell (fixture JobPacket first)", decision_ref: null },
  { flag_key: "feature_lab_enabled", enabled: false, description: "Future Feature Lab concept pages", decision_ref: null },
  { flag_key: "trust_enabled", enabled: false, description: "Trust Network V1 flows", decision_ref: null },
  { flag_key: "monetization_enabled", enabled: false, description: "Public-page ad/sponsor slots (#23 §5); never on private routes", decision_ref: null },
  { flag_key: "mcp_enabled", enabled: false, description: "Safe/internal MCP V1 (allowlisted test clients only)", decision_ref: null },
  { flag_key: "sms_enabled", enabled: false, description: "Telnyx SMS — stays OFF until 10DLC complete", decision_ref: null },
] as const;
