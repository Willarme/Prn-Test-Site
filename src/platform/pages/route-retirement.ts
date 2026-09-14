import type { IntentPage, PageSpec } from "@/domain/search/pages";

/** T6-29 R3, system under c6ff9a. History is retained; a new door uses a new kit binding. */
export const LEGACY_DOOR_RETIREMENT = {
  decision_ref: "T6-29:R3:c6ff9a",
  retired_at: "2026-09-13T19:50:22Z",
  paths: [
    "/problems/ac-blowing-warm-air",
    "/problems/furnace-blowing-cold-air",
    "/problems/ac-freezing-up",
    "/problems/why-is-my-ac-not-cooling",
    "/problems/ac-not-turning-on",
  ],
} as const;

export function isRetiredLegacySpec(spec: PageSpec): boolean {
  return ["tpl_intent_page", "tpl_intent_page_faq"].includes(spec.template_id) && !spec.door_template &&
    (LEGACY_DOOR_RETIREMENT.paths as readonly string[]).includes(spec.canonical_path);
}

export function applyLegacyRetirement(row: IntentPage, specs: readonly PageSpec[]): IntentPage {
  const current = specs.find(spec => spec.page_spec_id === row.current_page_spec_id);
  if (!current || !isRetiredLegacySpec(current)) return row;
  return { ...row, lifecycle_status: "RETIRED", retired_at: LEGACY_DOOR_RETIREMENT.retired_at };
}

/** Only navigation methods redirect. Never forward a submitted body to another handler. */
export function canonicalAlias(request: Request, pathname: string, dropQuery: readonly string[] = []): Response {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  const target = new URL(request.url);
  target.pathname = pathname;
  for (const key of dropQuery) target.searchParams.delete(key);
  return new Response(null, { status: 308, headers: {
    Location: target.href,
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
  } });
}
