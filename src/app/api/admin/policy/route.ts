import { NextResponse } from "next/server";
import { z } from "zod";
import { readAdminJson } from "@/platform/admin/body";
import { SeoFactoryPolicy } from "@/domain/search/policy";
import { adminBoundary, guardAdminMutation, guardAdminRead } from "@/platform/admin/request";
import { policyStore } from "@/platform/admin/data";
import { runtimeStore } from "@/platform/stores/runtime";

const Body = z.object({
  national_enabled: z.boolean(),
  national_target: z.number().int().safe().min(0),
  locals: z.array(
    z.object({
      local_target_id: z.string().min(1).max(200),
      state: z.string().length(2),
      county: z.string().min(1).max(200).nullable(),
      target_pages_per_period: z.number().int().safe().min(0),
    })
  ).max(100),
  target_qualified_pages_per_period: z.number().int().safe().min(0),
  max_new_pages_per_period: z.number().int().safe().min(0),
  min_opportunity_score: z.number().min(0).max(100),
  min_search_volume: z.number().int().safe().min(0).nullable(),
  max_keyword_difficulty: z.number().min(0).max(100).nullable(),
  discovery_scan_cadence: z.enum(["daily", "weekly", "monthly", "quarterly"]),
  max_external_seo_spend_usd_month: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  max_page_ai_spend_usd_month: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  daily_publish_cap: z.number().int().safe().min(0),
  allowed_categories: z.array(z.string().min(1).max(200)).max(100),
});

export async function GET(request: Request): Promise<NextResponse> {
  return adminBoundary(async () => {
    const refusal = await guardAdminRead(request);
    if (refusal) return refusal;
    return NextResponse.json(await policyStore().getActive());
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  return adminBoundary(async () => {
    const refusal = await guardAdminMutation(request);
    if (refusal) return refusal;
    const parsed = await readAdminJson(request, Body);
    if (!parsed.ok) return parsed.response;
    const store = policyStore();
    const active = await store.getActive();
    const b = parsed.data;
    const candidate = {
      ...active,
      geography_plan: {
        national: { enabled: b.national_enabled, target_pages_per_period: b.national_target },
        locals: b.locals,
      },
      target_qualified_pages_per_period: b.target_qualified_pages_per_period,
      max_new_pages_per_period: b.max_new_pages_per_period,
      min_opportunity_score: b.min_opportunity_score,
      min_search_volume: b.min_search_volume,
      max_keyword_difficulty: b.max_keyword_difficulty,
      discovery_scan_cadence: b.discovery_scan_cadence,
      max_external_seo_spend_usd_month: b.max_external_seo_spend_usd_month,
      max_page_ai_spend_usd_month: b.max_page_ai_spend_usd_month,
      daily_publish_cap: b.daily_publish_cap,
      allowed_categories: b.allowed_categories,
      version: active.version + 1,
      effective_from: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    };
    // Trial invariants (owner approval ON, target<=max, plan<=max, geography
    // rules) are enforced by the same contract everywhere.
    const valid = SeoFactoryPolicy.safeParse(candidate);
    if (!valid.success) {
      const issue = valid.error.issues[0];
      return NextResponse.json(
        { error: `Refused — ${issue.path.join(".")}: ${issue.message}` },
        { status: 422 }
      );
    }
    try {
      await store.save(valid.data);
      await runtimeStore().appendAudit({
        at: valid.data.effective_from,
        action: "policy.saved",
        target: `v${valid.data.version}`,
        detail: null,
      });
    } catch {
      return NextResponse.json(
        { error: "The admin action could not be saved. Try again later." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, version: valid.data.version });
  });
}
