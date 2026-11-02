import { assertEquals } from "@std/assert";
import {
  isWithinPublishWindow,
  nextScheduleBoundary,
  parseScheduleDate,
} from "../../src/content/schedule.ts";

const T = Date.UTC(2026, 11, 1, 9, 0, 0); // 2026-12-01T09:00:00Z

Deno.test("parseScheduleDate: Date, ISO with zone, offset, date-only and zoneless strings", () => {
  assertEquals(parseScheduleDate(new Date(T), "publish_date", "a.md"), T);
  assertEquals(parseScheduleDate("2026-12-01T09:00:00Z", "publish_date", "a.md"), T);
  assertEquals(parseScheduleDate("2026-12-01T10:00:00+01:00", "publish_date", "a.md"), T);
  assertEquals(parseScheduleDate("2026-12-01", "publish_date", "a.md"), Date.UTC(2026, 11, 1));
  // No zone → UTC, not the host's local time
  assertEquals(parseScheduleDate("2026-12-01T09:00:00", "publish_date", "a.md"), T);
});

Deno.test("parseScheduleDate: empty values are absent, garbage is ignored", () => {
  assertEquals(parseScheduleDate(undefined, "publish_date", "a.md"), undefined);
  assertEquals(parseScheduleDate(null, "publish_date", "a.md"), undefined);
  assertEquals(parseScheduleDate("", "publish_date", "a.md"), undefined);
  assertEquals(parseScheduleDate("next tuesday", "publish_date", "a.md"), undefined);
  assertEquals(parseScheduleDate(12345, "publish_date", "a.md"), undefined);
});

Deno.test("isWithinPublishWindow: open bounds, publish is inclusive, unpublish is exclusive", () => {
  assertEquals(isWithinPublishWindow(T, undefined, undefined), true);
  assertEquals(isWithinPublishWindow(T - 1, T, undefined), false);
  assertEquals(isWithinPublishWindow(T, T, undefined), true);
  assertEquals(isWithinPublishWindow(T - 1, undefined, T), true);
  assertEquals(isWithinPublishWindow(T, undefined, T), false);
  assertEquals(isWithinPublishWindow(T + 5, T, T + 10), true);
  assertEquals(isWithinPublishWindow(T + 10, T, T + 10), false);
});

Deno.test("nextScheduleBoundary: earliest instant strictly after now, across both bounds", () => {
  const pages = [{ publishAt: T + 100 }, { unpublishAt: T + 50 }, { publishAt: T - 10, unpublishAt: T + 200 }, {}];
  assertEquals(nextScheduleBoundary(pages, T), T + 50);
  assertEquals(nextScheduleBoundary(pages, T + 50), T + 100);
  assertEquals(nextScheduleBoundary(pages, T + 200), undefined);
  assertEquals(nextScheduleBoundary([], T), undefined);
});
