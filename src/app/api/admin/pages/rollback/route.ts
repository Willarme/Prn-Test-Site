import { NextResponse } from "next/server";
import { z } from "zod";
import { registryRowFor } from "@/domain/search/page-registry";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { policyStore } from "@/platform/admin/data";
import { loadPageCorpus } from "@/platform/search/page-corpus";
import { editStagedPage } from "@/platform/search/page-factory-run";

/**
 * THE OWNER'S ROLLBACK — canon 14A §17, Pages: "publish/rollback".
 *
 * There is no separate rollback state machine. A rollback IS an owner edit
 * whose values come from an older version: it goes through the same
 * editStagedPage path as any edit — new version at the front, QA reset to
 * PENDING, wording lint on the restored text, previous versions never
 * rewritten. History only ever grows forward, so even a rollback is
 * answerable later ("who rolled this back, to what, when").
 *
 * The POSTed id is the TARGET version to restore FROM. The route resolves the
 * page's CURRENT version from the registry itself and never trusts the
 * browser to name it.
 */
const Body = z.object({
  page_spec_id: z.string().min(1),
});

function back(request: Request, pageSpecId: string, params: Record<string, string>): NextResponse {
  const query = new URLSearchParams(params).toString();
  return NextResponse.redirect(
    new URL(`/admin/pages/${encodeURIComponent(pageSpecId)}?${query}`, request.url),
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
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const corpus = await loadPageCorpus();
  const target = corpus.specs.find((s) => s.page_spec_id === parsed.data.page_spec_id);
  if (!target) return NextResponse.json({ error: "unknown page" }, { status: 404 });

  // The CURRENT version is whichever spec the staged route would serve — the
  // highest version of the page, exactly what the /staged/[slug] test pins.
  // The registry's pointer when it exists says the same thing, but the
  // committed doors and the handcrafted sample predate the registry: fabricate
  // the row from the TARGET and "current" would equal the target, and every
  // rollback on those pages would answer "already on this version".
  const siblings = corpus.specs.filter((s) => s.page_id === target.page_id);
  const current = siblings.reduce((best, s) => (s.version > best.version ? s : best), target);

  const page =
    corpus.pages.find((p) => p.page_id === target.page_id) ??
    registryRowFor(current, new Date().toISOString().replace(/\.\d+Z$/, "Z"));

  if (current.page_spec_id === target.page_spec_id) {
    return back(request, current.page_spec_id, {
      saved: "already on this version — nothing to roll back",
    });
  }

  const policy = await policyStore().getActive();
  try {
    const result = await editStagedPage({
      page,
      previousSpec: current,
      edit: {
        title: target.title,
        meta_description: target.meta_description,
        h1: target.h1,
        hero_headline: target.hero.headline,
        hero_subheadline: target.hero.subheadline ?? null,
      },
      edited_by: `owner (rollback to v${target.version})`,
      policy: policy.page_factory,
    });

    if (result.blocked.length > 0) {
      return back(request, current.page_spec_id, {
        blocked:
          "The wording rules blocked this rollback: " +
          result.blocked.map((f) => `${f.check} @ ${f.where}: ${f.message}`).join(" | "),
      });
    }
    return back(request, result.spec!.page_spec_id, {
      saved: `rolled back — v${target.version}'s wording restored as v${result.spec!.version}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not roll back" },
      { status: 500 }
    );
  }
}
