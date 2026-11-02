/**
 * Time-windowed publishing from frontmatter: `publish_date` and
 * `unpublish_date`.
 *
 * A page is live when `publish_date <= now < unpublish_date`; either bound may
 * be absent. The window only ever *narrows* what `published` already allows
 * (`published: false` always wins). Nothing is written to the file: the index
 * is evaluated against the clock, and the engine rebuilds at the next
 * boundary so a page appears and disappears on time without a restart.
 *
 * Needs no admin plugin and no scheduler state.
 *
 * @module
 */

import { logger } from "../core/logger.ts";

/**
 * Parse a scheduling date from frontmatter into epoch milliseconds.
 *
 * YAML parsers turn an unquoted `2026-12-01T09:00:00Z` into a `Date`, so both
 * `Date` and ISO strings are accepted. A string without a zone (including a
 * bare `2026-12-01`) is read as UTC. Anything unparseable is ignored, with a
 * warning naming the page, rather than failing the whole index.
 */
export function parseScheduleDate(
  value: unknown,
  field: string,
  sourcePath: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let ms: number;
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === "string") {
    // `YYYY-MM-DDTHH:MM[:SS]` with no zone is parsed as local time by Date;
    // pin it to UTC so a page goes live at the same instant on every host.
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
    ms = Date.parse(hasZone || dateOnly ? value : `${value.trim()}Z`);
  } else {
    ms = NaN;
  }
  if (Number.isNaN(ms)) {
    logger.warn("content.schedule.invalid_date", { sourcePath, field, value: String(value) });
    return undefined;
  }
  return ms;
}

/** Whether `now` falls inside the page's publish window (open bounds when absent). */
export function isWithinPublishWindow(
  now: number,
  publishAt: number | undefined,
  unpublishAt: number | undefined,
): boolean {
  if (publishAt !== undefined && now < publishAt) return false;
  if (unpublishAt !== undefined && now >= unpublishAt) return false;
  return true;
}

/** The earliest publish/unpublish instant strictly after `now`, or `undefined`. */
export function nextScheduleBoundary(
  pages: ReadonlyArray<{ publishAt?: number; unpublishAt?: number }>,
  now: number,
): number | undefined {
  let next: number | undefined;
  for (const page of pages) {
    for (const t of [page.publishAt, page.unpublishAt]) {
      if (t !== undefined && t > now && (next === undefined || t < next)) next = t;
    }
  }
  return next;
}
