import { adminMode } from "@/platform/admin/auth";
import { policyStore } from "@/platform/admin/data";
import { PolicyForm } from "@/components/admin/PolicyForm";

export const dynamic = "force-dynamic";

export default async function ControlsPage() {
  const mode = await adminMode();
  const p = await policyStore().getActive();
  const canEdit = mode === "unlocked";
  const disabledReason =
    mode === "preview"
      ? "Preview mode — configure ADMIN_PASSWORD to enable changes. Values shown are the live policy."
      : mode === "locked"
        ? "Sign in to change controls."
        : null;

  return (
    <div>
      <div className="eyebrow">Configuration over code · policy v{p.version}</div>
      <h1 className="d2">Page-creator controls</h1>
      <p className="lede" style={{ margin: "12px 0 24px" }}>
        These settings drive A04 research and A05 page building. Changes take effect on the next
        scheduled run without a deploy; every change is versioned and validated — settings that would
        break trial rules (like turning off your publish approval) are refused with the reason.
      </p>
      <PolicyForm
        canEdit={canEdit}
        disabledReason={disabledReason}
        initial={{
          version: p.version,
          national_enabled: p.geography_plan.national.enabled,
          national_target: p.geography_plan.national.target_pages_per_period,
          locals: p.geography_plan.locals,
          target_qualified_pages_per_period: p.target_qualified_pages_per_period,
          max_new_pages_per_period: p.max_new_pages_per_period,
          min_opportunity_score: p.min_opportunity_score,
          min_search_volume: p.min_search_volume,
          max_keyword_difficulty: p.max_keyword_difficulty,
          discovery_scan_cadence: p.discovery_scan_cadence,
          max_external_seo_spend_usd_month: p.max_external_seo_spend_usd_month,
          max_page_ai_spend_usd_month: p.max_page_ai_spend_usd_month,
          daily_publish_cap: p.daily_publish_cap,
          allowed_categories: p.allowed_categories,
        }}
      />
    </div>
  );
}
