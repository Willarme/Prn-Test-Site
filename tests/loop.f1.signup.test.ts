import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE VOTE COLLECTOR.
 *
 * The one endpoint Melissa's product previews call. A vote must never fail
 * loudly at the visitor (their browser already kept a copy), and a "yes" is the
 * most identifying payload in the trial, so nothing about it is echoed back.
 */
let signupPost: (req: Request) => Promise<Response>;
let cwd: string;
const realCwd = process.cwd();

beforeAll(async () => {
  // The fallback file is written under process.cwd()/data/runtime — point that
  // at a scratch directory so a test never writes into the developer's runtime.
  cwd = mkdtempSync(join(tmpdir(), "prn-signup-"));
  process.chdir(cwd);
  ({ POST: signupPost } = await import("@/app/api/signup/route"));
});

afterAll(() => {
  process.chdir(realCwd);
  rmSync(cwd, { recursive: true, force: true });
});

function vote(body: unknown): Request {
  return new Request("http://localhost/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
});
