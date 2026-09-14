import { canonicalAlias } from "@/platform/pages/route-retirement";

export function GET(request: Request): Response {
  return canonicalAlias(request, "/problems/ac-blowing-warm-air");
}

export const HEAD = GET;
