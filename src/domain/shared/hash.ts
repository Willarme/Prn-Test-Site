/**
 * Deterministic 32-bit short hash for READABLE INTERNAL ids (fixtures, slugs,
 * dedupe keys). NOT cryptographic and NOT collision-resistant — never use it
 * for access-control identifiers; those are crypto-random (see intake route).
 */
export function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
