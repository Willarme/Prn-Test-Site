import source from "../../../../content/door-template/v44/contracts/template-constants.json";
import { doorV44Hash } from "./schema-engine";

export type DoorV44ConstantKey = keyof typeof source.strings;
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Copy authority only. Conditional entries do not grant feature or release permission. */
export const DOOR_V44_CONSTANTS = freeze(source);
export const DOOR_V44_CONSTANTS_SHA256 = doorV44Hash(DOOR_V44_CONSTANTS);

function known(key: string): key is DoorV44ConstantKey {
  return Object.prototype.hasOwnProperty.call(DOOR_V44_CONSTANTS.strings, key);
}

/** Return source-owned text. Escaping and condition checks belong to the renderer. */
export function doorV44Constant(key: DoorV44ConstantKey): string {
  if (!known(key)) throw new Error("Unknown door template constant");
  return DOOR_V44_CONSTANTS.strings[key];
}

export interface DoorV44ConstantOccurrence { key: string; value: string }
export interface DoorV44ConstantCoverageError {
  code: "CONSTANT_UNKNOWN" | "CONSTANT_UNEXPECTED" | "CONSTANT_CHANGED" | "CONSTANT_MISSING";
  key: DoorV44ConstantKey | "$unknown";
}

/**
 * Compare text occurrences emitted by a renderer against its independently
 * selected module/condition keys. Repeated identical labels are legitimate.
 * This does not extract a DOM or infer which conditional modules are permitted.
 */
export function checkDoorV44ConstantCoverage(
  observed: readonly DoorV44ConstantOccurrence[],
  expectedKeys: readonly DoorV44ConstantKey[],
): { ok: boolean; errors: DoorV44ConstantCoverageError[] } {
  const expected = new Set(expectedKeys);
  const seen = new Set<DoorV44ConstantKey>();
  const errors: DoorV44ConstantCoverageError[] = [];
  for (const item of observed) {
    if (!known(item.key)) { errors.push({ code: "CONSTANT_UNKNOWN", key: "$unknown" }); continue; }
    seen.add(item.key);
    if (!expected.has(item.key)) errors.push({ code: "CONSTANT_UNEXPECTED", key: item.key });
    if (item.value !== doorV44Constant(item.key)) errors.push({ code: "CONSTANT_CHANGED", key: item.key });
  }
  for (const key of expected) {
    if (!known(key)) errors.push({ code: "CONSTANT_UNKNOWN", key: "$unknown" });
    else if (!seen.has(key)) errors.push({ code: "CONSTANT_MISSING", key });
  }
  const unique = new Map(errors.map(error => [error.key + "\0" + error.code, error]));
  const sorted = [...unique.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  return { ok: sorted.length === 0, errors: sorted };
}
