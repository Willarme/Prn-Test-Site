import { NextResponse } from "next/server";
import { z } from "zod";
import { registryRowFor } from "@/domain/search/page-registry";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { policyStore } from "@/platform/admin/data";
import { loadPageCorpus } from "@/platform/search/page-corpus";
import { editStagedPage } from "@/platform/search/page-factory-run";

/**
 * THE OWNER'S EDIT of a staged page's unique fields.
 *
 * SERVER-SIDE ONLY, end to end. The form on /admin/pages/[page_spec_id] is a
 * SERVER component posting plain form-encoded data here — no client component
 * ever receives a PageSpec, which is condition C16's whole point. This route
 * redirects back rather than returning JSON so the flow needs no browser
 * JavaScript at all.
 *
 * The lint runs on the owner's text exactly as it runs on the machine's: a
 * guardrail that only applies to the agent is not a guardrail.
 */
const Body = z.object({
  page_spec_id: z.string().min(1),
  title: z.string().min(1).max(70),
  meta_description: z.string().min(1).max(170),
  h1: z.string().min(1),
  hero_headline: z.string().min(1),
  hero_subheadline: z.string(),
});

function back(pageSpecId: string, params: Record<string, string>): NextResponse {
  const query = new URLSearchParams(params).toString();
  return NextResponse.redirect(
    new URL(
      `/admin/pages/${encodeURIComponent(pageSpecId)}?${query}`,
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    ),
    { status: 303 }
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAdminUnlocked())) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const parsed = Body.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  const corpus = await loadPageCorpus();
  const spec = corpus.specs.find((s) => s.page_spec_id === parsed.data.page_spec_id);
  if (!spec) return NextResponse.json({ error: "unknown page" }, { status: 404 });

  // The six committed doors and the handcrafted sample predate the registry
  // table, so an edit to one creates its row rather than failing.
  const page =
    corpus.pages.find((p) => p.page_id === spec.page_id) ??
    registryRowFor(spec, new Date().toISOString().replace(/\.\d+Z$/, "Z"));

  const policy = await policyStore().getActive();
  try {
    const result = await editStagedPage({
      page,
      previousSpec: spec,
      edit: {
        title: parsed.data.title,
        meta_description: parsed.data.meta_description,
        h1: parsed.data.h1,
        hero_headline: parsed.data.hero_headline,
        hero_subheadline: parsed.data.hero_subheadline.trim() === "" ? null : parsed.data.hero_subheadline,
      },
      edited_by: "owner",
      policy: policy.page_factory,
    });

    if (result.blocked.length > 0) {
      return back(parsed.data.page_spec_id, {
        blocked: result.blocked.map((f) => `${f.check} @ ${f.where}: ${f.message}`).join(" | "),
      });
    }
    return back(result.spec!.page_spec_id, {
      saved: result.edited_fields.join(",") || "nothing changed",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not save the edit" },
      { status: 500 }
    );
  }
}
