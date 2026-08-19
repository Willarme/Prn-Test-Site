import type { FieldRequirement } from "@/domain/intake/playbook";

/**
 * Deterministic extraction of required fields from the customer's own words
 * (Tier-0, no AI). If they already told us the brand, the model number, or
 * when it started, that field gets its green check automatically and we never
 * ask for it again — the owner's "don't ask for what you already have" rule.
 */
export interface DetectedField {
  field_key: string;
  value_text: string;
}

export function detectFields(description: string, fields: FieldRequirement[]): DetectedField[] {
  const out: DetectedField[] = [];
  for (const field of fields) {
    for (const src of field.auto_detect_patterns) {
      let re: RegExp;
      try {
        re = new RegExp(src, "i");
      } catch {
        continue;
      }
      const m = re.exec(description);
      if (m) {
        // Use the whole match as the human-readable value (e.g. "8 years old",
        // "since yesterday") except when a pattern isolates a code-like token
        // such as a model number — then the last group is the value.
        const groups = m.slice(1).filter((g) => typeof g === "string" && g.trim().length > 0);
        const lastGroup = groups.length > 0 ? groups[groups.length - 1].trim() : "";
        const looksLikeCode = /^[A-Z0-9][A-Z0-9-]{5,}$/.test(lastGroup);
        const value = (looksLikeCode ? lastGroup : m[0]).trim();
        out.push({ field_key: field.field_key, value_text: value });
        break;
      }
    }
  }
  return out;
}
