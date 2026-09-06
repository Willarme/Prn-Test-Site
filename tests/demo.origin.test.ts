import { afterEach, expect, it, vi } from "vitest";
import { demoAwareOrigin } from "@/platform/demo-origin";
afterEach(() => vi.unstubAllEnvs());
it("uses the configured public preview origin instead of loopback or spoofed forwarded headers", () => {
  vi.stubEnv("PRN_CLIENT_DEMO", "1");
  vi.stubEnv("PRN_DEMO_PUBLIC_ORIGIN", "https://demo.example.test");
  expect(demoAwareOrigin(new Request("http://127.0.0.1:3189/packet/rq_test", { headers: { "x-forwarded-host": "evil.example" } }))).toBe("https://demo.example.test");
});
it("leaves ordinary runtime origin unchanged", () => {
  vi.stubEnv("PRN_CLIENT_DEMO", "0");
  vi.stubEnv("PRN_DEMO_PUBLIC_ORIGIN", "https://demo.example.test");
  expect(demoAwareOrigin(new Request("http://localhost:3188/demo"))).toBe("http://localhost:3188");
});
it("refuses invalid configured demo origins", () => {
  vi.stubEnv("PRN_CLIENT_DEMO", "1");
  for (const origin of ["http://demo.example", "https://name:pass@demo.example", "https://demo.example/path", "https://demo.example/?secret=1"]) {
    vi.stubEnv("PRN_DEMO_PUBLIC_ORIGIN", origin);
    expect(() => demoAwareOrigin(new Request("http://localhost/"))).toThrow();
  }
});
