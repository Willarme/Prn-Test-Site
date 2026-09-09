import { expect, it } from "vitest";
import { wallClock, weekdayDayMon } from "@/domain/packet/dates";
import { formatWhen } from "@/platform/links/views";
import { renderPacketHtml } from "@/domain/packet/render";
import { thinInput } from "./loop.p1.fixtures";

it("renders Supabase UTC offsets and application Z timestamps at the same local time", () => {
  const iso = "2026-09-09T15:48:00Z";
  for (const suffix of ["Z", "+00:00", "+0000", "-00:00"]) {
    const timestamp = "2026-09-09T15:48:00" + suffix;
    expect(wallClock(timestamp)).toEqual(wallClock(iso));
    expect(weekdayDayMon(wallClock(timestamp)!,true)).toBe("Wed 9 Sep, 11:48");
    expect(formatWhen(timestamp)).toBe("Sep 9, 11:48 AM EDT");
  }
});

it("uses winter local time while preserving the authored nonzero-offset reference contract", () => {
  expect(weekdayDayMon(wallClock("2026-01-09T15:48:00+00:00")!,true)).toBe("Fri 9 Jan, 10:48");
  expect(weekdayDayMon(wallClock("2026-09-09T11:48:00-04:00")!,true)).toBe("Wed 9 Sep, 11:48");
  expect(wallClock("invalid")).toBeNull();
});

it("does not claim service-history questions were asked when the record has no answers", () => {
  const html = renderPacketHtml(thinInput()).html;
  expect(html).toContain("Unanswered questions remain visible gaps.");
  expect(html).not.toContain("Asked at intake so you don't have to.");
});
