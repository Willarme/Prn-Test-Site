import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { __resetLinkSecretForTests, decodeLink, signLink } from "@/platform/links/tokens";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-signing-boundary-"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "dev-db.json"));
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("LINK_SIGNING_SECRET", "");
  __resetLinkSecretForTests();
});
afterEach(() => { __resetLinkSecretForTests(); vi.unstubAllEnvs(); });

it.each(["NODE_ENV", "VERCEL"] as const)("%s production/hosted mode requires the explicit key before creating any local secret", (marker) => {
  vi.stubEnv(marker, marker === "NODE_ENV" ? "production" : "1");
  expect(() => signLink({ scope: "keep", request_id: "rq_signing_test" })).toThrow(/not configured/i);
  expect(existsSync(join(dir, "link-secret.txt"))).toBe(false);
  expect(existsSync(join(dir, "link-secret.txt.lock"))).toBe(false);
});

it("a cached development key cannot become an implicit production key", () => {
  const token = signLink({ scope: "keep", request_id: "rq_signing_test" });
  expect(decodeLink(token).ok).toBe(true);
  vi.stubEnv("NODE_ENV", "production");
  expect(() => signLink({ scope: "keep", request_id: "rq_signing_test" })).toThrow(/not configured/i);
  expect(() => decodeLink(token)).toThrow(/not configured/i);
});

it("an explicit key verifies across signer resets without local fallback", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-stable-explicit-signing-key-for-tests-only");
  const token = signLink({ scope: "packet", request_id: "rq_signing_test" });
  __resetLinkSecretForTests();
  expect(decodeLink(token)).toMatchObject({ ok: true, scope: "packet", request_id: "rq_signing_test" });
  expect(existsSync(join(dir, "link-secret.txt"))).toBe(false);
});

it("development fallback retains its existing restart stability", () => {
  const token = signLink({ scope: "keep", request_id: "rq_signing_test" });
  __resetLinkSecretForTests();
  expect(decodeLink(token)).toMatchObject({ ok: true, request_id: "rq_signing_test" });
  expect(existsSync(join(dir, "link-secret.txt"))).toBe(true);
});
