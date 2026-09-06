import { runtimeStore } from "@/platform/stores/runtime";
import { ownerAllowed } from "@/platform/links/owner";
import { randomUUID } from "node:crypto";
import { appendIntakeEffort } from "@/platform/intake/effort";
import { regeneratePacket } from "@/platform/intake/complete";
import { journeySafetyRule } from "@/domain/problem/journey-safety";

/**
 * POST /api/packet/address — the job address the packet requires (Directions
 * §3.3; routine decision 10). A plain form post from the packet route's
 * address screen: saves through the store's append-only `saveJobAddress`
 * (a corrected address is a new row; the newest wins) and 303s back to the
 * packet. Nothing here is printed anywhere but the provider pages.
 *
 * Only ever redirects to a path on this site: `return_to` arrives in the
 * body, so it is checked before it is followed.
 */
export const dynamic = "force-dynamic";

const PROPERTY_TYPES = new Set(["single-family", "townhouse", "condo", "duplex", "mobile"]);

function field(form: FormData, name: string, max = 120): string | null {
  const raw = form.get(name);
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s+/g, " ").trim().slice(0, max);
  return v.length > 0 ? v : null;
}

function safePath(candidate: string | null, fallback: string): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  return candidate;
}

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const redirect = (path: string) => Response.redirect(new URL(path, origin), 303);

  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const requestId = form ? field(form, "request_id", 80) : null;
  if (!form || !requestId || !/^[A-Za-z0-9_-]+$/.test(requestId)) {
    return new Response("invalid", { status: 400 });
  }
  const keep = field(form, "k", 4096) || undefined;
  if (!(await ownerAllowed(requestId, keep))) return new Response("not found", { status: 404 });
  const fallback = `/packet/${encodeURIComponent(requestId)}${keep ? `?k=${encodeURIComponent(keep)}` : ""}`;
  const back = safePath(field(form, "return_to", 4300), fallback);
  const street = field(form, "street");
  const cityStateZip = field(form, "city_state_zip");
  if (!street || !cityStateZip) {
    const sep = back.includes("?") ? "&" : "?";
    return redirect(`${back}${sep}error=address`);
  }
  const typeRaw = field(form, "property_type", 40);
  const storeysRaw = field(form, "storeys", 20);

  const store = runtimeStore();
  const journey = await store.getJourney(requestId).catch(() => null);
  if (!journey) return new Response("not found", { status: 404 });
  const safety = journeySafetyRule(journey.problem);
  if (safety && !safety.intake_may_continue) return redirect(`/safety/${encodeURIComponent(safety.safety_rule_id)}`);
  const admission = await appendIntakeEffort({ request_id: requestId, tenant_id: journey.problem.tenant_id ?? "prn",
    operation_id: `address:${randomUUID()}`, kind: "answer", question_id: "property:address",
    question_type: "short_text", requirement_ids: ["property.street", "property.city_state_zip"],
    decision_reason: "A typed address group costs four units through every intake entry point." });
  if (!admission.accepted) return new Response("Your saved packet is available with the address still unknown. Intake is finished or has reached its effort limit.", { status: 409 });
  await store.saveJobAddress(requestId, {
    street,
    city_state_zip: cityStateZip,
    property_type: typeRaw && PROPERTY_TYPES.has(typeRaw) ? typeRaw : null,
    storeys: storeysRaw && /^\d storey$/.test(storeysRaw) ? storeysRaw : null,
  });
  await regeneratePacket(requestId);
  return redirect(back);
}
