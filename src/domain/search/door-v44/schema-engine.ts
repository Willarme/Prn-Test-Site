import Ajv from "ajv";
import { createHash } from "node:crypto";

export const DOOR_V44_SCHEMA_ID = "https://schemas.propertyresponsenetwork.com/doorspec/2.0.0.json";
export type DoorV44Diagnostic = { code: string; pointer: string };
type JsonRecord = Record<string, unknown>;
const DIALECT = "http://json-schema.org/draft-07/schema#";
const SCHEMA_PREFIX = "https://schemas.propertyresponsenetwork.com/doorspec/";
const POISON_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** The boundary accepts JSON data, never objects with getters or custom behavior. */
export function isPlainDoorJson(value: unknown): boolean {
  const ancestors = new Set<object>();
  let remaining = 50000;
  function check(current: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 64) return false;
    if (current === null || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current);
    if (typeof current === "string") return current.length <= 1000000;
    if (typeof current !== "object" || ancestors.has(current)) return false;
    const proto = Object.getPrototypeOf(current);
    if (proto !== Object.prototype && proto !== null && !(Array.isArray(current) && proto === Array.prototype)) return false;
    const descriptors = Object.getOwnPropertyDescriptors(current);
    if (Object.getOwnPropertySymbols(current).length > 0) return false;
    ancestors.add(current);
    const array = Array.isArray(current);
    let slots = 0;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || POISON_KEYS.has(key)) return false;
      if (array && key === "length") continue;
      if (array && !/^(0|[1-9]\d*)$/.test(key)) return false;
      if (!descriptor.enumerable || !check(descriptor.value, depth + 1)) return false;
      slots++;
    }
    ancestors.delete(current);
    return !array || slots === current.length;
  }
  try { return check(value, 0); } catch { return false; }
}

/** Object keys are non-semantic; visible arrays and string whitespace retain order/bytes. */
export function stableDoorJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableDoorJson).join(",") + "]";
  const row = value as JsonRecord;
  return "{" + Object.keys(row).sort().map((key) => JSON.stringify(key) + ":" + stableDoorJson(row[key])).join(",") + "}";
}

export function doorV44Hash(value: unknown): string {
  return createHash("sha256").update(stableDoorJson(value), "utf8").digest("hex");
}

export function sortDoorV44Diagnostics(errors: DoorV44Diagnostic[]): DoorV44Diagnostic[] {
  const unique = new Map(errors.map((error) => [error.pointer + "\0" + error.code, error]));
  return [...unique.values()].sort((a, b) => a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
}

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function visitSchema(schema: unknown, visit: (node: JsonRecord) => void): void {
  if (schema === true) { visit({}); return; }
  if (!record(schema)) return;
  visit(schema);
  // Visit schema positions only. const/enum/example values are data, not schemas.
  for (const key of ["properties", "definitions", "patternProperties", "$defs"] as const) {
    const map = schema[key];
    if (record(map)) Object.values(map).forEach((child) => visitSchema(child, visit));
  }
  for (const key of ["items", "additionalProperties", "additionalItems", "contains", "not", "if", "then", "else", "propertyNames"] as const) {
    const child = schema[key];
    if (Array.isArray(child)) child.forEach((part) => visitSchema(part, visit));
    else visitSchema(child, visit);
  }
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const children = schema[key];
    if (Array.isArray(children)) children.forEach((child) => visitSchema(child, visit));
  }
}

export type DoorV44SchemaCompilation =
  | { ok: true; validate: (value: unknown) => DoorV44Diagnostic[]; schema_hash: string; coverage: { schema_ids: string[]; object_count: number; property_names: string[] } }
  | { ok: false; errors: DoorV44Diagnostic[] };

/** No resolver callback, remote schema loading, coercion, defaults or payload repair. */
export function compileDoorV44Schemas(input: readonly unknown[]): DoorV44SchemaCompilation {
  if (!isPlainDoorJson(input) || input.length === 0 || input.length > 100) {
    return { ok: false, errors: [{ code: "SCHEMA_BUNDLE_INVALID", pointer: "/schema_bundle" }] };
  }
  const schemas = input as JsonRecord[];
  const errors: DoorV44Diagnostic[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  let objectCount = 0;
  schemas.forEach((schema, index) => {
    const pointer = "/schema_bundle/" + index;
    if (!record(schema) || typeof schema.$id !== "string" || !schema.$id.startsWith(SCHEMA_PREFIX) || schema.$id.includes("#") || schema.$schema !== DIALECT) {
      errors.push({ code: "SCHEMA_ID_INVALID", pointer });
      return;
    }
    if (ids.has(schema.$id)) errors.push({ code: "SCHEMA_ID_DUPLICATE", pointer });
    ids.add(schema.$id);
  });
  schemas.forEach((schema, index) => visitSchema(schema, (node) => {
    const pointer = "/schema_bundle/" + index;
    if (node.$async !== undefined || node.$data !== undefined) errors.push({ code: "SCHEMA_FEATURE_FORBIDDEN", pointer });
    if (node.patternProperties !== undefined) errors.push({ code: "SCHEMA_DYNAMIC_KEYS", pointer });
    if (!["type", "$ref", "const", "enum", "allOf", "anyOf", "oneOf", "not", "if", "contains", "required"].some((key) => node[key] !== undefined)) {
      errors.push({ code: "SCHEMA_UNTYPED", pointer });
    }
    if (node !== schema && node.$id !== undefined) errors.push({ code: "SCHEMA_ID_INVALID", pointer });
    if (node.type === "object" || (Array.isArray(node.type) && node.type.includes("object")) || node.properties !== undefined) {
      objectCount++;
      if (node.additionalProperties !== false || !record(node.properties) || !Array.isArray(node.required)) {
        errors.push({ code: "SCHEMA_OBJECT_NOT_STRICT", pointer });
      }
      if (record(node.properties)) Object.keys(node.properties).forEach((key) => keys.add(key));
    }
    if (node.$ref !== undefined) {
      if (typeof node.$ref !== "string") errors.push({ code: "SCHEMA_REF_INVALID", pointer });
      else {
        try {
          const resolved = new URL(node.$ref, schema.$id as string);
          const documentId = resolved.href.split("#")[0];
          if (!ids.has(documentId)) errors.push({ code: "SCHEMA_REF_UNKNOWN", pointer });
        } catch { errors.push({ code: "SCHEMA_REF_INVALID", pointer }); }
      }
    }
  }));
  if (!ids.has(DOOR_V44_SCHEMA_ID)) errors.push({ code: "SCHEMA_ROOT_MISSING", pointer: "/schema_bundle" });
  if (errors.length) return { ok: false, errors: sortDoorV44Diagnostics(errors) };
  try {
    const ajv = new Ajv({ allErrors: true, jsonPointers: true, coerceTypes: false, useDefaults: false,
      removeAdditional: false, ownProperties: true, validateSchema: true,
      strictKeywords: true, strictDefaults: true, strictNumbers: true, logger: false });
    // Clone so even the compiler cannot annotate the caller's frozen contracts.
    const ordered = schemas.map((schema) => JSON.parse(stableDoorJson(schema)) as object)
      .sort((a, b) => String((a as JsonRecord).$id) < String((b as JsonRecord).$id) ? -1 : 1);
    ajv.addSchema(ordered);
    for (const id of ids) if (!ajv.getSchema(id)) throw new Error("missing local schema");
    const validate = ajv.getSchema(DOOR_V44_SCHEMA_ID)!;
    const keywordCodes: Record<string, string> = {
      additionalProperties: "UNKNOWN_FIELD", required: "REQUIRED_FIELD", type: "INVALID_TYPE",
      minLength: "STRING_TOO_SHORT", maxLength: "STRING_TOO_LONG", minItems: "ARRAY_TOO_SHORT",
      maxItems: "ARRAY_TOO_LONG", uniqueItems: "DUPLICATE_VALUE", enum: "INVALID_ENUM", const: "INVALID_CONSTANT",
      pattern: "INVALID_PATTERN", format: "INVALID_FORMAT", minimum: "NUMBER_TOO_SMALL", maximum: "NUMBER_TOO_LARGE",
    };
    return {
      ok: true, schema_hash: doorV44Hash(ordered),
      coverage: { schema_ids: [...ids].sort(), object_count: objectCount, property_names: [...keys].sort() },
      validate: (value) => {
        if (!isPlainDoorJson(value)) return [{ code: "INVALID_INPUT", pointer: "" }];
        if (validate(value)) return [];
        return sortDoorV44Diagnostics((validate.errors ?? []).map((error) => {
          // Additional-property names are untrusted and can contain private payloads.
          // Fail closed even if a future schema compiler introduces dynamic paths.
          let pointer = "";
          for (const segment of error.dataPath.split("/").slice(1)) {
            const name = segment.replace(/~1/g, "/").replace(/~0/g, "~");
            if (!keys.has(name) && !/^(0|[1-9]\d*)$/.test(name)) break;
            pointer += "/" + segment;
          }
          if (error.keyword === "required") {
            const missing = (error.params as { missingProperty: string }).missingProperty;
            if (keys.has(missing)) pointer += "/" + missing.replace(/~/g, "~0").replace(/\//g, "~1");
          }
          return { code: keywordCodes[error.keyword] ?? "SCHEMA_" + error.keyword.toUpperCase(), pointer };
        }));
      },
    };
  } catch {
    return { ok: false, errors: [{ code: "SCHEMA_COMPILE_FAILED", pointer: "/schema_bundle" }] };
  }
}
