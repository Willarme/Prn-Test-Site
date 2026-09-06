import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(join(tmpdir(), "demo-media-isolation-"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "demo/dev-db.json"));
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); rmSync(root, { recursive: true, force: true }); });

describe("private demo media boundaries", () => {
  it("stores and reads only inside the selected runtime directory", async () => {
    const { mediaStore, localMediaFile } = await import("@/platform/adapters/media-storage");
    const key = "rq_demo/door_photo/ev_test.png";
    await mediaStore().put(key, Buffer.from("image fixture"), "image/png");
    expect(readFileSync(join(root, "demo/media", key), "utf8")).toBe("image fixture");
    expect(localMediaFile(`local/${key}`)?.toString()).toBe("image fixture");
  });
  it("rejects traversal and Windows path syntax on both writes and reads", async () => {
    const { mediaStore, localMediaFile } = await import("@/platform/adapters/media-storage");
    mkdirSync(join(root, "demo"), { recursive: true });
    writeFileSync(join(root, "demo/link-secret.txt"), "private sentinel");
    for (const key of ["rq_demo/../../link-secret.txt", "rq_demo/../link-secret.txt", "rq_demo/door_photo/..\\..\\link-secret.txt", "C:/private/file.txt", "rq_demo/%2e%2e/link-secret.txt", "rq_demo/a/file.png:secret"]) {
      await expect(mediaStore().put(key, Buffer.from("bad"), "image/png")).rejects.toThrow("Invalid private media key");
      expect(localMediaFile(`local/${key}`)).toBeNull();
    }
    expect(localMediaFile("rq_demo/door_photo/ev_test.png")).toBeNull();
    expect(readFileSync(join(root, "demo/link-secret.txt"), "utf8")).toBe("private sentinel");
  });
});
