import { NextResponse } from "next/server";
import { DoorAttribution } from "@/domain/intake/contracts";
import { attachMedia } from "@/platform/intake/media";
import { startIntake } from "@/platform/intake/start";

/**
 * THE DOOR ADAPTER — `POST /api/intake/start`, multipart/form-data.
 *
 * CONNECTION MAP - door to packet §3 asked for exactly this: keep the indexed
 * door page plain HTML (no React runtime on a door), and add ONE adapter route
 * that accepts the v41 form, records consent, calls the same intake capability
 * the JSON route calls, forwards the files to the same media capability, and
 * redirects. The alternative — mounting `StartRequestForm` into the console —
 * drags a client runtime into the door and re-opens the frozen-copy question on
 * every label.
 *
 * IT IS A FORM POST, so every outcome is a 303 to a page a browser can render.
 * A homeowner mid-problem never sees a JSON error body and never sees a 500:
 * the three outcomes are their walkthrough, the hazard screen, or the door
 * again with an `error` in the query string.
 */

/** The door's fields, exactly as the frozen v41 template names them. */
const FIELDS = [
  "problem_description",
  "page_id",
  "intent_cluster_id",
  "search_opportunity_id",
  "problem_family_hint",
  "landing_path",
  "disclosure_content_hash",
] as const;

const DEFAULT_DOOR = "/problems/ac-blowing-warm-air";

function text(form: FormData, name: string): string | null {
  const raw = form.get(name);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Only ever redirect to a path on this site. `landing_path` arrives in the
 * request body, so treating it as a redirect target without this check is an
 * open redirect with extra steps.
 */
function safeDoorPath(candidate: string | null): string {
  if (!candidate) return DEFAULT_DOOR;
  const pathname = candidate.split("?")[0]!.split("#")[0]!;
  // Backslashes and encoded separators can turn an apparent local path into
  // a browser network-path reference. Current door routes use plain slugs.
  return /^\/(?:[a-z0-9_-]+\/?)*$/i.test(pathname) ? pathname : DEFAULT_DOOR;
}

/**
 * The door has no error slot of its own. The query string is what it can carry
 * for the demo, and it is enough: the code is short, non-identifying, and the
 * page can be given a real inline message later without changing this route.
 */
function errorCode(status: number): string {
  if (status === 400) return "needs_description";
  if (status === 409) return "consent";
  if (status === 404) return "unavailable";
  return "try_again";
}

/** Empty file inputs post a zero-byte File with an empty name — skip those. */
function realFiles(form: FormData, name: string): File[] {
  return form
    .getAll(name)
    .filter((v): v is File => v instanceof File)
    .filter((f) => f.size > 0 && f.name.length > 0);
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  // Next's local request URL can say localhost while the browser used
  // 127.0.0.1. A relative Location preserves the host that owns the new cookie.
  const redirect = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  if (!form) return redirect(`${DEFAULT_DOOR}?error=try_again`);

  const values = Object.fromEntries(FIELDS.map((f) => [f, text(form!, f)])) as Record<
    (typeof FIELDS)[number],
    string | null
  >;
  const door = safeDoorPath(values.landing_path);

  /**
   * PRIOR CONTEXT, NOT TRUTH (DoorAttribution's own contract): the door says
   * which page this person came through; A01 is free to conclude differently.
   * `experiment_id` and `variant` are null because no experiment is running;
   * `referrer` is the browser's own Referer header, which is the only place the
   * static page could carry it from.
   */
  const attribution = DoorAttribution.parse({
    page_id: values.page_id,
    intent_cluster_id: values.intent_cluster_id,
    search_opportunity_id: values.search_opportunity_id,
    problem_family_hint: values.problem_family_hint,
    experiment_id: null,
    variant: null,
    referrer: request.headers.get("referer"),
    landing_path: door,
  });

  const outcome = await startIntake({
    description: values.problem_description ?? "",
    attribution,
    disclosure_content_hash: values.disclosure_content_hash ?? "",
    source: "door_form",
  });

  if (outcome.kind === "safety_halt") {
    // No ProblemRecord, no packet, no request id. The hazard screen carries the
    // approved copy for the rule that fired, looked up by id server-side.
    return redirect(`/safety/${encodeURIComponent(outcome.rule_id)}`);
  }
  if (outcome.kind === "error") {
    return redirect(`${door}?error=${errorCode(outcome.status)}#intake`);
  }

  /**
   * THE FILES, ATTACHED AFTER the request exists — a photo cannot be evidence
   * for a record that was never created, and the safety gate must have run
   * first. Each upload is independent: one refused file (wrong type, over the
   * cap, over the size limit) does not cost the homeowner the other files or
   * the request itself. They are already through the door by this point.
   */
  const uploads: { target: string; file: File }[] = [
    ...realFiles(form, "photos").map((file) => ({ target: "door_photo", file })),
    ...realFiles(form, "video").map((file) => ({ target: "door_video", file })),
    ...realFiles(form, "voice_note").map((file) => ({ target: "voice_note", file })),
  ];
  let refusedUploads = 0;
  for (const upload of uploads) {
    try {
      const result = await attachMedia({
        request_id: outcome.request_id,
        target: upload.target,
        file: upload.file,
        source: "door_form",
      });
      if (!result.ok) refusedUploads += 1;
    } catch {
      refusedUploads += 1;
    }
  }

  const next = new URL(outcome.next, origin);
  if (refusedUploads) next.searchParams.set("uploads", "partial");
  const res = redirect(next.pathname + next.search);
  if (outcome.cookie) {
    res.cookies.set(outcome.cookie.name, outcome.cookie.value, outcome.cookie.options);
  }
  return res;
}
