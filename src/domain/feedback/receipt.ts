/** A response code alone never establishes that a visitor's answer was saved. */
export function hasPersistedReceipt(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const receipt = value as { ok?: unknown; recorded?: unknown };
  return receipt.ok === true && (receipt.recorded === true || receipt.recorded === "file" || receipt.recorded === "supabase");
}
