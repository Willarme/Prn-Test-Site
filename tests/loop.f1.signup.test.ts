import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FEATURES } from "@/platform/features/registry";
import { invalidateFeatureStates } from "@/platform/features/state";

vi.mock("@/platform/db/client", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/db/client")>(), serviceConfigured: () => false,
}));

/**
 * THE VOTE COLLECTOR.
 *
 * The one endpoint Melissa's product previews call. A vote must never fail
 * loudly at the visitor (their browser already kept a copy), and a "yes" is the
 * most identifying payload in the trial, so nothing about it is echoed back.
 */
let signupPost: (req: Request) => Promise<Response>;
let cwd: string;
let runtime: typeof import("@/platform/stores/runtime");
const realCwd = process.cwd();

beforeAll(async () => {
  // The fallback file is written under process.cwd()/data/runtime — point that
  // at a scratch directory so a test never writes into the developer's runtime.
  cwd = mkdtempSync(join(tmpdir(), "prn-signup-"));
  process.chdir(cwd);
  vi.stubEnv("PRN_DEV_DB_PATH", join(cwd, "data", "runtime", "dev-db.json"));
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("PRN_ADMIN_ORIGIN", "");
  runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  await runtime.runtimeStore().setFeatureStates({
    tenant_id: "prn", actor: "test", reason: "Explicit approved product PREVIEW fixture",
    decision_ref: "test-only", at: new Date().toISOString(),
    changes: FEATURES.map(feature => ({ feature_id: feature.id, state: feature.launch_state, expected_version: 0 })),
  });
  invalidateFeatureStates();
  ({ POST: signupPost } = await import("@/app/api/signup/route"));
});

afterAll(() => {
  process.chdir(realCwd);
  vi.unstubAllEnvs();
  runtime.resetRuntimeStore();
  invalidateFeatureStates();
  rmSync(cwd, { recursive: true, force: true });
});

function vote(body: unknown): Request {
  return new Request("http://localhost/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

/**
 * Since track F2b the route writes through the runtime store's `saveSignup`;
 * on the file backend that is the `signups` collection of the dev-db under
 * process.cwd()/data/runtime (the scratch directory above).
 */
function rows(): Record<string, unknown>[] {
  const path = join(cwd, "data", "runtime", "dev-db.json");
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf-8")) as { signups?: Record<string, unknown>[] }).signups ?? [];
}

describe("POST /api/signup", () => {
  it("records a no-vote with its reasons", async () => {
    const res = await signupPost(
      vote({
        vote: "no",
        page: "Dashboard v3",
        id: "browser-1",
        at: "2026-09-05 13:00",
        reasons: ["I would not use this", "Too much to set up"],
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const row = rows().find((r) => r.vote_id === "browser-1")!;
    expect(row.vote).toBe("no");
    expect(row.page).toBe("Dashboard v3");
    expect(row.reasons).toEqual(["I would not use this", "Too much to set up"]);
    expect(String(row.signup_id)).toMatch(/^su_/);
  });

  it("a yes that arrives twice from one browser replaces rather than duplicates", async () => {
    await signupPost(vote({ vote: "yes", page: "SmartQuote v3", id: "browser-2" }));
    await signupPost(
      vote({
        vote: "yes",
        page: "SmartQuote v3",
        id: "browser-2",
        name: "Sample Person",
        email: "sample@example.com",
        zip: "46032",
      })
    );
    const mine = rows().filter((r) => r.vote_id === "browser-2");
    expect(mine.length).toBe(1);
    expect(mine[0]!.email).toBe("sample@example.com");
    expect(mine[0]!.zip).toBe("46032");
  });

  it("never echoes what it was given back to the page", async () => {
    const res = await signupPost(
      vote({ vote: "yes", page: "Trust Network v3", id: "browser-3", email: "private@example.com" })
    );
    const text = await res.text();
    expect(text).not.toContain("private@example.com");
    expect(text).not.toContain("Trust Network v3");
  });

  it("rejects a payload that is not a vote", async () => {
    for (const bad of [{}, { vote: "maybe", page: "x" }, { vote: "yes" }, null]) {
      const res = await signupPost(vote(bad));
      expect(res.status).toBe(400);
    }
  });

  it("reports a failed write and persists the retry before acknowledging success", async () => {
    const store = runtime.runtimeStore();
    const save = vi.spyOn(store, "saveSignup").mockRejectedValueOnce(new Error("synthetic write failure"));
    try {
      const payload = { vote: "yes", page: "Dashboard v3", id: "retry-browser" };
      const failed = await signupPost(vote(payload));
      expect(failed.status).toBe(503);
      expect((await failed.json()).ok).toBe(false);
      expect(rows().some(row => row.vote_id === "retry-browser")).toBe(false);
      const saved = await signupPost(vote(payload));
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ ok: true, recorded: "file" });
      expect(rows().filter(row => row.vote_id === "retry-browser")).toHaveLength(1);
      expect(save).toHaveBeenCalledTimes(2);
    } finally { save.mockRestore(); }
  });

  it("rejects an unknown or retired Feature Lab page without adding a vote", async () => {
    const before = rows().length;
    for (const page of ["future/smartquote", "DIY Packet", "unknown"]) {
      const response = await signupPost(vote({ vote: "yes", page }));
      expect(response.status).toBe(404);
    }
    expect(rows()).toHaveLength(before);
  });

  it("rejects a cross-origin vote before persistence", async () => {
    const before = rows().length;
    const request = vote({ vote: "yes", page: "Dashboard v3" });
    request.headers.set("origin", "https://elsewhere.example");
    expect((await signupPost(request)).status).toBe(403);
    expect(rows()).toHaveLength(before);
  });
});
