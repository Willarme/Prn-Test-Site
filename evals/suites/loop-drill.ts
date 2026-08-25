import type { Suite } from "../types";

export async function loopDrillSuite(): Promise<Suite> {
  return { group: "loop-drill", preamble: "stub", expectations: [] };
}
