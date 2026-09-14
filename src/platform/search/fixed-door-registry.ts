import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import assetManifest from "../../../config/ac-door-assets.json";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";

/** Existing routes, not generated-page lifecycle or publication evidence.
 * Additional families need a real index route before entering this registry. */
export const ISSUE_LIBRARY_FAMILIES = [{ id: "cooling", label: "Cooling", path: "/cooling", source_family: "hvac" }] as const;
export const FIXED_DOORS = [{ id: "ac-blowing-warm-air", tenant_id: DEFAULT_TENANT_ID,
  canonical_path: "/problems/ac-blowing-warm-air", family_id: "cooling",
  source_path: assetManifest.source_path, source_sha256_lf: assetManifest.source_sha256_lf }] as const;
export interface FixedDoorAsset {
  kind: "fixed_asset"; id: string; tenant_id: string; canonical_path: string; family_id: string;
  source_sha256_lf: string; label: string; html: string;
}
/** Only the inline emphasis in the pinned document is supported. New shapes require review. */
function heading(html: string): string | null {
  const matches = [...html.matchAll(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/gi)];
  if (matches.length !== 1) return null;
  const text = matches[0][1].replace(/<\/?(?:em|strong|span)(?:\s[^>]*)?>/gi, "")
    .replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&nbsp;": " " })[entity]!)
    .replace(/\s+/g, " ").trim();
  return !text || /<|>|&(?:#\w+|\w+);/.test(text) ? null : text;
}
/** Shared selected bytes for the fixed route and directory. No invented QA/PUBLISHED/PageVersion. */
export async function readFixedDoor(id: string, reader: (path: string) => Promise<string> = path => readFile(path, "utf8")): Promise<FixedDoorAsset | null> {
  const registration = FIXED_DOORS.find(door => door.id === id);
  if (!registration) return null;
  try {
    const html = await reader(join(process.cwd(), registration.source_path));
    const digest = createHash("sha256").update(html.replace(/\r\n/g, "\n")).digest("hex");
    if (digest !== registration.source_sha256_lf) return null;
    const label = heading(html);
    if (!label) return null;
    return { kind: "fixed_asset", id: registration.id, tenant_id: registration.tenant_id,
      canonical_path: registration.canonical_path, family_id: registration.family_id, source_sha256_lf: digest, label, html };
  } catch { return null; }
}
export async function loadFixedDoors(): Promise<FixedDoorAsset[]> {
  const doors = await Promise.all(FIXED_DOORS.map(door => readFixedDoor(door.id)));
  return doors.filter((door): door is FixedDoorAsset => door !== null);
}
