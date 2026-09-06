import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * PRN_RUNTIME_STORE=file (track F2b): with the trial project's Supabase env
 * PRESENT, every backend chooser still picks the file backend. This is what
 * keeps a local demo or a test run from writing a customer-like row, a test
 * photo or a fixture vote into the real trial database.
 */
const saved: Record<string, string | undefined> = {};
const KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_JWT_SECRET", "PRN_RUNTIME_STORE"];

beforeAll(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  // Fake values — never the real ones; this test never opens a connection.
  process.env.SUPABASE_URL = "https://fakeproject.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  process.env.SUPABASE_ANON_KEY = "fake-anon-key";
  process.env.SUPABASE_JWT_SECRET = "fake-jwt-secret";
});

afterAll(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("PRN_RUNTIME_STORE=file overrides a configured Supabase env", () => {
  it("client.ts: serviceConfigured() and requestScopedConfigured() are false only under the override", async () => {
    vi.resetModules();
    delete process.env.PRN_RUNTIME_STORE;
    const withoutOverride = await import("@/platform/db/client");
    expect(withoutOverride.serviceConfigured()).toBe(true);
    expect(withoutOverride.requestScopedConfigured()).toBe(true);

    process.env.PRN_RUNTIME_STORE = "file";
    expect(withoutOverride.serviceConfigured()).toBe(false);
    expect(withoutOverride.requestScopedConfigured()).toBe(false);
    expect(withoutOverride.serviceClient()).toBeNull();
    expect(withoutOverride.requestScopedClient("rq_x")).toBeNull();
    expect(withoutOverride.fileStoreForced()).toBe(true);
  });

  it("runtime store and media store both resolve to the file backend under the override", async () => {
    vi.resetModules();
    process.env.PRN_RUNTIME_STORE = "file";
    const runtime = await import("@/platform/stores/runtime");
    runtime.resetRuntimeStore();
    expect(runtime.supabaseConfigured()).toBe(false);
    expect(runtime.runtimeStore().kind).toBe("file");
    expect(runtime.unguardedRuntimeStore().kind).toBe("file");
    const media = await import("@/platform/adapters/media-storage");
    expect(media.mediaStore().kind).toBe("file");
  });

  it("any other value is not the override: the chooser reports supabase when its env is present", async () => {
    vi.resetModules();
    process.env.PRN_RUNTIME_STORE = "supabase";
    const client = await import("@/platform/db/client");
    expect(client.fileStoreForced()).toBe(false);
    expect(client.serviceConfigured()).toBe(true);
    const runtime = await import("@/platform/stores/runtime");
    expect(runtime.supabaseConfigured()).toBe(true);
  });
});
