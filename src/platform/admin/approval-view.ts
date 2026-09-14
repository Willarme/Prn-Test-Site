/** Approval evidence is IDs and summaries by contract. Keep malformed legacy
 * payloads from revealing credential-shaped fields or overwhelming the page. */
export function approvalEvidenceText(value: unknown): { text: string; truncated: boolean } {
  const seen = new WeakSet<object>();
  let text: string;
  try {
    text = JSON.stringify(value, (key, item: unknown) => {
      if (/(?:password|secret|credential|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)/i.test(key)) return "[credential omitted]";
      if (typeof item === "string") return item.replace(/\bsk-(?:or-v1-|proj-)?[A-Za-z0-9_-]{16,}/g, "[credential omitted]");
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[repeated reference]";
        seen.add(item);
      }
      return item;
    }, 2) ?? "Not recorded";
  } catch { text = "The recorded value could not be displayed."; }
  const truncated = text.length > 8000;
  return { text: truncated ? `${text.slice(0, 8000)}\n… Display limited to 8,000 characters; the stored record is unchanged.` : text, truncated };
}

/** Describes existing consumers only; approving an item creates no new scope. */
export function approvalEffect(kind: string | undefined): string {
  switch (kind) {
    case "data.repair": return "Approval records the decision and attempts the proposed repair through its existing safety checks. The returned repair result establishes whether it ran.";
    case "seo.opportunity_decision": return "Approval accepts the referenced opportunity and may create a staged draft through the existing factory. It does not publish a page.";
    case "seo.page_publish": return "This queue records a decision only. Actual publication remains on Pages and must pass its current independent release gate.";
    case "data.identity_merge": return "This queue records the decision. It does not execute an identity merge.";
    case "dictionary.definition_change": return "This queue records the decision. Applying a definition remains a separate guarded operation.";
    default: return "This queue records the decision. No automatic execution is defined for this item kind.";
  }
}
