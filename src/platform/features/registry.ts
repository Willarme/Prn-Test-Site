import type { FeatureState } from "@/domain/features/types";

export const FEATURE_DECISION_REF = "13e938/D5;30e5f8;plan-v2.2/20.14";
export type LaunchWord = "LIVE" | "TO BUILD" | "HIDDEN FOR NOW" | "COMING OUT" | "YOURS";
export interface FeatureDefinition {
  id: string; label: string; group: "Launch" | "Product previews" | "Hidden for now" | "Retired";
  launch_word: LaunchWord; launch_state: FeatureState; marketing_path?: string;
  /** A saved boundary is not evidence that the complete workspace is built. */
  live_eligible?: boolean;
}

/** Product explanations and the functional flows they describe are separate rows.
 * D5 never maps a hidden flow to PREVIEW. The original components remain saved. */
export const FEATURES: readonly FeatureDefinition[] = [
  { id: "door_pages", label: "Problem door pages", group: "Launch", launch_word: "LIVE", launch_state: "LIVE" },
  { id: "intake", label: "Describe a problem", group: "Launch", launch_word: "LIVE", launch_state: "LIVE" },
  { id: "walkthrough", label: "Guided checks", group: "Launch", launch_word: "LIVE", launch_state: "LIVE" },
  { id: "job_packet", label: "Job Packet and results", group: "Launch", launch_word: "LIVE", launch_state: "LIVE" },
  { id: "issue_library", label: "Issue Library", group: "Launch", launch_word: "TO BUILD", launch_state: "HIDDEN" },
  { id: "about", label: "About Us", group: "Launch", launch_word: "YOURS", launch_state: "HIDDEN" },
  { id: "faq", label: "Homeowner FAQ", group: "Launch", launch_word: "TO BUILD", launch_state: "HIDDEN" },
  { id: "explainers", label: "Help, methodology, terms and privacy", group: "Launch", launch_word: "LIVE", launch_state: "LIVE" },
  { id: "product_dashboard", label: "Customer Dashboard explanation", group: "Product previews", launch_word: "LIVE", launch_state: "PREVIEW", marketing_path: "/pages/dashboard" },
  { id: "product_trust_network", label: "Trust Network explanation", group: "Product previews", launch_word: "LIVE", launch_state: "PREVIEW", marketing_path: "/pages/trust-network" },
  { id: "product_smartquote", label: "SmartQuote Analyzer explanation", group: "Product previews", launch_word: "LIVE", launch_state: "PREVIEW", marketing_path: "/pages/smartquote" },
  { id: "product_home_memory", label: "Home Memory explanation", group: "Product previews", launch_word: "LIVE", launch_state: "PREVIEW", marketing_path: "/pages/home-memory" },
  { id: "keep", label: "Save this to my home / keep flow", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN" },
  { id: "ask", label: "Ask my people", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN" },
  { id: "send", label: "I already have someone / send to your own person", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN" },
  { id: "find", label: "Find someone for me", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "shared_links", label: "Links you shared / provider copy", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN" },
  { id: "customer_profile", label: "Customer profile and sign-in", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "account_details", label: "Customer account details", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "home_memory", label: "Home Memory workspace and account tab", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "trust_network", label: "Trust Network workspace and account tab", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "smartquote", label: "SmartQuote workspace and account tab", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "dashboard", label: "Customer Dashboard workspace and account tab", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "statistics_library", label: "Statistics library main page", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "statistics_categories", label: "Statistics family/category pages", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "statistics_all", label: "Statistics across all families", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN", live_eligible: false },
  { id: "pdf_keep_qr", label: "Page 1: keep QR card", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN" },
  { id: "pdf_ask_qr", label: "Page 1: ask QR card", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN" },
  { id: "demo", label: "Demo directory", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN" },
  { id: "feature_lab", label: "Future Feature Lab", group: "Retired", launch_word: "COMING OUT", launch_state: "HIDDEN" },
  { id: "staged_listing", label: "Public staged-page navigator", group: "Retired", launch_word: "COMING OUT", launch_state: "HIDDEN" },
  { id: "provider_os", label: "Provider OS explanation", group: "Hidden for now", launch_word: "HIDDEN FOR NOW", launch_state: "HIDDEN" },
];
const BY_ID = new Map(FEATURES.map(feature => [feature.id, feature]));
export function featureDefinition(id: string): FeatureDefinition | undefined { return BY_ID.get(id); }
export function productFeatureForPath(path: string): FeatureDefinition | undefined {
  return FEATURES.find(feature => feature.marketing_path === path.replace(/\/$/, ""));
}

/** Every entry is an actual route or an explicitly reserved direct-access boundary.
 * More specific paths come first; methodology is intentionally outside statistics. */
export function requiredFeaturesForPath(rawPath: string): string[] {
  let path: string;
  try { path = decodeURIComponent(rawPath.split("?")[0]!).replace(/\/+$/, "") || "/"; }
  catch { return ["unknown"]; }
  if (path === "/local-records/methodology" || path === "/repair-records/methodology") return ["explainers"];
  if (["/terms", "/privacy", "/what-this-tool-can-help-with", "/pages/overview"].includes(path)) return ["explainers"];
  if (path === "/pages/provider-os") return ["provider_os"];
  const product = productFeatureForPath(path);
  if (product) return [product.id];
  if (/^\/claim(?:\/|$)/.test(path)) return ["keep", "customer_profile"];
  if (/^\/(?:api\/)?keep(?:\/|$)/.test(path)) return ["keep"];
  if (/^\/(?:api\/)?ask(?:\/|$)/.test(path)) return ["ask"];
  if (/^\/(?:api\/)?(?:links|p)(?:\/|$)/.test(path)) return ["shared_links"];
  if (/^\/(?:api\/)?results\/[^/]+\/send(?:\/|$)/.test(path)) return ["send"];
  if (/^\/(?:api\/)?results\/[^/]+\/find(?:\/|$)/.test(path)) return ["find"];
  if (/^\/(?:api\/)?account(?:\/|$)/.test(path)) {
    const suffix = path.replace(/^\/(?:api\/)?account\/?/, "").split("/")[0];
    const child: Record<string, string> = { settings: "account_details", "home-memory": "home_memory", "trust-network": "trust_network", smartquote: "smartquote", dashboard: "dashboard" };
    return ["customer_profile", ...(suffix && child[suffix] ? [child[suffix]!] : [])];
  }
  if (/^\/(?:api\/)?(?:my-home|home-memory)(?:\/|$)/.test(path)) return ["customer_profile", "home_memory"];
  if (/^\/(?:api\/)?local-records(?:\/|$)/.test(path)) {
    const localPath = path.replace(/^\/api\//, "/");
    return ["statistics_library", ...(localPath === "/local-records" ? [] : [localPath === "/local-records/all" ? "statistics_all" : "statistics_categories"])];
  }
  if (/^\/demo(?:\/|$)/.test(path)) return ["demo"];
  if (/^\/future(?:\/|$)/.test(path)) return ["feature_lab"];
  if (path === "/problems") return ["issue_library"];
  if (/^\/problems\//.test(path)) return ["door_pages"];
  if (/^\/api\/intake\/(?:walkthrough|answer)(?:\/|$)/.test(path)) return ["intake", "walkthrough"];
  if (/^\/start(?:\/|$)|^\/api\/intake(?:\/|$)/.test(path)) return ["intake"];
  if (/^\/complete(?:\/|$)|^\/api\/complete(?:\/|$)/.test(path)) return ["walkthrough"];
  if (/^\/(?:results|packet)(?:\/|$)/.test(path)) return ["job_packet"];
  if (path === "/about") return ["about"];
  if (path === "/faq") return ["faq"];
  return [];
}
