import { notFound } from "next/navigation";
import { featureRouteRefusal } from "./state";

/** Route and action entry guards run before parsing tokens or reading records.
 * A storage/configuration failure never falls through to a functional flow. */
export async function refuseFeatureRoute(path: string, api = false): Promise<Response | null> {
  try { return await featureRouteRefusal(path, { api }); }
  catch { return new Response("not found", { status: 404, headers: { "Cache-Control": "private, no-store" } }); }
}

export async function requireFeaturePage(path: string): Promise<void> {
  if (await refuseFeatureRoute(path)) notFound();
}
