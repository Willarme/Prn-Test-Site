import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { signLink, verifyLink } from "@/platform/links/tokens";

/**
 * WHO COUNTS AS THE HOMEOWNER on the link-management surfaces (track P3):
 * /links/<request_id> and POST /api/links/revoke.
 *
 * Two proofs, either one enough:
 *   1. a signed keep-scoped owner cookie for this exact request;
 *   2. `k`, a keep-scoped token for the same request: the record's own
 *      capability link, printed on page 1 of the packet and carried by the
 *      keep flow's own pages and message.
 *
 * The owner cookie uses path=/ so the intake, results and link-management
 * routes receive the same proof. The older unsigned journey snapshot is
 * data only and grants no authority. A keep link also works on a new device.
 */
export async function ownerAllowed(requestId: string, k: string | undefined): Promise<boolean> {
  if (await hasOwnerAccess(requestId)) return true;
  try {
    if (k) {
      const keep = await verifyLink(k, "keep");
      return keep.ok && keep.request_id === requestId;
    }
  } catch {
    /* Unavailable revocation state never grants access. */
  }
  return false;
}

export function ownerCookieName(requestId: string): string {
  return `prn_owner_${createHash("sha256").update(requestId).digest("hex").slice(0, 20)}`;
}

/** A signed, request-bound owner capability; the old snapshot cookie is data only. */
export function createOwnerCookie(requestId: string) {
  return {
    name: ownerCookieName(requestId),
    value: signLink({ scope: "keep", request_id: requestId }),
    options: { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 90 * 24 * 60 * 60 },
  };
}

export async function hasOwnerAccess(requestId: string): Promise<boolean> {
  try {
    const raw = (await cookies()).get(ownerCookieName(requestId))?.value;
    if (!raw) return false;
    const link = await verifyLink(raw, "keep");
    return link.ok && link.request_id === requestId;
  } catch { return false; }
}
