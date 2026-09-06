import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeProblemFixture, buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import { JobPacket } from "@/domain/problem/contracts";
import {
  JOURNEY_COOKIE_MAX_CHARS,
  JOURNEY_COOKIE_NAME,
  JourneyCookiePayload,
  PacketCookieView,
  decodeJourneyCookie,
  encodeJourneyCookie,
  projectPacketForCookie,
} from "@/domain/problem/journey-cookie";

/**
 * A02 STEP 8 — THE COOKIE FINDING (Loop Spec Audit A02 condition 6).
 *
 * THE DECISION, ON THE RECORD: the exposure is ACCEPTED and DOCUMENTED, and
 * narrowed as far as it can be narrowed without breaking the walkthrough it
 * exists for. It was NOT reduced to ids, because the audit's premise for that
 * option — "the server can rehydrate" — is false in the only environment where
 * this cookie is ever set. See the module header; the evidence is
 * stores/dev-db.ts:111-115.
 *
 * This suite is the pin: it states exactly what may travel, and fails the build
 * if anything else does.
 */

const NOW = "2026-08-25T12:00:00Z";
const DESCRIPTION = "The water heater is making a knocking sound and the water runs cold.";

function fullPacket(): JobPacket {
  const { problem, evidence } = analyzeProblemFixture({
    description: DESCRIPTION,
    intake_session_id: "is_1",
    problem_family_hint: null,
    now: NOW,
  });
  return JobPacket.parse({
    ...buildJobPacketFixture(problem, evidence, NOW),
    // Everything A02 added this wave, deliberately present on the source.
    tenant_id: "prn",
    status: "current",
    superseded_by: null,
    claim_basis: ["fc_secret_1"],
    evidence_basis: ["ev_secret_1"],
    generation_run_id: "ar_secret_1",
    uncertainty_notes: ["internal note"],
    safety_notes: ["internal safety note"],
    template_version: "packet-copy@1.0.0",
    model_id: null,
    privacy_marking: "USER_PRIVATE",
  });
}

describe("A02 — exactly what the prn_last_journey cookie may contain", () => {
  it("carries three top-level keys and no more", () => {
    expect(Object.keys(JourneyCookiePayload.shape).sort()).toEqual([
      "packet",
      "request_id",
      "safety_rule_id",
    ]);
  });

  it("carries NO ProblemRecord at all — only the one field the page reads", () => {
    const payload = {
      request_id: "rq_1",
      safety_rule_id: null,
      packet: projectPacketForCookie(fullPacket()),
    };
    const json = JSON.stringify(JourneyCookiePayload.parse(payload));
    for (const gone of [
      "problem_summary",
      "service_category",
      "intake_session_id",
      "evidence_ids",
      "claim_ids",
      "source_channel",
      "safety_state",
    ]) {
      // As a JSON KEY, so the packet's own `likely_service_category` — which
      // the page renders and which is a different field — is not a false hit.
      expect(json, `${gone} must not travel`).not.toContain(`"${gone}":`);
    }
  });

  it("excludes every field A02 added this wave — structurally, not by promise", () => {
    const view = projectPacketForCookie(fullPacket());
    for (const gone of [
      "claim_basis",
      "evidence_basis",
      "generation_run_id",
      "uncertainty_notes",
      "safety_notes",
      "superseded_by",
      "status",
      "privacy_marking",
      "tenant_id",
      "template_version",
      "model_id",
      "observed_statements",
    ]) {
      expect(view, gone).not.toHaveProperty(gone);
    }
    // …and the secret-marked values are nowhere in the serialized payload.
    const json = JSON.stringify(view);
    expect(json).not.toContain("fc_secret_1");
    expect(json).not.toContain("ev_secret_1");
    expect(json).not.toContain("ar_secret_1");
  });

  it("the projection is field-by-field, so a NEW packet field cannot ride along", () => {
    const src = readFileSync(join(process.cwd(), "src/domain/problem/journey-cookie.ts"), "utf-8");
    const fn = src.match(/export function projectPacketForCookie[\s\S]*?\n\}/)![0];
    // A spread would inherit every future field by default. There must not be one.
    expect(fn).not.toMatch(/\.\.\.packet/);
    // Every key it writes must be declared on the allow-list schema.
    const written = [...fn.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(10);
    for (const key of written) {
      expect(Object.keys(PacketCookieView.shape), `${key} is allow-listed`).toContain(key);
    }
  });

  it("round-trips, and refuses a payload for a different request", () => {
    const payload = {
      request_id: "rq_1",
      safety_rule_id: null,
      packet: projectPacketForCookie(fullPacket()),
    };
    const encoded = encodeJourneyCookie(payload)!;
    expect(encoded).not.toBeNull();
    expect(decodeJourneyCookie(encoded, "rq_1")).toEqual(payload);
    expect(decodeJourneyCookie(encoded, "rq_other")).toBeNull();
  });

  it("discards a WIDER cookie written by an older deploy instead of trusting it", () => {
    const wide = Buffer.from(
      JSON.stringify({
        request_id: "rq_1",
        problem: { problem_summary: "the homeowner's own words" },
        packet: fullPacket(),
      })
    ).toString("base64url");
    // The old shape has no top-level safety_rule_id and a packet with extra
    // keys; strict validation rejects it rather than partially trusting it.
    expect(decodeJourneyCookie(wide, "rq_1")).toBeNull();
  });

  it("refuses to set anything rather than truncating past the size cap", () => {
    const huge = projectPacketForCookie(fullPacket());
    const oversized = {
      request_id: "rq_1",
      safety_rule_id: null,
      packet: { ...huge, call_script: "x".repeat(JOURNEY_COOKIE_MAX_CHARS * 2) },
    };
    expect(encodeJourneyCookie(oversized)).toBeNull();
  });

  it("survives garbage without throwing", () => {
    expect(decodeJourneyCookie(undefined, "rq_1")).toBeNull();
    expect(decodeJourneyCookie("not-base64!!!", "rq_1")).toBeNull();
    expect(decodeJourneyCookie(Buffer.from("{").toString("base64url"), "rq_1")).toBeNull();
  });
});

describe("A02 — the mitigations are not relaxed, and there is only ONE cookie", () => {
  /**
   * MOVED 2026-09-05 (campaign track F1). The cookie is DECIDED in one place
   * and SET by whichever transport called `startIntake`: the JSON route, or
   * the static door page's multipart adapter. Both write the same name with
   * the same options, because neither of them chooses any of it.
   *
   * REPLACED 2026-09-05 (campaign track P3, `platform/links/owner.ts`). What
   * `startIntake` hands the transports is no longer the journey SNAPSHOT
   * (packet projection + safety rule, file store only, path=/results). It is
   * a signed, request-bound OWNER CAPABILITY: a keep-scoped link token, one
   * cookie name per request, path=/ so the results, links and revoke routes
   * all receive the same proof, set after the journey was saved, on every
   * store. It carries NO journey data, which is why the /results path scope
   * and the file-store-only guard that bounded the snapshot's exposure are
   * gone: there is nothing in it to expose. The snapshot cookie still exists
   * as a read-only fallback on the results page ("data only, grants no
   * authority" — owner.ts), so its allow-list above is still pinned, and this
   * block now pins the capability where IT is decided.
   */
  const liveSrc = readFileSync(join(process.cwd(), "src/platform/intake/start.ts"), "utf-8");
  const ownerSrc = readFileSync(join(process.cwd(), "src/platform/links/owner.ts"), "utf-8");

  it("still httpOnly, sameSite lax, secure in production — decided in owner.ts, set by start.ts", () => {
    const fn = ownerSrc.match(/export function createOwnerCookie[\s\S]*?\n\}/)![0];
    expect(fn).toMatch(/httpOnly: true/);
    expect(fn).toMatch(/sameSite: "lax"/);
    expect(fn).toMatch(/secure: process\.env\.NODE_ENV === "production"/);
    // path=/ is deliberate: a signed capability with no data in it is what
    // /results, /links and POST /api/links/revoke all check.
    expect(fn).toMatch(/path: "\/"/);
    // start.ts decides nothing itself: no inline options, no cookie name.
    expect(liveSrc).toMatch(/const cookie = createOwnerCookie\(requestId\)/);
    expect(liveSrc).not.toMatch(/options: \{/);
    expect(liveSrc).not.toMatch(/httpOnly/);
  });

  it("carries a signed request-bound capability, never the journey snapshot", async () => {
    // The snapshot's projection is not what start.ts sets any more.
    expect(liveSrc).not.toMatch(/encodeJourneyCookie|projectPacketForCookie|JOURNEY_COOKIE_NAME/);
    // The capability is created only AFTER the journey write succeeded.
    const saveAt = liveSrc.indexOf("await store.recordJourney(");
    const cookieAt = liveSrc.indexOf("createOwnerCookie(requestId)");
    expect(saveAt).toBeGreaterThan(0);
    expect(cookieAt).toBeGreaterThan(saveAt);

    const prior = process.env.LINK_SIGNING_SECRET;
    process.env.LINK_SIGNING_SECRET = "a02-cookie-pin-not-a-deploy-key-0123456789";
    try {
      const { __resetLinkSecretForTests, decodeLink } = await import("@/platform/links/tokens");
      const { createOwnerCookie, ownerCookieName } = await import("@/platform/links/owner");
      __resetLinkSecretForTests();
      const cookie = createOwnerCookie("rq_1");
      expect(cookie.name).toBe(ownerCookieName("rq_1"));
      expect(cookie.name).not.toBe(JOURNEY_COOKIE_NAME);
      // One name per request, so a second request's cookie cannot shadow it.
      expect(ownerCookieName("rq_other")).not.toBe(cookie.name);
      const decoded = decodeLink(cookie.value);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.scope).toBe("keep");
        expect(decoded.request_id).toBe("rq_1");
      }
      // Nothing from the packet rides in it: no JSON keys at all.
      expect(cookie.value).not.toMatch(/[{}":]/);
      expect(decodeJourneyCookie(cookie.value, "rq_1")).toBeNull();
    } finally {
      if (prior === undefined) delete process.env.LINK_SIGNING_SECRET;
      else process.env.LINK_SIGNING_SECRET = prior;
      const { __resetLinkSecretForTests } = await import("@/platform/links/tokens");
      __resetLinkSecretForTests();
    }
  });

  it("no second cookie exists anywhere in src/ — no regenerate or share variant", () => {
    const files = [
      "src/platform/intake/start.ts",
      "src/app/api/intake/route.ts",
      "src/app/api/intake/start/route.ts",
      "src/app/api/intake/answer/route.ts",
      "src/app/api/intake/media/route.ts",
      "src/app/api/packet-activity/route.ts",
      "src/app/results/[request_id]/page.tsx",
      "src/domain/problem/journey-cookie.ts",
    ];
    let setters = 0;
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf-8");
      setters += (src.match(/cookies\.set\(/g) ?? []).length;
      // A non-httpOnly variant is the one thing condition 6 forbids outright.
      expect(src, file).not.toMatch(/httpOnly:\s*false/);
      // No transport may name a cookie of its own: both setters pass through
      // the ONE payload `startIntake` built, or they set nothing.
      expect(src, file).not.toMatch(/cookies\.set\(\s*["'`]/);
    }
    // Two transports, one cookie: the JSON route and the door adapter.
    expect(setters).toBe(2);
    expect(JOURNEY_COOKIE_NAME).toBe("prn_last_journey");
  });

  it("the reader validates rather than casting — an unchecked cast is how it widens", () => {
    const pageSrc = readFileSync(
      join(process.cwd(), "src/app/results/[request_id]/page.tsx"),
      "utf-8"
    );
    expect(pageSrc).toMatch(/decodeJourneyCookie\(/);
    expect(pageSrc).not.toMatch(/JSON\.parse\(Buffer\.from\(/);
    expect(pageSrc).not.toMatch(/as \{\s*\n?\s*request_id: string/);
  });

  it("says out loud that §2's absolute claim is false, instead of repeating it", () => {
    const src = readFileSync(join(process.cwd(), "src/domain/problem/journey-cookie.ts"), "utf-8");
    expect(src).toMatch(/ACCEPTED, BOUNDED EXPOSURE/);
    expect(src).toMatch(/That was already false when it was written/);
    expect(src).toMatch(/NEVER GROW A NON-httpOnly VARIANT/);
  });
});
