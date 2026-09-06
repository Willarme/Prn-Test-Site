/**
 * Narrow projection for third-party narrative copy. Removes common email,
 * phone and explicitly labelled access-code forms; never mutates source data.
 * This is not a general PII classifier. Structured job addresses required by
 * the packet contract are handled separately and must not be passed here.
 */
export function redactSharedText(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[contact removed]")
    .replace(/(?<![\w])(?:\+?1[\s().-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/g, "[contact removed]")
    .replace(/\b((?:(?:door|gate|garage|lockbox|keypad|alarm|access)\s*(?:pin|code|combination)|PIN(?:\s+code)?))\s*(?:is\s*|[:=]\s*)?[A-Z0-9#*][A-Z0-9#*-]{2,15}\b/gi, "$1 [private detail removed]");
}
