import { NextResponse } from "next/server";
import { z } from "zod";
import { readAdminJson } from "@/platform/admin/body";
import { adminBoundary, adminError, guardAdminMutation, guardAdminRead } from "@/platform/admin/request";
import { featureAdminView } from "@/platform/features/admin";
import { featureDefinition } from "@/platform/features/registry";
import { presetChanges, readFeatureSnapshot, saveFeatureChanges } from "@/platform/features/state";

export const dynamic = "force-dynamic";
const State = z.enum(["LIVE", "PREVIEW", "HIDDEN"]);
const Change = z.object({ feature_id: z.string().regex(/^[a-z_]+$/).max(80), state: State, expected_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
const Reason = z.string().trim().min(3).max(500);
const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("changes"), changes: z.array(Change).min(1).max(100), reason: Reason }).strict(),
  z.object({ mode: z.literal("preset"), preset: z.enum(["launch", "show_all", "preview_only", "hide_all"]), expected_versions: z.record(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)), reason: Reason }).strict(),
]);

export async function GET(request: Request) {
  return adminBoundary(async () => {
    const refusal = await guardAdminRead(request);
    return refusal ?? NextResponse.json(await featureAdminView());
  });
}
export async function PUT(request: Request) {
  return adminBoundary(async () => {
    const refusal = await guardAdminMutation(request);
    if (refusal) return refusal;
    const body = await readAdminJson(request, Body, 24 * 1024);
    if (!body.ok) return body.response;
    const snapshot = await readFeatureSnapshot({ fresh: true });
    if (!snapshot.verified) return adminError("Feature storage is unavailable. No changes were saved.", 503);
    const input = body.data;
    const changes = input.mode === "changes" ? input.changes : presetChanges(snapshot, input.preset).map(change => ({ ...change, expected_version: input.expected_versions[change.feature_id] ?? -1 }));
    if (new Set(changes.map(change => change.feature_id)).size !== changes.length || changes.some(change => change.expected_version < 0 || !featureDefinition(change.feature_id))) return adminError("Invalid feature selection. Refresh the page.", 400);
    if (changes.some(change => {
      const definition = featureDefinition(change.feature_id)!;
      return (change.state === "PREVIEW" && !definition.marketing_path) ||
        (definition.live_eligible === false && change.state !== "HIDDEN") ||
        definition.launch_word === "TO BUILD" || definition.launch_word === "YOURS" ||
        (definition.group === "Retired" && change.state !== "HIDDEN");
    })) return adminError("Preview applies only to product explanations. Unbuilt and unruled pages stay unset; incomplete and retired features stay hidden.", 422);
    try { await saveFeatureChanges(changes, input.reason); }
    catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "FEATURE_STATE_CONFLICT") return adminError("A feature changed since this page loaded. Refresh before saving again.", 409);
      return adminError("The change could not be confirmed. Refresh to check the stored state before trying again.", 503);
    }
    return NextResponse.json({ ok: true, ...await featureAdminView() });
  });
}
