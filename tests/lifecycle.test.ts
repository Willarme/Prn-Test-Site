import { describe, expect, it } from "vitest";
import {
  PAGE_LIFECYCLE_STATUSES,
  canTransition,
  assertTransition,
  type PageLifecycleStatus,
} from "@/domain/search/lifecycle";

describe("page lifecycle", () => {
  it("follows the approved happy path", () => {
    expect(canTransition("IDEA", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "STAGED")).toBe(true);
    expect(canTransition("STAGED", "QA_PASS")).toBe(true);
    expect(canTransition("QA_PASS", "PUBLISHED")).toBe(true);
    expect(canTransition("PUBLISHED", "REFRESH")).toBe(true);
    expect(canTransition("REFRESH", "STAGED")).toBe(true);
  });

  it("never skips the QA or owner gates", () => {
    expect(canTransition("IDEA", "PUBLISHED")).toBe(false);
    expect(canTransition("APPROVED", "PUBLISHED")).toBe(false);
    expect(canTransition("STAGED", "PUBLISHED")).toBe(false);
    expect(canTransition("IDEA", "STAGED")).toBe(false);
  });

  it("makes PUBLISHED reachable ONLY from QA_PASS — no path may skip QA + owner gate", () => {
    for (const from of PAGE_LIFECYCLE_STATUSES.filter((s) => s !== "QA_PASS")) {
      expect(canTransition(from, "PUBLISHED"), `${from} -> PUBLISHED must be illegal`).toBe(false);
    }
  });

  it("treats RETIRED as terminal", () => {
    for (const to of PAGE_LIFECYCLE_STATUSES) {
      expect(canTransition("RETIRED", to)).toBe(false);
    }
  });

  it("allows retiring from every non-terminal state", () => {
    for (const from of PAGE_LIFECYCLE_STATUSES.filter((s) => s !== "RETIRED")) {
      expect(canTransition(from, "RETIRED")).toBe(true);
    }
  });

  it("reaches every status from IDEA", () => {
    const seen = new Set<PageLifecycleStatus>(["IDEA"]);
    const queue: PageLifecycleStatus[] = ["IDEA"];
    while (queue.length) {
      const from = queue.pop()!;
      for (const to of PAGE_LIFECYCLE_STATUSES) {
        if (!seen.has(to) && canTransition(from, to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    expect([...seen].sort()).toEqual([...PAGE_LIFECYCLE_STATUSES].sort());
  });

  it("assertTransition throws with a readable message", () => {
    expect(() => assertTransition("IDEA", "PUBLISHED")).toThrow(/IDEA -> PUBLISHED/);
  });
});
