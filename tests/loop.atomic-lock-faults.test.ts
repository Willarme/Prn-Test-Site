import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ remaining: 0, attempts: 0, code: "EPERM" }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      if (String(args[0]).endsWith(".lock") && args[1] === "wx") {
        fault.attempts++;
        if (fault.remaining > 0) {
          fault.remaining--;
          throw Object.assign(new Error("injected lock contention"), { code: fault.code });
        }
      }
      return actual.openSync(...args);
    },
  };
});
import { withFileLock } from "@/platform/stores/atomic-file";

let dir: string | undefined;
afterEach(() => {
  vi.restoreAllMocks(); fault.remaining = 0; fault.attempts = 0;
  if (dir) rmSync(dir, { recursive: true, force: true });
});
describe("bounded Windows lock contention", () => {
  it.each(["EPERM", "EACCES", "EBUSY"])("retries %s and executes only after exclusive lock acquisition", errorCode => {
    dir = mkdtempSync(join(tmpdir(), "prn-lock-fault-"));
    const file = join(dir, "data.json");
    fault.code = errorCode; fault.remaining = 2;
    const action = vi.fn(() => {
      expect(fault.attempts).toBe(3);
      expect(existsSync(`${file}.lock`)).toBe(true);
      return "written";
    });
    expect(withFileLock(file, action)).toBe("written");
    expect(action).toHaveBeenCalledTimes(1);
    expect(existsSync(`${file}.lock`)).toBe(false);
  });
  it("persistent access denial reaches the deadline without executing the write", () => {
    dir = mkdtempSync(join(tmpdir(), "prn-lock-fault-"));
    fault.code = "EPERM"; fault.remaining = Infinity;
    let time = 0;
    vi.spyOn(Date, "now").mockImplementation(() => time += 6_000);
    const action = vi.fn();
    expect(() => withFileLock(join(dir!, "data.json"), action)).toThrow(/busy/);
    expect(action).not.toHaveBeenCalled();
    expect(fault.attempts).toBe(1);
  });
});
