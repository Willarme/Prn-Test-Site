import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { readAdminJson } from "@/platform/admin/body";
import { featureDefinition } from "@/platform/features/registry";
import { readFeatureSnapshot, stateIn } from "@/platform/features/state";
import { anonymousFeatureVisitor, featureInterestOriginAllowed, interestHashes } from "@/platform/features/interest";
import { runtimeStore } from "@/platform/stores/runtime";

export const dynamic = "force-dynamic";

// Stage 13 replaces the retired Feature Lab contract with four product previews.
// No identity, arbitrary context, IP, user agent or public tenant input is accepted.
const InterestRequest = z.object({
  feature_id: z.string().min(1).max(80),
  feature_version: z.number().int().positive().safe(),
  page: z.string().regex(/^\/[a-zA-Z0-9/_-]{0,255}$/),
  answer: z.enum(["yes", "no", "maybe"]),
}).strict();

export async function POST(request: Request): Promise<NextResponse> {
  if (!featureInterestOriginAllowed(request)) return NextResponse.json({ ok: false, recorded: false }, { status: 403 });
  const read = await readAdminJson(request, InterestRequest, 2048);
  if (!read.ok) return read.response;
  const data = read.data;
  const definition = featureDefinition(data.feature_id);
  if (!definition?.marketing_path || definition.marketing_path !== data.page) return NextResponse.json({ ok: false, recorded: false }, { status: 404 });
  const visitor = anonymousFeatureVisitor(request);
  if (!visitor) return NextResponse.json({ ok: false, recorded: false, error: "Reload the preview to answer." }, { status: 403 });
  const snapshot = await readFeatureSnapshot({ fresh: true });
  if (!snapshot.verified) return NextResponse.json({ ok: false, recorded: false }, { status: 503 });
  if (stateIn(snapshot, data.feature_id) !== "PREVIEW" || snapshot.rows.get(data.feature_id)?.version !== data.feature_version) return NextResponse.json({ ok: false, recorded: false }, { status: 409 });
  try {
    const result = await runtimeStore().recordFeatureInterest({
      ...data, tenant_id: DEFAULT_TENANT_ID,
      ...interestHashes(visitor, DEFAULT_TENANT_ID, data.feature_id, data.feature_version),
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, recorded: true, created: result.created });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "FEATURE_INTEREST_RATE_LIMIT") return NextResponse.json({ ok: false, recorded: false }, { status: 429, headers: { "Retry-After": "60" } });
    if (code === "FEATURE_INTEREST_UNAVAILABLE") return NextResponse.json({ ok: false, recorded: false }, { status: 409 });
    return NextResponse.json({ ok: false, recorded: false }, { status: 503 });
  }
}
