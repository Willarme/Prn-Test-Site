import { afterEach, describe, expect, it, vi } from "vitest";

const cookieStore = { value: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieStore.value ? { value: cookieStore.value } : undefined) }),
}));

import {
  adminConfigured,
  adminMode,
  isAdminUnlocked,
  loginAllowed,
  passwordMatches,
  resetLoginAttempts,
  sessionCookie,
} from "@/platform/admin/auth";

const PASSWORD = "correct horse battery";

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
  cookieStore.value = undefined;
});

describe("owner admin auth", () => {
  it("is locked when no password is configured", async () => {
    expect(adminConfigured()).toBe(false);
    expect(await adminMode()).toBe("preview");
    expect(await isAdminUnlocked()).toBe(false);
  });

  it("rejects short passwords as unconfigured", () => {
    process.env.ADMIN_PASSWORD = "short";
    expect(adminConfigured()).toBe(false);
  });

  it("matches only the exact password", () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    expect(passwordMatches(PASSWORD)).toBe(true);
    expect(passwordMatches(PASSWORD + "x")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });

  it("issues a session cookie that unlocks, and is not the password itself", async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    const cookie = sessionCookie(PASSWORD);
    expect(cookie.value).not.toContain(PASSWORD);
    cookieStore.value = cookie.value;
    expect(await isAdminUnlocked()).toBe(true);
    expect(await adminMode()).toBe("unlocked");
  });

  it("rejects a tampered or forged cookie", async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    const cookie = sessionCookie(PASSWORD);
    cookieStore.value = cookie.value.replace(/.$/, "0");
    expect(await isAdminUnlocked()).toBe(false);
    cookieStore.value = `${Date.now()}.deadbeef`;
    expect(await isAdminUnlocked()).toBe(false);
    cookieStore.value = "garbage";
    expect(await isAdminUnlocked()).toBe(false);
  });

  it("expires a session server-side even if the browser keeps the cookie", async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    const stale = sessionCookie(PASSWORD);
    const [, mac] = stale.value.split(".");
    const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
    cookieStore.value = `${thirteenHoursAgo}.${mac}`;
    expect(await isAdminUnlocked()).toBe(false);
  });

  it("stops working when the owner rotates the password", async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    cookieStore.value = sessionCookie(PASSWORD).value;
    expect(await isAdminUnlocked()).toBe(true);
    process.env.ADMIN_PASSWORD = "a different password";
    expect(await isAdminUnlocked()).toBe(false);
  });

  it("throttles repeated sign-in attempts", () => {
    resetLoginAttempts("test-ip");
    const results = Array.from({ length: 12 }, () => loginAllowed("test-ip"));
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
    expect(results[11]).toBe(false);
  });
});
