import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { allStagedSpecs } from "@/platform/admin/data";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * The OWNER publish action — the only path from QA_PASS to PUBLISHED
 * (#14A 15.1 step 8, canon). Requires an unlocked admin session and a
 * QA-PASS page. Every action is audited.
 */
const Body = z.object({
  page_spec_id: z.string().min(1),
  action: z.enum(["publish", "unpublish"]),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAdminUnlocked())) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const specs = await allStagedSpecs();
  const spec = specs.find((s) => s.page_spec_id === parsed.data.page_spec_id);
  if (!spec) return NextResponse.json({ error: "unknown page" }, { status: 404 });
  if (parsed.data.action === "publish" && spec.qa.state !== "PASS") {
    return NextResponse.json({ error: "QA must PASS before publishing" }, { status: 409 });
  }

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const store = runtimeStore();
  try {
    await store.setPublished(spec, parsed.data.action === "publish");
    await store.appendAudit({
      at: now,
      action: `page.${parsed.data.action}`,
      target: spec.page_id,
      detail: spec.canonical_path,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not save: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
