import type { Suite } from "../types";

export async function liveModelSuite(): Promise<Suite> {
  return { group: "live-model", preamble: "stub", expectations: [] };
}
