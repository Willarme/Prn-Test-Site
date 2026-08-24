/**
 * A00 Kill Switch — Wave-0 STUB (spec §9 step 5 seam; full GLOBAL + AGENT
 * implementation lands in step 8). The gateway already calls this
 * synchronously before every capability call so the check is structural from
 * day one; until step 8 replaces this, nothing is ever engaged.
 */
export interface KillSwitchCheck {
  engaged: boolean;
  scope: "GLOBAL" | "AGENT" | null;
  reason?: string;
}

export function checkKillSwitch(_agentId: string): KillSwitchCheck {
  return { engaged: false, scope: null };
}
