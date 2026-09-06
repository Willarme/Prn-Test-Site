import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeLink, signLink, type LinkScope } from "@/platform/links/tokens";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";

/**
 * THE LINK LEDGER — which links a homeowner has generated for one request
 * (campaign track P3, 2026-09-05).
 *
 * tokens.ts mints and verifies; the runtime store keeps the REVOCATION
 * ledger. Neither remembers what was issued, and the homeowner's
 * "links I shared" page (/links/<request_id>) needs exactly that list to put
 * a switch-off button next to each one. This module is that memory: a small
 * per-request sidecar under data/runtime/links/, the same shape of thing as
 * F1's label-confidence sidecar (src/platform/intake/media.ts). File store
 * only, by design: the Supabase path gets a table when the loop leaves the
 * demo, and until then a missing sidecar reads as "nothing issued", never as
 * an error.
 *
 * WHAT IS STORED. The link id, its scope, the token itself, when it was
 * minted and when it expires. The token is a capability, so the file is
 * private material (data/runtime/ is gitignored) and the page that reads it
 * is gated. No personal data is ever written here: a contact goes to the
 * store's keep_claims collection, never to a link.
 *
 * The same sidecar keeps the one piece of Home Memory state the store's
 * KeepClaim row has no field for: whether the magic link that confirms the
 * claim has been tapped (`keep.confirmed_at`), and which outbox message
 * carried it (`keep.email_id`) so the pending state can point at the preview.
 */
export interface IssuedLink {
  link_id: string;
  scope: LinkScope;
  token: string;
  created_at: string;
  exp: string | null;
}

export interface KeepState {
  email_id: string | null;
  magic_id: string | null;
  confirmed_at: string | null;
}

export interface LinkLedger {
  request_id: string;
  links: IssuedLink[];
  keep: KeepState | null;
}

function ledgerPath(requestId: string): string {
  if (!/^[a-z0-9_-]+$/i.test(requestId)) throw new Error("Invalid request identifier");
  const base = process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data", "runtime");
  return join(base, "links", `${requestId}.json`);
}

export function readLinkLedger(requestId: string): LinkLedger {
  try {
    const raw = readFileSync(ledgerPath(requestId), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as LinkLedger).links) && (parsed as LinkLedger).request_id === requestId) {
      const ledger = parsed as LinkLedger;
      return { request_id: requestId, links: ledger.links, keep: ledger.keep ?? null };
    }
    throw new Error("Invalid link ledger");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || existsSync(`${ledgerPath(requestId)}.initialized`)) throw new Error("Link history is unavailable; existing links have been preserved.");
  }
  return { request_id: requestId, links: [], keep: null };
}

function writeLinkLedger(ledger: LinkLedger): void {
  const path = ledgerPath(ledger.request_id);
  writeFileAtomic(`${path}.initialized`, "1\n");
  writeFileAtomic(path, JSON.stringify(ledger, null, 2));
}

function updateLedger<T>(requestId: string, change: (ledger: LinkLedger) => T): T {
  return withFileLock(ledgerPath(requestId), () => {
    const ledger = readLinkLedger(requestId);
    const result = change(ledger);
    writeLinkLedger(ledger);
    return result;
  });
}

/** Remember a token somebody else already minted with signLink. Idempotent per link_id. */
export function recordIssuedLink(token: string): IssuedLink | null {
  const decoded = decodeLink(token);
  if (!decoded.ok) return null;
  return updateLedger(decoded.request_id, (ledger) => {
  const existing = ledger.links.find((l) => l.link_id === decoded.link_id);
  if (existing) return existing;
  const issued: IssuedLink = {
    link_id: decoded.link_id,
    scope: decoded.scope,
    token,
    created_at: new Date().toISOString(),
    exp: decoded.exp,
  };
  ledger.links.push(issued);
  return issued;
  });
}

/**
 * Mint AND remember: the one call the results page, the packet and the
 * share flows should make, so every link a homeowner generates shows up on
 * /links/<request_id> with its own switch. Magic links are deliberately not
 * ledgered (they are consumed once and expire in days; see /api/keep).
 */
export function issueLink(input: {
  scope: Exclude<LinkScope, "magic">;
  request_id: string;
  ttl_days?: number;
  extra?: Record<string, string>;
}): { token: string; link_id: string } {
  const token = signLink(input);
  const issued = recordIssuedLink(token);
  if (!issued) throw new Error("issueLink: a freshly signed token failed to decode");
  return { token, link_id: issued.link_id };
}

export function listIssuedLinks(requestId: string): IssuedLink[] {
  return readLinkLedger(requestId).links;
}

/** Does this link belong to this request, by our own record of issuing it? */
export function ledgerHasLink(requestId: string, linkId: string): boolean {
  return readLinkLedger(requestId).links.some((l) => l.link_id === linkId);
}

export function recordKeepRequested(
  requestId: string,
  keep: { email_id: string | null; magic_id: string }
): void {
  updateLedger(requestId, (ledger) => {
  // A fresh contact claim needs its own confirmation. An older magic link
  // must not certify the replacement contact currently shown on the page.
  ledger.keep = {
    email_id: keep.email_id,
    magic_id: keep.magic_id,
    confirmed_at: ledger.keep?.magic_id === keep.magic_id ? ledger.keep.confirmed_at : null,
  };
  });
}

/** The magic link was tapped: the claim is confirmed. Never un-confirms. */
export function markKeepConfirmed(requestId: string, at: string, magicId?: string): boolean {
  return updateLedger(requestId, (ledger) => {
  if (magicId && ledger.keep?.magic_id !== magicId) return false;
  ledger.keep = {
    email_id: ledger.keep?.email_id ?? null,
    magic_id: ledger.keep?.magic_id ?? null,
    confirmed_at: ledger.keep?.confirmed_at ?? at,
  };
  return true;
  });
}

export function readKeepState(requestId: string): KeepState | null {
  return readLinkLedger(requestId).keep;
}
