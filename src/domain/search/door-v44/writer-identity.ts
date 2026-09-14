import { doorPageModelProvenanceSchema, type DoorPageModelProvenance } from "./page-version-input";
import { doorV44Hash, isPlainDoorJson, stableDoorJson } from "./schema-engine";

export interface DoorWriterIdentity {
  models: Array<{ provider: string; model_id: string }>;
  assignments_sha256: string;
}

/** Per-page identity comes from the captured writer runs, never today's model setting. */
export function deriveDoorWriterIdentity(provenance: DoorPageModelProvenance): DoorWriterIdentity | null {
  if (!isPlainDoorJson(provenance)) return null;
  const parsed = doorPageModelProvenanceSchema.safeParse(provenance);
  if (!parsed.success || parsed.data.status !== "recorded") return null;
  const assignments = parsed.data.assignments.filter(row => row.capability === "generate_page_copy")
    .sort((a, b) => { const x = stableDoorJson(a), y = stableDoorJson(b); return x < y ? -1 : x > y ? 1 : 0; });
  if (!assignments.length || new Set(assignments.map(row => row.run_id)).size !== assignments.length) return null;
  const models = [...new Map(assignments.map(row => [row.provider + "/" + row.model_id, { provider: row.provider, model_id: row.model_id }])).values()]
    .sort((a, b) => { const x = stableDoorJson(a), y = stableDoorJson(b); return x < y ? -1 : x > y ? 1 : 0; });
  return { models, assignments_sha256: doorV44Hash({ format: "door-writer-identity/1.0.0", assignments }) };
}
