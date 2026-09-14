import { canonicalAlias } from "@/platform/pages/route-retirement";

/** Preserve old links while dropping the retired body selector. */
export function GET(request: Request): Response {
  return canonicalAlias(request, "/local-records/methodology", ["old"]);
}

export const HEAD = GET;
