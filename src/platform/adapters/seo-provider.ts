import { dataForSeoConfigured } from "@/platform/adapters/dataforseo";

/** Server-side composition seam; consumers know readiness, not provider credentials. */
export function seoProviderConfigured(): boolean {
  return dataForSeoConfigured();
}
